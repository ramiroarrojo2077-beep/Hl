"""NEXUS Meetings: reuniones reales entre agentes con límites de rondas, tiempo y presupuesto.

Cada intervención es una ejecución real del modelo del agente. Las rondas son trabajos
independientes de la cola: si el servidor se reinicia, la reunión continúa desde la
ronda en curso sin repetir intervenciones ya registradas.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.runtime import record_message, run_agent, set_agent_status
from app.core import events
from app.core.errors import BudgetExceeded, Conflict, EmergencyStopActive, NexusError, NotFound
from app.jobs import queue
from app.models import Agent, AgentMessage, Meeting, MeetingParticipant, Project, UserSettings
from app.models.enums import MeetingType
from app.monitoring.audit import record_audit
from app.notifications.service import notify
from app.orchestrator.jsonutil import JSONExtractionError, extract_json

TYPE_LABELS = {
    "planning": "planificación",
    "research": "investigación",
    "technical": "técnica",
    "review": "revisión",
    "problem_solving": "resolución de problemas",
    "evaluation": "evaluación",
}
_TAG = re.compile(r"^\s*\[(PROPUESTA|PREGUNTA|OBJECI[OÓ]N|ACUERDO|DATO|ACLARACI[OÓ]N|ERROR)\]", re.I)
_TAG_TYPES = {"PROPUESTA": "proposal", "PREGUNTA": "question", "OBJECION": "objection", "OBJECIÓN": "objection",
              "ACUERDO": "agreement", "DATO": "result", "ACLARACION": "clarification", "ACLARACIÓN": "clarification",
              "ERROR": "error_report"}


async def publish_meeting(meeting: Meeting) -> None:
    await events.publish(meeting.user_id, "meeting.updated", {
        "id": str(meeting.id), "status": meeting.status, "current_round": meeting.current_round, "topic": meeting.topic,
        "stop_reason": meeting.stop_reason,
    })


async def create_meeting(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    topic: str,
    objective: str,
    meeting_type: str = "planning",
    participant_slugs: list[str] | None = None,
    max_rounds: int = 3,
    max_duration_seconds: int = 900,
    budget_usd: Decimal | None = None,
    project_id: uuid.UUID | None = None,
    mission_id: uuid.UUID | None = None,
    context: str | None = None,
    expected_outcomes: str | None = None,
    scheduled_job_id: uuid.UUID | None = None,
) -> Meeting:
    if meeting_type not in {t.value for t in MeetingType}:
        raise NexusError(f"Tipo de reunión inválido: {meeting_type}")
    settings = await session.get(UserSettings, user_id)
    if settings and settings.emergency_stop:
        raise EmergencyStopActive("STOP ALL está activo")
    if project_id is not None:
        project = await session.get(Project, project_id)
        if project is None or project.user_id != user_id:
            raise NotFound("Proyecto no encontrado")
    agents = (await session.scalars(select(Agent).where(Agent.user_id == user_id, Agent.is_enabled.is_(True)))).all()
    by_slug = {a.slug: a for a in agents}
    moderator = by_slug.get("nexus")
    if moderator is None:
        raise NexusError("Se necesita a NEXUS para moderar la reunión")
    slugs = [s.lower() for s in (participant_slugs or [])]
    if not slugs:
        slugs = [a.slug for a in agents if a.participates_in_meetings and a.slug != "nexus"][:4]
    participants = []
    for slug in slugs:
        agent = by_slug.get(slug)
        if agent is None:
            raise NotFound(f"No existe el agente {slug}")
        if agent.id != moderator.id and agent not in participants:
            participants.append(agent)
    if not participants:
        raise NexusError("La reunión necesita al menos un participante además de NEXUS")
    meeting = Meeting(
        user_id=user_id, project_id=project_id, mission_id=mission_id, meeting_type=meeting_type, topic=topic.strip()[:300],
        objective=objective.strip(), context=context, expected_outcomes=expected_outcomes,
        max_rounds=max(1, min(max_rounds, 6)), max_duration_seconds=max(60, min(max_duration_seconds, 7200)),
        budget_usd=budget_usd, scheduled_job_id=scheduled_job_id, status="scheduled",
    )
    session.add(meeting)
    await session.flush()
    session.add(MeetingParticipant(meeting_id=meeting.id, agent_id=moderator.id, role="moderator", position=0))
    for i, agent in enumerate(participants, 1):
        session.add(MeetingParticipant(meeting_id=meeting.id, agent_id=agent.id, role="participant", position=i))
    await session.flush()
    await queue.enqueue(session, "meeting.round", {"meeting_id": str(meeting.id), "round": 1}, user_id=user_id,
                        idempotency_key=f"meeting.round:{meeting.id}:1")
    await record_audit(session, user_id, "meeting.created", f"Reunión convocada: «{meeting.topic}»", actor_type="user",
                       target_type="meeting", target_id=meeting.id, project_id=project_id, mission_id=mission_id,
                       details={"participants": [a.slug for a in participants], "type": meeting_type})
    await publish_meeting(meeting)
    return meeting


async def get_meeting(session: AsyncSession, user_id: uuid.UUID, meeting_id: uuid.UUID) -> Meeting:
    meeting = await session.get(Meeting, meeting_id)
    if meeting is None or meeting.user_id != user_id:
        raise NotFound("Reunión no encontrada")
    return meeting


async def participants_of(session: AsyncSession, meeting_id: uuid.UUID) -> list[tuple[MeetingParticipant, Agent]]:
    rows = await session.execute(
        select(MeetingParticipant, Agent).join(Agent, Agent.id == MeetingParticipant.agent_id)
        .where(MeetingParticipant.meeting_id == meeting_id).order_by(MeetingParticipant.position)
    )
    return [(p, a) for p, a in rows]


async def transcript(session: AsyncSession, meeting: Meeting, limit: int = 40) -> tuple[str, list[AgentMessage]]:
    msgs = list((await session.scalars(
        select(AgentMessage).where(AgentMessage.channel == "meeting", AgentMessage.channel_id == meeting.id)
        .order_by(AgentMessage.created_at)
    )).all())
    names = {a.id: a.name for _, a in await participants_of(session, meeting.id)}
    lines = [f"[Ronda {m.turn}] {names.get(m.sender_agent_id, 'Sistema')}: {m.content}" for m in msgs[-limit:]]
    return "\n\n".join(lines), msgs


def _brief(meeting: Meeting, names: list[str]) -> str:
    return (
        f"Reunión de {TYPE_LABELS.get(meeting.meeting_type, meeting.meeting_type)}: {meeting.topic}\n"
        f"Objetivo: {meeting.objective}\n"
        + (f"Contexto: {meeting.context}\n" if meeting.context else "")
        + (f"Resultados esperados: {meeting.expected_outcomes}\n" if meeting.expected_outcomes else "")
        + f"Participantes: {', '.join(names)}. Rondas máximas: {meeting.max_rounds}."
    )


def _limit_reason(meeting: Meeting) -> str | None:
    if meeting.started_at and (datetime.now(UTC) - meeting.started_at).total_seconds() > meeting.max_duration_seconds:
        return "Se alcanzó el tiempo máximo de la reunión"
    if meeting.budget_usd is not None and meeting.spent_usd >= meeting.budget_usd:
        return "Se alcanzó el presupuesto de la reunión"
    return None


async def run_round(session: AsyncSession, meeting_id: uuid.UUID, round_number: int) -> None:
    meeting = await session.get(Meeting, meeting_id)
    if meeting is None or meeting.status in ("completed", "failed", "cancelled", "summarizing"):
        return
    if meeting.current_round > round_number:
        return  # ronda ya procesada
    if meeting.status == "scheduled":
        meeting.status = "running"
        meeting.started_at = datetime.now(UTC)
    meeting.current_round = round_number
    await publish_meeting(meeting)
    await queue.commit(session)

    roster = await participants_of(session, meeting.id)
    names = [a.name for _, a in roster]
    moderator = next(a for p, a in roster if p.role == "moderator")
    speakers = [(p, a) for p, a in roster if p.role != "moderator"]
    brief = _brief(meeting, names)
    mode = (await session.get(UserSettings, meeting.user_id)).autonomy_mode  # type: ignore[union-attr]

    async def speak(participant: MeetingParticipant, agent: Agent, instruction: str) -> None:
        already = await session.scalar(
            select(AgentMessage.id).where(
                AgentMessage.channel == "meeting", AgentMessage.channel_id == meeting.id,
                AgentMessage.turn == round_number, AgentMessage.sender_agent_id == agent.id,
                AgentMessage.message_type != "moderation",
            )
        )
        if already:
            return  # idempotencia: esta intervención ya existe
        history, _ = await transcript(session, meeting)
        await set_agent_status(session, agent, "collaborating", f"Reunión: {meeting.topic}")
        await queue.commit(session)
        result = await run_agent(
            session, agent, purpose="meeting", task_type="meeting", autonomy_mode=mode, meeting_id=meeting.id,
            project_id=meeting.project_id, mission_id=meeting.mission_id, use_tools=True,
            tool_filter={"memory.search", "documents.read", "project.list_files", "web.fetch", "web.search"},
            max_steps=3, max_tokens=2500,
            prompt=f"""{brief}

