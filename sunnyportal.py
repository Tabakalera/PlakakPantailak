"""Cliente mínimo de Sunny Portal powered by ennexOS.

Inicia sesión como el usuario en la web (OAuth2 + PKCE en login.sma.energy)
y llama a la API interna uiapi.sunnyportal.com con el token.
"""

from __future__ import annotations

import base64
import hashlib
import re
import secrets
import threading
import urllib.parse

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


class ErrorSunnyPortal(Exception):
    pass


class SunnyPortal:
    def __init__(self, usuario: str, clave: str) -> None:
        self.usuario = usuario
        self.clave = clave
        self.s = requests.Session()
        self.s.headers["User-Agent"] = UA
        self.token: str | None = None
        self.refresh: str | None = None
        self._lock = threading.Lock()

    # --- autenticación -----------------------------------------------------

    def login(self) -> None:
        verifier = secrets.token_urlsafe(64)
        challenge = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        self.s.cookies.clear()
        r = self.s.get(
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
            timeout=30,
        )
        r.raise_for_status()
        m = re.search(r'<form[^>]*\saction=["\']([^"\']+)["\']', r.text, re.I)
        if not m:
            raise ErrorSunnyPortal("No se encuentra el formulario de login")
        r = self.s.post(
            urllib.parse.urljoin(r.url, m.group(1).replace("&amp;", "&")),
            data={"username": self.usuario, "password": self.clave, "credentialId": ""},
            allow_redirects=False,
            timeout=30,
        )
        destino = r.headers.get("Location", "")
        if "code=" not in destino:
            raise ErrorSunnyPortal(f"Login rechazado (HTTP {r.status_code})")
        codigo = urllib.parse.parse_qs(urllib.parse.urlparse(destino).query)["code"][0]
        self._pedir_token(
            {
                "grant_type": "authorization_code",
                "code": codigo,
                "redirect_uri": REDIRECT_URI,
                "code_verifier": verifier,
                "client_id": CLIENT_ID,
            }
        )

    def _pedir_token(self, datos: dict) -> None:
        r = self.s.post(
            f"{AUTH_BASE}/token",
            data=datos,
            headers={"Origin": "https://ennexos.sunnyportal.com"},
            timeout=30,
        )
        r.raise_for_status()
        j = r.json()
        self.token = j["access_token"]
        self.refresh = j.get("refresh_token", self.refresh)

    def _renovar(self) -> None:
        try:
            if not self.refresh:
                raise ErrorSunnyPortal("sin refresh token")
            self._pedir_token(
                {"grant_type": "refresh_token", "refresh_token": self.refresh, "client_id": CLIENT_ID}
            )
        except Exception:
            self.login()

    # --- peticiones --------------------------------------------------------

    def _req(self, metodo: str, ruta: str, **kw):
        with self._lock:
            if not self.token:
                self.login()
            for intento in range(2):
                r = self.s.request(
                    metodo,
                    f"{API}{ruta}",
                    headers={**API_HEADERS, "Authorization": f"Bearer {self.token}"},
                    timeout=30,
                    **kw,
                )
                if r.status_code == 401 and intento == 0:
                    self._renovar()
                    continue
                break
            if r.status_code >= 400:
                raise ErrorSunnyPortal(f"HTTP {r.status_code} en {ruta}: {r.text[:300]}")
            return r.json() if r.content else None

    def get(self, ruta: str, **params):
        return self._req("GET", ruta, params=params or None)

    def post(self, ruta: str, cuerpo: dict):
        return self._req("POST", ruta, json=cuerpo)
