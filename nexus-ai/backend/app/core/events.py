"""Bus de eventos en tiempo real.

Cada evento corresponde a un cambio real persistido en la base de datos (estado de
agente, tarea, misión, mensaje de reunión, notificación...). Se distribuye por Redis
pub/sub a todas las instancias de la API, que lo reenvían por WebSocket al usuario
dueño del recurso. Sin Redis (tests) funciona en un único proceso.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections import defaultdict
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from app.core.redis import get_redis

logger = logging.getLogger(__name__)

_local_subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = defaultdict(set)


def _channel(user_id: uuid.UUID | str) -> str:
    return f"nexus:events:{user_id}"


def make_event(event_type: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": uuid.uuid4().hex,
        "type": event_type,
        "ts": datetime.now(UTC).isoformat(),
        "data": data,
    }


async def publish(user_id: uuid.UUID | str, event_type: str, data: dict[str, Any]) -> None:
    event = make_event(event_type, data)
    payload = json.dumps(event, default=str)
    redis = await get_redis()
    if redis is not None:
        try:
            await redis.publish(_channel(user_id), payload)
            return
        except Exception as exc:  # noqa: BLE001
            logger.warning("No se pudo publicar en Redis: %s", exc)
    for queue in list(_local_subscribers.get(str(user_id), ())):
        try:
            queue.put_nowait(json.loads(payload))
        except asyncio.QueueFull:
            pass


async def subscribe(user_id: uuid.UUID | str) -> AsyncIterator[dict[str, Any]]:
    redis = await get_redis()
    if redis is not None:
        pubsub = redis.pubsub()
        await pubsub.subscribe(_channel(user_id))
        try:
            while True:
                message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=30.0)
                if message is None:
                    continue
                try:
                    yield json.loads(message["data"])
                except (ValueError, TypeError):
                    continue
        finally:
            await pubsub.unsubscribe(_channel(user_id))
            await pubsub.aclose()
    else:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1000)
        _local_subscribers[str(user_id)].add(queue)
        try:
            while True:
                yield await queue.get()
        finally:
            _local_subscribers[str(user_id)].discard(queue)
