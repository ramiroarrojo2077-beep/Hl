"""JARVIS CORE: capa superior que coordina la experiencia del usuario.

Etapas (capítulo 1.3), modulares: cada pedido ejecuta solo las que necesita y queda
registrado cuáles corrieron y cuánto tardaron (vista avanzada).

 1 input          texto, voz (transcripción) o integración autorizada
 2 understanding  normalización, palabra de activación, datos pendientes de una pregunta
 3 context        recuerdos, conversación, pendientes reales (solo si hace falta un modelo)
 4 intent         clasificación local determinista (app.jarvis.intents)
 5 routing        acción directa / consulta de memoria / modelo + especialistas sugeridos
 6 permissions    Action Registry (riesgo y confirmación), STOP ALL, permisos de agentes
 7 execution      propone/ejecuta la acción o encola la respuesta del modelo
 8 verification   relee lo creado (servidor) o espera el informe del dispositivo
 9 response       respuesta natural (plantilla con personalidad o modelo)
10 memory         guarda lo que el usuario pidió recordar; resumen de la conversación
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.runtime import AgentInterrupted, record_message, run_agent, set_agent_status
from app.core import events
from app.core.errors import NexusError, NotFound
from app.jarvis.intents import ClassifyContext, Intent, classify
from app.jarvis.persona import VOICE_RULES, persona_prompt
from app.jobs import queue
from app.models import (
    ActionRequest,
    Agent,
    AgentMessage,
    AgentPermission,
    ApprovalRequest,
    Automation,
    Conversation,
    Job,
    MemoryItem,
    Mission,
    MissionTask,
    Notification,
    Project,
    ScheduledJob,
    User,
    UserSettings,
)
from app.providers.base import Message

logger = logging.getLogger(__name__)

JARVIS_TOOLS = {
    "missions.create", "missions.list", "missions.status", "meetings.request", "agents.list", "agents.ask",
    "memory.search", "memory.propose", "documents.read", "project.list_files", "reminders.create", "web.fetch", "web.search",
    "drafts.create", "actions.propose",
}
PENDING_TTL = timedelta(minutes=15)
SUMMARY_THRESHOLD = 60
STALE_DAYS = 180
DEFAULT_TZ = "UTC"


@dataclass
class Trace:
    stages: list[dict[str, Any]] = field(default_factory=list)
    _t: float = field(default_factory=time.perf_counter)

    def add(self, name: str, status: str = "done", **detail: Any) -> None:
        now = time.perf_counter()
        self.stages.append({"stage": name, "status": status, "ms": round((now - self._t) * 1000, 2), **detail})
        self._t = now


# ------------------------------------------------------------------ utilidades

def user_zone(settings: UserSettings | None, override: str | None = None) -> tuple[str, ZoneInfo]:
    for name in (override, ((settings.jarvis_settings or {}) if settings else {}).get("timezone"), DEFAULT_TZ):
        if not name:
            continue
        try:
            return name, ZoneInfo(name)
        except (ZoneInfoNotFoundError, ValueError):
            continue
    return "UTC", ZoneInfo("UTC")


async def nexus_agent(session: AsyncSession, user_id: uuid.UUID) -> Agent:
    agent = await session.scalar(select(Agent).where(Agent.user_id == user_id, Agent.slug == "nexus"))
    if agent is None:
        raise NotFound("No existe el agente NEXUS")
    return agent


async def ensure_permissions(session: AsyncSession, settings: UserSettings, nexus: Agent) -> None:
    """Agrega una única vez a NEXUS los permisos nuevos de la 2.0 (cuentas creadas con la 1.0)."""
    js = dict(settings.jarvis_settings or {})
    if js.get("permissions_v2"):
        return
    for key in ("actions.propose", "web.search"):
        exists = await session.scalar(select(AgentPermission.id).where(AgentPermission.agent_id == nexus.id, AgentPermission.tool_key == key))
        if exists is None:
            session.add(AgentPermission(agent_id=nexus.id, tool_key=key, allowed=True, mode="auto"))
    js["permissions_v2"] = True
    settings.jarvis_settings = js
    await session.flush()


async def get_or_create_jarvis_conversation(session: AsyncSession, user_id: uuid.UUID, *, new: bool = False) -> Conversation:
    if not new:
        conv = await session.scalar(
            select(Conversation).where(Conversation.user_id == user_id, Conversation.kind == "jarvis")
            .order_by(Conversation.updated_at.desc()).limit(1)
        )
        if conv is not None:
            return conv
    nexus = await nexus_agent(session, user_id)
    conv = Conversation(user_id=user_id, agent_id=nexus.id, title="NEXUS", kind="jarvis")
    session.add(conv)
    await session.flush()
    return conv


async def publish_state(user_id: uuid.UUID, state: str, *, conversation_id: uuid.UUID | None = None, message_id: uuid.UUID | None = None,
                        stage: str | None = None, detail: str | None = None) -> None:
    await events.publish(user_id, "jarvis.state", {
        "state": state, "stage": stage, "detail": detail,
        "conversation_id": str(conversation_id) if conversation_id else None,
        "message_id": str(message_id) if message_id else None,
        "entity": {"type": "conversation", "id": str(conversation_id)} if conversation_id else None,
    })


def _last_pending(msg: AgentMessage | None) -> dict[str, Any] | None:
    if msg is None or msg.sender_type == "user":
        return None
    pending = (msg.meta or {}).get("pending")
    if not pending or not msg.created_at or datetime.now(UTC) - msg.created_at > PENDING_TTL:
        return None
    return pending


async def _last_messages(session: AsyncSession, conv: Conversation, limit: int = 4) -> list[AgentMessage]:
    return list((await session.scalars(
        select(AgentMessage).where(AgentMessage.channel == "chat", AgentMessage.channel_id == conv.id)
        .order_by(AgentMessage.created_at.desc()).limit(limit)
    )).all())


async def models_available(session: AsyncSession, user_id: uuid.UUID) -> bool:
    from app.providers.router import load_usable_models

    return any("chat" in (m.capabilities or []) for m, _ in await load_usable_models(session, user_id))


# ------------------------------------------------------------------ respuestas de acción (etapa 9)

def _when_label(iso: str | None, tz: ZoneInfo) -> str:
    if not iso:
        return ""
    dt = datetime.fromisoformat(iso).astimezone(tz)
    now = datetime.now(tz)
    days = (dt.date() - now.date()).days
    day = "hoy" if days == 0 else "mañana" if days == 1 else "pasado mañana" if days == 2 else dt.strftime("el %d/%m")
    return f"{day} a las {dt:%H:%M}"


def action_reply(intent: Intent, a: ActionRequest, tz: ZoneInfo) -> str:
    p = intent.params
    key = a.action_key
    waiting = a.status == "awaiting_confirmation"
    if a.status == "blocked":
        return f"No puedo hacerlo ahora: {a.error}"
    if a.status == "failed":
        return f"Lo intenté, pero falló: {a.error}"
    who = p.get("contact_label") or p.get("recipient_query") or "ese contacto"
    if key == "whatsapp.open_chat":
        if not p.get("text"):
            return f"Te preparo el WhatsApp para {who}. Escribí el mensaje en la vista previa y, cuando confirmes, abro WhatsApp. El envío lo hacés vos."
        return (f"Te preparé el WhatsApp para {who}. Revisá el destinatario y el texto; cuando confirmes abro WhatsApp con el "
                "mensaje listo. El envío lo hacés vos desde WhatsApp.")
    if key == "device.dial":
        return f"Te dejo lista la llamada a {who}. Al confirmar abro el marcador; la llamada la iniciás vos."
    if key == "device.open_app":
        return f"Abriendo {p.get('app')}." if not waiting else f"¿Abro {p.get('app')}?"
    if key == "device.open_settings":
        note = intent.extra.get("note")
        return (note + " " if note else "") + "Te abro la configuración."
    if key == "device.navigate":
        return f"Te abro la ruta hacia {p.get('destination')}."
    if key == "device.map_search":
        return f"Busco «{p.get('query')}» en el mapa."
    if key == "device.set_alarm":
        return f"{'¿Pongo la' if waiting else 'Pongo la'} alarma a las {int(p['hour']):02d}:{int(p.get('minute', 0)):02d}{'?' if waiting else '.'}"
    if key == "device.set_timer":
        secs = int(p["seconds"])
        label = f"{secs // 60} minutos" if secs >= 60 and secs % 60 == 0 else f"{secs} segundos" if secs < 60 else f"{secs // 60} min {secs % 60} s"
        return f"Temporizador de {label}{' listo para confirmar' if waiting else ' en marcha'}."
    if key == "device.calendar_event":
        when = "todo el día" if p.get("all_day") else _when_label(p.get("start"), tz)
        return f"Te preparé el evento «{p.get('title')}» {when}. Lo guardás desde tu calendario."
    if key == "device.calendar_view":
        return "Te abro el calendario en esa fecha. Aclaración: yo no leo tus eventos, solo abro la agenda."
    if key == "device.contact_create":
        return f"Te preparo el contacto {p.get('name')} para que lo guardes en tu agenda."
    if key in ("device.share_text", "device.share_file"):
        return "Al confirmar abro el menú de compartir para que elijas la app." if waiting else "Abro el menú de compartir."
    if key == "device.open_url":
        return "Abro el enlace."
    if key == "app.open_screen":
        return f"Abriendo {p.get('label') or 'la sección'}."
    if key == "reminder.create":
        when = _when_label(p.get("at"), tz)
        if a.status == "completed":
            return f"Listo, te lo recuerdo {when}: «{p.get('title')}»."
        return f"Te armé el recordatorio «{p.get('title')}» para {when}. ¿Lo confirmo?"
    if key == "memory.remember":
        return f"¿Lo guardo en tu memoria? «{p.get('content')}»"
    if key == "memory.forget":
        return "Encontré estos recuerdos. Si confirmás, los borro definitivamente."
    if key == "mission.create":
        return (f"Puedo armar una misión: {p.get('objective')}. Se planifica y trabaja en segundo plano con el equipo "
                "(consume presupuesto). ¿La creo?")
    if key == "automation.create":
        return f"Te propongo esta rutina: {a.summary}. ¿La activo?"
    return a.summary


async def record_action_outcome(session: AsyncSession, a: ActionRequest) -> None:
    """Etapa 8-9 para acciones de dispositivo: deja constancia verificable de lo que pasó."""
    if a.conversation_id is None:
        return
    p = a.params or {}
    who = p.get("contact_label") or p.get("recipient_query") or a.result.get("contact_label") or "el contacto"
    texts = {
        "WHATSAPP_OPENED": f"Abrí WhatsApp con el mensaje para {who}. Todavía no está enviado: el envío lo confirmás vos en WhatsApp.",
        "DIALER_OPENED": f"Abrí el marcador con el número de {who}.",
        "APP_NOT_FOUND": f"No encontré una app instalada llamada «{p.get('app', '')}».",
    }
    text = texts.get(a.state_detail or "")
    if text is None:
        if a.status == "failed":
            text = f"La acción «{a.summary[:100]}» falló: {a.error}"
        elif a.status == "cancelled":
            text = "Listo, lo cancelé."
        else:
            return
    nexus = await nexus_agent(session, a.user_id)
    await record_message(session, a.user_id, channel="chat", channel_id=a.conversation_id, content=text, sender_type="agent",
                         sender_agent_id=nexus.id, message_type="action_result",
                         meta={"kind": "action_result", "action_id": str(a.id), "state": a.state_detail})
    await publish_state(a.user_id, "idle", conversation_id=a.conversation_id, stage="verification")


# ------------------------------------------------------------------ memoria (consulta y olvido)

def is_stale(item: MemoryItem) -> bool:
    ref = item.last_verified_at or item.source_date or item.created_at
    return bool(ref and datetime.now(UTC) - ref > timedelta(days=STALE_DAYS))


def disabled_categories(settings: UserSettings | None) -> set[str]:
    return set(((settings.privacy_settings or {}) if settings else {}).get("disabled_memory_categories") or [])


async def memory_lookup(session: AsyncSession, user_id: uuid.UUID, topic: str, settings: UserSettings | None) -> tuple[str, list[dict]]:
    from app.memory.service import search

    blocked = disabled_categories(settings)
    if topic:
        hits = [h.item for h in await search(session, user_id, topic, for_agent=False, scopes=["user", "shared"], limit=8)]
    else:
        hits = list((await session.scalars(
            select(MemoryItem).where(MemoryItem.user_id == user_id, MemoryItem.scope.in_(["user", "shared"]),
                                     MemoryItem.verification_status != "rejected")
            .order_by(MemoryItem.updated_at.desc()).limit(8)
        )).all())
    items = [i for i in hits if i.category not in blocked][:6]
    if not items:
        return ("No tengo recuerdos guardados sobre eso." if topic else "Todavía no tengo recuerdos personales guardados."), []
    now = datetime.now(UTC)
    for i in items:
        i.last_used_at = now
    lines = []
    out = []
    for i in items:
        date = (i.source_date or i.created_at).strftime("%d/%m/%Y") if (i.source_date or i.created_at) else "s/f"
        origin = {"user": "me lo dijiste vos", "agent": "lo propuso un agente", "document": "de un documento", "web": "de la web",
                  "mission": "de una misión"}.get(i.source, i.source)
        stale = " — puede estar desactualizado" if is_stale(i) else ""
        lines.append(f"• {i.content.strip()[:300]} ({origin}, {date}{stale})")
        out.append({"id": str(i.id), "content": i.content[:500], "category": i.category, "source": i.source, "source_ref": i.source_ref,
                    "date": date, "stale": is_stale(i)})
    head = f"Esto es lo que tengo sobre {topic}:" if topic else "Esto es lo que tengo guardado de vos:"
    return head + "\n" + "\n".join(lines), out


# ------------------------------------------------------------------ pipeline

async def process_message(
    session: AsyncSession,
    user: User,
    content: str,
    *,
    input_mode: str = "text",
    conversation_id: uuid.UUID | None = None,
    new_conversation: bool = False,
    timezone: str | None = None,
    attachments: list[dict[str, Any]] | None = None,
    interrupted_message_id: uuid.UUID | None = None,
    spoken_chars: int | None = None,
    source: str = "app",
) -> dict[str, Any]:
    trace = Trace()
    settings = await session.get(UserSettings, user.id)
    assert settings is not None
    tz_name, tz = user_zone(settings, timezone)
    if timezone and tz_name == timezone and (settings.jarvis_settings or {}).get("timezone") != timezone:
        settings.jarvis_settings = {**(settings.jarvis_settings or {}), "timezone": timezone}
    nexus = await nexus_agent(session, user.id)
    await ensure_permissions(session, settings, nexus)

    # 1 INPUT
    if conversation_id:
        conv = await session.get(Conversation, conversation_id)
        if conv is None or conv.user_id != user.id:
            raise NotFound("Conversación no encontrada")
    else:
        conv = await get_or_create_jarvis_conversation(session, user.id, new=new_conversation)
    text = (content or "").strip()
    if len(text) > 8000:
        raise NexusError("El mensaje es demasiado largo (máx. 8000 caracteres)")
    if interrupted_message_id:
        await _mark_interrupted(session, conv, interrupted_message_id, spoken_chars)
    trace.add("input", mode=input_mode, source=source)

    # 2 UNDERSTANDING
    recent = await _last_messages(session, conv)
    pending = _last_pending(recent[0] if recent else None)
    last_text = next((m.content for m in recent if m.sender_type == "agent" and m.message_type == "message"), None)
    ctx = ClassifyContext(now=datetime.now(tz), timezone=tz_name, last_assistant_text=last_text, has_attachments=bool(attachments),
                          pending=pending)
    trace.add("understanding", pending=bool(pending))

    # 4 INTENT
    intent = classify(text, ctx)
    trace.add("intent", category=intent.category, rule=intent.rule, confidence=intent.confidence)

    # control de voz (barge-in): no se registra como turno de conversación
    if intent.control in ("stop", "resume", "repeat", "noop"):
        if intent.control == "stop":
            await cancel_inflight(session, conv)
            await publish_state(user.id, "idle", conversation_id=conv.id, stage="control", detail="stop")
        trace.add("routing", handler="control")
        return {"conversation_id": str(conv.id), "handled": "control", "control": intent.control, "intent": intent.to_dict(),
                "stages": trace.stages, "user_message": None, "reply": None, "action": None}

    user_msg = await record_message(
        session, user.id, channel="chat", channel_id=conv.id, content=text, sender_type="user",
        meta={"input_mode": input_mode, "attachments": attachments or [], "source": source,
              "intent": {"category": intent.category, "rule": intent.rule, "confidence": intent.confidence}},
    )
    conv.updated_at = user_msg.created_at
    if conv.title in ("NEXUS", "Chat con NEXUS", "Conversación"):
        conv.title = text[:60]

    # 5 ROUTING
    handler = intent.handler
    trace.add("routing", handler=handler, specialists=intent.specialists)
    reply_text: str | None = None
    reply_meta: dict[str, Any] = {"reply_to": str(user_msg.id), "category": intent.category}
    action: ActionRequest | None = None
    device_params: dict[str, Any] | None = None

    if intent.control == "cancel_pending":
        reply_text = "Listo, lo dejo."
        trace.add("response", kind="template")
    elif handler == "clarification":
        reply_text = intent.question
        reply_meta["pending"] = intent.extra.get("pending")
        trace.add("response", kind="clarification")
    elif handler == "memory_lookup":
        trace.add("context", memory=True)
        reply_text, items = await memory_lookup(session, user.id, intent.extra["memory_lookup"], settings)
        reply_meta["memories"] = items
        trace.add("execution", kind="memory_search", results=len(items))
        trace.add("response", kind="template")
    elif handler == "memory_forget":
        from app.memory.service import search

        hits = await search(session, user.id, intent.extra["memory_forget"], for_agent=False, scopes=["user", "shared"], limit=5)
        trace.add("context", memory=True)
        if not hits:
            reply_text = f"No encontré recuerdos sobre «{intent.extra['memory_forget']}»."
        else:
            intent.action_key = "memory.forget"
            intent.params = {"memory_ids": [str(h.item.id) for h in hits], "query": intent.extra["memory_forget"]}
            intent.summary = f"Olvidar {len(hits)} recuerdo(s) sobre «{intent.extra['memory_forget'][:80]}»"
            reply_meta["memories"] = [{"id": str(h.item.id), "content": h.item.content[:300]} for h in hits]
            handler = "action"
    if handler == "action":
        from app.actions.service import ActionError, propose

        if intent.extra.get("resolve_project"):
            project = await session.scalar(select(Project).where(Project.user_id == user.id, Project.name.ilike(f"%{intent.extra['resolve_project']}%"))
                                           .order_by(Project.updated_at.desc()).limit(1))
            if project is not None:
                intent.params = {**intent.params, "entity_id": str(project.id), "label": project.name}
            else:
                intent.params = {"screen": "projects", "label": "tus proyectos"}
                intent.assumptions.append(f"No encontré un proyecto llamado «{intent.extra['resolve_project']}»; te muestro la lista.")
        # 6 PERMISSIONS + 7 EXECUTION (+ 8 VERIFICATION en acciones de servidor sin confirmación)
        try:
            device_params = dict(intent.params)
            action = await propose(session, user.id, intent.action_key or "", intent.params, summary=intent.summary or intent.action_key or "",
                                   source="jarvis", conversation_id=conv.id)
        except ActionError as exc:
            reply_text = f"No pude preparar la acción: {exc.message}"
            trace.add("permissions", status="error", error=exc.message)
        else:
            trace.add("permissions", requires_confirmation=action.requires_confirmation, status=action.status)
            trace.add("execution", status=action.status, executor=action.executor)
            if action.executor == "server" and action.status in ("completed", "failed"):
                trace.add("verification", verified=action.status == "completed")
            reply_text = action_reply(intent, action, tz)
            if intent.assumptions:
                reply_text += " Ojo: " + " ".join(intent.assumptions)
            reply_meta.update({"kind": "action_proposal", "action_id": str(action.id)})
            trace.add("response", kind="template")
            if action.action_key == "memory.remember" and action.status == "completed":
                trace.add("memory", saved=True)

    if reply_text is not None:
        reply = await record_message(session, user.id, channel="chat", channel_id=conv.id, content=reply_text, sender_type="agent",
                                     sender_agent_id=nexus.id, meta={**reply_meta, "pipeline": list(trace.stages)})
        user_msg.meta = {**user_msg.meta, "pipeline": list(trace.stages)}
        state = "waiting_confirmation" if action is not None and action.status == "awaiting_confirmation" else (
            "executing" if action is not None and action.status == "ready" else "idle")
        await publish_state(user.id, state, conversation_id=conv.id, message_id=user_msg.id, stage="response")
        from app.actions.service import serialize as serialize_action

        return {"conversation_id": str(conv.id), "handled": "action" if action else "direct", "intent": intent.to_dict(),
                "stages": trace.stages, "user_message": _msg(user_msg), "reply": _msg(reply),
                "action": {**serialize_action(action), "device_params": device_params} if action else None, "control": None}

    # Camino del modelo
    if not await models_available(session, user.id):
        reply = await record_message(
            session, user.id, channel="chat", channel_id=conv.id, sender_type="system", message_type="error",
            content=("Para eso necesito un modelo de IA y todavía no hay ninguno configurado (Más → Ajustes → Modelos). "
                     "Mientras tanto puedo hacer acciones directas: WhatsApp, llamadas, recordatorios, alarmas, abrir apps, "
                     "mapas, agenda, memoria, misiones y rutinas."),
            meta={**reply_meta, "reason": "no_model_available"},
        )
        trace.add("execution", status="blocked", reason="no_model_available")
        user_msg.meta = {**user_msg.meta, "pipeline": list(trace.stages)}
        await publish_state(user.id, "idle", conversation_id=conv.id, stage="execution", detail="no_model_available")
        return {"conversation_id": str(conv.id), "handled": "no_model", "intent": intent.to_dict(), "stages": trace.stages,
                "user_message": _msg(user_msg), "reply": _msg(reply), "action": None, "control": None}

    trace.add("execution", status="queued", kind="model")
    user_msg.meta = {**user_msg.meta, "route": intent.to_dict()["route"], "pipeline": list(trace.stages)}
    await queue.enqueue(session, "jarvis.reply", {"conversation_id": str(conv.id), "message_id": str(user_msg.id)},
                        user_id=user.id, priority=1, idempotency_key=f"jarvis.reply:{user_msg.id}")
    await publish_state(user.id, "thinking", conversation_id=conv.id, message_id=user_msg.id, stage="execution")
    return {"conversation_id": str(conv.id), "handled": "model", "intent": intent.to_dict(), "stages": trace.stages,
            "user_message": _msg(user_msg), "reply": None, "action": None, "control": None}


def _msg(m: AgentMessage) -> dict[str, Any]:
    return {"id": str(m.id), "channel": m.channel, "channel_id": str(m.channel_id), "sender_type": m.sender_type,
            "sender_agent_id": str(m.sender_agent_id) if m.sender_agent_id else None, "message_type": m.message_type,
            "content": m.content, "meta": m.meta, "model_used": m.model_used, "created_at": m.created_at.isoformat() if m.created_at else None}


async def _mark_interrupted(session: AsyncSession, conv: Conversation, message_id: uuid.UUID, spoken_chars: int | None) -> None:
    msg = await session.get(AgentMessage, message_id)
    if msg is None or msg.channel_id != conv.id:
        return
    msg.meta = {**(msg.meta or {}), "interrupted": True, "spoken_chars": spoken_chars}


async def cancel_inflight(session: AsyncSession, conv: Conversation) -> int:
    """Barge-in: pide detener las respuestas que se están generando en esta conversación."""
    rows = (await session.scalars(
        select(AgentMessage).where(AgentMessage.channel == "chat", AgentMessage.channel_id == conv.id, AgentMessage.sender_type == "user",
                                   AgentMessage.created_at > datetime.now(UTC) - timedelta(minutes=10))
        .order_by(AgentMessage.created_at.desc()).limit(5)
    )).all()
    count = 0
    for m in rows:
        answered = await session.scalar(select(AgentMessage.id).where(
            AgentMessage.channel == "chat", AgentMessage.channel_id == conv.id, AgentMessage.meta["reply_to"].astext == str(m.id)))
        if answered is None and not (m.meta or {}).get("cancel_requested"):
            m.meta = {**(m.meta or {}), "cancel_requested": True}
            count += 1
    return count


# ------------------------------------------------------------------ respuesta con modelo (worker)

async def _context_block(session: AsyncSession, user_id: uuid.UUID, tz: ZoneInfo) -> str:
    approvals = await session.scalar(select(func.count()).select_from(ApprovalRequest).where(ApprovalRequest.user_id == user_id, ApprovalRequest.status == "pending"))
    actions = await session.scalar(select(func.count()).select_from(ActionRequest).where(ActionRequest.user_id == user_id, ActionRequest.status == "awaiting_confirmation"))
    running = await session.scalar(select(func.count()).select_from(Mission).where(Mission.user_id == user_id, Mission.status.in_(["planning", "running", "reviewing", "consolidating"])))
    now = datetime.now(tz)
    return (f"# Contexto real del usuario (no lo inventes ni lo exageres)\n- Hora local: {now:%A %d/%m/%Y %H:%M} ({tz.key}).\n"
            f"- Aprobaciones pendientes: {approvals or 0}. Acciones esperando confirmación: {actions or 0}. Misiones en curso: {running or 0}.")


async def generate_jarvis_reply(session: AsyncSession, conversation_id: uuid.UUID, message_id: uuid.UUID) -> None:
    from app.chat.service import _history

    conv = await session.get(Conversation, conversation_id)
    user_msg = await session.get(AgentMessage, message_id)
    if conv is None or user_msg is None:
        return
    existing = await session.scalar(select(AgentMessage.id).where(
        AgentMessage.channel == "chat", AgentMessage.channel_id == conv.id, AgentMessage.meta["reply_to"].astext == str(user_msg.id)))
    if existing:
        return  # ya respondido (reintento tras caída del worker): no se duplica
    if (user_msg.meta or {}).get("cancel_requested"):
        return
    nexus = await nexus_agent(session, conv.user_id)
    settings = await session.get(UserSettings, conv.user_id)
    assert settings is not None
    _, tz = user_zone(settings)
    route = (user_msg.meta or {}).get("route") or {}
    voice = (user_msg.meta or {}).get("input_mode") == "voice"
    stream_id = uuid.uuid4().hex
    user_id, conv_id, agent_id, msg_id = conv.user_id, conv.id, nexus.id, user_msg.id
    streamed: list[str] = []

    async def on_text(delta: str) -> None:
        streamed.append(delta)
        await events.publish(user_id, "chat.delta", {"conversation_id": str(conv_id), "stream_id": stream_id, "agent_id": str(agent_id),
                                                     "delta": delta, "reply_to": str(msg_id)})

    async def should_stop() -> str | None:
        meta = await session.scalar(select(AgentMessage.meta).where(AgentMessage.id == msg_id).execution_options(populate_existing=True))
        if meta and meta.get("cancel_requested"):
            return "interrumpido por el usuario"
        stop = await session.scalar(select(UserSettings.emergency_stop).where(UserSettings.user_id == user_id))
        return "STOP ALL activo" if stop else None

    await set_agent_status(session, nexus, "thinking", "Respondiendo")
    await queue.commit(session)
    history = await _history(session, conv, user_msg)
    dialect = (settings.voice_settings or {}).get("language") or "es-AR"
    extra = [persona_prompt("es-AR" if str(dialect).startswith("es-AR") else "es"), await _context_block(session, user_id, tz)]
    if conv.summary:
        extra.append(f"# Resumen de la conversación anterior\n{conv.summary}")
    if route.get("response_style"):
        extra.append(f"# Formato de esta respuesta\nRespuesta {route['response_style']}.")
    if route.get("specialists"):
        names = ", ".join(s.upper() for s in route["specialists"])
        extra.append(f"# Ruteo\nPara este pedido puede aportar: {names}. Consultá con agents.ask solo si mejora la respuesta.")
    if voice:
        extra.append(VOICE_RULES)
    attachments = (user_msg.meta or {}).get("attachments") or []
    prompt = user_msg.content
    if attachments:
        prompt += "\n\nArchivos adjuntos en el proyecto: " + ", ".join(a.get("path", "") for a in attachments)
    max_tokens = int(route.get("max_tokens") or 1500)
    if voice:
        max_tokens = max(400, max_tokens // 2)
    try:
        result = await run_agent(
            session, nexus, purpose="chat", task_type=route.get("task_type") or "chat", prompt=prompt, history=history,
            autonomy_mode=settings.autonomy_mode, project_id=conv.project_id, conversation_id=conv.id,
            tool_filter=JARVIS_TOOLS, max_steps=6, max_tokens=max_tokens, on_text=on_text, should_stop=should_stop,
            extra_system="\n\n".join(extra),
        )
    except AgentInterrupted as exc:
        await session.rollback()
        partial = "".join(streamed).strip()
        await record_message(session, user_id, channel="chat", channel_id=conv_id, sender_type="agent", sender_agent_id=agent_id,
                             content=partial or "(respuesta detenida)", meta={"reply_to": str(msg_id), "stream_id": stream_id,
                                                                             "interrupted": True, "reason": exc.reason})
        agent = await nexus_agent(session, user_id)
        await set_agent_status(session, agent, "idle")
        await publish_state(user_id, "idle", conversation_id=conv_id, message_id=msg_id, stage="response", detail="interrupted")
        return
    except Exception as exc:
        await session.rollback()
        await record_message(session, user_id, channel="chat", channel_id=conv_id, sender_type="system", message_type="error",
                             content=f"No pude responder: {getattr(exc, 'message', str(exc))}", meta={"reply_to": str(msg_id), "stream_id": stream_id})
        agent = await nexus_agent(session, user_id)
        await set_agent_status(session, agent, "error", "Error al responder")
        await publish_state(user_id, "error", conversation_id=conv_id, message_id=msg_id, stage="execution",
                            detail=getattr(exc, "message", str(exc))[:200])
        await session.commit()
        return
    tool_steps = [s for s in result.steps if s.get("type") == "tool"]
    consulted = sorted({str((s.get("args") or {}).get("agent", "")).lower() for s in tool_steps if s.get("tool") == "agents.ask" and not s.get("is_error")})
    proposed = [s for s in tool_steps if s.get("tool") == "actions.propose" and not s.get("is_error")]
    llm_models = [s.get("model") for s in result.steps if s.get("type") == "llm"]
    reply = await record_message(
        session, user_id, channel="chat", channel_id=conv_id, content=result.text or "(sin respuesta)", sender_type="agent",
        sender_agent_id=agent_id, model_used=result.model_label,
        meta={"reply_to": str(msg_id), "stream_id": stream_id, "tools_used": [s.get("tool") for s in tool_steps],
              "consulted_agents": [c for c in consulted if c], "tokens": result.tokens, "cost_usd": str(result.cost_usd),
              "degraded_quality": result.degraded_quality, "models": llm_models, "category": (user_msg.meta or {}).get("intent", {}).get("category"),
              "tool_errors": sum(1 for s in tool_steps if s.get("is_error")), "proposed_actions": len(proposed),
              "citations": result.citations[:10]},
    )
    from app.providers.quality import record_deterministic

    await record_deterministic(session, user_id, result, task_type=route.get("task_type") or "chat", message_id=reply.id)
    await set_agent_status(session, nexus, "idle")
    waiting = await session.scalar(select(func.count()).select_from(ActionRequest).where(
        ActionRequest.user_id == user_id, ActionRequest.status == "awaiting_confirmation", ActionRequest.conversation_id == conv_id))
    await publish_state(user_id, "waiting_confirmation" if waiting else "idle", conversation_id=conv_id, message_id=msg_id, stage="response")
    total = await session.scalar(select(func.count()).select_from(AgentMessage).where(AgentMessage.channel == "chat", AgentMessage.channel_id == conv_id))
    if (total or 0) > SUMMARY_THRESHOLD:
        await queue.enqueue(session, "jarvis.summarize", {"conversation_id": str(conv_id)}, user_id=user_id, priority=8,
                            idempotency_key=f"jarvis.summarize:{conv_id}")


async def summarize_conversation(session: AsyncSession, conversation_id: uuid.UUID) -> None:
    """Etapa 10 (memoria conversacional): resume lo que queda fuera de la ventana de historial."""
    from app.chat.service import HISTORY_LIMIT
    from app.providers import gateway

    conv = await session.get(Conversation, conversation_id)
    if conv is None:
        return
    rows = list((await session.scalars(
        select(AgentMessage).where(AgentMessage.channel == "chat", AgentMessage.channel_id == conv.id, AgentMessage.message_type == "message")
        .order_by(AgentMessage.created_at.desc()).offset(HISTORY_LIMIT).limit(80)
    )).all())
    rows.reverse()
    if not rows or (conv.summary_until and rows[-1].created_at <= conv.summary_until):
        return
    transcript = "\n".join(f"{'Usuario' if m.sender_type == 'user' else 'NEXUS'}: {m.content[:600]}" for m in rows)
    prev = f"Resumen previo:\n{conv.summary}\n\n" if conv.summary else ""
    ctx = gateway.CallContext(user_id=conv.user_id, purpose="summary", task_type="summary")
    res = await gateway.complete(session, ctx, system="Resumí conversaciones de forma fiel y breve. No agregues nada que no esté.",
                                 messages=[Message(role="user", content=f"{prev}Conversación:\n{transcript}\n\nResumen (máx. 12 líneas):")],
                                 max_tokens=700)
    conv.summary = res.response.text.strip()[:4000]
    conv.summary_until = rows[-1].created_at


# ------------------------------------------------------------------ estado y contexto (Home)

async def jarvis_state(session: AsyncSession, user_id: uuid.UUID) -> dict[str, Any]:
    from app.core.redis import get_redis

    settings = await session.get(UserSettings, user_id)
    agents = (await session.scalars(select(Agent).where(Agent.user_id == user_id))).all()
    nexus = next((a for a in agents if a.slug == "nexus"), None)
    pending_actions = await session.scalar(select(func.count()).select_from(ActionRequest).where(
        ActionRequest.user_id == user_id, ActionRequest.status == "awaiting_confirmation", ActionRequest.expires_at > datetime.now(UTC)))
    pending_approvals = await session.scalar(select(func.count()).select_from(ApprovalRequest).where(ApprovalRequest.user_id == user_id, ApprovalRequest.status == "pending"))
    running_tasks = await session.scalar(select(func.count()).select_from(MissionTask).where(MissionTask.user_id == user_id, MissionTask.status == "running"))
    # Una acción del teléfono «ready» que venció (la app nunca reportó) no cuenta como ejecución en curso.
    executing_actions = await session.scalar(select(func.count()).select_from(ActionRequest).where(
        ActionRequest.user_id == user_id,
        or_(ActionRequest.status == "executing",
            and_(ActionRequest.status == "ready", or_(ActionRequest.expires_at.is_(None), ActionRequest.expires_at > datetime.now(UTC))))))
    collaborating = [a.slug for a in agents if a.slug != "nexus" and a.status == "collaborating"]
    working = [a.slug for a in agents if a.status in ("working", "thinking")]
    emergency = bool(settings and settings.emergency_stop)
    recent_error = bool(nexus and nexus.status == "error" and nexus.last_activity_at and datetime.now(UTC) - nexus.last_activity_at < timedelta(minutes=5))
    if emergency:
        state = "stopped"
    elif nexus and nexus.status == "thinking":
        state = "thinking"
    elif collaborating:
        state = "collaborating"
    elif (pending_actions or 0) + (pending_approvals or 0) > 0:
        state = "waiting_confirmation"
    elif executing_actions or running_tasks:
        state = "executing"
    elif recent_error:
        state = "error"
    else:
        state = "idle"
    queued = await session.scalar(select(func.count()).select_from(Job).where(Job.user_id == user_id, Job.status.in_(["queued", "running"])))
    workers: int | None = None
    redis = await get_redis()
    if redis is not None:
        try:
            workers = len([k async for k in redis.scan_iter(match="nexus:worker:*", count=100)])
        except Exception:  # noqa: BLE001
            workers = None
    if emergency:
        system = "STOPPED"
    elif workers == 0:
        system = "ERROR"
    elif (pending_actions or 0) + (pending_approvals or 0) > 0:
        system = "WAITING_USER"
    elif running_tasks or executing_actions:
        system = "EXECUTING"
    elif queued:
        system = "PROCESSING"
    else:
        system = "IDLE"
    return {
        "state": state, "system_state": system, "emergency_stop": emergency,
        "workers_online": workers, "pending_actions": pending_actions or 0, "pending_approvals": pending_approvals or 0,
        "running_tasks": running_tasks or 0, "queued_jobs": queued or 0, "collaborating_agents": collaborating, "active_agents": working,
        "nexus_status": nexus.status if nexus else None, "nexus_detail": nexus.status_detail if nexus else None,
        "measured_at": datetime.now(UTC).isoformat(),
    }


async def jarvis_context(session: AsyncSession, user: User, timezone: str | None) -> dict[str, Any]:
    """Zona C del Home: mensaje contextual derivado exclusivamente de datos reales."""
    settings = await session.get(UserSettings, user.id)
    tz_name, tz = user_zone(settings, timezone)
    now_local = datetime.now(tz)
    now = datetime.now(UTC)
    last_seen = settings.last_seen_at if settings else None
    approvals = await session.scalar(select(func.count()).select_from(ApprovalRequest).where(ApprovalRequest.user_id == user.id, ApprovalRequest.status == "pending")) or 0
    actions = await session.scalar(select(func.count()).select_from(ActionRequest).where(
        ActionRequest.user_id == user.id, ActionRequest.status == "awaiting_confirmation", ActionRequest.expires_at > now)) or 0
    running = await session.scalar(select(func.count()).select_from(Mission).where(Mission.user_id == user.id, Mission.status.in_(["planning", "running", "reviewing", "consolidating"]))) or 0
    blocked = await session.scalar(select(func.count()).select_from(Mission).where(Mission.user_id == user.id, Mission.status == "blocked")) or 0
    since = last_seen or (now - timedelta(hours=24))
    finished = list((await session.scalars(select(Mission).where(Mission.user_id == user.id, Mission.status == "completed", Mission.completed_at > since)
                                           .order_by(Mission.completed_at.desc()).limit(3))).all())
    end_of_day = now_local.replace(hour=23, minute=59, second=59).astimezone(UTC)
    reminders = list((await session.scalars(select(ScheduledJob).where(ScheduledJob.user_id == user.id, ScheduledJob.kind == "reminder",
                                                                       ScheduledJob.is_enabled.is_(True), ScheduledJob.next_run_at > now,
                                                                       ScheduledJob.next_run_at <= end_of_day)
                                             .order_by(ScheduledJob.next_run_at).limit(3))).all())
    unread = await session.scalar(select(func.count()).select_from(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None),
                                                                                         Notification.deliver_at.is_(None))) or 0
    automations = await session.scalar(select(func.count()).select_from(Automation).where(Automation.user_id == user.id, Automation.status == "active")) or 0
    hour = now_local.hour
    greeting = "Buen día" if 5 <= hour < 13 else "Buenas tardes" if 13 <= hour < 20 else "Buenas noches"
    first = (user.display_name or "").split(" ")[0]
    lines: list[str] = []
    if settings and settings.emergency_stop:
        lines.append("STOP ALL está activo: los agentes y las rutinas están detenidos.")
    if actions:
        lines.append(f"Tenés {actions} {'acción' if actions == 1 else 'acciones'} esperando tu confirmación.")
    if approvals:
        lines.append(f"Hay {approvals} {'aprobación pendiente' if approvals == 1 else 'aprobaciones pendientes'}.")
    if finished:
        lines.append(f"Terminé «{finished[0].title}»." if len(finished) == 1 else f"Terminé {len(finished)} misiones desde tu última visita.")
    if blocked:
        lines.append(f"{blocked} {'misión quedó bloqueada' if blocked == 1 else 'misiones quedaron bloqueadas'} y {'necesita' if blocked == 1 else 'necesitan'} revisión.")
    if running:
        lines.append(f"Estoy trabajando en {running} {'misión' if running == 1 else 'misiones'}.")
    if reminders:
        r = reminders[0]
        lines.append(f"Hoy a las {r.next_run_at.astimezone(tz):%H:%M}: {r.payload.get('title', r.name)}.")
    headline = f"{greeting}{', ' + first if first else ''}."
    message = headline + (" " + lines[0] if lines else " ¿Qué hacemos hoy?")
    if settings is not None:
        settings.last_seen_at = now
    return {
        "headline": headline, "message": message, "lines": lines, "timezone": tz_name, "local_time": now_local.isoformat(),
        "counts": {"pending_actions": actions, "pending_approvals": approvals, "missions_running": running, "missions_blocked": blocked,
                   "missions_finished_since_last_visit": len(finished), "reminders_today": len(reminders), "unread_notifications": unread,
                   "active_automations": automations},
        "finished_missions": [{"id": str(m.id), "title": m.title} for m in finished],
        "reminders_today": [{"id": str(r.id), "title": r.payload.get("title", r.name), "at": r.next_run_at.isoformat()} for r in reminders],
        "last_seen_at": last_seen.isoformat() if last_seen else None,
    }