Transcripción hasta ahora:
{history or '(todavía nadie habló)'}

Ronda {round_number} de {meeting.max_rounds}. {instruction}
Empezá tu intervención con una etiqueta: [PROPUESTA], [PREGUNTA], [OBJECIÓN], [ACUERDO], [DATO] o [ACLARACIÓN].
Sé concreto (máx. ~250 palabras), respondé a lo que dijeron los demás por su nombre cuando corresponda y no repitas.""",
        )
        text = result.text or "(sin intervención)"
        tag = _TAG.match(text)
        mtype = _TAG_TYPES.get(tag.group(1).upper(), "message") if tag else "message"
        await record_message(
            session, meeting.user_id, channel="meeting", channel_id=meeting.id, content=text, sender_type="agent",
            sender_agent_id=agent.id, message_type=mtype, model_used=result.model_label, turn=round_number,
        )
        participant.turns_taken += 1
        await set_agent_status(session, agent, "idle")
        await queue.commit(session)

    try:
        if round_number == 1:
            mod_part = next(p for p, a in roster if a.id == moderator.id)
            await speak(mod_part, moderator, "Como moderador, abrí la reunión: encuadrá el problema, qué decisión hay que tomar y qué esperás de cada participante.")
        for participant, agent in speakers:
            if reason := _limit_reason(meeting):
                meeting.stop_reason = reason
                break
            await speak(participant, agent, "Aportá desde tu especialidad. Si no estás de acuerdo con alguien, explicá por qué con argumentos.")
    except (BudgetExceeded, EmergencyStopActive) as exc:
        meeting.stop_reason = exc.message
        await _finish_or_summarize(session, meeting, force=True)
        return

    # El moderador decide si hace falta otra ronda.
    if meeting.stop_reason or round_number >= meeting.max_rounds:
        await _finish_or_summarize(session, meeting)
        return
    history, _ = await transcript(session, meeting)
    decision = await run_agent(
        session, moderator, purpose="meeting", task_type="simple", autonomy_mode=mode, meeting_id=meeting.id, use_tools=False,
        max_tokens=600,
        prompt=f"""{brief}\n\nTranscripción:\n{history}\n\nComo moderador: ¿hace falta otra ronda para cumplir el objetivo,
