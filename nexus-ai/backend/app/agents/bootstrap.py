"""Inicialización de la cuenta: ajustes, equipo inicial de agentes y catálogo de plugins."""

from __future__ import annotations

import copy

from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.defaults import DEFAULT_AGENTS, PLUGIN_CATALOG, AgentSeed
from app.agents.persona import DEFAULT_PERSONAS, GENERIC_PERSONA
from app.models import (
    Agent,
    AgentInstruction,
    AgentPermission,
    AgentProfile,
    Plugin,
    PluginPermission,
    User,
    UserSettings,
)

DEFAULT_NOTIFICATION_PREFS = {
    "mission_completed": True,
    "mission_blocked": True,
    "important_error": True,
    "approval_requested": True,
    "agent_needs_info": True,
    "meeting_finished": True,
    "report_ready": True,
    "budget_reached": True,
    "reminder": True,
}


async def create_agent_from_seed(
    session: AsyncSession, user: User, seed: AgentSeed, *, is_system: bool, persona: dict | None = None
) -> Agent:
    if persona is None:
        persona = DEFAULT_PERSONAS.get(seed.slug, GENERIC_PERSONA) if is_system else GENERIC_PERSONA
    persona = copy.deepcopy(persona)
    agent = Agent(
        user_id=user.id,
        slug=seed.slug,
        name=seed.name,
        role=seed.role,
        is_system=is_system,
        status="idle",
    )
    agent.profile = AgentProfile(
        avatar=seed.avatar,
        color=seed.color,
        description=seed.description,
        personality=seed.personality,
        specialties=list(seed.specialties),
        communication_style=seed.communication_style,
        work_criteria=seed.work_criteria,
        temperature=seed.temperature,
        reasoning_level=seed.reasoning_level,
        traits=persona.get("traits", {}),
        appearance=persona.get("appearance", {}),
        voice=persona.get("voice", {}),
    )
    session.add(agent)
    await session.flush()
    session.add(AgentInstruction(agent_id=agent.id, version=1, content=seed.instructions, is_active=True))
    for tool_key in seed.tools:
        session.add(
            AgentPermission(
                agent_id=agent.id,
                tool_key=tool_key,
                allowed=True,
                mode="approval" if tool_key in seed.approval_tools else "auto",
            )
        )
    return agent


async def bootstrap_user(session: AsyncSession, user: User) -> None:
    session.add(UserSettings(user_id=user.id, notification_prefs=dict(DEFAULT_NOTIFICATION_PREFS)))
    for seed in DEFAULT_AGENTS:
        await create_agent_from_seed(session, user, seed, is_system=True)
    for key, info in PLUGIN_CATALOG.items():
        plugin = Plugin(user_id=user.id, key=key, name=info["name"], is_enabled=False)
        session.add(plugin)
        await session.flush()
        for perm in info["permissions"]:
            session.add(PluginPermission(plugin_id=plugin.id, permission=perm, granted=False))
    await session.flush()
