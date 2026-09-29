"""Explora endpoints de la API para localizar consumo, red y curvas."""

import json
import sys
from pathlib import Path

from probar_sunnyportal import leer_env
from sunnyportal import SunnyPortal

PLANTA = "10688503"
SALIDA = Path(__file__).parent / "salida_prueba"
SALIDA.mkdir(exist_ok=True)

env = leer_env()
sp = SunnyPortal(env["SMA_USER"], env["SMA_PASSWORD"])


def probar(nombre, fn):
    try:
        d = fn()
        (SALIDA / f"{nombre}.json").write_text(json.dumps(d, indent=2, ensure_ascii=False), encoding="utf-8")
        txt = json.dumps(d, ensure_ascii=False)
        print(f"OK  {nombre}: {txt[:600]}")
    except Exception as e:
        print(f"ERR {nombre}: {e}")


pruebas = [a for a in sys.argv[1:]] or None
casos = {
    "w_energybalance": lambda: sp.get("/widgets/energybalance", componentId=PLANTA),
    "g_consumption": lambda: sp.get("/widgets/gauge/power", componentId=PLANTA, type="Consumption"),
    "g_meteringinout": lambda: sp.get("/widgets/gauge/power", componentId=PLANTA, type="MeteringInOut"),
    "m_energybalance": lambda: sp.get(f"/measurements/{PLANTA}/energybalance"),
    "m_energybalance_day": lambda: sp.get(
        f"/measurements/{PLANTA}/energybalance", periodType="Day", start="2026-09-29"
    ),
}
for k, f in casos.items():
    if not pruebas or k in pruebas:
        probar(k, f)