o ya hay suficiente para cerrar? Respondé SOLO JSON: {{"continue": true|false, "reason": "...", "focus": "en qué deben enfocarse"}}""",
    )
    try:
        data = extract_json(decision.text)
        go_on = bool(data.get("continue")) if isinstance(data, dict) else False
        focus = str(data.get("focus", "")) if isinstance(data, dict) else ""
    except JSONExtractionError:
        go_on, focus = False, ""
    if go_on:
        await record_message(
            session, meeting.user_id, channel="meeting", channel_id=meeting.id, sender_type="agent", sender_agent_id=moderator.id,
            message_type="moderation", turn=round_number, model_used=decision.model_label,
            content=f"Pasamos a la ronda {round_number + 1}. Foco: {focus}",
        )
        await queue.enqueue(session, "meeting.round", {"meeting_id": str(meeting.id), "round": round_number + 1},
                            user_id=meeting.user_id, idempotency_key=f"meeting.round:{meeting.id}:{round_number + 1}")
    else:
        meeting.stop_reason = "El moderador dio por cumplido el objetivo"
        await _finish_or_summarize(session, meeting)


async def _finish_or_summarize(session: AsyncSession, meeting: Meeting, force: bool = False) -> None:
    meeting.status = "summarizing"
    meeting.stop_reason = meeting.stop_reason or ("Detenida" if force else "Se alcanzó el máximo de rondas")
    await publish_meeting(meeting)
    await queue.enqueue(session, "meeting.summarize", {"meeting_id": str(meeting.id)}, user_id=meeting.user_id,
                        idempotency_key=f"meeting.summarize:{meeting.id}")


async def summarize(session: AsyncSession, meeting_id: uuid.UUID) -> None:
    meeting = await session.get(Meeting, meeting_id)
    if meeting is None or meeting.status != "summarizing":
        return
    roster = await participants_of(session, meeting.id)
    moderator = next(a for p, a in roster if p.role == "moderator")
    history, msgs = await transcript(session, meeting, limit=200)
    if not msgs:
        meeting.status = "failed"
        meeting.summary = "La reunión terminó sin intervenciones."
        meeting.ended_at = datetime.now(UTC)
        await publish_meeting(meeting)
        return
    mode = (await session.get(UserSettings, meeting.user_id)).autonomy_mode  # type: ignore[union-attr]
    slugs = ", ".join(a.slug for _, a in roster)
    result = await run_agent(
        session, moderator, purpose="meeting", task_type="summary", autonomy_mode=mode, meeting_id=meeting.id, use_tools=False,
        max_tokens=4000, check_meeting_budget=False,
        prompt=f"""{_brief(meeting, [a.name for _, a in roster])}

