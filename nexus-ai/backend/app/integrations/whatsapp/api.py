"""Endpoints de WhatsApp (/api/v1/integrations/whatsapp).

WhatsApp personal: el número se resuelve y el chat se abre EN EL TELÉFONO (intent
https://wa.me/...). Estos endpoints validan, preparan y registran el flujo sin recibir la
agenda; el texto solo llega al servidor cuando el usuario pide mejorarlo con IA.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, Query, Request, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.actions import service as actions
from app.auth.deps import CurrentUser, current_user
from app.core.config import get_settings
from app.core.db import get_session
from app.core.errors import NexusError
from app.integrations.whatsapp import business, contacts
from app.integrations.whatsapp.composer import compose
from app.integrations.whatsapp.phone import normalize, wa_link
from app.models import ActionRequest, UserSettings

router = APIRouter(prefix="/integrations/whatsapp", tags=["whatsapp"])
STATES = ["DRAFT_CREATED", "CONTACT_RESOLVED", "AWAITING_CONFIRMATION", "READY_TO_OPEN", "WHATSAPP_OPENED", "CANCELLED", "ERROR"]


class PrepareIn(BaseModel):
    phone: str = Field(min_length=3, max_length=40)
    text: str = Field(default="", max_length=4000)
    contact_label: str | None = Field(default=None, max_length=120)
    default_area_code: str | None = Field(default=None, max_length=5)
    register_action: bool = True


class ResolveIn(BaseModel):
    query: str = Field(min_length=1, max_length=120)
    candidates: list[dict[str, Any]] = Field(default_factory=list, max_length=500)


class DraftIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    mode: str = Field(default="tone", pattern=r"^(tone|correct|translate|direct)$")
    tone: str | None = Field(default=None, pattern=r"^(original|informal|formal|amistoso|breve|profesional|explicativo)$")
    target_language: str | None = Field(default=None, max_length=30)
    recipient_first_name: str | None = Field(default=None, max_length=40)


class NormalizeIn(BaseModel):
    phone: str = Field(min_length=1, max_length=40)
    default_area_code: str | None = Field(default=None, max_length=5)


@router.post("/normalize")
async def normalize_number(body: NormalizeIn, _: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    return normalize(body.phone, body.default_area_code).to_dict()


@router.post("/prepare")
async def prepare(body: PrepareIn, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    """Valida y normaliza el número y arma el enlace Click to Chat. Si el número es ambiguo, no
    devuelve enlace: la app debe preguntar antes de seguir."""
    result = normalize(body.phone, body.default_area_code)
    out: dict[str, Any] = {"phone": result.to_dict(), "state": "DRAFT_CREATED", "link": None, "action": None}
    if result.status in ("needs_area_code", "invalid"):
        out["state"] = "ERROR" if result.status == "invalid" else "DRAFT_CREATED"
        return out
    out["state"] = "AWAITING_CONFIRMATION"
    out["link"] = wa_link(result.e164 or "", body.text)
    if body.register_action:
        a = await actions.propose(session, cu.id, "whatsapp.open_chat",
                                  {"phone": result.e164, "text": body.text, "contact_label": body.contact_label or result.masked},
                                  summary=f"WhatsApp para {body.contact_label or result.masked}", source="user")
        out["action"] = actions.serialize(a)
        await session.commit()
    return out


@router.post("/contact/resolve")
async def resolve_contact(body: ResolveIn, _: CurrentUser = Depends(current_user)) -> dict[str, Any]:
    for c in body.candidates:
        if any(k in c for k in ("phone", "number", "numbers")):
            raise NexusError("No envíes números de teléfono para resolver contactos: solo etiquetas y alias")
    return contacts.resolve(body.query, body.candidates)


@router.post("/draft")
async def draft(body: DraftIn, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    settings = await session.get(UserSettings, cu.id)
    dialect = ((settings.voice_settings or {}).get("language") if settings else None) or "es-AR"
    out = await compose(session, cu.id, text=body.text, mode=body.mode, tone=body.tone, target_language=body.target_language,
                        recipient_first_name=body.recipient_first_name, dialect=dialect)
    await session.commit()
    return out


@router.get("/status")
async def wa_status(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    recent = (await session.scalars(select(ActionRequest).where(ActionRequest.user_id == cu.id,
                                                               ActionRequest.action_key.in_(["whatsapp.open_chat", "whatsapp.business_send"]))
                                    .order_by(ActionRequest.created_at.desc()).limit(20))).all()
    return {
        "personal": {"available": True, "method": "click_to_chat", "opened_on_device": True,
                     "can_confirm_delivery": False,
                     "note": "NEXUS abre WhatsApp con el texto listo; el envío lo hace el usuario y no se puede verificar."},
        "business": await business.status(session, cu.id),
        "states": STATES,
        "recent": [actions.serialize(a) for a in recent],
    }


@router.get("/business/status")
async def business_status(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    return await business.status(session, cu.id)


@router.get("/business/webhook", response_class=PlainTextResponse)
async def webhook_verify(mode: str = Query(alias="hub.mode"), token: str = Query(alias="hub.verify_token"),
                         challenge: str = Query(alias="hub.challenge")) -> PlainTextResponse:
    expected = get_settings().whatsapp_verify_token
    if not expected or mode != "subscribe" or token != expected:
        return PlainTextResponse("forbidden", status_code=status.HTTP_403_FORBIDDEN)
    return PlainTextResponse(challenge)


@router.post("/business/webhook")
async def webhook_receive(request: Request, session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    raw = await request.body()
    if not business.verify_signature(raw, request.headers.get("x-hub-signature-256")):
        return PlainTextResponse("invalid signature", status_code=status.HTTP_401_UNAUTHORIZED)  # type: ignore[return-value]
    try:
        payload = json.loads(raw)
    except ValueError:
        return PlainTextResponse("invalid json", status_code=status.HTTP_400_BAD_REQUEST)  # type: ignore[return-value]
    result = await business.handle_webhook(session, payload)
    await session.commit()
    return {"ok": True, **result}
