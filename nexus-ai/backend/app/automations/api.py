"""Endpoints de automatizaciones (/api/v1/automations)."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import CurrentUser, current_user
from app.automations import service
from app.core.db import get_session
from app.jobs import queue
from app.models import Automation, AutomationRun
from app.monitoring.audit import record_audit

router = APIRouter(prefix="/automations", tags=["automations"])


class AutomationIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    trigger_type: str = Field(pattern=r"^(schedule|date|event)$")
    cron: str | None = Field(default=None, max_length=120)
    run_at: str | None = Field(default=None, max_length=40)
    timezone: str | None = Field(default=None, max_length=60)
    event_type: str | None = Field(default=None, max_length=60)
    conditions: dict[str, Any] = Field(default_factory=dict)
    actions: list[dict[str, Any]] = Field(min_length=1, max_length=5)
    max_runs_per_day: int | None = Field(default=None, ge=1, le=48)
    max_total_runs: int | None = Field(default=None, ge=1)
    cooldown_seconds: int | None = Field(default=None, ge=30, le=86_400)


class AutomationPatch(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    cron: str | None = Field(default=None, max_length=120)
    run_at: str | None = Field(default=None, max_length=40)
    timezone: str | None = Field(default=None, max_length=60)
    conditions: dict[str, Any] | None = None
    actions: list[dict[str, Any]] | None = Field(default=None, max_length=5)
    max_runs_per_day: int | None = Field(default=None, ge=1, le=48)
    max_total_runs: int | None = Field(default=None, ge=1)
    cooldown_seconds: int | None = Field(default=None, ge=30, le=86_400)


@router.get("/events")
async def event_catalog(_: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    return {"events": service.EVENT_TYPES, "action_types": sorted(service.ACTION_TYPES), "limits": {
        "max_actions": service.MAX_ACTIONS, "user_hourly_cap": service.USER_HOURLY_CAP, "min_schedule_minutes": 15}}


@router.get("")
async def list_automations(status_filter: str | None = Query(default=None, alias="status"), cu: CurrentUser = Depends(current_user),
                           session: AsyncSession = Depends(get_session)) -> list[dict[str, Any]]:
    q = select(Automation).where(Automation.user_id == cu.id)
    if status_filter:
        q = q.where(Automation.status.in_(status_filter.split(",")))
    return [service.serialize(a) for a in (await session.scalars(q.order_by(Automation.created_at.desc()))).all()]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create(body: AutomationIn, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    a = await service.create_automation(session, cu.id, body.model_dump(exclude_none=True), created_by="user")
    await session.commit()
    return service.serialize(a)


@router.get("/{automation_id}")
async def get_one(automation_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    return service.serialize(await service.get_owned(session, cu.id, automation_id))


@router.patch("/{automation_id}")
async def update(automation_id: uuid.UUID, body: AutomationPatch, cu: CurrentUser = Depends(current_user),
                 session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    a = await service.get_owned(session, cu.id, automation_id, lock=True)
    a = await service.update_automation(session, a, body.model_dump(exclude_unset=True))
    await record_audit(session, cu.id, "automation.updated", f"Automatización editada: {a.name}", actor_type="user",
                       target_type="automation", target_id=a.id)
    await session.commit()
    return service.serialize(a)


@router.post("/{automation_id}/pause")
async def pause(automation_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    a = await service.set_status(session, await service.get_owned(session, cu.id, automation_id, lock=True), "paused")
    await session.commit()
    return service.serialize(a)


@router.post("/{automation_id}/resume")
async def resume(automation_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    a = await service.set_status(session, await service.get_owned(session, cu.id, automation_id, lock=True), "active")
    await session.commit()
    return service.serialize(a)


@router.post("/{automation_id}/run", status_code=status.HTTP_202_ACCEPTED)
async def run_now(automation_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    a = await service.get_owned(session, cu.id, automation_id)
    await service.run_manual(session, a)
    await queue.commit(session)
    return {"queued": True, "automation_id": str(a.id)}


@router.get("/{automation_id}/runs")
async def runs(automation_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[dict[str, Any]]:
    a = await service.get_owned(session, cu.id, automation_id)
    rows = (await session.scalars(select(AutomationRun).where(AutomationRun.automation_id == a.id).order_by(AutomationRun.created_at.desc()).limit(50))).all()
    return [{"id": str(r.id), "status": r.status, "trigger": r.trigger, "result": r.result, "error": r.error,
             "created_at": r.created_at.isoformat(), "finished_at": r.finished_at.isoformat() if r.finished_at else None} for r in rows]


@router.delete("/{automation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete(automation_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> None:
    a = await service.get_owned(session, cu.id, automation_id, lock=True)
    await record_audit(session, cu.id, "automation.deleted", f"Automatización eliminada: {a.name}", actor_type="user",
                       target_type="automation", target_id=a.id)
    await session.delete(a)
    await session.commit()