Transcripción completa:
{history}

Redactá el acta de la reunión. Respondé SOLO JSON:
{{"summary": "resumen fiel de lo discutido",
  "decisions": ["decisión tomada"],
  "arguments": [{{"agent": "slug", "point": "argumento principal"}}],
  "disagreements": ["desacuerdo que quedó abierto"],
  "derived_tasks": [{{"title": "...", "description": "...", "agent": "uno de: {slugs}", "priority": 1-5}}],
  "next_steps": ["..."]}}
No inventes decisiones que no se tomaron.""",
    )
    try:
        outcome = extract_json(result.text)
        if not isinstance(outcome, dict):
            raise JSONExtractionError("no es objeto")
    except JSONExtractionError:
        outcome = {"summary": result.text, "decisions": [], "arguments": [], "disagreements": [], "derived_tasks": [], "next_steps": []}
    meeting.summary = str(outcome.get("summary", ""))
    meeting.outcome = outcome
    meeting.status = "completed"
    meeting.ended_at = datetime.now(UTC)
    await record_message(
        session, meeting.user_id, channel="meeting", channel_id=meeting.id, sender_type="agent", sender_agent_id=moderator.id,
        message_type="summary", content=meeting.summary, model_used=result.model_label, turn=meeting.current_round,
    )
    await record_audit(session, meeting.user_id, "meeting.completed", f"Reunión finalizada: «{meeting.topic}»", actor_type="agent",
                       agent_id=moderator.id, target_type="meeting", target_id=meeting.id, mission_id=meeting.mission_id,
                       model_used=result.model_label, tokens=meeting.tokens_used, cost_usd=meeting.spent_usd)
    await notify(session, meeting.user_id, "meeting_finished", f"Reunión finalizada: {meeting.topic}",
                 meeting.summary[:300], {"meeting_id": str(meeting.id)})
    await publish_meeting(meeting)


async def cancel_meeting(session: AsyncSession, meeting: Meeting) -> None:
    if meeting.status in ("completed", "failed", "cancelled"):
        raise Conflict("La reunión ya terminó")
    meeting.status = "cancelled"
    meeting.stop_reason = "Cancelada por el usuario"
    meeting.ended_at = datetime.now(UTC)
    await queue.cancel_jobs(session, user_id=meeting.user_id, payload_key="meeting_id", payload_value=str(meeting.id))
    await publish_meeting(meeting)
