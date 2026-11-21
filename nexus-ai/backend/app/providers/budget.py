"""Control de presupuesto y consumo."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import BudgetExceeded
from app.models import Agent, Meeting, Mission, Notification, UsageRecord, UserSettings


def estimate_cost(tokens_in: int, tokens_out: int, price_in: Decimal | None, price_out: Decimal | None) -> Decimal | None:
    if price_in is None or price_out is None:
        return None
    return (Decimal(tokens_in) * Decimal(price_in) + Decimal(tokens_out) * Decimal(price_out)) / Decimal(1_000_000)


async def spent_since(session: AsyncSession, user_id: uuid.UUID, since: datetime, *, agent_id: uuid.UUID | None = None) -> Decimal:
    q = select(func.coalesce(func.sum(func.coalesce(UsageRecord.cost_confirmed_usd, UsageRecord.cost_estimated_usd)), 0)).where(
        UsageRecord.user_id == user_id, UsageRecord.created_at >= since
    )
    if agent_id is not None:
        q = q.where(UsageRecord.agent_id == agent_id)
    return Decimal(await session.scalar(q) or 0)


def day_start(now: datetime | None = None) -> datetime:
    now = now or datetime.now(UTC)
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def month_start(now: datetime | None = None) -> datetime:
    return day_start(now).replace(day=1)


@dataclass
class BudgetStatus:
    daily_spent: Decimal
    monthly_spent: Decimal
    daily_limit: Decimal | None
    monthly_limit: Decimal | None


async def budget_status(session: AsyncSession, user_id: uuid.UUID) -> BudgetStatus:
    settings = await session.get(UserSettings, user_id)
    return BudgetStatus(
        daily_spent=await spent_since(session, user_id, day_start()),
        monthly_spent=await spent_since(session, user_id, month_start()),
        daily_limit=settings.daily_budget_usd if settings else None,
        monthly_limit=settings.monthly_budget_usd if settings else None,
    )


async def _notify_budget_once(session: AsyncSession, user_id: uuid.UUID, key: str, message: str) -> None:
    from app.notifications.service import notify

    recent = await session.scalar(
        select(Notification.id).where(
            Notification.user_id == user_id,
            Notification.event_type == "budget_reached",
            Notification.created_at >= datetime.now(UTC) - timedelta(hours=6),
            Notification.data["key"].astext == key,
        )
    )
    if not recent:
        await notify(session, user_id, "budget_reached", "Presupuesto alcanzado", message, {"key": key})


async def check_budget(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    agent_id: uuid.UUID | None = None,
    mission_id: uuid.UUID | None = None,
    meeting_id: uuid.UUID | None = None,
) -> None:
    """Lanza BudgetExceeded si una nueva operación excedería algún límite configurado."""
    settings = await session.get(UserSettings, user_id)
    status = await budget_status(session, user_id)
    if status.daily_limit is not None and status.daily_spent >= status.daily_limit:
        await _notify_budget_once(session, user_id, "daily", f"Se alcanzó el límite diario de USD {status.daily_limit}.")
        raise BudgetExceeded(f"Límite diario alcanzado (USD {status.daily_spent:.4f} de {status.daily_limit})")
    if status.monthly_limit is not None and status.monthly_spent >= status.monthly_limit:
        await _notify_budget_once(session, user_id, "monthly", f"Se alcanzó el límite mensual de USD {status.monthly_limit}.")
        raise BudgetExceeded(f"Límite mensual alcanzado (USD {status.monthly_spent:.4f} de {status.monthly_limit})")
    if agent_id is not None:
        agent = await session.get(Agent, agent_id)
        if agent and agent.daily_budget_usd is not None:
            spent = await spent_since(session, user_id, day_start(), agent_id=agent_id)
            if spent >= agent.daily_budget_usd:
                await _notify_budget_once(session, user_id, f"agent:{agent_id}", f"{agent.name} alcanzó su presupuesto diario.")
                raise BudgetExceeded(f"{agent.name} alcanzó su presupuesto diario (USD {agent.daily_budget_usd})")
    if mission_id is not None:
        mission = await session.get(Mission, mission_id)
        if mission is not None:
            if mission.budget_usd is not None and mission.spent_usd >= mission.budget_usd:
                await _notify_budget_once(session, user_id, f"mission:{mission_id}", f"La misión «{mission.title}» alcanzó su presupuesto.")
                raise BudgetExceeded(f"La misión alcanzó su presupuesto (USD {mission.budget_usd})")
            cap = settings.max_tokens_per_mission if settings else None
            if cap and mission.tokens_used >= cap:
                await _notify_budget_once(session, user_id, f"mission-tokens:{mission_id}", f"La misión «{mission.title}» alcanzó el tope de tokens.")
                raise BudgetExceeded(f"La misión alcanzó el tope de {cap} tokens")
    if meeting_id is not None:
        meeting = await session.get(Meeting, meeting_id)
        if meeting and meeting.budget_usd is not None and meeting.spent_usd >= meeting.budget_usd:
            raise BudgetExceeded(f"La reunión alcanzó su presupuesto (USD {meeting.budget_usd})")
