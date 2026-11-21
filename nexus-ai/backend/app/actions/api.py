"""Endpoints del Action Registry (/api/v1/actions)."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.actions import service
from app.auth.deps import CurrentUser, current_user
from app.core.db import get_session
from app.models import ActionRequest

router = APIRouter(prefix="/actions", tags=["actions"])


class ExecuteIn(BaseModel):
    action_key: str = Field(max_length=60)
    params: dict[str, Any] = Field(default_factory=dict)
    summary: str | None = Field(default=None, max_length=500)
    conversation_id: uuid.UUID | None = None


class ConfirmIn(BaseModel):
    params: dict[str, Any] | None = None  # parámetros editados en la vista previa


class CancelIn(BaseModel):
    reason: str | None = Field(default=None, max_length=300)


class ReportIn(BaseModel):
    state: str = Field(max_length=40)
    result: dict[str, Any] = Field(default_factory=dict)


@router.get("/catalog")
async def catalog(_: CurrentUser = Depends(current_user)) -> list[dict[str, Any]]:
    return service.catalog()


@router.get("")
async def list_actions(status_filter: str | None = Query(default=None, alias="status"), limit: int = Query(default=50, le=200),
                       cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[dict[str, Any]]:
    q = select(ActionRequest).where(ActionRequest.user_id == cu.id)
    if status_filter:
        q = q.where(ActionRequest.status.in_(status_filter.split(",")))
    rows = (await session.scalars(q.order_by(ActionRequest.created_at.desc()).limit(limit))).all()
    return [service.serialize(a) for a in rows]


@router.post("/execute", status_code=status.HTTP_201_CREATED)
async def execute(body: ExecuteIn, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Acción pedida directamente por el usuario desde la app (acciones rápidas, botones)."""
    from app.actions.registry import get_action

    definition = get_action(body.action_key)
    a = await service.propose(session, cu.id, body.action_key, body.params,
                              summary=body.summary or (definition.name if definition else body.action_key), source="user",
                              conversation_id=body.conversation_id)
    out = {**service.serialize(a), "device_params": service.execution_params(a)}
    await session.commit()
    return out


@router.get("/{action_id}")
async def get_action(action_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    a = await service.get_owned(session, cu.id, action_id)
    return {**service.serialize(a), "device_params": service.execution_params(a)}


@router.post("/{action_id}/confirm")
async def confirm(action_id: uuid.UUID, body: ConfirmIn | None = None, cu: CurrentUser = Depends(current_user),
                  session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    a = await service.confirm(session, cu.id, action_id, body.params if body else None)
    out = {**service.serialize(a), "device_params": service.execution_params(a)}
    if a.executor == "server" and a.conversation_id is not None and a.status in ("completed", "failed"):
        await _server_outcome_message(session, a)
    await session.commit()
    return out


@router.post("/{action_id}/cancel")
async def cancel(action_id: uuid.UUID, body: CancelIn | None = None, cu: CurrentUser = Depends(current_user),
                 session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    a = await service.cancel(session, cu.id, action_id, body.reason if body else None)
    await session.commit()
    return service.serialize(a)


@router.post("/{action_id}/report")
async def report(action_id: uuid.UUID, body: ReportIn, cu: CurrentUser = Depends(current_user),
                 session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """La app informa el resultado real de una acción de dispositivo."""
    a = await service.report(session, cu.id, action_id, body.state, body.result)
    if a.status == "completed" and a.source != "automation":  # anti-bucle: lo que originó una rutina no dispara otras
        from app.automations.service import emit_event

        await emit_event(session, cu.id, "action.completed", {"action_key": a.action_key, "state": a.state_detail,
                                                              "event_id": f"{a.id}:completed"})
    await session.commit()
    return service.serialize(a)


async def _server_outcome_message(session: AsyncSession, a: ActionRequest) -> None:
    from app.agents.runtime import record_message
    from app.jarvis.service import nexus_agent, user_zone, _when_label
    from app.models import UserSettings

    settings = await session.get(UserSettings, a.user_id)
    _, tz = user_zone(settings)
    p = a.params or {}
    if a.status == "failed":
        text = f"No pude completarlo: {a.error}"
    elif a.action_key == "reminder.create":
        text = f"Listo, te lo recuerdo {_when_label(p.get('at'), tz)}: «{p.get('title')}»."
    elif a.action_key == "memory.remember":
        text = "Guardado en tu memoria. Lo podés ver o borrar en Memoria → Privacidad."
    elif a.action_key == "memory.forget":
        text = f"Listo, borré {a.result.get('deleted', 0)} recuerdo(s)."
    elif a.action_key == "mission.create":
        text = f"Misión creada: «{a.result.get('title')}». Te aviso cuando haya avances."
    elif a.action_key == "automation.create":
        text = "Rutina activada." + (f" Próxima ejecución: {_when_label(a.result.get('next_run_at'), tz)}." if a.result.get("next_run_at") else "")
    elif a.action_key == "whatsapp.business_send":
        text = f"La API de WhatsApp Business aceptó el mensaje para {a.result.get('recipient')}. La entrega se confirma por webhook."
    else:
        text = "Listo."
    nexus = await nexus_agent(session, a.user_id)
    assert a.conversation_id is not None
    await record_message(session, a.user_id, channel="chat", channel_id=a.conversation_id, content=text, sender_type="agent",
                         sender_agent_id=nexus.id, message_type="action_result",
                         meta={"kind": "action_result", "action_id": str(a.id), "state": a.state_detail})
