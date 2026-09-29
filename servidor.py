"""Servidor del dashboard de la instalación fotovoltaica de Tabakalera.

- Consulta Sunny Portal en segundo plano y guarda los últimos datos buenos.
- Sirve la pantalla (carpeta web/) y los datos en /api/datos.

Uso:
    python servidor.py            # http://localhost:8080
    PUERTO=9000 python servidor.py
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
from datetime import datetime
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from zoneinfo import ZoneInfo

from probar_sunnyportal import leer_env
from sunnyportal import SunnyPortal

AQUI = Path(__file__).parent
WEB = AQUI / "web"
CACHE = Path(os.environ.get("CACHE", AQUI / "cache_datos.json"))

# Hora local de la planta (en Docker el reloj va en UTC)
ZONA = ZoneInfo("Europe/Madrid")

# Cada cuánto se pide cada bloque (segundos)
CADA = {"ahora": 60, "dia": 300, "mes": 900, "anio": 900}

# Equivalencias (ajustables)
KWH_HOGAR_ANIO = 3500   # consumo eléctrico medio de un hogar en España, kWh/año
KG_CO2_ARBOL_ANIO = 22  # CO₂ que absorbe un árbol adulto en un año, kg
CO2_G_KWH_DEFECTO = 400  # si el portal no da factor propio

log = logging.getLogger("tbk")


class Recolector:
    def __init__(self, sp: SunnyPortal) -> None:
        self.sp = sp
        self.planta: str | None = None
        self.info: dict = {}
        self.brutos: dict = {}
        self.ultima: dict[str, float] = {}
        self.error: str | None = None
        self.lock = threading.Lock()
        if CACHE.exists():
            try:
                c = json.loads(CACHE.read_text(encoding="utf-8"))
                self.brutos, self.info, self.planta = c["brutos"], c["info"], c["planta"]
            except Exception:
                log.warning("No se pudo leer la caché, se ignora")

    # --- consultas a Sunny Portal ------------------------------------------

    def _preparar(self) -> None:
        if self.planta and self.info:
            return
        nav = self.sp.get("/navigation")
        items = nav if isinstance(nav, list) else [nav]
        planta = next(i for i in items if i.get("componentType") == "Plant" or "componentType" not in i)
        self.planta = str(planta["componentId"])
        self.info = self.sp.get(f"/plants/{self.planta}")

    def _balance(self, intervalo: str, inicio: date) -> dict:
        return self.sp.get(
            f"/measurements/{self.planta}/energybalance",
            interval=intervalo,
            dateBeginLocal=inicio.isoformat(),
        )

    def actualizar(self, forzar: bool = False) -> None:
        self._preparar()
        hoy = datetime.now(ZONA).date()
        tareas = {
            "ahora": lambda: self.sp.get("/widgets/energybalance", componentId=self.planta),
            "dia": lambda: self._balance("Day", hoy),
            "mes": lambda: self._balance("Month", hoy.replace(day=1)),
            "anio": lambda: self._balance("Year", hoy.replace(month=1, day=1)),
        }
        ahora = time.time()
        cambios = False
        for clave, fn in tareas.items():
            # al cambiar de día se refresca todo aunque no toque
            cambio_dia = self.brutos.get("fecha") != hoy.isoformat()
            if forzar or cambio_dia or ahora - self.ultima.get(clave, 0) >= CADA[clave]:
                datos = fn()
                with self.lock:
                    self.brutos[clave] = datos
                self.ultima[clave] = ahora
                cambios = True
        if cambios:
            with self.lock:
                self.brutos["fecha"] = hoy.isoformat()
                self.brutos["actualizado"] = datetime.now(ZONA).isoformat(timespec="seconds")
                CACHE.write_text(
                    json.dumps({"brutos": self.brutos, "info": self.info, "planta": self.planta}),
                    encoding="utf-8",
                )

    def bucle(self) -> None:
        espera = 10
        while True:
            try:
                self.actualizar()
                if self.error:
                    log.info("Conexión recuperada")
                self.error = None
                espera = 10
            except Exception as e:  # noqa: BLE001
                self.error = str(e)
                log.warning("Fallo al consultar Sunny Portal: %s", e)
                espera = min(espera * 2, 300)
                time.sleep(espera)
                continue
            time.sleep(10)

    # --- datos para la pantalla --------------------------------------------

    def resumen(self) -> dict:
        with self.lock:
            b = dict(self.brutos)
        kw = lambda w: round((w or 0) / 1000, 1)  # noqa: E731
        kwh = lambda wh: round((wh or 0) / 1000)  # noqa: E731
        g_kwh = self.info.get("co2SavingsFactor") or CO2_G_KWH_DEFECTO

        def acumulado(bloque: str) -> dict:
            t = (b.get(bloque) or {}).get("total") or {}
            return {"produccion_kwh": kwh(t.get("pvGeneration")), "consumo_kwh": kwh(t.get("totalConsumption"))}

        acum = {k: acumulado(k) for k in ("dia", "mes", "anio")}
        co2 = {k: round(v["produccion_kwh"] * g_kwh / 1000) for k, v in acum.items()}

        a = b.get("ahora") or {}
        curva = [
            {
                "t": p["timeUtc"],
                "fv": kw(p.get("pvGeneration")),
                "consumo": kw(p.get("totalConsumption")),
            }
            for p in (b.get("dia") or {}).get("detail", [])
            if p.get("totalConsumption") is not None or p.get("pvGeneration") is not None
        ]

        return {
            "planta": {"nombre": self.info.get("name"), "pico_kwp": (self.info.get("peakPower") or 0) / 1000},
            "actualizado": b.get("actualizado"),
            "medida": a.get("time"),
            "error": self.error,
            "ahora": {
                "fv_kw": kw(a.get("pvGeneration")),
                "fv_consumida_kw": kw(a.get("directConsumption")),
                "red_kw": kw(a.get("externalConsumption")),
                "vertido_kw": kw(a.get("feedIn")),
                "consumo_kw": kw(a.get("totalConsumption")),
            },
            "acumulado": acum,
            "co2_kg": co2,
            "equivalencias": {
                "hogares": round(acum["anio"]["produccion_kwh"] / KWH_HOGAR_ANIO),
                "arboles": round(co2["anio"] / KG_CO2_ARBOL_ANIO),
                "kwh_hogar": KWH_HOGAR_ANIO,
                "kg_arbol": KG_CO2_ARBOL_ANIO,
            },
            "curva": curva,
        }


class Manejador(SimpleHTTPRequestHandler):
    recolector: Recolector

    def do_GET(self):
        if self.path.split("?")[0] == "/api/datos":
            cuerpo = json.dumps(self.recolector.resumen(), ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(cuerpo)))
            self.end_headers()
            self.wfile.write(cuerpo)
            return
        super().do_GET()

    def end_headers(self):
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        log.debug(fmt, *args)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    env = leer_env()
    usuario = env.get("SMA_USER") or os.environ.get("SMA_USER")
    clave = env.get("SMA_PASSWORD") or os.environ.get("SMA_PASSWORD")
    if not usuario or not clave:
        raise SystemExit("Faltan SMA_USER / SMA_PASSWORD en .env")

    rec = Recolector(SunnyPortal(usuario, clave))
    try:
        rec.actualizar(forzar=True)
        log.info("Primeros datos cargados de la planta %s", rec.info.get("name"))
    except Exception as e:  # noqa: BLE001
        rec.error = str(e)
        log.warning("No se pudieron cargar datos al arrancar: %s", e)
    threading.Thread(target=rec.bucle, daemon=True).start()

    Manejador.recolector = rec
    puerto = int(os.environ.get("PUERTO", env.get("PUERTO", 8080)))
    srv = ThreadingHTTPServer(("0.0.0.0", puerto), partial(Manejador, directory=str(WEB)))
    log.info("Dashboard en http://localhost:%s", puerto)
    srv.serve_forever()


if __name__ == "__main__":
    main()
