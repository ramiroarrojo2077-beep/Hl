"""Endpoints de JARVIS CORE (/api/v1/jarvis)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import CurrentUser, current_user
from app.core.db import get_session
from app.core.errors import NexusError, NotFound
from app.jarvis import service
from app.jarvis.intents import ClassifyContext, classify
from app.jarvis.settings import jarvis_view, privacy_view
from app.jobs import queue
from app.models import Agent, AgentMessage, Conversation, ProjectFile, UserSettings
from app.monitoring.audit import record_audit

router = APIRouter(prefix="/jarvis", tags=["jarvis"])


class JarvisMessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    input_mode: str = Field(default="text", pattern=r"^(text|voice)$")
    conversation_id: uuid.UUID | None = None
    new_conversation: bool = False
    timezone: str | None = Field(default=None, max_length=60)
    attachment_file_ids: list[uuid.UUID] = Field(default_factory=list, max_length=10)
    interrupted_message_id: uuid.UUID | None = None
    spoken_chars: int | None = Field(default=None, ge=0)


class IntentIn(BaseModel):
    content: str = Field(min_length=1, max_length=8000)
    timezone: str | None = Field(default=None, max_length=60)


class VoiceSessionIn(BaseModel):
    action: str = Field(pattern=r"^(start|end)$")
    mode: str = Field(default="push_to_talk", pattern=r"^(push_to_talk|continuous|wake_word)$")
    session_id: str | None = Field(default=None, max_length=64)
    turns: int | None = Field(default=None, ge=0)
    duration_seconds: int | None = Field(default=None, ge=0)


class FeedbackIn(BaseModel):
    rating: int = Field(ge=-1, le=1)
    comment: str | None = Field(default=None, max_length=500)


@router.post("/message", status_code=status.HTTP_202_ACCEPTED)
async def message(body: JarvisMessageIn, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    attachments = []
    for fid in body.attachment_file_ids:
        pfile = await session.get(ProjectFile, fid)
        if pfile is None or pfile.user_id != cu.id:
            raise NotFound("Adjunto no encontrado")
        attachments.append({"file_id": str(pfile.id), "path": pfile.path, "project_id": str(pfile.project_id)})
    result = await service.process_message(
        session, cu.user, body.content, input_mode=body.input_mode, conversation_id=body.conversation_id,
        new_conversation=body.new_conversation, timezone=body.timezone, attachments=attachments,
        interrupted_message_id=body.interrupted_message_id, spoken_chars=body.spoken_chars,
    )
    await queue.commit(session)
    return result


@router.post("/intent")
async def intent(body: IntentIn, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Clasificación sin efectos (no registra mensajes ni crea acciones)."""
    settings = await session.get(UserSettings, cu.id)
    tz_name, tz = service.user_zone(settings, body.timezone)
    result = classify(body.content, ClassifyContext(now=datetime.now(tz), timezone=tz_name))
    return result.to_dict()


