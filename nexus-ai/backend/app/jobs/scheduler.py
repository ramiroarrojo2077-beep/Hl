"""Programador de misiones y reuniones recurrentes, recordatorios y entregas diferidas."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from croniter import croniter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.jobs import queue
from app.models import Agent, Notification, ScheduledJob, UserSettings

logger = logging.getLogger(__name__)


def next_run(cron: str, tz: str, after: datetime | None = None) -> datetime:
    zone = ZoneInfo(tz)
    base = (after or datetime.now(UTC)).astimezone(zone)
    return croniter(cron, base).get_next(datetime).astimezone(UTC)


def validate_cron(cron: str) -> bool:
    return croniter.is_valid(cron)


async def tick(session: AsyncSession) -> int:
    now = datetime.now(UTC)
    due = (
        await session.scalars(
            select(ScheduledJob)
            .where(ScheduledJob.is_enabled.is_(True), ScheduledJob.next_run_at.is_not(None), ScheduledJob.next_run_at <= now)
            .with_for_update(skip_locked=True)
            .limit(50)
        )
    ).all()
    fired = 0
    for job in due:
        settings = await session.get(UserSettings, job.user_id)
        scheduled_for = job.next_run_at
        try:
            if settings and settings.emergency_stop and job.kind != "reminder":
                job.last_status = "skipped_emergency_stop"
            elif job.kind == "mission":
                from app.missions.service import create_mission

                p = job.payload
                await create_mission(
                    session, job.user_id, title=p.get("title", job.name), objective=p["objective"],
                    description=p.get("description"), project_id=_uuid(p.get("project_id")), priority=int(p.get("priority", 3)),
                    budget_usd=Decimal(str(p["budget_usd"])) if p.get("budget_usd") else None,
                    autonomy_mode=p.get("autonomy_mode", "scheduled"), scheduled_job_id=job.id,
                    created_by_agent=await session.scalar(select(Agent).where(Agent.user_id == job.user_id, Agent.slug == "nexus")),
                )
                job.last_status = "fired"
            elif job.kind == "meeting":
                from app.meetings.service import create_meeting

                p = job.payload
                await create_meeting(
                    session, job.user_id, topic=p.get("topic", job.name), objective=p["objective"],
                    meeting_type=p.get("meeting_type", "review"), participant_slugs=p.get("participants"),
                    max_rounds=int(p.get("max_rounds", 2)), project_id=_uuid(p.get("project_id")), scheduled_job_id=job.id,
                )
                job.last_status = "fired"
            elif job.kind == "reminder":
                n = Notification(user_id=job.user_id, event_type="reminder", title=job.payload.get("title", job.name),
                                 body=job.payload.get("body", ""), data={"scheduled_job_id": str(job.id)})
                session.add(n)
                await session.flush()
                await queue.enqueue(session, "notification.deliver", {"notification_id": str(n.id)}, user_id=job.user_id,
                                    idempotency_key=f"reminder:{job.id}:{scheduled_for.isoformat() if scheduled_for else ''}")
                job.last_status = "fired"
                from app.automations.service import emit_event

                await emit_event(session, job.user_id, "reminder.fired", {"title": job.payload.get("title", job.name), "event_id": f"{job.id}:{scheduled_for}"},
                                 origin_automation_id=uuid.UUID(job.payload["automation_id"]) if job.payload.get("automation_id") else None)
        except Exception as exc:  # noqa: BLE001 - un error en una programación no frena al resto
            logger.exception("Falló la programación %s", job.id)
            job.last_status = f"error: {exc}"[:20]
        job.last_run_at = now
        job.run_count += 1
        if job.cron:
            job.next_run_at = next_run(job.cron, job.timezone, now)
        else:
            job.next_run_at = None
            job.is_enabled = False
        fired += 1
    # NEXUS 2.0: rutinas programadas, acciones vencidas y retención de transcripciones.
    from app.actions.service import expire_stale
    from app.automations.service import tick_due
    from app.voice.service import purge_expired_transcripts

    fired += await tick_due(session)
    await expire_stale(session)
    await purge_expired_transcripts(session)
    await queue.commit(session)
    return fired


def _uuid(value):
    return uuid.UUID(value) if value else None
