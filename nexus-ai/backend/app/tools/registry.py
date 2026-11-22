"""Registro de herramientas (NEXUS Tools)."""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Agent, ToolDefinition


@dataclass
class ToolContext:
    session: AsyncSession
    user_id: uuid.UUID
    agent: Agent
    autonomy_mode: str
    mission_id: uuid.UUID | None = None
    task_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    meeting_id: uuid.UUID | None = None
    conversation_id: uuid.UUID | None = None
    depth: int = 0


@dataclass
class ToolOutput:
    content: str
    data: dict[str, Any] = field(default_factory=dict)
    untrusted: bool = False  # contenido externo: se envuelve como dato, nunca como instrucción
    is_error: bool = False


Handler = Callable[[ToolContext, dict[str, Any]], Awaitable[ToolOutput]]


@dataclass
class ToolDef:
    key: str
    name: str
    description: str
    category: str
    operation_class: str
    parameters: dict[str, Any]
    handler: Handler
    requires_plugin: str | None = None
    limits: dict[str, Any] = field(default_factory=dict)
    side_effects: bool = False

    @property
    def llm_name(self) -> str:
        return llm_name(self.key)


def llm_name(key: str) -> str:
    return key.replace(".", "__")


def key_from_llm_name(name: str) -> str:
    return name.replace("__", ".")


TOOLS: dict[str, ToolDef] = {}


def register(tool: ToolDef) -> ToolDef:
    TOOLS[tool.key] = tool
    return tool


def get_tool(key: str) -> ToolDef | None:
    return TOOLS.get(key)


def validate_arguments(tool: ToolDef, args: dict[str, Any]) -> str | None:
    """Validación estricta y simple contra el esquema declarado. Devuelve el error o None."""
    schema = tool.parameters
    props: dict[str, Any] = schema.get("properties", {})
    for req in schema.get("required", []):
        if req not in args or args[req] in (None, ""):
            return f"Falta el parámetro obligatorio «{req}»"
    type_map = {"string": str, "integer": int, "number": (int, float), "boolean": bool, "array": list, "object": dict}
    for name, value in args.items():
        if name not in props:
            return f"Parámetro desconocido «{name}»"
        expected = props[name].get("type")
        if expected and value is not None:
            py = type_map.get(expected)
            if py and (not isinstance(value, py) or (expected in ("integer", "number") and isinstance(value, bool))):
                return f"El parámetro «{name}» debe ser {expected}"
        enum = props[name].get("enum")
        if enum and value not in enum:
            return f"El parámetro «{name}» debe ser uno de: {', '.join(map(str, enum))}"
        max_len = props[name].get("maxLength")
        if max_len and isinstance(value, str) and len(value) > max_len:
            return f"El parámetro «{name}» supera {max_len} caracteres"
    return None


async def sync_tool_definitions(session: AsyncSession) -> None:
    """Sincroniza el catálogo en base con el registro en código.

    Upsert atómico (INSERT ... ON CONFLICT DO UPDATE): varios procesos de la API y workers
    pueden arrancar a la vez sin chocar por la clave única. `is_enabled` (decisión del
    administrador) no se pisa.
    """
    from sqlalchemy.dialects.postgresql import insert

    from app.tools import builtin  # noqa: F401  registra las herramientas

    for tool in TOOLS.values():
        values = {"key": tool.key, "name": tool.name, "description": tool.description, "category": tool.category,
                  "operation_class": str(tool.operation_class), "parameters_schema": tool.parameters,
                  "requires_plugin": tool.requires_plugin, "limits": tool.limits}
        stmt = insert(ToolDefinition).values(id=uuid.uuid4(), is_enabled=True, **values)
        stmt = stmt.on_conflict_do_update(index_elements=["key"], set_={k: v for k, v in values.items() if k != "key"})
        await session.execute(stmt)
