"""Ajustes, STOP ALL, notificaciones, dispositivos, exportación de datos, herramientas,
plugins y programaciones."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.defaults import PLUGIN_CATALOG
from app.api.schemas import (
    DeviceIn,
    EmergencyStopIn,
    NotificationOut,
    PluginOut,
    PluginPermissionIn,
    PluginUpdate,
    ScheduleCreate,
    ScheduleOut,
    ScheduleUpdate,
    SettingsOut,
    SettingsUpdate,
    ToolOut,
)
from app.auth.deps import CurrentUser, current_user
from app.core.crypto import decrypt_json, encrypt_json
from app.core.db import get_session
from app.core.errors import NexusError, NotFound
from app.jobs import queue
from app.jobs.scheduler import next_run, validate_cron
from app.models import (
    ActionRequest,
    Agent,
    AgentMessage,
    Automation,
    AutomationRun,
    ModelQualityScore,
    AuditLog,
    Conversation,
    DeviceToken,
    MemoryItem,
    Mission,
    MissionTask,
    Notification,
    Plugin,
    PluginPermission,
    Project,
    ScheduledJob,
    ToolDefinition,
    ToolExecution,
    UsageRecord,
    UserSettings,
)
from app.monitoring.audit import record_audit
from app.notifications.service import EVENT_TYPES
from app.security import emergency

router = APIRouter(tags=["settings"])


# ------------------------------------------------------------ ajustes

@router.get("/settings", response_model=SettingsOut)
async def get_settings_(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> UserSettings:
    settings = await session.get(UserSettings, cu.id)
    assert settings is not None
    return settings


@router.patch("/settings", response_model=SettingsOut)
async def update_settings(body: SettingsUpdate, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> UserSettings:
    settings = await session.get(UserSettings, cu.id)
    assert settings is not None
    data = body.model_dump(exclude_unset=True)
    if body.notification_prefs is not None:
        unknown = set(body.notification_prefs) - set(EVENT_TYPES)
        if unknown:
            raise NexusError(f"Tipos de notificación desconocidos: {', '.join(sorted(unknown))}")
        settings.notification_prefs = {**settings.notification_prefs, **body.notification_prefs}
    for field in ("autonomy_mode", "daily_budget_usd", "monthly_budget_usd", "default_mission_budget_usd", "max_tokens_per_mission",
                  "max_concurrent_tasks", "language"):
        if data.get(field) is not None:
            setattr(settings, field, data[field])
    for flag, field in (("clear_daily_budget", "daily_budget_usd"), ("clear_monthly_budget", "monthly_budget_usd"),
                        ("clear_default_mission_budget", "default_mission_budget_usd")):
        if data.get(flag):
            setattr(settings, field, None)
    if body.appearance is not None:
        settings.appearance = {**settings.appearance, **body.appearance}
    if body.memory_settings is not None:
        settings.memory_settings = {**settings.memory_settings, **body.memory_settings}
    if body.display_name:
        cu.user.display_name = body.display_name
    if body.jarvis_settings is not None:
        from app.jarvis.settings import merge_jarvis

        settings.jarvis_settings = merge_jarvis(settings.jarvis_settings, body.jarvis_settings)
    if body.privacy_settings is not None:
        from app.jarvis.settings import merge_privacy

        settings.privacy_settings = merge_privacy(settings.privacy_settings, body.privacy_settings)
    await record_audit(session, cu.id, "settings.updated", "Ajustes actualizados", actor_type="user",
                       details={"fields": sorted(k for k in data if not k.startswith("clear_") or data[k])})
    await session.commit()
    return settings


@router.post("/system/emergency-stop")
async def emergency_stop(body: EmergencyStopIn, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict:
    summary = await emergency.activate(session, cu.id, body.reason)
    await session.commit()
    return {"active": True, **summary}


@router.delete("/system/emergency-stop")
async def clear_emergency_stop(resume_missions: bool = True, cu: CurrentUser = Depends(current_user),
                               session: AsyncSession = Depends(get_session)) -> dict:
    summary = await emergency.deactivate(session, cu.id, resume_missions)
    await queue.commit(session)
    return {"active": False, **summary}


# ------------------------------------------------------------ notificaciones

@router.get("/notifications", response_model=list[NotificationOut])
async def notifications(unread_only: bool = False, before: datetime | None = None, limit: int = 50,
                        cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[Notification]:
    q = select(Notification).where(Notification.user_id == cu.id, Notification.deliver_at.is_(None)).order_by(Notification.created_at.desc()).limit(min(limit, 200))
    if unread_only:
        q = q.where(Notification.read_at.is_(None))
    if before:
        q = q.where(Notification.created_at < before)
    return list((await session.scalars(q)).all())


@router.post("/notifications/{notification_id}/read", status_code=status.HTTP_204_NO_CONTENT)
async def read_notification(notification_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> None:
    n = await session.get(Notification, notification_id)
    if n is None or n.user_id != cu.id:
        raise NotFound("Notificación no encontrada")
    n.read_at = n.read_at or datetime.now(UTC)
    await session.commit()


@router.post("/notifications/read-all", status_code=status.HTTP_204_NO_CONTENT)
async def read_all(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> None:
    await session.execute(update(Notification).where(Notification.user_id == cu.id, Notification.read_at.is_(None)).values(read_at=datetime.now(UTC)))
    await session.commit()


@router.post("/devices", status_code=status.HTTP_204_NO_CONTENT)
async def register_device(body: DeviceIn, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> None:
    stmt = insert(DeviceToken).values(id=uuid.uuid4(), user_id=cu.id, token=body.token, platform=body.platform, last_seen_at=datetime.now(UTC))
    stmt = stmt.on_conflict_do_update(index_elements=["token"], set_={"user_id": cu.id, "last_seen_at": datetime.now(UTC)})
    await session.execute(stmt)
    await session.commit()


@router.delete("/devices", status_code=status.HTTP_204_NO_CONTENT)
async def unregister_device(token: str = Query(min_length=10), cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> None:
    device = await session.scalar(select(DeviceToken).where(DeviceToken.token == token, DeviceToken.user_id == cu.id))
    if device:
        await session.delete(device)
        await session.commit()


# ------------------------------------------------------------ exportación

@router.get("/export")
async def export_data(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Exporta los datos del usuario (sin secretos: las API keys nunca salen del servidor)."""
    uid = cu.id

    async def rows(model, *where, order=None) -> list[dict]:
        q = select(model).where(*where)
        if order is not None:
            q = q.order_by(order)
        out = []
        for r in (await session.scalars(q)).all():
            out.append({a.key: getattr(r, a.key) for a in sa_inspect(model).column_attrs
                        if a.key not in ("password_hash", "api_key_encrypted", "config_encrypted", "search_vector", "to_encrypted")})
        return out

    await record_audit(session, uid, "data.exported", "Exportación de datos", actor_type="user")
    await session.commit()
    return {
        "exported_at": datetime.now(UTC),
        "user": {"id": str(cu.user.id), "email": cu.user.email, "display_name": cu.user.display_name},
        "settings": (await rows(UserSettings, UserSettings.user_id == uid)),
        "agents": await rows(Agent, Agent.user_id == uid),
        "projects": await rows(Project, Project.user_id == uid),
        "missions": await rows(Mission, Mission.user_id == uid, order=Mission.created_at),
        "tasks": await rows(MissionTask, MissionTask.user_id == uid, order=MissionTask.created_at),
        "memory": await rows(MemoryItem, MemoryItem.user_id == uid, order=MemoryItem.created_at),
        "conversations": await rows(Conversation, Conversation.user_id == uid),
        "messages": await rows(AgentMessage, AgentMessage.user_id == uid, order=AgentMessage.created_at),
        "tool_executions": await rows(ToolExecution, ToolExecution.user_id == uid, order=ToolExecution.created_at),
        "usage": await rows(UsageRecord, UsageRecord.user_id == uid, order=UsageRecord.created_at),
        "audit": await rows(AuditLog, AuditLog.user_id == uid, order=AuditLog.created_at),
        "actions": await rows(ActionRequest, ActionRequest.user_id == uid, order=ActionRequest.created_at),
        "automations": await rows(Automation, Automation.user_id == uid, order=Automation.created_at),
        "automation_runs": await rows(AutomationRun, AutomationRun.user_id == uid, order=AutomationRun.created_at),
        "quality_scores": await rows(ModelQualityScore, ModelQualityScore.user_id == uid, order=ModelQualityScore.created_at),
    }


