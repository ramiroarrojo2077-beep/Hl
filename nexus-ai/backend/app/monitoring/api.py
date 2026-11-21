"""Activity Center, consumo, dashboard y estado del sistema (todo con datos reales)."""

from __future__ import annotations

import os
import shutil
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import func, literal_column, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import ActivityOut
from app.auth.deps import CurrentUser, current_user
from app.core.db import get_session
from app.models import (
    Agent,
    AIModel,
    AIProvider,
    ApprovalRequest,
    AuditLog,
    Job,
    Meeting,
    MemoryItem,
    Mission,
    MissionTask,
    Notification,
    UsageRecord,
    UserSettings,
)
from app.notifications import fcm
from app.providers.budget import budget_status, day_start, month_start

router = APIRouter(tags=["activity"])


@router.get("/activity", response_model=list[ActivityOut])
async def activity(
    agent_id: uuid.UUID | None = None,
    mission_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    outcome: str | None = None,
    action: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    before: datetime | None = None,
    limit: int = 50,
    cu: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[AuditLog]:
    q = select(AuditLog).where(AuditLog.user_id == cu.id).order_by(AuditLog.created_at.desc()).limit(min(limit, 200))
    if agent_id:
        q = q.where(AuditLog.agent_id == agent_id)
    if mission_id:
        q = q.where(AuditLog.mission_id == mission_id)
    if project_id:
        q = q.where(AuditLog.project_id == project_id)
    if outcome:
        q = q.where(AuditLog.outcome == outcome)
    if action:
        q = q.where(AuditLog.action.startswith(action))
    if date_from:
        q = q.where(AuditLog.created_at >= date_from)
    if date_to:
        q = q.where(AuditLog.created_at <= date_to)
    if before:
        q = q.where(AuditLog.created_at < before)
    return list((await session.scalars(q)).all())


def _cost_expr():
    return func.coalesce(func.sum(func.coalesce(UsageRecord.cost_confirmed_usd, UsageRecord.cost_estimated_usd)), 0)


@router.get("/usage/summary")
async def usage_summary(days: int = 30, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict:
    since = datetime.now(UTC) - timedelta(days=min(days, 365))
    base = (UsageRecord.user_id == cu.id, UsageRecord.created_at >= since)

    async def grouped(col, label: str) -> list[dict]:
        rows = (await session.execute(
            select(col, func.sum(UsageRecord.tokens_in), func.sum(UsageRecord.tokens_out), _cost_expr(), func.count())
            .where(*base).group_by(col)
        )).all()
        return [{label: str(r[0]) if r[0] is not None else None, "tokens_in": int(r[1] or 0), "tokens_out": int(r[2] or 0),
                 "cost_usd": str(r[3]), "calls": r[4]} for r in rows]

    day = func.date_trunc(literal_column("'day'"), UsageRecord.created_at)
    daily = (await session.execute(
        select(day, func.sum(UsageRecord.tokens_in + UsageRecord.tokens_out), _cost_expr())
        .where(*base).group_by(day).order_by(day)
    )).all()
    totals = (await session.execute(
        select(func.coalesce(func.sum(UsageRecord.tokens_in), 0), func.coalesce(func.sum(UsageRecord.tokens_out), 0), _cost_expr(),
               func.count(), func.count().filter(UsageRecord.success.is_(False)),
               func.count().filter(UsageRecord.cost_estimated_usd.is_(None) & UsageRecord.success.is_(True)))
        .where(*base)
    )).one()
    status = await budget_status(session, cu.id)
    agent_names = {a.id: a.name for a in (await session.scalars(select(Agent).where(Agent.user_id == cu.id))).all()}
    by_agent = await grouped(UsageRecord.agent_id, "agent_id")
    for row in by_agent:
        row["agent_name"] = agent_names.get(uuid.UUID(row["agent_id"])) if row["agent_id"] else "Sistema"
    return {
        "since": since,
        "totals": {"tokens_in": int(totals[0]), "tokens_out": int(totals[1]), "cost_usd": str(totals[2]), "calls": totals[3],
                   "failed_calls": totals[4], "calls_without_price": totals[5]},
        "budget": {"daily_spent": str(status.daily_spent), "monthly_spent": str(status.monthly_spent),
                   "daily_limit": str(status.daily_limit) if status.daily_limit is not None else None,
                   "monthly_limit": str(status.monthly_limit) if status.monthly_limit is not None else None},
        "daily": [{"day": d[0].date().isoformat(), "tokens": int(d[1] or 0), "cost_usd": str(d[2])} for d in daily],
        "by_agent": by_agent,
        "by_mission": await grouped(UsageRecord.mission_id, "mission_id"),
        "by_model": await grouped(UsageRecord.model_name, "model"),
        "by_provider": await grouped(UsageRecord.provider_kind, "provider"),
        "note": "Costos estimados con los precios configurados por modelo. Las llamadas sin precio configurado no suman costo.",
    }


@router.get("/usage/records")
async def usage_records(mission_id: uuid.UUID | None = None, agent_id: uuid.UUID | None = None, limit: int = 100,
                        cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[dict]:
    q = select(UsageRecord).where(UsageRecord.user_id == cu.id).order_by(UsageRecord.created_at.desc()).limit(min(limit, 500))
    if mission_id:
        q = q.where(UsageRecord.mission_id == mission_id)
    if agent_id:
        q = q.where(UsageRecord.agent_id == agent_id)
    return [
        {"id": str(r.id), "created_at": r.created_at, "agent_id": str(r.agent_id) if r.agent_id else None,
         "mission_id": str(r.mission_id) if r.mission_id else None, "provider": r.provider_kind, "model": r.model_name,
         "purpose": r.purpose, "tokens_in": r.tokens_in, "tokens_out": r.tokens_out,
         "cost_estimated_usd": str(r.cost_estimated_usd) if r.cost_estimated_usd is not None else None,
         "cost_confirmed_usd": str(r.cost_confirmed_usd) if r.cost_confirmed_usd is not None else None,
         "latency_ms": r.latency_ms, "success": r.success, "error": r.error}
        for r in (await session.scalars(q)).all()
    ]


def server_metrics() -> dict:
    """Métricas reales del host donde corre la API."""
    import psutil

    disk = shutil.disk_usage(os.getcwd())
    return {
        "cpu_percent": psutil.cpu_percent(interval=0.2),
        "memory_percent": psutil.virtual_memory().percent,
        "disk_percent": round(disk.used / disk.total * 100, 1),
        "load_avg": list(os.getloadavg()) if hasattr(os, "getloadavg") else None,
        "measured_at": datetime.now(UTC).isoformat(),
    }


@router.get("/dashboard")
async def dashboard(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict:
    uid = cu.id
    agents = (await session.scalars(select(Agent).where(Agent.user_id == uid).order_by(Agent.is_system.desc(), Agent.created_at))).all()
    mission_counts = dict((await session.execute(
        select(Mission.status, func.count()).where(Mission.user_id == uid).group_by(Mission.status)
    )).all())
    tasks_today = await session.scalar(
        select(func.count()).select_from(MissionTask).where(MissionTask.user_id == uid, MissionTask.status == "completed",
                                                            MissionTask.completed_at >= day_start())
    )
    tasks_total = await session.scalar(select(func.count()).select_from(MissionTask).where(MissionTask.user_id == uid, MissionTask.status == "completed"))
    pending_approvals = await session.scalar(select(func.count()).select_from(ApprovalRequest).where(ApprovalRequest.user_id == uid, ApprovalRequest.status == "pending"))
    unread = await session.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == uid, Notification.read_at.is_(None), Notification.deliver_at.is_(None)))
    memories = await session.scalar(select(func.count()).select_from(MemoryItem).where(MemoryItem.user_id == uid))
    meetings_active = await session.scalar(select(func.count()).select_from(Meeting).where(Meeting.user_id == uid, Meeting.status.in_(["scheduled", "running", "summarizing"])))
    usage_today = (await session.execute(
        select(func.coalesce(func.sum(UsageRecord.tokens_in + UsageRecord.tokens_out), 0), _cost_expr(), func.count())
        .where(UsageRecord.user_id == uid, UsageRecord.created_at >= day_start())
    )).one()
    usage_month = await session.scalar(select(_cost_expr()).where(UsageRecord.user_id == uid, UsageRecord.created_at >= month_start()))
    providers = (await session.scalars(select(AIProvider).where(AIProvider.user_id == uid))).all()
    model_counts = dict((await session.execute(
        select(AIModel.provider_id, func.count()).where(AIModel.user_id == uid, AIModel.is_enabled.is_(True)).group_by(AIModel.provider_id)
    )).all())
    timeline = (await session.scalars(
        select(Mission).where(Mission.user_id == uid).order_by(Mission.updated_at.desc()).limit(6)
    )).all()
    recent = (await session.scalars(select(AuditLog).where(AuditLog.user_id == uid).order_by(AuditLog.created_at.desc()).limit(8))).all()
    alerts = (await session.scalars(
        select(Notification).where(Notification.user_id == uid, Notification.read_at.is_(None),
                                   Notification.event_type.in_(["mission_blocked", "important_error", "budget_reached", "approval_requested"]))
        .order_by(Notification.created_at.desc()).limit(5)
    )).all()
    settings = await session.get(UserSettings, uid)
    active_agents = [a for a in agents if a.status in ("thinking", "working", "collaborating")]
    return {
        "user": {"display_name": cu.user.display_name},
        "emergency_stop": bool(settings and settings.emergency_stop),
        "autonomy_mode": settings.autonomy_mode if settings else "supervised",
        "agents": {"total": len(agents), "active": len(active_agents),
                   "items": [{"id": str(a.id), "slug": a.slug, "name": a.name, "role": a.role, "status": a.status,
                              "status_detail": a.status_detail, "color": a.profile.color, "appearance": a.profile.appearance,
                              "last_activity_at": a.last_activity_at} for a in agents]},
        "missions": {"running": sum(mission_counts.get(s, 0) for s in ("planning", "running", "reviewing", "consolidating")),
                     "pending": sum(mission_counts.get(s, 0) for s in ("awaiting_approval", "paused", "blocked")),
                     "completed": mission_counts.get("completed", 0), "failed": mission_counts.get("failed", 0),
                     "by_status": mission_counts},
        "tasks": {"completed_today": tasks_today or 0, "completed_total": tasks_total or 0},
        "meetings_active": meetings_active or 0,
        "pending_approvals": pending_approvals or 0,
        "unread_notifications": unread or 0,
        "memories": memories or 0,
        "usage": {"tokens_today": int(usage_today[0]), "cost_today_usd": str(usage_today[1]), "calls_today": usage_today[2],
                  "cost_month_usd": str(usage_month or Decimal(0))},
        "providers": [{"id": str(p.id), "kind": p.kind, "name": p.name, "status": p.status, "is_enabled": p.is_enabled,
                       "models": model_counts.get(p.id, 0)} for p in providers],
        "timeline": [{"id": str(m.id), "title": m.title, "status": m.status, "updated_at": m.updated_at,
                      "created_at": m.created_at} for m in timeline],
        "recent_activity": [ActivityOut.model_validate(r).model_dump(mode="json") for r in recent],
        "alerts": [{"id": str(n.id), "event_type": n.event_type, "title": n.title, "body": n.body, "created_at": n.created_at} for n in alerts],
    }


@router.get("/system/status")
async def system_status(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict:
    now = datetime.now(UTC)
    host = func.split_part(Job.lease_owner, literal_column("':'"), literal_column("1"))
    workers = (await session.execute(
        select(host, func.count()).where(Job.status == "running", Job.lease_expires_at > now).group_by(host)
    )).all()
    queued = await session.scalar(select(func.count()).select_from(Job).where(Job.user_id == cu.id, Job.status == "queued"))
    running = await session.scalar(select(func.count()).select_from(Job).where(Job.user_id == cu.id, Job.status == "running"))
    last_job = await session.scalar(select(func.max(Job.updated_at)).where(Job.status.in_(["succeeded", "running"])))
    return {
        "server": server_metrics(),
        "queue": {"queued": queued or 0, "running": running or 0, "busy_worker_hosts": [{"host": w[0], "jobs": w[1]} for w in workers],
                  "last_worker_activity": last_job},
        "push_configured": fcm.is_configured(),
    }
