"""Notificaciones: se guardan en la base, se emiten por WebSocket y se envían por push."""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import events
from app.core.db import session_factory
from app.models import DeviceToken, Notification, UserSettings
from app.notifications import fcm

logger = logging.getLogger(__name__)

EVENT_TYPES = {
    "mission_completed": "Misión completada",
    "mission_blocked": "Misión bloqueada",
    "important_error": "Error importante",
    "approval_requested": "Solicitud de aprobación",
    "agent_needs_info": "Un agente necesita información",
    "meeting_finished": "Reunión finalizada",
    "report_ready": "Informe disponible",
    "budget_reached": "Presupuesto alcanzado",
    "reminder": "Recordatorio",
}


async def notify(
    session: AsyncSession,
    user_id: uuid.UUID,
    event_type: str,
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
    *,
    deliver_at: datetime | None = None,
) -> Notification | None:
    settings = await session.get(UserSettings, user_id)
    prefs = (settings.notification_prefs if settings else {}) or {}
    if prefs.get(event_type) is False:
        return None
    notification = Notification(
        user_id=user_id, event_type=event_type, title=title[:200], body=body, data=data or {}, deliver_at=deliver_at
    )
    session.add(notification)
    await session.flush()
    if deliver_at is None:
        await events.publish(user_id, "notification.created", serialize(notification))
        _schedule_push(notification.id)
    return notification


def serialize(n: Notification) -> dict[str, Any]:
    return {
        "id": str(n.id),
        "event_type": n.event_type,
        "title": n.title,
        "body": n.body,
        "data": n.data,
        "read_at": n.read_at.isoformat() if n.read_at else None,
        "created_at": n.created_at.isoformat() if n.created_at else None,
    }


_pending: set[asyncio.Task[None]] = set()


def _schedule_push(notification_id: uuid.UUID) -> None:
    if not fcm.is_configured():
        return
    task = asyncio.get_running_loop().create_task(_deliver_push_later(notification_id))
    _pending.add(task)
    task.add_done_callback(_pending.discard)


async def _deliver_push_later(notification_id: uuid.UUID) -> None:
    # Espera a que la transacción que creó la notificación se confirme.
    await asyncio.sleep(0.5)
    async with session_factory()() as session:
        await deliver_push(session, notification_id)
        await session.commit()


async def deliver_push(session: AsyncSession, notification_id: uuid.UUID) -> None:
    n = await session.get(Notification, notification_id)
    if n is None or n.push_status not in ("not_sent", "failed"):
        return
    tokens = list((await session.scalars(select(DeviceToken.token).where(DeviceToken.user_id == n.user_id))).all())
    status, invalid = await fcm.send_push(
        tokens, n.title, n.body, {"notification_id": str(n.id), "event_type": n.event_type, **{k: str(v) for k, v in n.data.items()}}
    )
    n.push_status = status
    if invalid:
        await session.execute(delete(DeviceToken).where(DeviceToken.token.in_(invalid)))
