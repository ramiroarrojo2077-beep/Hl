"""Ciclo de vida de las acciones: propuesta → confirmación → ejecución → verificación.

Estados (status):
  awaiting_confirmation → ready (dispositivo) | executing → completed | failed
  awaiting_confirmation | ready → cancelled | expired
  blocked: rechazada por política (p. ej. STOP ALL activo)

state_detail guarda el estado fino de cada acción (WHATSAPP_OPENED, APP_OPENED...). Para
WhatsApp personal el estado final posible es WHATSAPP_OPENED: el envío ocurre dentro de
WhatsApp y NEXUS no puede verificarlo, por lo que nunca lo informa como enviado.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.actions.registry import ACTIONS, ActionDef, Risk, get_action, validate_params
from app.core import events
from app.core.errors import NexusError, NotFound
from app.models import ActionRequest, Agent, MemoryItem, ScheduledJob, UserSettings
from app.monitoring.audit import record_audit

CONFIRMATION_TTL = timedelta(minutes=30)
READY_TTL = timedelta(minutes=10)
ACTIVE_STATUSES = ("awaiting_confirmation", "ready", "executing")
# Claves de resultado que el dispositivo puede informar (nunca números completos ni el texto).
DEVICE_RESULT_KEYS = {"recipient_masked", "contact_label", "app_label", "package", "error", "text_chars", "edited", "tone", "panel", "destination"}

SUCCESS_STATES = {
    "WHATSAPP_OPENED", "DIALER_OPENED", "SHARE_SHEET_OPENED", "APP_OPENED", "SETTINGS_OPENED", "MAPS_OPENED", "ALARM_SET",
    "TIMER_SET", "CALENDAR_OPENED", "CONTACTS_OPENED", "BROWSER_OPENED", "SCREEN_OPENED",
}
DEVICE_PROGRESS_STATES = {"DRAFT_CREATED", "CONTACT_RESOLVED", "AWAITING_CONFIRMATION", "READY_TO_OPEN"}


class ActionError(NexusError):
    code = "action_error"


def serialize(a: ActionRequest) -> dict[str, Any]:
    d = get_action(a.action_key)
    return {
        "id": str(a.id), "action_key": a.action_key, "name": d.name if d else a.action_key, "category": a.category,
        "executor": a.executor, "risk": d.risk.value if d else None, "operation": d.operation if d else None,
        "params": public_params(a), "summary": a.summary, "status": a.status, "state_detail": a.state_detail,
        "requires_confirmation": a.requires_confirmation, "result": a.result, "error": a.error, "source": a.source,
        "conversation_id": str(a.conversation_id) if a.conversation_id else None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "confirmed_at": a.confirmed_at.isoformat() if a.confirmed_at else None,
        "completed_at": a.completed_at.isoformat() if a.completed_at else None,
        "expires_at": a.expires_at.isoformat() if a.expires_at else None,
    }


async def _publish(session: AsyncSession, a: ActionRequest) -> None:
    await session.flush()
    await events.publish(a.user_id, "action.updated", {**serialize(a), "entity": {"type": "action", "id": str(a.id)}})


async def _settings(session: AsyncSession, user_id: uuid.UUID) -> UserSettings:
    s = await session.get(UserSettings, user_id)
    assert s is not None
    return s


INTERNAL_PARAM_KEYS = {"phone_enc", "recipient_masked", "phone_status"}


def _sanitize_params(action: ActionDef, params: dict[str, Any]) -> dict[str, Any]:
    """Los números de teléfono nunca se guardan en claro: cifrados (Fernet) y enmascarados."""
    from app.core.crypto import encrypt_str
    from app.integrations.whatsapp.phone import normalize

    clean = {k: v for k, v in params.items() if v not in (None, "") and k in action.params}
    if "phone" in clean:
        phone = str(clean.pop("phone"))
        res = normalize(phone)
        clean["phone_enc"] = encrypt_str(phone)
        clean["recipient_masked"] = res.masked or "número sin validar"
        clean["phone_status"] = res.status
        digits = re.sub(r"\D", "", phone)
        if "contact_label" in clean and digits and digits[-6:] in re.sub(r"\D", "", str(clean["contact_label"])):
            clean["contact_label"] = clean["recipient_masked"]
    return clean


def execution_params(a: ActionRequest) -> dict[str, Any]:
    """Parámetros completos para ejecutar (solo para el dueño): descifra el número si existe."""
    from app.core.crypto import decrypt_str

    params = {k: v for k, v in a.params.items() if k not in INTERNAL_PARAM_KEYS}
    if a.params.get("phone_enc"):
        params["phone"] = decrypt_str(a.params["phone_enc"])
    return params


def public_params(a: ActionRequest) -> dict[str, Any]:
    return {k: v for k, v in a.params.items() if k != "phone_enc"}


async def propose(
    session: AsyncSession,
    user_id: uuid.UUID,
    key: str,
    params: dict[str, Any],
    *,
    summary: str,
    source: str = "jarvis",
    conversation_id: uuid.UUID | None = None,
    auto_execute: bool = True,
) -> ActionRequest:
    action = get_action(key)
    if action is None:
        raise ActionError(f"Acción desconocida: {key}")
    error = validate_params(action, params)
    if error:
        raise ActionError(error)
    settings = await _settings(session, user_id)
    jarvis = settings.jarvis_settings or {}
    confirm_local = bool(jarvis.get("confirm_local_actions", False)) or source == "automation"
    needs = action.needs_confirmation(confirm_local) or bool(action.extra.get("force_confirm"))
    now = datetime.now(UTC)
    # La versión guardada no conserva números personales; la app recibe los parámetros originales
    # en la respuesta de esta llamada para poder resolver y abrir el chat.
    stored = _sanitize_params(action, params)
    a = ActionRequest(
        user_id=user_id, conversation_id=conversation_id, action_key=key, category=action.category, executor=action.executor,
        params=stored, summary=summary[:2000], requires_confirmation=needs, source=source, status="awaiting_confirmation",
        state_detail="AWAITING_CONFIRMATION" if needs else None, expires_at=now + CONFIRMATION_TTL,
    )
    session.add(a)
    await session.flush()
    if settings.emergency_stop and source != "user" and action.risk != Risk.READ_ONLY:
        a.status = "blocked"
        a.error = "STOP ALL está activo: no se ejecutan acciones propuestas automáticamente."
        a.expires_at = None
    elif not needs and auto_execute:
        await _start(session, a, action, params)
    await record_audit(session, user_id, "action.proposed", f"Acción propuesta: {action.name}", actor_type="agent" if source != "user" else "user",
                       target_type="action", target_id=a.id, outcome="info",
                       details={"key": key, "risk": action.risk.value, "requires_confirmation": needs, "status": a.status})
    await _publish(session, a)
    return a


async def get_owned(session: AsyncSession, user_id: uuid.UUID, action_id: uuid.UUID, *, lock: bool = False) -> ActionRequest:
    a = await session.get(ActionRequest, action_id, with_for_update=lock)
    if a is None or a.user_id != user_id:
        raise NotFound("Acción no encontrada")
    return a


async def _start(session: AsyncSession, a: ActionRequest, action: ActionDef, params: dict[str, Any]) -> None:
    now = datetime.now(UTC)
    a.confirmed_at = a.confirmed_at or now
    if action.executor == "device":
        a.status = "ready"
        a.state_detail = "READY_TO_OPEN" if action.key == "whatsapp.open_chat" else None
        a.expires_at = now + READY_TTL
        return
    a.status = "executing"
    a.expires_at = None
    await session.flush()
    try:
        result = await execute_server_action(session, a, action, params)
    except NexusError as exc:
        a.status = "failed"
        a.error = exc.message
        a.state_detail = "FAILED"
    except Exception as exc:  # noqa: BLE001 - se informa al usuario, no se oculta
        a.status = "failed"
        a.error = f"{type(exc).__name__}: {exc}"[:500]
        a.state_detail = "FAILED"
    else:
        a.result = result
        a.status = "completed" if result.get("verified", False) else "failed"
        a.state_detail = result.get("state", "COMPLETED") if a.status == "completed" else "UNVERIFIED"
        if a.status == "failed":
            a.error = "No se pudo verificar el resultado de la acción."
    a.completed_at = datetime.now(UTC)


async def confirm(session: AsyncSession, user_id: uuid.UUID, action_id: uuid.UUID, params: dict[str, Any] | None = None) -> ActionRequest:
    a = await get_owned(session, user_id, action_id, lock=True)
    action = get_action(a.action_key)
    assert action is not None
    if a.status != "awaiting_confirmation":
        raise ActionError(f"La acción no espera confirmación (estado: {a.status})")
    if a.expires_at and a.expires_at < datetime.now(UTC):
        a.status = "expired"
        await _publish(session, a)
        raise ActionError("La acción venció: pedila de nuevo")
    settings = await _settings(session, user_id)
    if settings.emergency_stop and action.risk != Risk.READ_ONLY:
        raise ActionError("STOP ALL está activo: desactivalo para ejecutar acciones")
    merged = {**execution_params(a), **{k: v for k, v in (params or {}).items() if k in action.params}}
    error = validate_params(action, merged)
    if error:
        raise ActionError(error)
    a.params = _sanitize_params(action, merged)
    if params:
        a.result = {**a.result, "edited_before_confirm": True}
    await record_audit(session, user_id, "action.confirmed", f"Acción confirmada: {action.name}", actor_type="user",
                       target_type="action", target_id=a.id, details={"key": a.action_key})
    await _start(session, a, action, merged)
    await _publish(session, a)
    return a


async def cancel(session: AsyncSession, user_id: uuid.UUID, action_id: uuid.UUID, reason: str | None = None) -> ActionRequest:
    a = await get_owned(session, user_id, action_id, lock=True)
    if a.status not in ("awaiting_confirmation", "ready"):
        raise ActionError(f"La acción ya no se puede cancelar (estado: {a.status})")
    a.status = "cancelled"
    a.state_detail = "CANCELLED"
    a.completed_at = datetime.now(UTC)
    a.result = {**a.result, "cancel_reason": (reason or "Cancelada por el usuario")[:300]}
    await record_audit(session, user_id, "action.cancelled", f"Acción cancelada: {a.summary[:120]}", actor_type="user",
                       target_type="action", target_id=a.id)
    await _publish(session, a)
    return a


async def report(session: AsyncSession, user_id: uuid.UUID, action_id: uuid.UUID, state: str, result: dict[str, Any] | None) -> ActionRequest:
    """El dispositivo informa lo que realmente ocurrió al ejecutar una acción de dispositivo."""
    a = await get_owned(session, user_id, action_id, lock=True)
    action = get_action(a.action_key)
    assert action is not None
    if a.executor != "device":
        raise ActionError("Solo las acciones de dispositivo se informan desde la app")
    if state not in action.result_states and state not in ("ERROR", "CANCELLED"):
        raise ActionError(f"Estado no válido para {a.action_key}: {state}")
    if a.status in ("completed", "failed", "cancelled", "expired", "blocked"):
        if a.state_detail == state:
            return a  # reintento idempotente del mismo informe
        raise ActionError(f"La acción ya terminó (estado: {a.status})")
    clean = {k: v for k, v in (result or {}).items() if k in DEVICE_RESULT_KEYS}
    if state in DEVICE_PROGRESS_STATES:
        if a.status != "awaiting_confirmation":
            raise ActionError("Ese estado solo es válido antes de confirmar")
        a.state_detail = state
        a.result = {**a.result, **clean}
        await _publish(session, a)
        return a
    if a.status != "ready":
        raise ActionError("Primero hay que confirmar la acción")
    a.state_detail = state
    a.result = {**a.result, **clean}
    a.completed_at = datetime.now(UTC)
    if state == "CANCELLED":
        a.status = "cancelled"
    elif state in SUCCESS_STATES:
        a.status = "completed"
    else:
        a.status = "failed"
        a.error = str(clean.get("error") or state)[:500]
    await record_audit(session, user_id, "action.reported", f"{action.name}: {state}", actor_type="user", target_type="action",
                       target_id=a.id, outcome="success" if a.status == "completed" else "error", details={"state": state})
    await _publish(session, a)
    if a.conversation_id is not None:
        from app.jarvis.service import record_action_outcome

        await record_action_outcome(session, a)
    return a


async def expire_stale(session: AsyncSession) -> int:
    now = datetime.now(UTC)
    rows = (await session.scalars(
        select(ActionRequest).where(ActionRequest.status.in_(["awaiting_confirmation", "ready"]), ActionRequest.expires_at < now)
        .with_for_update(skip_locked=True).limit(200)
    )).all()
    for a in rows:
        a.status = "expired"
        a.state_detail = "EXPIRED"
        await _publish(session, a)
    return len(rows)


async def cancel_pending_for_stop(session: AsyncSession, user_id: uuid.UUID) -> int:
    """STOP ALL: deshabilita las acciones pendientes (externas incluidas)."""
    now = datetime.now(UTC)
    result = await session.execute(
        update(ActionRequest)
        .where(ActionRequest.user_id == user_id, ActionRequest.status.in_(["awaiting_confirmation", "ready"]))
        .values(status="cancelled", state_detail="CANCELLED", completed_at=now, error="Cancelada por STOP ALL")
        .returning(ActionRequest.id)
    )
    ids = [r[0] for r in result.all()]
    for aid in ids:
        await events.publish(user_id, "action.updated", {"id": str(aid), "status": "cancelled", "state_detail": "CANCELLED",
                                                         "entity": {"type": "action", "id": str(aid)}})
    return len(ids)


# ------------------------------------------------------------------ ejecución en el servidor

async def execute_server_action(session: AsyncSession, a: ActionRequest, action: ActionDef, params: dict[str, Any]) -> dict[str, Any]:
    """Ejecuta y VERIFICA (relee lo creado). Devuelve verified=True solo con evidencia."""
    uid = a.user_id
    nexus = await session.scalar(select(Agent).where(Agent.user_id == uid, Agent.slug == "nexus"))
    if action.key == "reminder.create":
        at = datetime.fromisoformat(params["at"].replace("Z", "+00:00"))
        if at <= datetime.now(UTC):
            raise ActionError("La fecha del recordatorio ya pasó")
        job = ScheduledJob(user_id=uid, kind="reminder", name=params["title"][:200], run_once_at=at, next_run_at=at,
                           payload={"title": params["title"], "body": params.get("body", ""), "action_id": str(a.id)},
                           created_by_agent_id=nexus.id if nexus else None)
        session.add(job)
        await session.flush()
        check = await session.get(ScheduledJob, job.id)
        ok = check is not None and check.is_enabled and check.next_run_at == at
        return {"verified": ok, "state": "REMINDER_SCHEDULED", "scheduled_job_id": str(job.id), "at": at.isoformat()}
    if action.key == "memory.remember":
        from app.memory.service import create_memory

        item = await create_memory(session, uid, scope="user", content=params["content"], kind="preference" if "prefer" in params["content"].lower() else "fact",
                                   source="user", source_ref="Pedido explícito a NEXUS", confidence=0.95,
                                   verification_status="verified", meta={"action_id": str(a.id)})
        item.category = (params.get("category") or "personal")[:30]
        item.last_verified_at = datetime.now(UTC)
        await session.flush()
        check = await session.get(MemoryItem, item.id)
        return {"verified": check is not None, "state": "MEMORY_SAVED", "memory_id": str(item.id)}
    if action.key == "memory.forget":
        ids = [uuid.UUID(str(i)) for i in params.get("memory_ids", [])]
        rows = (await session.scalars(select(MemoryItem).where(MemoryItem.user_id == uid, MemoryItem.id.in_(ids)))).all()
        for row in rows:
            await session.delete(row)
        await session.flush()
        remaining = await session.scalar(select(MemoryItem.id).where(MemoryItem.user_id == uid, MemoryItem.id.in_(ids)))
        return {"verified": remaining is None, "state": "MEMORY_DELETED", "deleted": len(rows)}
    if action.key == "mission.create":
        from app.missions.service import create_mission

        mission = await create_mission(session, uid, title=params.get("title") or params["objective"][:80], objective=params["objective"],
                                       project_id=uuid.UUID(params["project_id"]) if params.get("project_id") else None,
                                       created_by_agent=nexus)
        return {"verified": mission.id is not None, "state": "MISSION_CREATED", "mission_id": str(mission.id), "title": mission.title}
    if action.key == "automation.create":
        from app.automations.service import create_automation

        auto = await create_automation(session, uid, {**params, "status": "active"}, created_by="nexus")
        return {"verified": auto.status == "active", "state": "AUTOMATION_ACTIVE", "automation_id": str(auto.id),
                "next_run_at": auto.next_run_at.isoformat() if auto.next_run_at else None}
    if action.key == "whatsapp.business_send":
        from app.integrations.whatsapp.business import send_from_action

        return await send_from_action(session, a, params)
    raise ActionError(f"La acción {action.key} no se ejecuta en el servidor")


def catalog() -> list[dict[str, Any]]:
    return [a.describe() for a in ACTIONS.values()]