@router.get("/state")
async def state(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    return await service.jarvis_state(session, cu.id)


@router.get("/context")
async def context(timezone: str | None = Query(default=None, max_length=60), cu: CurrentUser = Depends(current_user),
                  session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    data = await service.jarvis_context(session, cu.user, timezone)
    settings = await session.get(UserSettings, cu.id)
    conv = await session.scalar(select(Conversation).where(Conversation.user_id == cu.id, Conversation.kind == "jarvis")
                                .order_by(Conversation.updated_at.desc()).limit(1))
    data["conversation_id"] = str(conv.id) if conv else None
    data["jarvis_settings"] = jarvis_view(settings.jarvis_settings if settings else None)
    await session.commit()
    return data


@router.post("/voice/session")
async def voice_session(body: VoiceSessionIn, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Registra el inicio/fin de una sesión de voz (nunca audio) y devuelve la configuración vigente."""
    from app.core import events
    from app.voice.service import current, remote_status

    settings = await session.get(UserSettings, cu.id)
    assert settings is not None
    vs = current(settings)
    if body.mode == "wake_word" and not (vs.get("wake_word_enabled") and vs.get("wake_word_consent_at")):
        raise NexusError("La palabra de activación está desactivada o no tiene tu consentimiento")
    sid = body.session_id or uuid.uuid4().hex
    conv = await service.get_or_create_jarvis_conversation(session, cu.id)
    await record_audit(session, cu.id, f"voice.session_{body.action}", f"Sesión de voz {'iniciada' if body.action == 'start' else 'finalizada'}",
                       actor_type="user", details={"mode": body.mode, "session_id": sid, "turns": body.turns,
                                                   "duration_seconds": body.duration_seconds, "audio_stored": False})
    await events.publish(cu.id, "voice.state", {"session_id": sid, "active": body.action == "start", "mode": body.mode,
                                                "entity": {"type": "voice_session", "id": sid}})
    await session.commit()
    return {"session_id": sid, "active": body.action == "start", "mode": body.mode, "conversation_id": str(conv.id),
            "settings": vs, "remote": await remote_status(session, cu.id), "audio_stored": False}


@router.get("/messages/{message_id}/trace")
async def trace(message_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Vista avanzada: etapas, especialistas, herramientas, modelos y errores REALES de una respuesta."""
    msg = await session.get(AgentMessage, message_id)
    if msg is None or msg.user_id != cu.id:
        raise NotFound("Mensaje no encontrado")
    user_msg = msg
    reply = None
    if msg.sender_type == "user":
        reply = await session.scalar(select(AgentMessage).where(AgentMessage.channel_id == msg.channel_id,
                                                                AgentMessage.meta["reply_to"].astext == str(msg.id)))
    else:
        reply = msg
        rt = (msg.meta or {}).get("reply_to")
        user_msg = await session.get(AgentMessage, uuid.UUID(rt)) if rt else msg
    consults = []
    if reply is not None and user_msg is not None and user_msg.created_at and reply.created_at:
        rows = (await session.scalars(select(AgentMessage).where(
            AgentMessage.user_id == cu.id, AgentMessage.channel == "direct", AgentMessage.channel_id == msg.channel_id,
            AgentMessage.created_at >= user_msg.created_at, AgentMessage.created_at <= reply.created_at).order_by(AgentMessage.created_at))).all()
        agents = {a.id: a.slug for a in (await session.scalars(select(Agent).where(Agent.user_id == cu.id))).all()}
        consults = [{"from": agents.get(r.sender_agent_id), "to": agents.get(r.recipient_agent_id), "type": r.message_type,
                     "content": r.content[:1500], "model": r.model_used, "at": r.created_at.isoformat()} for r in rows]
    um = (user_msg.meta or {}) if user_msg else {}
    rm = (reply.meta or {}) if reply else {}
    return {
        "message_id": str(message_id), "intent": um.get("intent"), "route": um.get("route"), "pipeline": um.get("pipeline") or rm.get("pipeline"),
        "reply": {"id": str(reply.id), "model": reply.model_used, "tools_used": rm.get("tools_used", []),
                  "consulted_agents": rm.get("consulted_agents", []), "tokens": rm.get("tokens"), "cost_usd": rm.get("cost_usd"),
                  "degraded_quality": rm.get("degraded_quality"), "models": rm.get("models"), "tool_errors": rm.get("tool_errors"),
                  "interrupted": rm.get("interrupted", False), "action_id": rm.get("action_id")} if reply else None,
        "collaboration": consults,
    }


@router.post("/messages/{message_id}/feedback", status_code=status.HTTP_204_NO_CONTENT)
async def feedback(message_id: uuid.UUID, body: FeedbackIn, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> None:
    from app.providers.quality import record

    msg = await session.get(AgentMessage, message_id)
    if msg is None or msg.user_id != cu.id or msg.sender_type != "agent":
        raise NotFound("Respuesta no encontrada")
    msg.meta = {**(msg.meta or {}), "feedback": {"rating": body.rating, "comment": body.comment, "at": datetime.now(UTC).isoformat()}}
    if body.rating != 0 and msg.model_used:
        value = 9.0 if body.rating > 0 else 3.0
        from app.jarvis.intents import STYLE

        category = (msg.meta or {}).get("category") or "conversation"
        await record(session, cu.id, model_label=msg.model_used, task_type=STYLE.get(category, STYLE["information"])[2],
                     source="user_feedback", criteria={"precision": value, "instruction_following": value, "completeness": value},
                     notes=body.comment, message_id=msg.id)
    await session.commit()


@router.delete("/history", status_code=status.HTTP_200_OK)
async def delete_history(confirm: bool = False, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, int]:
    """Borra el historial de conversaciones con NEXUS (irreversible: requiere confirm=true)."""
    if not confirm:
        raise NexusError("Borrar el historial es irreversible: enviá confirm=true")
    convs = list((await session.scalars(select(Conversation.id).where(Conversation.user_id == cu.id, Conversation.kind == "jarvis"))).all())
    msgs = await session.execute(delete(AgentMessage).where(AgentMessage.user_id == cu.id, AgentMessage.channel.in_(["chat", "direct"]),
                                                            AgentMessage.channel_id.in_(convs)))
    await session.execute(delete(Conversation).where(Conversation.id.in_(convs)))
    await record_audit(session, cu.id, "jarvis.history_deleted", "Historial de NEXUS borrado", actor_type="user",
                       details={"conversations": len(convs), "messages": msgs.rowcount or 0})
    await session.commit()
    return {"conversations_deleted": len(convs), "messages_deleted": msgs.rowcount or 0}


@router.get("/settings")
async def get_jarvis_settings(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    settings = await session.get(UserSettings, cu.id)
    assert settings is not None
    return {"jarvis": jarvis_view(settings.jarvis_settings), "privacy": privacy_view(settings.privacy_settings)}
