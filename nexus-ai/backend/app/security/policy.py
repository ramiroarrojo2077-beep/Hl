"""Motor de políticas de seguridad (la parte determinista de GUARDIAN).

Toda llamada a herramienta pasa por `evaluate`. Las reglas dependen de: STOP ALL,
permisos del agente (que solo el usuario puede cambiar), plugins habilitados, clase de
operación y modo de autonomía. Los agentes no pueden alterar estas reglas.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from sqlalchemy import select

from app.models import AgentPermission, Plugin, PluginPermission, ToolDefinition, UserSettings
from app.models.enums import AutonomyMode, OperationClass
from app.tools.registry import ToolContext, ToolDef

Outcome = Literal["allow", "approval", "deny"]


@dataclass
class Decision:
    outcome: Outcome
    reason: str


OPERATION_LABELS = {
    OperationClass.READ: "lectura",
    OperationClass.ANALYSIS: "análisis",
    OperationClass.CREATION: "creación",
    OperationClass.MODIFICATION: "modificación",
    OperationClass.EXTERNAL_COMMUNICATION: "comunicación externa",
    OperationClass.IRREVERSIBLE: "operación irreversible",
    OperationClass.ACCOUNT_ADMIN: "administración de cuenta",
}


def class_rule(op: str, mode: str, permission_mode: str) -> Decision:
    """Regla por clase de operación y modo de autonomía."""
    label = OPERATION_LABELS.get(op, op)
    if op in (OperationClass.READ, OperationClass.ANALYSIS, OperationClass.CREATION):
        return Decision("allow", f"{label}: permitida automáticamente")
    if op == OperationClass.ACCOUNT_ADMIN:
        return Decision("deny", "Los agentes no pueden administrar la cuenta ni sus permisos")
    if op == OperationClass.IRREVERSIBLE:
        return Decision("approval", "Operación irreversible: requiere confirmación explícita del usuario")
    if mode == AutonomyMode.MANUAL:
        return Decision("approval", f"Modo manual: toda {label} requiere aprobación")
    if permission_mode == "approval":
        return Decision("approval", f"El permiso de esta herramienta exige aprobación para {label}")
    if op == OperationClass.MODIFICATION:
        return Decision("allow", "Modificación autorizada por permiso específico del agente")
    if op == OperationClass.EXTERNAL_COMMUNICATION:
        if mode == AutonomyMode.SCHEDULED:
            return Decision("allow", "Autonomía programada: comunicación externa preautorizada")
        return Decision("approval", "Comunicación externa: requiere autorización en modo supervisado")
    return Decision("approval", f"Clase de operación desconocida ({op}): se pide aprobación")


async def evaluate(ctx: ToolContext, tool: ToolDef) -> Decision:
    session = ctx.session
    settings = await session.get(UserSettings, ctx.user_id)
    if settings and settings.emergency_stop:
        return Decision("deny", "STOP ALL AGENTS está activo")

    definition = await session.scalar(select(ToolDefinition).where(ToolDefinition.key == tool.key))
    if definition is not None and not definition.is_enabled:
        return Decision("deny", f"La herramienta {tool.key} está deshabilitada en el servidor")

    permission = await session.scalar(
        select(AgentPermission).where(AgentPermission.agent_id == ctx.agent.id, AgentPermission.tool_key == tool.key)
    )
    if permission is None or not permission.allowed:
        return Decision("deny", f"{ctx.agent.name} no tiene permiso para usar {tool.key}")
    if permission.expires_at is not None and permission.expires_at <= datetime.now(UTC):
        return Decision("deny", f"El permiso temporal de {ctx.agent.name} para {tool.key} venció")

    if tool.requires_plugin:
        plugin = await session.scalar(select(Plugin).where(Plugin.user_id == ctx.user_id, Plugin.key == tool.requires_plugin))
        if plugin is None or not plugin.is_enabled:
            return Decision("deny", f"El plugin «{tool.requires_plugin}» no está habilitado")
        granted = await session.scalar(
            select(PluginPermission).where(
                PluginPermission.plugin_id == plugin.id,
                PluginPermission.permission == f"tool:{tool.key}",
                PluginPermission.granted.is_(True),
            )
        )
        if granted is None:
            return Decision("deny", f"El plugin «{tool.requires_plugin}» no tiene concedido el permiso tool:{tool.key}")

    return class_rule(tool.operation_class, ctx.autonomy_mode, permission.mode)
