"""Cifrado simétrico de secretos en reposo (API keys, configuración de plugins).

Usa MultiFernet: la primera clave de NEXUS_ENCRYPTION_KEYS cifra y todas descifran,
lo que permite rotar claves sin perder datos.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.core.config import get_settings


@lru_cache
def _fernet() -> MultiFernet:
    keys = [k.strip() for k in get_settings().encryption_keys.split(",") if k.strip()]
    if not keys:
        raise RuntimeError("NEXUS_ENCRYPTION_KEYS está vacío")
    return MultiFernet([Fernet(k.encode()) for k in keys])


class DecryptionError(Exception):
    pass


def encrypt_str(value: str) -> str:
    return _fernet().encrypt(value.encode()).decode()


def decrypt_str(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:
        raise DecryptionError("No se pudo descifrar el secreto (¿clave rotada sin conservar la anterior?)") from exc


def encrypt_json(value: dict[str, Any]) -> str:
    return encrypt_str(json.dumps(value))


def decrypt_json(token: str | None) -> dict[str, Any]:
    if not token:
        return {}
    return json.loads(decrypt_str(token))


def mask_secret(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "••••"
    return f"{value[:3]}••••{value[-4:]}"


def generate_key() -> str:
    return Fernet.generate_key().decode()
