"""STOP ALL AGENTS.

Niveles de detención (distintos y explícitos):
1. Detener una tarea: POST /missions/{id}/tasks/{task_id}/cancel.
2. Detener a todos los agentes del usuario (este módulo): ningún trabajo nuevo arranca,
   los trabajos en curso se detienen en su siguiente punto seguro, se invalidan los
   permisos temporales y las aprobaciones pendientes.
3. Apagar workers / servidor: operación de infraestructura (SIGTERM al proceso worker,
   que libera sus trabajos de forma ordenada). Ver docs/setup.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import events
from app.models import Agent, AgentPermission, ApprovalRequest, Meeting, Mission, MissionTask, UserSettings
from app.models.enums import ACTIVE_MISSION_STATUSES, MissionStatus, TaskStatus
from app.monitoring.audit import record_audit
from app.notifications.service import notify
from app.orchestrator.engine import resume_mission, set_mission_status


async def activate(session: AsyncSession, user_id: uuid.UUID, reason: str | None) -> dict:
    settings = await session.get(UserSettings, user_id, with_for_update=True)
    assert settings is not None
    now = datetime.now(UTC)
    settings.emergency_stop = True
    settings.emergency_stop_at = now
    settings.emergency_stop_reason = reason or "Activado por el usuario"

    running_tasks = (
        await session.scalars(select(MissionTask).where(MissionTask.user_id == user_id, MissionTask.status.in_([TaskStatus.RUNNING, TaskStatus.READY])))
    ).all()
    for t in running_tasks:
        if t.status == TaskStatus.RUNNING:
            t.cancel_requested = False  # no se cancela: se interrumpe y queda pendiente para reanudar
        else:
            t.status = TaskStatus.PENDING
    missions = (
        await session.scalars(select(Mission).where(Mission.user_id == user_id, Mission.status.in_(list(ACTIVE_MISSION_STATUSES))))
    ).all()
    for m in missions:
        m.plan = {**(m.plan or {}), "_paused_from": m.status, "_paused_by_stop": True}
        await set_mission_status(session, m, MissionStatus.PAUSED, "STOP ALL AGENTS")
    meetings = (await session.scalars(select(Meeting).where(Meeting.user_id == user_id, Meeting.status.in_(["scheduled", "running"])))).all()
    for meeting in meetings:
        meeting.status = "cancelled"
        meeting.stop_reason = "STOP ALL AGENTS"
        meeting.ended_at = now
    temp = await session.execute(
        delete(AgentPermission).where(
            AgentPermission.agent_id.in_(select(Agent.id).where(Agent.user_id == user_id)), AgentPermission.expires_at.is_not(None)
        )
    )
    approvals = await session.execute(
        update(ApprovalRequest)
        .where(ApprovalRequest.user_id == user_id, ApprovalRequest.status == "pending")
        .values(status="expired", decided_at=now, decision_note="Invalidada por STOP ALL")
    )
    agents = (await session.scalars(select(Agent).where(Agent.user_id == user_id))).all()
    for a in agents:
        a.status = "paused"
        a.status_detail = "STOP ALL"
    summary = {
        "missions_paused": len(missions),
        "tasks_interrupted": len(running_tasks),
        "meetings_stopped": len(meetings),
        "temporary_permissions_revoked": temp.rowcount or 0,
        "approvals_invalidated": approvals.rowcount or 0,
    }
    await record_audit(session, user_id, "system.emergency_stop", "STOP ALL AGENTS activado", actor_type="user",
                       outcome="info", details=summary)
    await notify(session, user_id, "important_error", "STOP ALL AGENTS activado",
                 "Todos los agentes están detenidos. Los registros se conservan.", summary)
    await events.publish(user_id, "system.emergency_stop", {"active": True, **summary})
    return summary


async def deactivate(session: AsyncSession, user_id: uuid.UUID, resume_missions: bool) -> dict:
    settings = await session.get(UserSettings, user_id, with_for_update=True)
    assert settings is not None
    settings.emergency_stop = False
    settings.emergency_stop_reason = None
    agents = (await session.scalars(select(Agent).where(Agent.user_id == user_id))).all()
    for a in agents:
        a.status = "idle"
        a.status_detail = None
    resumed = 0
    if resume_missions:
        missions = (await session.scalars(select(Mission).where(Mission.user_id == user_id, Mission.status == MissionStatus.PAUSED))).all()
        for m in missions:
            if (m.plan or {}).get("_paused_by_stop"):
                plan = dict(m.plan)
                plan.pop("_paused_by_stop", None)
                plan.pop("_paused_from", None)
                m.plan = plan
                await resume_mission(session, m)
                resumed += 1
    await record_audit(session, user_id, "system.emergency_stop_cleared", "STOP ALL AGENTS desactivado", actor_type="user",
                       outcome="info", details={"missions_resumed": resumed})
    await events.publish(user_id, "system.emergency_stop", {"active": False, "missions_resumed": resumed})
    return {"missions_resumed": resumed}
