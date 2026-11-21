"""Chat general con NEXUS (o con cualquier agente). Las respuestas se generan en el
worker con streaming real del proveedor; los fragmentos llegan a la app por WebSocket."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.runtime import record_message, run_agent, set_agent_status
from app.core import events
from app.core.errors import NotFound
from app.jobs import queue
from app.models import Agent, AgentMessage, Conversation, UserSettings
from app.providers.base import Message

CHAT_TOOLS = {
    "missions.create", "missions.list", "missions.status", "meetings.request", "agents.list", "agents.ask",
    "memory.search", "memory.propose", "documents.read", "project.list_files", "reminders.create", "web.fetch", "web.search",
    "drafts.create",
}
HISTORY_LIMIT = 24


async def get_conversation(session: AsyncSession, user_id: uuid.UUID, conversation_id: uuid.UUID) -> Conversation:
    conv = await session.get(Conversation, conversation_id)
    if conv is None or conv.user_id != user_id:
        raise NotFound("Conversación no encontrada")
    return conv


async def post_user_message(session: AsyncSession, conv: Conversation, content: str, attachments: list[dict] | None = None) -> AgentMessage:
    msg = await record_message(
        session, conv.user_id, channel="chat", channel_id=conv.id, content=content, sender_type="user",
        meta={"attachments": attachments or []},
    )
    await queue.enqueue(session, "chat.reply", {"conversation_id": str(conv.id), "message_id": str(msg.id)},
                        user_id=conv.user_id, priority=1, idempotency_key=f"chat.reply:{msg.id}")
    return msg


async def _history(session: AsyncSession, conv: Conversation, before: AgentMessage) -> list[Message]:
    rows = list((await session.scalars(
        select(AgentMessage)
        .where(AgentMessage.channel == "chat", AgentMessage.channel_id == conv.id, AgentMessage.created_at < before.created_at)
        .order_by(AgentMessage.created_at.desc()).limit(HISTORY_LIMIT)
    )).all())
    rows.reverse()
    history: list[Message] = []
    for m in rows:
        if m.message_type in ("question", "answer"):
            continue  # consultas internas entre agentes: no se mezclan como turnos del chat
        role = "user" if m.sender_type == "user" else "assistant"
        if history and history[-1].role == role:
            history[-1].content += "\n\n" + m.content
        else:
            history.append(Message(role=role, content=m.content))
    if history and history[0].role == "assistant":
        history.insert(0, Message(role="user", content="(inicio de la conversación)"))
    return history


async def generate_reply(session: AsyncSession, conversation_id: uuid.UUID, message_id: uuid.UUID) -> None:
    conv = await session.get(Conversation, conversation_id)
    user_msg = await session.get(AgentMessage, message_id)
    if conv is None or user_msg is None:
        return
    existing = await session.scalar(
        select(AgentMessage.id).where(AgentMessage.channel == "chat", AgentMessage.channel_id == conv.id,
                                      AgentMessage.meta["reply_to"].astext == str(user_msg.id))
    )
    if existing:
        return  # ya respondido (reintento tras caída)
    agent = await session.get(Agent, conv.agent_id) if conv.agent_id else None
    if agent is None:
        agent = await session.scalar(select(Agent).where(Agent.user_id == conv.user_id, Agent.slug == "nexus"))
    assert agent is not None
    settings = await session.get(UserSettings, conv.user_id)
    stream_id = uuid.uuid4().hex
    agent_id, user_id, conv_id = agent.id, conv.user_id, conv.id

    async def on_text(delta: str) -> None:
        await events.publish(user_id, "chat.delta", {"conversation_id": str(conv_id), "stream_id": stream_id,
                                                     "agent_id": str(agent_id), "delta": delta})

    await set_agent_status(session, agent, "thinking", "Respondiendo en el chat")
    await queue.commit(session)
    history = await _history(session, conv, user_msg)
    attachments = user_msg.meta.get("attachments") or []
    prompt = user_msg.content
    if attachments:
        prompt += "\n\nArchivos adjuntos en el proyecto: " + ", ".join(a.get("path", "") for a in attachments)
    try:
        result = await run_agent(
            session, agent, purpose="chat", task_type="chat", prompt=prompt, history=history,
            autonomy_mode=settings.autonomy_mode if settings else "supervised", project_id=conv.project_id,
            conversation_id=conv.id, tool_filter=CHAT_TOOLS if agent.slug == "nexus" else None, max_steps=6,
            on_text=on_text,
            extra_system=(
                "# Contexto del chat\nEstás conversando con el usuario en el chat general de NEXUS. Si pide un objetivo que "
                "requiere trabajo planificado, creá una misión con missions.create y explicá qué va a pasar. Si consultás "
                "a otro agente, decí explícitamente qué información aportó."
            ),
        )
        consulted = sorted({
            str((s.get("args") or {}).get("agent", "")).lower()
            for s in result.steps if s.get("type") == "tool" and s.get("tool") == "agents.ask" and not s.get("is_error")
        })
        await record_message(
            session, conv.user_id, channel="chat", channel_id=conv.id, content=result.text or "(sin respuesta)",
            sender_type="agent", sender_agent_id=agent.id, model_used=result.model_label,
            meta={"reply_to": str(user_msg.id), "stream_id": stream_id, "tools_used": [s.get("tool") for s in result.steps if s.get("type") == "tool"],
                  "consulted_agents": consulted, "tokens": result.tokens, "cost_usd": str(result.cost_usd)},
        )
    except Exception as exc:
        reply_to = str(message_id)
        await session.rollback()
        await record_message(
            session, user_id, channel="chat", channel_id=conv_id, sender_type="system", message_type="error",
            content=f"No pude responder: {getattr(exc, 'message', str(exc))}", meta={"reply_to": reply_to, "stream_id": stream_id},
        )
        agent = await session.get(Agent, agent_id)
        assert agent is not None
        await set_agent_status(session, agent, "error", "Error en el chat")
        await session.commit()
        return
    await set_agent_status(session, agent, "idle")
