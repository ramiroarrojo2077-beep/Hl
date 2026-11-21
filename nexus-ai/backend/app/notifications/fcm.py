"""Envío de notificaciones push con Firebase Cloud Messaging (API HTTP v1).

Requiere NEXUS_FCM_SERVICE_ACCOUNT_FILE con la clave de una cuenta de servicio de
Firebase. Sin esa configuración, las notificaciones siguen llegando por WebSocket y por
la sincronización periódica de la app, y quedan marcadas como `push_not_configured`.
"""

from __future__ import annotations

import json
import logging
import time
from functools import lru_cache
from typing import Any

import httpx
import jwt

from app.core.config import get_settings

logger = logging.getLogger(__name__)
TOKEN_URL = "https://oauth2.googleapis.com/token"
SCOPE = "https://www.googleapis.com/auth/firebase.messaging"

_cached_token: tuple[str, float] | None = None


@lru_cache
def _service_account() -> dict[str, Any] | None:
    path = get_settings().fcm_service_account_file
    if not path:
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except OSError as exc:
        logger.error("No se pudo leer la cuenta de servicio de FCM: %s", exc)
        return None


def is_configured() -> bool:
    return _service_account() is not None


async def _access_token(client: httpx.AsyncClient) -> str:
    global _cached_token
    if _cached_token and _cached_token[1] > time.time() + 60:
        return _cached_token[0]
    sa = _service_account()
    assert sa is not None
    now = int(time.time())
    assertion = jwt.encode(
        {"iss": sa["client_email"], "scope": SCOPE, "aud": TOKEN_URL, "iat": now, "exp": now + 3600},
        sa["private_key"],
        algorithm="RS256",
    )
    resp = await client.post(
        TOKEN_URL,
        data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion},
        timeout=20,
    )
    resp.raise_for_status()
    data = resp.json()
    _cached_token = (data["access_token"], now + int(data.get("expires_in", 3600)))
    return _cached_token[0]


async def send_push(tokens: list[str], title: str, body: str, data: dict[str, str]) -> tuple[str, list[str]]:
    """Devuelve (estado, tokens_inválidos)."""
    sa = _service_account()
    if sa is None:
        return "push_not_configured", []
    if not tokens:
        return "no_devices", []
    invalid: list[str] = []
    sent = 0
    async with httpx.AsyncClient() as client:
        try:
            access = await _access_token(client)
        except httpx.HTTPError as exc:
            logger.error("FCM: no se obtuvo token OAuth: %s", exc)
            return "failed", []
        url = f"https://fcm.googleapis.com/v1/projects/{sa['project_id']}/messages:send"
        for token in tokens:
            message = {
                "message": {
                    "token": token,
                    "notification": {"title": title, "body": body[:500]},
                    "data": {k: str(v) for k, v in data.items()},
                    "android": {"priority": "high", "notification": {"channel_id": "nexus_events"}},
                }
            }
            try:
                resp = await client.post(url, json=message, headers={"authorization": f"Bearer {access}"}, timeout=20)
            except httpx.HTTPError as exc:
                logger.warning("FCM: error de red: %s", exc)
                continue
            if resp.status_code == 200:
                sent += 1
            elif resp.status_code in (400, 404) and ("UNREGISTERED" in resp.text or "INVALID_ARGUMENT" in resp.text):
                invalid.append(token)
            else:
                logger.warning("FCM respondió %s: %s", resp.status_code, resp.text[:200])
    return ("sent" if sent else "failed"), invalid
