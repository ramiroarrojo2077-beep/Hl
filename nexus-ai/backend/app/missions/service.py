"""Operaciones del usuario sobre misiones: crear, pausar, reanudar, cancelar, reintentar."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound
from app.jobs import queue
from app.models import Agent, ApprovalRequest, Mission, MissionTask, Project, UserSettings
from app.models.enums import MissionStatus, TaskStatus, TERMINAL_MISSION_STATUSES, TERMINAL_TASK_STATUSES
from app.monitoring.audit import record_audit
from app.orchestrator.engine import publish_task, resume_mission, schedule_ready_tasks, set_mission_status


async def get_mission(session: AsyncSession, user_id: uuid.UUID, mission_id: uuid.UUID) -> Mission:
    mission = await session.get(Mission, mission_id)
    if mission is None or mission.user_id != user_id:
        raise NotFound("Misión no encontrada")
    return mission


async def create_mission(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    title: str,
    objective: str,
    description: str | None = None,
    project_id: uuid.UUID | None = None,
    priority: int = 3,
    budget_usd: Decimal | None = None,
    autonomy_mode: str | None = None,
    created_by_agent: Agent | None = None,
    scheduled_job_id: uuid.UUID | None = None,
    source_meeting_id: uuid.UUID | None = None,
) -> Mission:
    settings = await session.get(UserSettings, user_id)
    if project_id is not None:
        project = await session.get(Project, project_id)
        if project is None or project.user_id != user_id:
            raise NotFound("Proyecto no encontrado")
    mission = Mission(
        user_id=user_id,
        title=title.strip()[:200],
        objective=objective.strip(),
        description=description,
        project_id=project_id,
        priority=max(1, min(priority, 5)),
        budget_usd=budget_usd if budget_usd is not None else (settings.default_mission_budget_usd if settings else None),
        autonomy_mode=autonomy_mode or (settings.autonomy_mode if settings else "supervised"),
        scheduled_job_id=scheduled_job_id,
        source_meeting_id=source_meeting_id,
        status=MissionStatus.PLANNING,
    )
    session.add(mission)
    await session.flush()
    await queue.enqueue(session, "mission.plan", {"mission_id": str(mission.id)}, user_id=user_id, priority=2,
                        idempotency_key=f"mission.plan:{mission.id}")
    who = created_by_agent.name if created_by_agent else "El usuario"
    await record_audit(
        session, user_id, "mission.created", f"{who} creó la misión «{mission.title}»",
        actor_type="agent" if created_by_agent else "user", agent_id=created_by_agent.id if created_by_agent else None,
        target_type="mission", target_id=mission.id, mission_id=mission.id, project_id=project_id,
    )
    await set_mission_status(session, mission, MissionStatus.PLANNING, "NEXUS analiza el objetivo")
    return mission


async def pause_mission(session: AsyncSession, mission: Mission, reason: str = "Pausada por el usuario") -> None:
    if mission.status in TERMINAL_MISSION_STATUSES:
        raise Conflict("La misión ya terminó")
    if mission.status == MissionStatus.PAUSED:
        return
    tasks = (await session.scalars(select(MissionTask).where(MissionTask.mission_id == mission.id))).all()
    for t in tasks:
        if t.status == TaskStatus.READY:
            t.status = TaskStatus.PENDING
            await publish_task(t)
    mission.plan = {**(mission.plan or {}), "_paused_from": mission.status}
    await set_mission_status(session, mission, MissionStatus.PAUSED, reason)
    await record_audit(session, mission.user_id, "mission.paused", f"Misión pausada: «{mission.title}»", actor_type="user",
                       mission_id=mission.id, details={"reason": reason})


async def resume(session: AsyncSession, mission: Mission) -> None:
    if mission.status not in (MissionStatus.PAUSED, MissionStatus.BLOCKED):
        raise Conflict(f"No se puede reanudar una misión en estado {mission.status}")
    settings = await session.get(UserSettings, mission.user_id)
    if settings and settings.emergency_stop:
        raise Conflict("STOP ALL está activo: desactivalo antes de reanudar misiones")
    plan = dict(mission.plan or {})
    plan.pop("_paused_from", None)
    mission.plan = plan
    await record_audit(session, mission.user_id, "mission.resumed", f"Misión reanudada: «{mission.title}»", actor_type="user",
                       mission_id=mission.id)
    await resume_mission(session, mission)


async def cancel_mission(session: AsyncSession, mission: Mission) -> None:
    if mission.status in TERMINAL_MISSION_STATUSES:
        raise Conflict("La misión ya terminó")
    tasks = (await session.scalars(select(MissionTask).where(MissionTask.mission_id == mission.id))).all()
    for t in tasks:
        if t.status == TaskStatus.RUNNING:
            t.cancel_requested = True  # el runtime se detiene en el próximo paso seguro
        elif t.status not in TERMINAL_TASK_STATUSES:
            t.status = TaskStatus.CANCELLED
        await publish_task(t)
    await queue.cancel_jobs(session, user_id=mission.user_id, payload_key="mission_id", payload_value=str(mission.id))
    for t in tasks:
        await queue.cancel_jobs(session, user_id=mission.user_id, kind="task.run", payload_key="task_id", payload_value=str(t.id))
    await session.execute(
        update(ApprovalRequest)
        .where(ApprovalRequest.mission_id == mission.id, ApprovalRequest.status == "pending")
        .values(status="expired", decided_at=datetime.now(UTC), decision_note="Misión cancelada")
    )
    await set_mission_status(session, mission, MissionStatus.CANCELLED, "Cancelada por el usuario")
    await record_audit(session, mission.user_id, "mission.cancelled", f"Misión cancelada: «{mission.title}»", actor_type="user",
                       mission_id=mission.id)


async def retry_task(session: AsyncSession, mission: Mission, task_id: uuid.UUID) -> MissionTask:
    task = await session.get(MissionTask, task_id)
    if task is None or task.mission_id != mission.id:
        raise NotFound("Tarea no encontrada")
    if task.status not in (TaskStatus.FAILED, TaskStatus.CANCELLED):
        raise Conflict("Solo se pueden reintentar tareas fallidas o canceladas")
    if mission.status in (MissionStatus.COMPLETED, MissionStatus.CANCELLED):
        raise Conflict("La misión ya terminó")
    task.status = TaskStatus.PENDING
    task.error = None
    task.max_attempts = task.attempts + 3
    await publish_task(task)
    await record_audit(session, mission.user_id, "task.retry", f"Reintento manual de «{task.title}»", actor_type="user",
                       mission_id=mission.id, target_type="task", target_id=task.id)
    await set_mission_status(session, mission, MissionStatus.RUNNING)
    await schedule_ready_tasks(session, mission)
    return task


async def cancel_task(session: AsyncSession, mission: Mission, task_id: uuid.UUID) -> MissionTask:
    task = await session.get(MissionTask, task_id)
    if task is None or task.mission_id != mission.id:
        raise NotFound("Tarea no encontrada")
    if task.status in TERMINAL_TASK_STATUSES:
        raise Conflict("La tarea ya terminó")
    if task.status == TaskStatus.RUNNING:
        task.cancel_requested = True
    else:
        task.status = TaskStatus.CANCELLED
        await queue.cancel_jobs(session, user_id=mission.user_id, kind="task.run", payload_key="task_id", payload_value=str(task.id))
    await publish_task(task)
    await record_audit(session, mission.user_id, "task.cancelled", f"Tarea cancelada: «{task.title}»", actor_type="user",
                       mission_id=mission.id, target_type="task", target_id=task.id)
    return task


async def skip_task(session: AsyncSession, mission: Mission, task_id: uuid.UUID) -> MissionTask:
    """Marca una tarea fallida/cancelada como omitida para que la misión pueda continuar."""
    task = await session.get(MissionTask, task_id)
    if task is None or task.mission_id != mission.id:
        raise NotFound("Tarea no encontrada")
    if task.status not in (TaskStatus.FAILED, TaskStatus.CANCELLED, TaskStatus.PENDING, TaskStatus.AWAITING_APPROVAL):
        raise Conflict("Esta tarea no se puede omitir en su estado actual")
    task.status = TaskStatus.SKIPPED
    await publish_task(task)
    if mission.status in (MissionStatus.BLOCKED, MissionStatus.RUNNING):
        await set_mission_status(session, mission, MissionStatus.RUNNING)
        await schedule_ready_tasks(session, mission)
    return task
