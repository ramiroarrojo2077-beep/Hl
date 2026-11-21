"""Rate limiting de ventana fija por clave (IP o usuario)."""

from __future__ import annotations

import time
from collections import defaultdict

from fastapi import HTTPException, Request, status

from app.core.config import get_settings
from app.core.redis import get_redis

_local: dict[str, tuple[int, int]] = defaultdict(lambda: (0, 0))


async def hit(key: str, limit: int, window_seconds: int = 60) -> bool:
    """Registra un acceso. Devuelve False si se superó el límite."""
    window = int(time.time() // window_seconds)
    redis = await get_redis()
    full_key = f"nexus:rl:{key}:{window}"
    if redis is not None:
        count = await redis.incr(full_key)
        if count == 1:
            await redis.expire(full_key, window_seconds + 1)
        return count <= limit
    current_window, count = _local[key]
    if current_window != window:
        current_window, count = window, 0
    count += 1
    _local[key] = (current_window, count)
    return count <= limit


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


async def limit_auth(request: Request) -> None:
    settings = get_settings()
    if not await hit(f"auth:{client_ip(request)}", settings.auth_rate_limit_per_minute):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Demasiados intentos. Esperá un minuto.")


def reset_local() -> None:
    _local.clear()
