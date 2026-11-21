"""Registro de auditoría y actividad. Cada entrada corresponde a una acción real."""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core import events
from app.models import AuditLog


async def record_audit(
    session: AsyncSession,
    user_id: uuid.UUID,
    action: str,
    summary: str,
    *,
    actor_type: str = "system",
    agent_id: uuid.UUID | None = None,
    target_type: str | None = None,
    target_id: uuid.UUID | None = None,
    mission_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    outcome: str = "success",
    details: dict[str, Any] | None = None,
    model_used: str | None = None,
    tokens: int | None = None,
    cost_usd: Decimal | None = None,
    publish: bool = True,
) -> AuditLog:
    entry = AuditLog(
        user_id=user_id,
        actor_type=actor_type,
        agent_id=agent_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        mission_id=mission_id,
        project_id=project_id,
        outcome=outcome,
        summary=summary[:2000],
        details=details or {},
        model_used=model_used,
        tokens=tokens,
        cost_usd=cost_usd,
    )
    session.add(entry)
    await session.flush()
    if publish:
        await events.publish(
            user_id,
            "activity.created",
            {
                "id": str(entry.id),
                "action": action,
                "summary": entry.summary,
                "agent_id": str(agent_id) if agent_id else None,
                "mission_id": str(mission_id) if mission_id else None,
                "outcome": outcome,
            },
        )
    return entry
