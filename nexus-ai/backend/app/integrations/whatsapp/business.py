"""WhatsApp Business Platform (Cloud API oficial de Meta). Opcional.

- Credenciales exclusivamente en el servidor (variables NEXUS_WHATSAPP_*); nunca en la app.
- Cada envío es una acción EXTERNAL_COMMUNICATION confirmada por el usuario.
- Consentimiento: el usuario declara que el destinatario aceptó recibir mensajes (opt-in).
- Ventana de 24 h: texto libre solo si el destinatario escribió en las últimas 24 h;
  fuera de la ventana se exige una plantilla aprobada.
- Estados: ACCEPTED (respuesta de la API) y luego sent/delivered/read/failed SOLO por
  webhook firmado (X-Hub-Signature-256). Nada se infiere.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import events
from app.core.config import get_settings
from app.core.crypto import encrypt_str
from app.core.errors import NexusError
from app.integrations.whatsapp.phone import normalize
from app.models import ActionRequest, BusinessMessage, User

logger = logging.getLogger(__name__)
transport_override: httpx.AsyncBaseTransport | None = None
STATUS_ORDER = {"queued": 0, "accepted": 1, "sent": 2, "delivered": 3, "read": 4, "failed": 5}


class BusinessError(NexusError):
    code = "whatsapp_business_error"


def configured() -> bool:
    s = get_settings()
    return bool(s.whatsapp_business_token and s.whatsapp_phone_number_id)


async def owner_allowed(session: AsyncSession, user_id: uuid.UUID) -> bool:
    s = get_settings()
    if not configured():
        return False
    if not s.whatsapp_business_owner_email:
        return False
    user = await session.get(User, user_id)
    return bool(user and user.email.lower() == s.whatsapp_business_owner_email.lower())


def recipient_hash(e164: str) -> str:
    return hmac.new(get_settings().secret_key.encode(), e164.encode(), hashlib.sha256).hexdigest()


async def status(session: AsyncSession, user_id: uuid.UUID) -> dict[str, Any]:
    s = get_settings()
    allowed = await owner_allowed(session, user_id)
    counts: dict[str, int] = {}
    last_webhook = None
    if allowed:
        counts = dict((await session.execute(
            select(BusinessMessage.status, func.count()).where(BusinessMessage.user_id == user_id, BusinessMessage.direction == "outbound")
            .group_by(BusinessMessage.status))).all())
        last_webhook = await session.scalar(select(func.max(BusinessMessage.updated_at)).where(BusinessMessage.user_id == user_id))
    return {
        "configured": configured(),
        "enabled_for_user": allowed,
        "webhook_verification_configured": bool(s.whatsapp_verify_token),
        "webhook_signature_configured": bool(s.whatsapp_app_secret),
        "graph_version": s.whatsapp_graph_version,
        "phone_number_id_hint": (s.whatsapp_phone_number_id or "")[-4:] or None,
        "messages_by_status": counts,
        "last_activity_at": last_webhook.isoformat() if last_webhook else None,
        "notes": None if allowed else ("WhatsApp Business no está configurado en el servidor." if not configured()
                                       else "Tu usuario no es el titular configurado de la cuenta Business."),
    }


async def _within_window(session: AsyncSession, user_id: uuid.UUID, to_hash: str) -> bool:
    last_inbound = await session.scalar(select(func.max(BusinessMessage.created_at)).where(
        BusinessMessage.user_id == user_id, BusinessMessage.direction == "inbound", BusinessMessage.to_hash == to_hash))
    return bool(last_inbound and datetime.now(UTC) - last_inbound < timedelta(hours=24))


async def send_from_action(session: AsyncSession, a: ActionRequest, params: dict[str, Any]) -> dict[str, Any]:
    s = get_settings()
    if not await owner_allowed(session, a.user_id):
        raise BusinessError("WhatsApp Business no está disponible para tu usuario")
    if not params.get("opt_in_confirmed"):
        raise BusinessError("Falta confirmar que el destinatario aceptó recibir mensajes (opt-in)")
    phone = normalize(str(params.get("phone", "")))
    if phone.status not in ("ok", "needs_confirmation") or not phone.e164:
        raise BusinessError(f"Número inválido: {phone.message}")
    to_hash = recipient_hash(phone.e164)
    template = params.get("template_name")
    text = (params.get("text") or "").strip()
    if not template:
        if not text:
            raise BusinessError("Falta el texto o la plantilla")
        if not await _within_window(session, a.user_id, to_hash):
            raise BusinessError("Fuera de la ventana de 24 h: WhatsApp exige una plantilla aprobada para iniciar la conversación")
        body: dict[str, Any] = {"messaging_product": "whatsapp", "to": phone.e164, "type": "text", "text": {"body": text[:4096]}}
    else:
        comps = []
        if params.get("template_params"):
            comps = [{"type": "body", "parameters": [{"type": "text", "text": str(p)[:1000]} for p in params["template_params"]][:10]}]
        body = {"messaging_product": "whatsapp", "to": phone.e164, "type": "template",
                "template": {"name": template, "language": {"code": params.get("template_language") or "es_AR"}, **({"components": comps} if comps else {})}}
    msg = BusinessMessage(user_id=a.user_id, action_id=a.id, direction="outbound", to_hash=to_hash, to_encrypted=encrypt_str(phone.e164),
                          to_masked=phone.masked or "****", opt_in_confirmed=True, kind="template" if template else "text",
                          body=text or None, template={"name": template, "params": params.get("template_params") or []} if template else {},
                          status="queued", status_history=[{"status": "queued", "at": datetime.now(UTC).isoformat()}])
    session.add(msg)
    await session.flush()
    url = f"{s.whatsapp_graph_base_url}/{s.whatsapp_graph_version}/{s.whatsapp_phone_number_id}/messages"
    async with httpx.AsyncClient(transport=transport_override, timeout=20) as client:
        try:
            resp = await client.post(url, headers={"authorization": f"Bearer {s.whatsapp_business_token}", "content-type": "application/json"},
                                     content=json.dumps(body))
        except httpx.HTTPError as exc:
            msg.status, msg.error = "failed", f"Error de red: {exc}"[:500]
            raise BusinessError("No se pudo contactar a la API de WhatsApp") from exc
    data: dict[str, Any] = {}
    try:
        data = resp.json()
    except ValueError:
        pass
    if resp.status_code >= 400:
        err = (data.get("error") or {}).get("message") or f"HTTP {resp.status_code}"
        msg.status, msg.error = "failed", str(err)[:500]
        msg.status_history = [*msg.status_history, {"status": "failed", "at": datetime.now(UTC).isoformat(), "error": msg.error}]
        raise BusinessError(f"WhatsApp rechazó el mensaje: {err}")
    wa_id = ((data.get("messages") or [{}])[0]).get("id")
    if not wa_id:
        msg.status, msg.error = "failed", "Respuesta sin id de mensaje"
        raise BusinessError("La API no devolvió un id de mensaje")
    msg.wa_message_id = wa_id
    msg.status = "accepted"
    msg.status_history = [*msg.status_history, {"status": "accepted", "at": datetime.now(UTC).isoformat()}]
    await session.flush()
    return {"verified": True, "state": "ACCEPTED", "business_message_id": str(msg.id), "wa_message_id": wa_id, "recipient": msg.to_masked,
            "note": "Aceptado por la API de WhatsApp. La entrega y la lectura se informan por webhook."}


def verify_signature(raw: bytes, header: str | None) -> bool:
    secret = get_settings().whatsapp_app_secret
    if not secret or not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header.split("=", 1)[1])


async def handle_webhook(session: AsyncSession, payload: dict[str, Any]) -> dict[str, int]:
    s = get_settings()
    owner = None
    if s.whatsapp_business_owner_email:
        owner = await session.scalar(select(User).where(func.lower(User.email) == s.whatsapp_business_owner_email.lower()))
    updated = inbound = 0
    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            value = change.get("value") or {}
            for st in value.get("statuses") or []:
                msg = await session.scalar(select(BusinessMessage).where(BusinessMessage.wa_message_id == str(st.get("id", ""))).with_for_update())
                new = str(st.get("status", ""))
                if msg is None or new not in STATUS_ORDER:
                    continue
                at = datetime.fromtimestamp(int(st.get("timestamp", 0) or 0), UTC).isoformat() if st.get("timestamp") else datetime.now(UTC).isoformat()
                entry_hist = {"status": new, "at": at}
                if new == "failed":
                    errs = st.get("errors") or [{}]
                    msg.error = str(errs[0].get("title") or errs[0].get("message") or "failed")[:500]
                    entry_hist["error"] = msg.error
                if any(h.get("status") == new for h in msg.status_history):
                    continue  # webhook repetido: idempotente
                msg.status_history = [*msg.status_history, entry_hist]
                if new == "failed" or STATUS_ORDER[new] > STATUS_ORDER.get(msg.status, 0):
                    msg.status = new
                updated += 1
                await events.publish(msg.user_id, "whatsapp.business.status", {"business_message_id": str(msg.id), "status": msg.status,
                                                                               "recipient": msg.to_masked, "entity": {"type": "business_message", "id": str(msg.id)}})
                if msg.action_id:
                    a = await session.get(ActionRequest, msg.action_id)
                    if a is not None:
                        a.state_detail = msg.status.upper()
                        a.result = {**a.result, "delivery_status": msg.status}
            for m in value.get("messages") or []:
                if owner is None:
                    continue
                sender = normalize("+" + str(m.get("from", "")))
                if not sender.e164:
                    continue
                to_hash = recipient_hash(sender.e164)
                session.add(BusinessMessage(user_id=owner.id, direction="inbound", to_hash=to_hash, to_encrypted=encrypt_str(sender.e164),
                                            to_masked=sender.masked or "****", kind="inbound", status="received",
                                            wa_message_id=str(m.get("id", ""))[:200] or None,
                                            status_history=[{"status": "received", "at": datetime.now(UTC).isoformat(), "type": m.get("type")}]))
                inbound += 1
                from app.automations.service import emit_event

                await emit_event(session, owner.id, "whatsapp.business.inbound", {"from": sender.masked, "type": str(m.get("type", "")),
                                                                                   "event_id": str(m.get("id", uuid.uuid4().hex))})
    await session.flush()
    return {"statuses": updated, "inbound": inbound}