# ------------------------------------------------------------ herramientas y plugins

@router.get("/tools", response_model=list[ToolOut])
async def tools(_: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[ToolDefinition]:
    return list((await session.scalars(select(ToolDefinition).order_by(ToolDefinition.category, ToolDefinition.key))).all())


async def _plugin_out(session: AsyncSession, plugin: Plugin) -> PluginOut:
    perms = (await session.scalars(select(PluginPermission).where(PluginPermission.plugin_id == plugin.id))).all()
    info = PLUGIN_CATALOG.get(plugin.key, {})
    return PluginOut(
        key=plugin.key, name=plugin.name, description=info.get("description", ""), is_enabled=plugin.is_enabled,
        config_public=plugin.config_public, has_secret=bool(plugin.config_encrypted),
        permissions=[{"permission": p.permission, "granted": p.granted, "granted_at": p.granted_at, "revoked_at": p.revoked_at} for p in perms],
        config_fields=info.get("config_fields", {}), last_used_at=plugin.last_used_at,
    )


async def _owned_plugin(session: AsyncSession, user_id: uuid.UUID, key: str) -> Plugin:
    plugin = await session.scalar(select(Plugin).where(Plugin.user_id == user_id, Plugin.key == key))
    if plugin is None:
        raise NotFound("Plugin no encontrado")
    return plugin


@router.get("/plugins", response_model=list[PluginOut])
async def plugins(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[PluginOut]:
    return [await _plugin_out(session, p) for p in (await session.scalars(select(Plugin).where(Plugin.user_id == cu.id).order_by(Plugin.key))).all()]


@router.patch("/plugins/{key}", response_model=PluginOut)
async def update_plugin(key: str, body: PluginUpdate, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> PluginOut:
    plugin = await _owned_plugin(session, cu.id, key)
    if body.config is not None:
        fields = PLUGIN_CATALOG.get(key, {}).get("config_fields", {})
        unknown = set(body.config) - set(fields)
        if unknown:
            raise NexusError(f"Campos de configuración desconocidos: {', '.join(sorted(unknown))}")
        secrets = decrypt_json(plugin.config_encrypted)
        public = dict(plugin.config_public)
        for name, value in body.config.items():
            spec = fields[name]
            if spec == "secret":
                if value:
                    secrets[name] = value
                else:
                    secrets.pop(name, None)
            else:
                if isinstance(spec, list) and value not in spec:
                    raise NexusError(f"{name} debe ser uno de: {', '.join(spec)}")
                public[name] = value
        plugin.config_encrypted = encrypt_json(secrets) if secrets else None
        plugin.config_public = public
    if body.is_enabled is not None:
        plugin.is_enabled = body.is_enabled
    await record_audit(session, cu.id, "plugin.updated", f"Plugin {plugin.name}: {'activado' if plugin.is_enabled else 'desactivado'}",
                       actor_type="user", details={"key": key, "config_keys": sorted((body.config or {}).keys())})
    await session.commit()
    return await _plugin_out(session, plugin)


@router.put("/plugins/{key}/permissions", response_model=PluginOut)
async def set_plugin_permission(key: str, body: PluginPermissionIn, cu: CurrentUser = Depends(current_user),
                                session: AsyncSession = Depends(get_session)) -> PluginOut:
    plugin = await _owned_plugin(session, cu.id, key)
    perm = await session.scalar(select(PluginPermission).where(PluginPermission.plugin_id == plugin.id, PluginPermission.permission == body.permission))
    if perm is None:
        raise NotFound("Ese plugin no declara ese permiso")
    perm.granted = body.granted
    if body.granted:
        perm.granted_at = datetime.now(UTC)
        perm.revoked_at = None
    else:
        perm.revoked_at = datetime.now(UTC)
    await record_audit(session, cu.id, "plugin.permission", f"Permiso {body.permission} {'concedido' if body.granted else 'revocado'} a {plugin.name}",
                       actor_type="user")
    await session.commit()
    return await _plugin_out(session, plugin)


@router.get("/plugins/{key}/activity")
async def plugin_activity(key: str, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[dict]:
    await _owned_plugin(session, cu.id, key)
    tool_keys = [t.key for t in (await session.scalars(select(ToolDefinition).where(ToolDefinition.requires_plugin == key))).all()]
    rows = (await session.scalars(
        select(ToolExecution).where(ToolExecution.user_id == cu.id, ToolExecution.tool_key.in_(tool_keys))
        .order_by(ToolExecution.created_at.desc()).limit(100)
    )).all() if tool_keys else []
    return [{"id": str(r.id), "tool": r.tool_key, "status": r.status, "decision": r.decision, "reason": r.decision_reason,
             "agent_id": str(r.agent_id) if r.agent_id else None, "created_at": r.created_at, "duration_ms": r.duration_ms} for r in rows]


# ------------------------------------------------------------ programaciones

def _validate_schedule(kind: str, cron: str | None, run_once_at: datetime | None, tz: str, payload: dict) -> None:
    if not cron and not run_once_at:
        raise NexusError("Indicá una expresión cron o una fecha única")
    if cron and not validate_cron(cron):
        raise NexusError("Expresión cron inválida")
    try:
        from zoneinfo import ZoneInfo

        ZoneInfo(tz)
    except Exception as exc:  # noqa: BLE001
        raise NexusError(f"Zona horaria inválida: {tz}") from exc
    if kind in ("mission", "meeting") and not payload.get("objective"):
        raise NexusError("La programación necesita 'objective' en payload")
    if kind == "reminder" and not payload.get("title"):
        raise NexusError("El recordatorio necesita 'title' en payload")


@router.get("/schedules", response_model=list[ScheduleOut])
async def schedules(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[ScheduledJob]:
    return list((await session.scalars(select(ScheduledJob).where(ScheduledJob.user_id == cu.id).order_by(ScheduledJob.created_at.desc()))).all())


@router.post("/schedules", response_model=ScheduleOut, status_code=status.HTTP_201_CREATED)
async def create_schedule(body: ScheduleCreate, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> ScheduledJob:
    _validate_schedule(body.kind, body.cron, body.run_once_at, body.timezone, body.payload)
    job = ScheduledJob(
        user_id=cu.id, kind=body.kind, name=body.name, cron=body.cron, run_once_at=body.run_once_at, timezone=body.timezone,
        payload=body.payload, is_enabled=body.is_enabled,
        next_run_at=next_run(body.cron, body.timezone) if body.cron else body.run_once_at,
    )
    session.add(job)
    await session.flush()
    await record_audit(session, cu.id, "schedule.created", f"Programación creada: {job.name}", actor_type="user",
                       target_type="schedule", target_id=job.id)
    await session.commit()
    return job


@router.patch("/schedules/{schedule_id}", response_model=ScheduleOut)
async def update_schedule(schedule_id: uuid.UUID, body: ScheduleUpdate, cu: CurrentUser = Depends(current_user),
                          session: AsyncSession = Depends(get_session)) -> ScheduledJob:
    job = await session.get(ScheduledJob, schedule_id)
    if job is None or job.user_id != cu.id:
        raise NotFound("Programación no encontrada")
    data = body.model_dump(exclude_unset=True)
    for k, v in data.items():
        if v is not None:
            setattr(job, k, v)
    _validate_schedule(job.kind, job.cron, job.run_once_at, job.timezone, job.payload)
    if job.cron and ("cron" in data or "timezone" in data or data.get("is_enabled")):
        job.next_run_at = next_run(job.cron, job.timezone)
    await session.commit()
    return job


@router.delete("/schedules/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_schedule(schedule_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> None:
    job = await session.get(ScheduledJob, schedule_id)
    if job is None or job.user_id != cu.id:
        raise NotFound("Programación no encontrada")
    await session.delete(job)
    await session.commit()
