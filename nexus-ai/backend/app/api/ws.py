"""Canal WebSocket en tiempo real.

Protocolo:
  cliente → {"type": "auth", "token": "<access token>"}   (primer mensaje, máx. 10 s)
  servidor → {"type": "ready", "user_id": ...}
  servidor → eventos {"id", "type", "ts", "data"} del usuario autenticado únicamente
  cliente → {"type": "ping"}  /  servidor → {"type": "pong"}
El token no viaja en la URL (no queda en logs). La sesión se revalida periódicamente:
si el usuario cierra sesión o se revoca, el canal se cierra.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi import HTTPException

from app.auth.deps import resolve_token
from app.auth.service import session_is_active
from app.core import events
from app.core.db import session_factory
from app.monitoring import metrics

logger = logging.getLogger(__name__)
router = APIRouter()
AUTH_TIMEOUT = 10
REVALIDATE_SECONDS = 60


@router.websocket("/ws")
async def websocket(ws: WebSocket) -> None:
    await ws.accept()
    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=AUTH_TIMEOUT)
        msg = json.loads(raw)
        if msg.get("type") != "auth" or not isinstance(msg.get("token"), str):
            raise ValueError("auth requerido")
        async with session_factory()() as session:
            cu = await resolve_token(session, msg["token"])
    except (TimeoutError, ValueError, HTTPException, WebSocketDisconnect):
        with contextlib.suppress(Exception):
            await ws.close(code=4401, reason="No autenticado")
        return
    user_id, session_id = cu.id, cu.session_id
    metrics.WS_CONNECTIONS.inc()
    await ws.send_json({"type": "ready", "user_id": str(user_id)})

    async def pump() -> None:
        async for event in events.subscribe(user_id):
            await ws.send_json(event)

    async def receiver() -> None:
        while True:
            text = await ws.receive_text()
            try:
                data = json.loads(text)
            except ValueError:
                continue
            if data.get("type") == "ping":
                await ws.send_json({"type": "pong"})

    async def revalidate() -> None:
        while True:
            await asyncio.sleep(REVALIDATE_SECONDS)
            async with session_factory()() as session:
                if not await session_is_active(session, user_id, session_id):
                    await ws.close(code=4401, reason="Sesión cerrada")
                    return

    tasks = [asyncio.create_task(pump()), asyncio.create_task(receiver()), asyncio.create_task(revalidate())]
    try:
        await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    finally:
        for t in tasks:
            t.cancel()
        with contextlib.suppress(Exception):
            await ws.close()
