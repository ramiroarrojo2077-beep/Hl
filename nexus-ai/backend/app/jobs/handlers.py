"""Handlers de cada tipo de trabajo de la cola."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, Job, Meeting, Mission, Notification, ProjectFile, ToolExecution, UserSettings
from app.models.enums import MissionStatus

logger = logging.getLogger(__name__)
Handler = Callable[[AsyncSession, Job, str], Awaitable[None]]


async def _mission(session: AsyncSession, job: Job) -> Mission | None:
    return await session.get(Mission, uuid.UUID(job.payload["mission_id"]), with_for_update=True)


async def handle_mission_plan(session: AsyncSession, job: Job, worker_id: str) -> None:
    from app.orchestrator.engine import plan_mission

    mission = await _mission(session, job)
    if mission is not None:
        await plan_mission(session, mission)


async def handle_task_run(session: AsyncSession, job: Job, worker_id: str) -> None:
    from app.orchestrator.engine import run_task

    await run_task(session, uuid.UUID(job.payload["task_id"]), worker_id)


async def handle_mission_review(session: AsyncSession, job: Job, worker_id: str) -> None:
    from app.orchestrator.engine import review_mission

    mission = await _mission(session, job)
    if mission is not None:
        await review_mission(session, mission)


async def handle_mission_security(session: AsyncSession, job: Job, worker_id: str) -> None:
    from app.orchestrator.engine import security_review

    mission = await _mission(session, job)
    if mission is not None:
        await security_review(session, mission)


async def handle_mission_consolidate(session: AsyncSession, job: Job, worker_id: str) -> None:
    from app.orchestrator.engine import consolidate_mission

    mission = await _mission(session, job)
    if mission is not None:
        await consolidate_mission(session, mission)


async def handle_meeting_round(session: AsyncSession, job: Job, worker_id: str) -> None:
    from app.meetings.service import run_round

    await run_round(session, uuid.UUID(job.payload["meeting_id"]), int(job.payload["round"]))


async def handle_meeting_summarize(session: AsyncSession, job: Job, worker_id: str) -> None:
    from app.meetings.service import summarize

    await summarize(session, uuid.UUID(job.payload["meeting_id"]))


async def handle_chat_reply(session: AsyncSession, job: Job, worker_id: str) -> None:
    from app.chat.service import generate_reply

    await generate_reply(session, uuid.UUID(job.payload["conversation_id"]), uuid.UUID(job.payload["message_id"]))


async def handle_file_index(session: AsyncSession, job: Job, worker_id: str) -> None:
    from app.memory.extract import UnsupportedDocument, extract_text
    from app.memory.service import index_project_file
    from app.projects.storage import read_bytes

    pfile = await session.get(ProjectFile, uuid.UUID(job.payload["file_id"]))
    if pfile is None or not pfile.is_latest:
        return
    try:
        text = extract_text(await read_bytes(pfile.storage_key), pfile.content_type, pfile.path)
    except UnsupportedDocument as exc:
        pfile.index_error = str(exc)
        return
    count = await index_project_file(session, pfile, text)
    pfile.meta = {**pfile.meta, "chunks": count}


async def handle_tool_execute_approved(session: AsyncSession, job: Job, worker_id: str) -> None:
    """Operación aprobada fuera de una tarea (p.ej. pedida desde el chat)."""
    from app.tools.executor import run_approved_execution
    from app.tools.registry import ToolContext

    execution = await session.get(ToolExecution, uuid.UUID(job.payload["execution_id"]))
    if execution is None or execution.agent_id is None:
        return
    agent = await session.get(Agent, execution.agent_id)
    settings = await session.get(UserSettings, execution.user_id)
    assert agent is not None and settings is not None
    ctx = ToolContext(session=session, user_id=execution.user_id, agent=agent, autonomy_mode=settings.autonomy_mode,
                      mission_id=execution.mission_id)
    content, is_error = await run_approved_execution(ctx, execution)
    from app.notifications.service import notify

    await notify(session, execution.user_id, "report_ready", f"Operación aprobada ejecutada: {execution.tool_key}",
                 content[:400], {"tool_execution_id": str(execution.id), "is_error": str(is_error)})


async def handle_notification_deliver(session: AsyncSession, job: Job, worker_id: str) -> None:
    from app.core import events
    from app.notifications.service import deliver_push, serialize

    n = await session.get(Notification, uuid.UUID(job.payload["notification_id"]))
    if n is None:
        return
    n.deliver_at = None
    await events.publish(n.user_id, "notification.created", serialize(n))
    await deliver_push(session, n.id)


async def handle_eval_run(session: AsyncSession, job: Job, worker_id: str) -> None:
    from app.providers.evals import run_evaluation

    await run_evaluation(session, uuid.UUID(job.payload["run_id"]))


async def handle_jarvis_reply(session: AsyncSession, job: Job, worker_id: str) -> None:
    from app.jarvis.service import generate_jarvis_reply

    await generate_jarvis_reply(session, uuid.UUID(job.payload["conversation_id"]), uuid.UUID(job.payload["message_id"]))


async def handle_jarvis_summarize(session: AsyncSession, job: Job, worker_id: str) -> None:
    from app.jarvis.service import summarize_conversation

    await summarize_conversation(session, uuid.UUID(job.payload["conversation_id"]))


async def handle_automation_run(session: AsyncSession, job: Job, worker_id: str) -> None:
    from app.automations.service import execute_run

    await execute_run(session, uuid.UUID(job.payload["automation_id"]), job.payload.get("trigger") or {})


async def handle_automation_jarvis(session: AsyncSession, job: Job, worker_id: str) -> None:
    from app.automations.service import run_jarvis_prompt

    await run_jarvis_prompt(session, uuid.UUID(job.payload["automation_id"]), job.payload["prompt"], job.payload.get("trigger") or {})


HANDLERS: dict[str, Handler] = {
    "mission.plan": handle_mission_plan,
    "task.run": handle_task_run,
    "mission.review": handle_mission_review,
    "mission.security": handle_mission_security,
    "mission.consolidate": handle_mission_consolidate,
    "meeting.round": handle_meeting_round,
    "meeting.summarize": handle_meeting_summarize,
    "chat.reply": handle_chat_reply,
    "file.index": handle_file_index,
    "tool.execute_approved": handle_tool_execute_approved,
    "notification.deliver": handle_notification_deliver,
    "eval.run": handle_eval_run,
    "jarvis.reply": handle_jarvis_reply,
    "jarvis.summarize": handle_jarvis_summarize,
    "automation.run": handle_automation_run,
    "automation.jarvis": handle_automation_jarvis,
}


async def on_job_failed_permanently(session: AsyncSession, job: Job, error: str) -> None:
    """Efectos de un trabajo que agotó sus intentos: nada queda 'colgado' en silencio."""
    from app.notifications.service import notify
    from app.orchestrator.engine import set_mission_status, task_job_exhausted

    if job.kind == "task.run":
        await task_job_exhausted(session, uuid.UUID(job.payload["task_id"]), error)
    elif job.kind.startswith("mission."):
        mission = await session.get(Mission, uuid.UUID(job.payload["mission_id"]))
        if mission is not None and mission.status not in (MissionStatus.COMPLETED, MissionStatus.CANCELLED):
            await set_mission_status(session, mission, MissionStatus.BLOCKED, f"Falló la etapa {job.kind}: {error[:300]}")
            await notify(session, mission.user_id, "mission_blocked", f"Misión bloqueada: {mission.title}", error[:400],
                         {"mission_id": str(mission.id)})
    elif job.kind.startswith("meeting."):
        meeting = await session.get(Meeting, uuid.UUID(job.payload["meeting_id"]))
        if meeting is not None and meeting.status not in ("completed", "cancelled"):
            meeting.status = "failed"
            meeting.stop_reason = error[:500]
            meeting.ended_at = datetime.now(UTC)


async def on_job_exhausted(session: AsyncSession, job: Job) -> None:
    await on_job_failed_permanently(session, job, job.last_error or "Trabajo interrumpido repetidamente")
