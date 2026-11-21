"""Decisiones del usuario sobre solicitudes de aprobación."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import Conflict, NotFound
from app.jobs import queue
from app.models import ApprovalRequest, Mission, MissionTask, ToolExecution
from app.models.enums import MissionStatus, TaskStatus, ToolExecutionStatus
from app.monitoring.audit import record_audit
from app.orchestrator.engine import publish_task, schedule_ready_tasks, set_mission_status


async def decide(session: AsyncSession, user_id: uuid.UUID, approval_id: uuid.UUID, approve: bool, note: str | None = None) -> ApprovalRequest:
    approval = await session.get(ApprovalRequest, approval_id, with_for_update=True)
    if approval is None or approval.user_id != user_id:
        raise NotFound("Solicitud no encontrada")
    if approval.status != "pending":
        raise Conflict(f"La solicitud ya fue resuelta ({approval.status})")
    now = datetime.now(UTC)
    if approval.expires_at and approval.expires_at <= now:
        approval.status = "expired"
        raise Conflict("La solicitud venció")
    approval.status = "approved" if approve else "rejected"
    approval.decided_at = now
    approval.decision_note = note

    mission = await session.get(Mission, approval.mission_id) if approval.mission_id else None
    if approval.kind == "mission_plan" and mission is not None:
        if approve:
            await set_mission_status(session, mission, MissionStatus.RUNNING, "Plan aprobado por el usuario")
            await schedule_ready_tasks(session, mission)
        else:
            await set_mission_status(session, mission, MissionStatus.CANCELLED, "Plan rechazado por el usuario")
    elif approval.kind == "task" and approval.task_id:
        task = await session.get(MissionTask, approval.task_id)
        if task is not None:
            if approve:
                task.approved_at = now
                task.status = TaskStatus.PENDING
            else:
                task.status = TaskStatus.SKIPPED
                task.error = "Rechazada por el usuario"
            await publish_task(task)
            if mission is not None and mission.status == MissionStatus.RUNNING:
                await schedule_ready_tasks(session, mission)
    elif approval.kind == "tool" and approval.tool_execution_id:
        execution = await session.get(ToolExecution, approval.tool_execution_id)
        if execution is not None and not approve:
            execution.status = ToolExecutionStatus.REJECTED
        if approval.task_id:
            task = await session.get(MissionTask, approval.task_id)
            if task is not None and task.status == TaskStatus.AWAITING_APPROVAL:
                # La tarea se reanuda desde el estado guardado; el runtime ejecuta (o descarta) la operación.
                task.status = TaskStatus.READY
                await queue.enqueue(session, "task.run", {"task_id": str(task.id)}, user_id=user_id, priority=1,
                                    idempotency_key=f"task.run:{task.id}")
                await publish_task(task)
        elif approve and execution is not None:
            await queue.enqueue(session, "tool.execute_approved", {"execution_id": str(execution.id)}, user_id=user_id,
                                idempotency_key=f"tool.approved:{execution.id}")
    await record_audit(
        session, user_id, "approval.approved" if approve else "approval.rejected",
        f"{'Aprobado' if approve else 'Rechazado'}: {approval.title}", actor_type="user",
        target_type="approval", target_id=approval.id, mission_id=approval.mission_id, outcome="info",
        details={"note": note, "kind": approval.kind},
    )
    return approval
