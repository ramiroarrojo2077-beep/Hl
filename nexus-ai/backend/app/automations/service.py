"""Automatizaciones y rutinas.

Disparadores:
  schedule  → cron (con zona horaria)                      p. ej. todos los días 08:00
  date      → una única fecha (run_at)
  event     → evento real del sistema: mission.completed, mission.failed, mission.blocked,
              mission.status_changed, approval.requested, action.completed,
              reminder.fired, whatsapp.business.inbound, user.manual (acción del usuario)

Acciones: notify, reminder, mission, jarvis_prompt (NEXUS responde y notifica), action
(propone una acción del registry que SIEMPRE requiere confirmación humana).

Límites (sin bucles infinitos ni consumo indefinido):
- max_runs_per_day (ventana móvil de 24 h), max_total_runs, cooldown_seconds.
- Tope global de ejecuciones por usuario y hora.
- Los eventos originados por una automatización (o por una misión que creó una
  automatización) NUNCA disparan otras automatizaciones.
- STOP ALL pausa todas las automatizaciones activas.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import events
from app.core.errors import NexusError, NotFound
from app.jobs import queue
from app.models import Agent, Automation, AutomationRun, UserSettings
from app.monitoring.audit import record_audit

logger = logging.getLogger(__name__)

EVENT_TYPES = {
    "mission.completed": "Una misión terminó",
    "mission.failed": "Una misión falló",
    "mission.blocked": "Una misión quedó bloqueada",
    "mission.status_changed": "Una misión cambió de estado",
    "approval.requested": "Hay una aprobación pendiente",
    "action.completed": "Se completó una acción",
    "reminder.fired": "Se disparó un recordatorio",
    "whatsapp.business.inbound": "Llegó un mensaje a WhatsApp Business",
    "user.manual": "El usuario la ejecuta manualmente",
}
ACTION_TYPES = {"notify", "reminder", "mission", "jarvis_prompt", "action"}
MAX_ACTIONS = 5
USER_HOURLY_CAP = 30


class AutomationError(NexusError):
    code = "automation_error"


def serialize(a: Automation) -> dict[str, Any]:
    return {
        "id": str(a.id), "name": a.name, "description": a.description, "trigger_type": a.trigger_type, "cron": a.cron,
        "run_at": a.run_at.isoformat() if a.run_at else None, "timezone": a.timezone, "event_type": a.event_type,
        "conditions": a.conditions, "actions": a.actions, "max_runs_per_day": a.max_runs_per_day,
        "max_total_runs": a.max_total_runs, "cooldown_seconds": a.cooldown_seconds, "status": a.status,
        "paused_by_stop": a.paused_by_stop, "next_run_at": a.next_run_at.isoformat() if a.next_run_at else None,
        "last_run_at": a.last_run_at.isoformat() if a.last_run_at else None, "last_status": a.last_status,
        "run_count": a.run_count, "created_by": a.created_by,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


def _tz(name: str | None) -> str:
    name = name or "UTC"
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise AutomationError(f"Zona horaria inválida: {name}") from exc
    return name


def _parse_dt(value: Any) -> datetime:
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError as exc:
        raise AutomationError("Fecha inválida: usá ISO 8601") from exc
    if dt.tzinfo is None:
        raise AutomationError("La fecha debe incluir zona horaria")
    return dt.astimezone(UTC)


def validate_actions(actions: Any) -> list[dict[str, Any]]:
    from app.actions.registry import get_action, validate_params

    if not isinstance(actions, list) or not actions:
        raise AutomationError("La automatización necesita al menos una acción")
    if len(actions) > MAX_ACTIONS:
        raise AutomationError(f"Máximo {MAX_ACTIONS} acciones por automatización")
    clean = []
    for act in actions:
        if not isinstance(act, dict) or act.get("type") not in ACTION_TYPES:
            raise AutomationError(f"Tipo de acción inválido; usá: {', '.join(sorted(ACTION_TYPES))}")
        t = act["type"]
        if t == "notify" and not str(act.get("title", "")).strip():
            raise AutomationError("La notificación necesita un título")
        if t == "reminder" and not str(act.get("title", "")).strip():
            raise AutomationError("El recordatorio necesita un título")
        if t == "mission" and len(str(act.get("objective", "")).strip()) < 5:
            raise AutomationError("La misión necesita un objetivo")
        if t == "jarvis_prompt" and len(str(act.get("prompt", "")).strip()) < 3:
            raise AutomationError("Falta la instrucción para NEXUS")
        if t == "action":
            definition = get_action(str(act.get("action_key", "")))
            if definition is None:
                raise AutomationError("Acción del registry desconocida")
            if definition.executor == "server" and definition.key in ("automation.create",):
                raise AutomationError("Una automatización no puede crear otras automatizaciones")
            err = validate_params(definition, act.get("params") or {})
            if err:
                raise AutomationError(err)
        clean.append({k: v for k, v in act.items() if isinstance(k, str)})
    return clean


def _compute_next(a: Automation, after: datetime | None = None) -> datetime | None:
    from app.jobs.scheduler import next_run

    now = after or datetime.now(UTC)
    if a.trigger_type == "schedule" and a.cron:
        return next_run(a.cron, a.timezone, now)
    if a.trigger_type == "date" and a.run_at:
        return a.run_at if a.run_count == 0 else None
    return None


async def create_automation(session: AsyncSession, user_id: uuid.UUID, data: dict[str, Any], *, created_by: str = "user") -> Automation:
    from app.jobs.scheduler import validate_cron

    trigger = data.get("trigger_type")
    if trigger not in ("schedule", "date", "event"):
        raise AutomationError("Disparador inválido: schedule, date o event")
    a = Automation(
        user_id=user_id, name=str(data.get("name", "")).strip()[:200] or "Automatización", description=str(data.get("description") or "")[:2000],
        trigger_type=trigger, timezone=_tz(data.get("timezone")), conditions=data.get("conditions") or {},
        actions=validate_actions(data.get("actions")), created_by=created_by,
        max_runs_per_day=max(1, min(int(data.get("max_runs_per_day") or 5), 48)),
        max_total_runs=int(data["max_total_runs"]) if data.get("max_total_runs") else None,
        cooldown_seconds=max(30, min(int(data.get("cooldown_seconds") or 60), 86_400)),
        status=data.get("status") if data.get("status") in ("active", "awaiting_approval", "paused") else "active",
    )
    if not isinstance(a.conditions, dict):
        raise AutomationError("Las condiciones deben ser un objeto {campo: valor}")
    if trigger == "schedule":
        cron = str(data.get("cron") or "").strip()
        if not validate_cron(cron):
            raise AutomationError("Expresión cron inválida")
        # Frecuencia mínima: cada 15 minutos (evita consumo indefinido).
        from croniter import croniter

        it = croniter(cron, datetime.now(UTC))
        first, second = it.get_next(datetime), it.get_next(datetime)
        if (second - first) < timedelta(minutes=15):
            raise AutomationError("La frecuencia mínima es cada 15 minutos")
        a.cron = cron
    elif trigger == "date":
        a.run_at = _parse_dt(data.get("run_at"))
        if a.run_at <= datetime.now(UTC):
            raise AutomationError("La fecha debe ser futura")
        a.max_total_runs = 1
    else:
        et = data.get("event_type")
        if et not in EVENT_TYPES:
            raise AutomationError(f"Evento inválido; disponibles: {', '.join(EVENT_TYPES)}")
        a.event_type = et
    a.next_run_at = _compute_next(a) if a.status == "active" else None
    session.add(a)
    await session.flush()
    await record_audit(session, user_id, "automation.created", f"Automatización creada: {a.name}", actor_type="user" if created_by == "user" else "agent",
                       target_type="automation", target_id=a.id, details={"trigger": trigger, "status": a.status})
    await _publish(a)
    return a


async def _publish(a: Automation) -> None:
    await events.publish(a.user_id, "automation.updated", {**serialize(a), "entity": {"type": "automation", "id": str(a.id)}})


async def get_owned(session: AsyncSession, user_id: uuid.UUID, automation_id: uuid.UUID, *, lock: bool = False) -> Automation:
    a = await session.get(Automation, automation_id, with_for_update=lock)
    if a is None or a.user_id != user_id:
        raise NotFound("Automatización no encontrada")
    return a


async def update_automation(session: AsyncSession, a: Automation, data: dict[str, Any]) -> Automation:
    from app.jobs.scheduler import validate_cron

    if "name" in data and data["name"]:
        a.name = str(data["name"])[:200]
    if "description" in data and data["description"] is not None:
        a.description = str(data["description"])[:2000]
    if "actions" in data and data["actions"] is not None:
        a.actions = validate_actions(data["actions"])
    if "conditions" in data and data["conditions"] is not None:
        if not isinstance(data["conditions"], dict):
            raise AutomationError("Las condiciones deben ser un objeto")
        a.conditions = data["conditions"]
    for field_name, lo, hi in (("max_runs_per_day", 1, 48), ("cooldown_seconds", 30, 86_400)):
        if data.get(field_name) is not None:
            setattr(a, field_name, max(lo, min(int(data[field_name]), hi)))
    if "max_total_runs" in data:
        a.max_total_runs = int(data["max_total_runs"]) if data["max_total_runs"] else None
    if a.trigger_type == "schedule" and data.get("cron"):
        if not validate_cron(data["cron"]):
            raise AutomationError("Expresión cron inválida")
        a.cron = data["cron"]
    if data.get("timezone"):
        a.timezone = _tz(data["timezone"])
    if a.trigger_type == "date" and data.get("run_at"):
        a.run_at = _parse_dt(data["run_at"])
    if a.status == "active":
        a.next_run_at = _compute_next(a)
    await session.flush()
    await _publish(a)
    return a


async def set_status(session: AsyncSession, a: Automation, status: str) -> Automation:
    if status == "active":
        settings = await session.get(UserSettings, a.user_id)
        if settings and settings.emergency_stop:
            raise AutomationError("STOP ALL está activo: desactivalo antes de reanudar automatizaciones")
        if a.status == "exhausted":
            raise AutomationError("La automatización alcanzó su límite de ejecuciones")
        a.status = "active"
        a.paused_by_stop = False
        a.next_run_at = _compute_next(a)
    elif status == "paused":
        a.status = "paused"
        a.next_run_at = None
    await session.flush()
    await record_audit(session, a.user_id, f"automation.{status}", f"Automatización {status}: {a.name}", actor_type="user",
                       target_type="automation", target_id=a.id)
    await _publish(a)
    return a


async def pause_all_for_stop(session: AsyncSession, user_id: uuid.UUID) -> int:
    rows = (await session.scalars(select(Automation).where(Automation.user_id == user_id, Automation.status == "active"))).all()
    for a in rows:
        a.status = "paused"
        a.paused_by_stop = True
        a.next_run_at = None
        await _publish(a)
    return len(rows)


# ------------------------------------------------------------------ disparo

def conditions_match(conditions: dict[str, Any], data: dict[str, Any]) -> bool:
    for key, expected in (conditions or {}).items():
        value = data.get(key)
        if isinstance(expected, list):
            if value not in expected:
                return False
        elif str(value).lower() != str(expected).lower():
            return False
    return True


async def emit_event(session: AsyncSession, user_id: uuid.UUID, event_type: str, data: dict[str, Any], *,
                     origin_automation_id: uuid.UUID | None = None) -> int:
    """Encola las automatizaciones activas que escuchan este evento real."""
    if origin_automation_id is not None:
        return 0  # anti-bucle: lo que generó una automatización no dispara otras
    rows = (await session.scalars(
        select(Automation).where(Automation.user_id == user_id, Automation.status == "active", Automation.trigger_type == "event",
                                 Automation.event_type == event_type)
    )).all()
    fired = 0
    event_id = data.get("event_id") or uuid.uuid4().hex
    for a in rows:
        if not conditions_match(a.conditions, data):
            continue
        await queue.enqueue(session, "automation.run", {"automation_id": str(a.id), "trigger": {"type": "event", "event_type": event_type,
                                                                                               "event_id": event_id, "data": _small(data)}},
                            user_id=user_id, priority=4, idempotency_key=f"automation.run:{a.id}:{event_id}", max_attempts=2)
        fired += 1
    return fired


def _small(data: dict[str, Any]) -> dict[str, Any]:
    return {k: (v[:300] if isinstance(v, str) else v) for k, v in data.items() if isinstance(v, (str, int, float, bool)) or v is None}


async def tick_due(session: AsyncSession) -> int:
    now = datetime.now(UTC)
    due = (await session.scalars(
        select(Automation).where(Automation.status == "active", Automation.next_run_at.is_not(None), Automation.next_run_at <= now)
        .with_for_update(skip_locked=True).limit(50)
    )).all()
    for a in due:
        scheduled = a.next_run_at
        assert scheduled is not None
        await queue.enqueue(session, "automation.run", {"automation_id": str(a.id), "trigger": {"type": a.trigger_type,
                                                                                               "scheduled_for": scheduled.isoformat()}},
                            user_id=a.user_id, priority=4, idempotency_key=f"automation.run:{a.id}:{scheduled.isoformat()}", max_attempts=2)
        a.next_run_at = _compute_next(a, scheduled + timedelta(seconds=1)) if a.trigger_type == "schedule" else None
    return len(due)


async def run_manual(session: AsyncSession, a: Automation) -> None:
    if a.status != "active":
        raise AutomationError("Solo se pueden ejecutar automatizaciones activas")
    key = f"automation.run:{a.id}:manual:{datetime.now(UTC).strftime('%Y%m%d%H%M')}"
    await queue.enqueue(session, "automation.run", {"automation_id": str(a.id), "trigger": {"type": "manual"}}, user_id=a.user_id,
                        priority=3, idempotency_key=key, max_attempts=1)


async def _limit_reason(session: AsyncSession, a: Automation, now: datetime) -> str | None:
    if a.max_total_runs is not None and a.run_count >= a.max_total_runs:
        return "Límite total de ejecuciones alcanzado"
    if a.last_run_at and (now - a.last_run_at).total_seconds() < a.cooldown_seconds:
        return f"En enfriamiento ({a.cooldown_seconds} s entre ejecuciones)"
    day = await session.scalar(select(func.count()).select_from(AutomationRun).where(
        AutomationRun.automation_id == a.id, AutomationRun.created_at > now - timedelta(hours=24), AutomationRun.status != "skipped"))
    if (day or 0) >= a.max_runs_per_day:
        return f"Límite diario alcanzado ({a.max_runs_per_day})"
    hour = await session.scalar(select(func.count()).select_from(AutomationRun).where(
        AutomationRun.user_id == a.user_id, AutomationRun.created_at > now - timedelta(hours=1), AutomationRun.status != "skipped"))
    if (hour or 0) >= USER_HOURLY_CAP:
        return "Tope global de automatizaciones por hora alcanzado"
    return None


async def execute_run(session: AsyncSession, automation_id: uuid.UUID, trigger: dict[str, Any]) -> AutomationRun | None:
    a = await session.get(Automation, automation_id, with_for_update=True)
    if a is None:
        return None
    now = datetime.now(UTC)
    settings = await session.get(UserSettings, a.user_id)
    run = AutomationRun(automation_id=a.id, user_id=a.user_id, trigger=trigger, status="running")
    session.add(run)
    reason = None
    if a.status != "active":
        reason = f"La automatización está {a.status}"
    elif settings and settings.emergency_stop:
        reason = "STOP ALL activo"
    else:
        reason = await _limit_reason(session, a, now)
    if reason:
        run.status = "skipped"
        run.error = reason
        run.finished_at = now
        a.last_status = f"omitida: {reason}"[:40]
        await session.flush()
        await _publish(a)
        return run
    results: list[dict[str, Any]] = []
    failed = False
    for act in a.actions:
        try:
            results.append(await _run_action(session, a, act, trigger, settings))
        except Exception as exc:  # noqa: BLE001 - cada acción informa su error
            failed = True
            results.append({"type": act.get("type"), "ok": False, "error": getattr(exc, "message", str(exc))[:300]})
    run.result = {"actions": results}
    run.status = "failed" if failed else "succeeded"
    run.finished_at = datetime.now(UTC)
    a.run_count += 1
    a.last_run_at = now
    a.last_status = run.status
    if a.max_total_runs is not None and a.run_count >= a.max_total_runs:
        a.status = "exhausted"
        a.next_run_at = None
    if failed:
        from app.notifications.service import notify

        await notify(session, a.user_id, "important_error", f"Automatización con errores: {a.name}",
                     "; ".join(r["error"] for r in results if not r.get("ok") and r.get("error"))[:400], {"automation_id": str(a.id)})
    await session.flush()
    await events.publish(a.user_id, "automation.run", {"automation_id": str(a.id), "run_id": str(run.id), "status": run.status,
                                                       "entity": {"type": "automation", "id": str(a.id)}})
    await _publish(a)
    return run


def _in_quiet_hours(settings: UserSettings | None, now: datetime, tz: str) -> datetime | None:
    """Si ahora es horario de silencio, devuelve cuándo termina (para diferir la notificación)."""
    proactive = ((settings.jarvis_settings or {}) if settings else {}).get("proactive") or {}
    quiet = proactive.get("quiet_hours") or {}
    start, end = quiet.get("start"), quiet.get("end")
    if not start or not end:
        return None
    try:
        zone = ZoneInfo(proactive.get("timezone") or tz)
        local = now.astimezone(zone)
        sh, sm = map(int, start.split(":"))
        eh, em = map(int, end.split(":"))
    except (ValueError, ZoneInfoNotFoundError):
        return None
    minutes = local.hour * 60 + local.minute
    s, e = sh * 60 + sm, eh * 60 + em
    inside = (s <= minutes < e) if s < e else (minutes >= s or minutes < e)
    if not inside:
        return None
    end_local = local.replace(hour=eh, minute=em, second=0, microsecond=0)
    if end_local <= local:
        end_local += timedelta(days=1)
    return end_local.astimezone(UTC)


async def _run_action(session: AsyncSession, a: Automation, act: dict[str, Any], trigger: dict[str, Any],
                      settings: UserSettings | None) -> dict[str, Any]:
    from app.notifications.service import notify

    t = act["type"]
    now = datetime.now(UTC)
    if t == "notify":
        deliver_at = _in_quiet_hours(settings, now, a.timezone)
        n = await notify(session, a.user_id, "automation", act["title"][:200], str(act.get("body") or "")[:1000],
                         {"automation_id": str(a.id)}, deliver_at=deliver_at)
        if n is not None and deliver_at is not None:
            await queue.enqueue(session, "notification.deliver", {"notification_id": str(n.id)}, user_id=a.user_id,
                                delay_seconds=(deliver_at - now).total_seconds(), idempotency_key=f"notify:{n.id}")
        return {"type": t, "ok": True, "notification_id": str(n.id) if n else None, "deferred_until": deliver_at.isoformat() if deliver_at else None,
                "note": None if n else "Tipo de notificación desactivado por el usuario"}
    if t == "reminder":
        from app.models import ScheduledJob

        minutes = max(1, min(int(act.get("in_minutes") or 1), 60 * 24 * 30))
        at = now + timedelta(minutes=minutes)
        job = ScheduledJob(user_id=a.user_id, kind="reminder", name=act["title"][:200], run_once_at=at, next_run_at=at,
                           payload={"title": act["title"], "body": act.get("body", ""), "automation_id": str(a.id)})
        session.add(job)
        await session.flush()
        return {"type": t, "ok": True, "scheduled_job_id": str(job.id), "at": at.isoformat()}
    if t == "mission":
        from app.missions.service import create_mission

        nexus = await session.scalar(select(Agent).where(Agent.user_id == a.user_id, Agent.slug == "nexus"))
        mission = await create_mission(session, a.user_id, title=str(act.get("title") or a.name)[:200], objective=act["objective"],
                                       budget_usd=Decimal(str(act["budget_usd"])) if act.get("budget_usd") else None,
                                       created_by_agent=nexus)
        mission.automation_id = a.id
        await session.flush()
        return {"type": t, "ok": True, "mission_id": str(mission.id)}
    if t == "jarvis_prompt":
        await queue.enqueue(session, "automation.jarvis", {"automation_id": str(a.id), "prompt": act["prompt"][:4000],
                                                           "trigger": _small(trigger.get("data") or {})},
                            user_id=a.user_id, priority=4, idempotency_key=f"automation.jarvis:{a.id}:{now.isoformat()}", max_attempts=2)
        return {"type": t, "ok": True, "queued": True}
    if t == "action":
        from app.actions.service import propose

        action = await propose(session, a.user_id, act["action_key"], act.get("params") or {}, summary=f"{a.name}: {act['action_key']}",
                               source="automation")
        await notify(session, a.user_id, "approval_requested", f"Confirmá: {action.summary[:150]}",
                     "Una automatización preparó una acción que necesita tu confirmación.", {"action_id": str(action.id)})
        return {"type": t, "ok": True, "action_id": str(action.id), "status": action.status}
    raise AutomationError(f"Acción no soportada: {t}")


async def run_jarvis_prompt(session: AsyncSession, automation_id: uuid.UUID, prompt: str, trigger: dict[str, Any]) -> None:
    """NEXUS responde a la instrucción de una rutina (solo herramientas de lectura) y lo notifica."""
    from app.agents.runtime import run_agent
    from app.jarvis.service import get_or_create_jarvis_conversation
    from app.agents.runtime import record_message
    from app.notifications.service import notify

    a = await session.get(Automation, automation_id)
    if a is None:
        return
    nexus = await session.scalar(select(Agent).where(Agent.user_id == a.user_id, Agent.slug == "nexus"))
    assert nexus is not None
    settings = await session.get(UserSettings, a.user_id)
    context = f"\n\nDatos del evento que disparó la rutina: {trigger}" if trigger else ""
    result = await run_agent(
        session, nexus, purpose="automation", task_type="general", prompt=prompt + context,
        autonomy_mode=settings.autonomy_mode if settings else "supervised",
        tool_filter={"missions.list", "missions.status", "memory.search", "agents.list", "project.list_files", "documents.read"},
        max_steps=4, max_tokens=2000,
        extra_system="# Rutina automática\nEstás ejecutando una rutina programada por el usuario. Respondé breve y concreto; "
                     "no propongas acciones externas.",
    )
    conv = await get_or_create_jarvis_conversation(session, a.user_id)
    await record_message(session, a.user_id, channel="chat", channel_id=conv.id, content=result.text or "(sin respuesta)",
                         sender_type="agent", sender_agent_id=nexus.id, model_used=result.model_label,
                         meta={"automation_id": str(a.id), "kind": "automation_result"})
    deliver_at = _in_quiet_hours(settings, datetime.now(UTC), a.timezone)
    n = await notify(session, a.user_id, "automation", a.name, (result.text or "")[:1000], {"automation_id": str(a.id)}, deliver_at=deliver_at)
    if n is not None and deliver_at is not None:
        await queue.enqueue(session, "notification.deliver", {"notification_id": str(n.id)}, user_id=a.user_id,
                            delay_seconds=(deliver_at - datetime.now(UTC)).total_seconds(), idempotency_key=f"notify:{n.id}")
