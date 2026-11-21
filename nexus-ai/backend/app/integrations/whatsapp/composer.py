"""Message Composer: mejora la redacción de un mensaje SIN inventar datos.

Solo se llama cuando el usuario lo pide (botón «Mejorar» / tono elegido): ahí es necesario
enviar el texto al modelo. Nunca se envía el número ni datos del contacto: como mucho el
nombre de pila para el saludo, si el usuario lo incluye.
"""

from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NexusError
from app.providers import gateway
from app.providers.base import Message

TONE_GUIDE = {
    "informal": "informal y cercano, como entre amigos",
    "formal": "formal y respetuoso",
    "amistoso": "amable y cálido",
    "breve": "lo más breve posible sin perder el sentido",
    "profesional": "profesional, claro y cortés",
    "explicativo": "claro y explicativo, con el detalle necesario",
    "original": "igual al original; solo corregí errores",
}
MODES = ("tone", "correct", "translate", "direct")

SYSTEM = """Sos el redactor de mensajes de NEXUS. Reescribís el mensaje que el usuario quiere mandar.
Reglas estrictas:
- No agregues hechos, fechas, horarios, lugares, montos, nombres ni promesas que no estén en el original.
- Conservá el significado y la intención.
- Escribís el mensaje tal como lo leerá el destinatario (en primera persona del usuario).
- Devolvé SOLO el texto final del mensaje, sin comillas ni comentarios."""


async def compose(session: AsyncSession, user_id: uuid.UUID, *, text: str, mode: str, tone: str | None, target_language: str | None,
                  recipient_first_name: str | None, dialect: str = "es-AR") -> dict:
    text = (text or "").strip()
    if not text:
        raise NexusError("No hay texto para mejorar")
    if len(text) > 4000:
        raise NexusError("El mensaje supera 4000 caracteres")
    if mode not in MODES:
        raise NexusError(f"Modo inválido: {', '.join(MODES)}")
    if mode == "tone":
        instruction = f"Reescribí el mensaje con un tono {TONE_GUIDE.get(tone or 'original', TONE_GUIDE['original'])}."
    elif mode == "correct":
        instruction = "Corregí ortografía, puntuación y gramática sin cambiar el estilo."
    elif mode == "translate":
        if not target_language:
            raise NexusError("Indicá el idioma de destino")
        instruction = f"Traducí el mensaje al idioma {target_language[:30]} con naturalidad."
    else:
        instruction = ("El texto está en estilo indirecto (lo que el usuario quiere que se le diga a alguien). "
                       "Convertilo en el mensaje directo que va a recibir el destinatario.")
    if mode != "translate":
        instruction += " Español rioplatense con voseo." if dialect.startswith("es-AR") else " Español neutro."
    who = f"\nEl destinatario se llama {recipient_first_name[:40]} (podés usarlo en el saludo si corresponde)." if recipient_first_name else ""
    ctx = gateway.CallContext(user_id=user_id, purpose="compose", task_type="writing")
    res = await gateway.complete(session, ctx, system=SYSTEM, max_tokens=900,
                                 messages=[Message(role="user", content=f"{instruction}{who}\n\nMensaje original:\n<<<\n{text}\n>>>")])
    out = res.response.text.strip().strip('"').strip("«»").strip()
    if not out:
        raise NexusError("El modelo no devolvió texto")
    return {"text": out, "original": text, "mode": mode, "tone": tone, "model": res.model_label, "degraded_quality": res.degraded_quality}
