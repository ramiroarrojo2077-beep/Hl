"""Cliente Redis compartido. Redis es opcional en tests; en producción es obligatorio
para distribuir eventos entre la API y los workers."""

from __future__ import annotations

import logging

import redis.asyncio as aioredis

from app.core.config import get_settings

logger = logging.getLogger(__name__)
_client: aioredis.Redis | None = None
_checked = False


async def get_redis() -> aioredis.Redis | None:
    global _client, _checked
    if _client is not None:
        return _client
    url = get_settings().redis_url
    if not url:
        return None
    if _checked and _client is None:
        return None
    client = aioredis.from_url(url, decode_responses=True)
    try:
        await client.ping()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Redis no disponible (%s); se usa modo de proceso único", exc)
        _checked = True
        return None
    _client = client
    _checked = True
    return _client


async def close_redis() -> None:
    global _client, _checked
    if _client is not None:
        await _client.aclose()
    _client = None
    _checked = False
