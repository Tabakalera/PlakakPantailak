"""Prueba de acceso a Sunny Portal powered by ennexOS.

Inicia sesión con tu usuario (como lo hace la web), lista las plantas y pide
potencia actual y energía del día. Muestra cada paso para ver dónde falla.
Guarda las respuestas en bruto en la carpeta salida_prueba/.

Uso:
    pip install requests
    python probar_sunnyportal.py

Las credenciales se leen de un archivo .env (SMA_USER / SMA_PASSWORD) o se
piden por teclado. La contraseña solo se envía a login.sma.energy.
"""

from __future__ import annotations

import base64
import getpass
import hashlib
import json
import os
import re
import secrets
import sys
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path

import requests

CLIENT_ID = "SPpbeOS"
AUTH_BASE = "https://login.sma.energy/auth/realms/SMA/protocol/openid-connect"
REDIRECT_URI = "https://ennexos.sunnyportal.com/dashboard/initialize"
API = "https://uiapi.sunnyportal.com/api/v1"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)
API_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://ennexos.sunnyportal.com",
    "Referer": "https://ennexos.sunnyportal.com/",
}

AQUI = Path(__file__).parent
SALIDA = AQUI / "salida_prueba"


def paso(msg: str) -> None:
    print(f"\n==> {msg}")


def fallo(msg: str, r: requests.Response | None = None) -> None:
    print(f"    ✗ {msg}")
    if r is not None:
        print(f"      HTTP {r.status_code} {r.url}")
        print(f"      {r.text[:500]}")
    sys.exit(1)


def guardar(nombre: str, datos) -> None:
    SALIDA.mkdir(exist_ok=True)
    (SALIDA / f"{nombre}.json").write_text(
        json.dumps(datos, indent=2, ensure_ascii=False), encoding="utf-8"
    )


def leer_env() -> dict[str, str]:
    env = {}
    f = AQUI / ".env"
    if f.exists():
        for linea in f.read_text(encoding="utf-8").splitlines():
            linea = linea.strip()
            if linea and not linea.startswith("#") and "=" in linea:
                k, v = linea.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def login(s: requests.Session, usuario: str, clave: str) -> str:
    verifier = secrets.token_urlsafe(64)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )

    paso("1/3 Abriendo la página de login de SMA")
    r = s.get(
        f"{AUTH_BASE}/auth",
        params={
            "response_type": "code",
            "client_id": CLIENT_ID,
            "redirect_uri": REDIRECT_URI,
            "scope": "openid profile",
            "state": secrets.token_hex(16),
            "nonce": secrets.token_hex(16),
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        },
    )
    if r.status_code != 200:
        fallo("No se pudo abrir la página de login", r)
    m = re.search(r'<form[^>]*\saction=["\']([^"\']+)["\']', r.text, re.I)
    if not m:
        fallo("No encuentro el formulario de login (¿ha cambiado la web?)", r)
    accion = m.group(1).replace("&amp;", "&")
    print("    ✓ OK")

    paso("2/3 Enviando usuario y contraseña")
    r = s.post(
        urllib.parse.urljoin(r.url, accion),
        data={"username": usuario, "password": clave, "credentialId": ""},
        allow_redirects=False,
    )
    destino = r.headers.get("Location", "")
    if r.status_code not in (301, 302, 303) or "code=" not in destino:
        texto = r.text.lower()
        if "otp" in texto or "totp" in texto:
            fallo("La cuenta pide un segundo factor (2FA/OTP). Habrá que tratarlo aparte.")
        if "invalid" in texto or "incorrect" in texto or "ungültig" in texto:
            fallo("Usuario o contraseña incorrectos.")
        fallo("El login no devolvió un código de autorización", r)
    codigo = urllib.parse.parse_qs(urllib.parse.urlparse(destino).query)["code"][0]
    print("    ✓ OK")

    paso("3/3 Canjeando el código por un token")
    r = s.post(
        f"{AUTH_BASE}/token",
        data={
            "grant_type": "authorization_code",
            "code": codigo,
            "redirect_uri": REDIRECT_URI,
            "code_verifier": verifier,
            "client_id": CLIENT_ID,
        },
        headers={"Origin": "https://ennexos.sunnyportal.com"},
    )
    if r.status_code != 200:
        fallo("No se pudo obtener el token", r)
    print("    ✓ OK, sesión iniciada")
    return r.json()["access_token"]


def main() -> None:
    env = leer_env()
    usuario = env.get("SMA_USER") or os.environ.get("SMA_USER") or input("Usuario (email): ")
    clave = env.get("SMA_PASSWORD") or os.environ.get("SMA_PASSWORD") or getpass.getpass("Contraseña: ")

    s = requests.Session()
    s.headers["User-Agent"] = UA
    token = login(s, usuario, clave)
    h = {**API_HEADERS, "Authorization": f"Bearer {token}"}

    paso("Listando plantas")
    r = s.get(f"{API}/navigation", headers=h)
    if r.status_code != 200:
        fallo("Error al pedir la lista de plantas", r)
    nav = r.json()
    guardar("navigation", nav)
    items = nav if isinstance(nav, list) else [nav]
    plantas = [i for i in items if i.get("componentType") == "Plant" or "componentType" not in i]
    if not plantas:
        fallo("La cuenta no tiene plantas visibles. Mira salida_prueba/navigation.json")
    for p in plantas:
        print(f"    - {p.get('name')}  (componentId={p.get('componentId')})")
    planta = str(plantas[0]["componentId"])

    paso("Datos de la planta")
    r = s.get(f"{API}/plants/{planta}", headers=h)
    if r.status_code == 200:
        guardar("planta", r.json())
        print(f"    ✓ guardado en salida_prueba/planta.json")
    else:
        print(f"    ✗ HTTP {r.status_code}: {r.text[:300]}")

    paso("Potencia FV actual")
    r = s.get(
        f"{API}/widgets/gauge/power",
        params={"componentId": planta, "type": "PvProduction"},
        headers=h,
    )
    if r.status_code == 200:
        guardar("potencia", r.json())
        d = r.json()
        print(f"    ✓ {d.get('value')} W  ({d.get('timestamp')})")
    else:
        print(f"    ✗ HTTP {r.status_code}: {r.text[:300]}")

    paso("Energía FV de hoy")
    hoy = datetime.now().astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
    fmt = "%Y-%m-%dT%H:%M:%S.000Z"
    r = s.post(
        f"{API}/measurements/search",
        json={
            "queryItems": [
                {
                    "componentId": planta,
                    "channelId": "Measurement.Metering.TotWhOut.Pv",
                    "resolution": "OneDay",
                    "timezone": "Europe/Madrid",
                    "aggregate": "Dif",
                    "multiAggregate": "Sum",
                }
            ],
            "dateTimeBegin": hoy.astimezone(timezone.utc).strftime(fmt),
            "dateTimeEnd": (hoy + timedelta(days=1)).astimezone(timezone.utc).strftime(fmt),
        },
        headers=h,
    )
    if r.status_code == 200:
        guardar("energia_hoy", r.json())
        valores = [v["value"] for c in r.json() for v in c.get("values", []) if v.get("value") is not None]
        print(f"    ✓ {valores[-1] / 1000:.1f} kWh" if valores else "    ? sin valores (ver salida_prueba/energia_hoy.json)")
    else:
        print(f"    ✗ HTTP {r.status_code}: {r.text[:300]}")

    print("\nFin. Revisa la carpeta salida_prueba/ (no contiene tu contraseña).")


if __name__ == "__main__":
    main()
