"""Herramienta para que NEXUS proponga acciones del Action Registry desde el modelo.

Proponer no es ejecutar: la confirmación humana la exige el registry según el riesgo y la
ejecución ocurre en el dispositivo (intents oficiales) o en el servidor con verificación.
"""

from __future__ import annotations

from typing import Any

from app.actions.registry import ACTIONS
from app.models.enums import OperationClass
from app.tools.registry import ToolContext, ToolDef, ToolOutput, register


async def _propose(ctx: ToolContext, args: dict[str, Any]) -> ToolOutput:
    from app.actions.service import ActionError, propose

    key = args["action_key"]
    params = args.get("params") or {}
    if not isinstance(params, dict):
        return ToolOutput("params debe ser un objeto", is_error=True)
    try:
        a = await propose(ctx.session, ctx.user_id, key, params, summary=str(args.get("summary") or key)[:500], source="jarvis",
                          conversation_id=ctx.conversation_id)
    except ActionError as exc:
        return ToolOutput(f"No se pudo proponer la acción: {exc.message}", is_error=True)
    if a.status == "awaiting_confirmation":
        status = "Esperando confirmación del usuario en la app. No digas que ya se hizo."
    elif a.status == "ready":
        status = "Lista: la app la ejecuta ahora en el teléfono. No afirmes el resultado hasta que se informe."
    elif a.status == "completed":
        status = f"Ejecutada y verificada en el servidor: {a.result}"
    else:
        status = f"Estado {a.status}: {a.error or ''}"
    return ToolOutput(f"Acción {a.id} ({key}). {status}", data={"action_id": str(a.id), "status": a.status})


register(ToolDef(
    key="actions.propose", name="Proponer acción", category="acciones", operation_class=OperationClass.CREATION,
    description=("Propone una acción del registro de NEXUS (teléfono, WhatsApp, agenda, recordatorios, memoria, misiones, rutinas). "
                 "La app pide confirmación cuando el riesgo lo exige. Acciones: "
                 + "; ".join(f"{a.key}: {a.name} (params {', '.join(a.params)})" for a in ACTIONS.values())),
    parameters={"type": "object", "properties": {
        "action_key": {"type": "string", "enum": sorted(ACTIONS)},
        "params": {"type": "object"},
        "summary": {"type": "string", "maxLength": 500},
    }, "required": ["action_key", "params", "summary"]},
    handler=_propose, side_effects=True,
))
