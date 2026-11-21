from __future__ import annotations

import re
import uuid

from fastapi import APIRouter, Depends, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.bootstrap import create_agent_from_seed
from app.agents.defaults import AgentSeed
from app.agents.persona import GENERIC_PERSONA, PersonaError, persona_catalog, validate_appearance, validate_traits, validate_voice
from app.agents.runtime import active_instructions
from app.api.schemas import (
    AgentCreate,
    AgentDetailOut,
    AgentModelRef,
    AgentModelsIn,
    AgentOut,
    AgentPermissionOut,
    AgentUpdate,
    ConversationOut,
    PermissionIn,
    TaskOut,
)
from app.auth.deps import CurrentUser, current_user
from app.core import events
from app.core.db import get_session
from app.core.errors import Conflict, Forbidden, NexusError, NotFound
from app.models import (
    Agent,
    AgentInstruction,
    AgentModel,
    AgentPermission,
    AIModel,
    AIProvider,
    Conversation,
    MissionTask,
    UsageRecord,
)
from app.monitoring.audit import record_audit
from app.tools.registry import TOOLS

router = APIRouter(prefix="/agents", tags=["agents"])


async def owned_agent(session: AsyncSession, user_id: uuid.UUID, agent_id: uuid.UUID) -> Agent:
    agent = await session.get(Agent, agent_id)
    if agent is None or agent.user_id != user_id:
        raise NotFound("Agente no encontrado")
    return agent


async def agent_detail(session: AsyncSession, agent: Agent) -> AgentDetailOut:
    instr = await session.scalar(
        select(AgentInstruction).where(AgentInstruction.agent_id == agent.id, AgentInstruction.is_active.is_(True))
        .order_by(AgentInstruction.version.desc())
    )
    models = (
        await session.execute(
            select(AgentModel, AIModel, AIProvider).join(AIModel, AIModel.id == AgentModel.model_id)
            .join(AIProvider, AIProvider.id == AIModel.provider_id).where(AgentModel.agent_id == agent.id)
            .order_by(AgentModel.priority)
        )
    ).all()
    perms = (await session.scalars(select(AgentPermission).where(AgentPermission.agent_id == agent.id).order_by(AgentPermission.tool_key))).all()
    counts = dict((await session.execute(
        select(MissionTask.status, func.count()).where(MissionTask.agent_id == agent.id).group_by(MissionTask.status)
    )).all())
    usage = (await session.execute(
        select(func.coalesce(func.sum(UsageRecord.tokens_in + UsageRecord.tokens_out), 0),
               func.coalesce(func.sum(UsageRecord.cost_estimated_usd), 0), func.count())
        .where(UsageRecord.agent_id == agent.id, UsageRecord.success.is_(True))
    )).one()
    base = AgentOut.model_validate(agent).model_dump()
    return AgentDetailOut(
        **base,
        instructions=instr.content if instr else "",
        instructions_version=instr.version if instr else 0,
        models=[AgentModelRef(model_id=m.id, priority=am.priority, model_name=m.model_name, provider_kind=p.kind) for am, m, p in models],
        permissions=[AgentPermissionOut.model_validate(p) for p in perms],
        stats={
            "tasks_by_status": counts,
            "tasks_completed": counts.get("completed", 0),
            "tasks_failed": counts.get("failed", 0),
            "llm_calls": usage[2],
            "tokens": int(usage[0]),
            "cost_usd": str(usage[1]),
        },
    )


def _persona(traits: dict | None, appearance: dict | None, voice: dict | None, base: dict) -> dict:
    try:
        return {
            "traits": validate_traits(traits) if traits is not None else base["traits"],
            "appearance": {**base["appearance"], **validate_appearance(appearance)} if appearance is not None else base["appearance"],
            "voice": {**base["voice"], **validate_voice(voice)} if voice is not None else base["voice"],
        }
    except PersonaError as exc:
        raise NexusError(str(exc), code="invalid_persona") from exc


@router.get("/persona-catalog")
async def get_persona_catalog(_: CurrentUser = Depends(current_user)) -> dict:
    """Opciones disponibles para el editor de personajes (rasgos, apariencia, voz)."""
    return persona_catalog()


@router.get("", response_model=list[AgentOut])
async def list_agents(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[AgentOut]:
    agents = (await session.scalars(select(Agent).where(Agent.user_id == cu.id).order_by(Agent.is_system.desc(), Agent.created_at))).all()
    primary = {
        agent_id: name
        for agent_id, name in (await session.execute(
            select(AgentModel.agent_id, AIModel.display_name).join(AIModel, AIModel.id == AgentModel.model_id)
            .where(AgentModel.priority == 0, AgentModel.agent_id.in_([a.id for a in agents]))
        )).all()
    } if agents else {}
    default = await session.scalar(select(AIModel.display_name).where(AIModel.user_id == cu.id, AIModel.is_default.is_(True)))
    out = []
    for a in agents:
        item = AgentOut.model_validate(a)
        # Sin asignación explícita, el router usa el modelo predeterminado (u otro compatible).
        item.primary_model = primary.get(a.id) or (f"auto · {default}" if default else None)
        out.append(item)
    return out


@router.post("", response_model=AgentDetailOut, status_code=status.HTTP_201_CREATED)
async def create_agent(body: AgentCreate, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> AgentDetailOut:
    slug = body.slug or re.sub(r"[^a-z0-9]+", "-", body.name.lower()).strip("-")[:40] or f"agent-{uuid.uuid4().hex[:6]}"
    if await session.scalar(select(Agent.id).where(Agent.user_id == cu.id, Agent.slug == slug)):
        raise Conflict(f"Ya existe un agente con el identificador «{slug}»")
    unknown = [t for t in body.tools if t not in TOOLS]
    if unknown:
        raise NexusError(f"Herramientas desconocidas: {', '.join(unknown)}")
    seed = AgentSeed(
        slug=slug, name=body.name, role=body.role, avatar=body.avatar, color=body.color, description=body.description,
        personality=body.personality, specialties=body.specialties, communication_style=body.communication_style,
        work_criteria=body.work_criteria, instructions=body.instructions, tools=body.tools,
        reasoning_level=body.reasoning_level, temperature=body.temperature,
    )
    persona = _persona(body.traits, body.appearance, body.voice, GENERIC_PERSONA)
    agent = await create_agent_from_seed(session, cu.user, seed, is_system=False, persona=persona)
    agent.memory_enabled = body.memory_enabled
    agent.participates_in_meetings = body.participates_in_meetings
    agent.autonomy_level = body.autonomy_level
    agent.daily_budget_usd = body.daily_budget_usd
    await _set_models(session, cu.id, agent, body.model_ids)
    await record_audit(session, cu.id, "agent.created", f"Agente creado: {agent.name}", actor_type="user",
                       target_type="agent", target_id=agent.id)
    await session.commit()
    await session.refresh(agent)
    return await agent_detail(session, agent)


@router.get("/{agent_id}", response_model=AgentDetailOut)
async def get_agent(agent_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> AgentDetailOut:
    return await agent_detail(session, await owned_agent(session, cu.id, agent_id))


@router.patch("/{agent_id}", response_model=AgentDetailOut)
async def update_agent(agent_id: uuid.UUID, body: AgentUpdate, cu: CurrentUser = Depends(current_user),
                       session: AsyncSession = Depends(get_session)) -> AgentDetailOut:
    agent = await owned_agent(session, cu.id, agent_id)
    data = body.model_dump(exclude_unset=True)
    for field in ("name", "role", "memory_enabled", "participates_in_meetings", "is_enabled", "autonomy_level", "daily_budget_usd"):
        if field in data and data[field] is not None:
            setattr(agent, field, data[field])
    if body.clear_daily_budget:
        agent.daily_budget_usd = None
    if agent.slug == "nexus" and data.get("is_enabled") is False:
        raise Forbidden("NEXUS coordina el equipo y no puede deshabilitarse")
    profile = agent.profile
    for field in ("description", "personality", "specialties", "communication_style", "work_criteria", "avatar", "color",
                  "temperature", "reasoning_level"):  # traits/appearance/voice se validan aparte
        if field in data and data[field] is not None:
            setattr(profile, field, data[field])
    if body.clear_temperature:
        profile.temperature = None
    if body.traits is not None or body.appearance is not None or body.voice is not None:
        persona = _persona(body.traits, body.appearance, body.voice,
                           {"traits": profile.traits, "appearance": profile.appearance, "voice": profile.voice})
        profile.traits, profile.appearance, profile.voice = persona["traits"], persona["appearance"], persona["voice"]
    if body.instructions is not None and body.instructions.strip() != (await active_instructions(session, agent.id)).strip():
        current = await session.scalar(select(func.max(AgentInstruction.version)).where(AgentInstruction.agent_id == agent.id)) or 0
        await session.execute(
            AgentInstruction.__table__.update().where(AgentInstruction.agent_id == agent.id).values(is_active=False)
        )
        session.add(AgentInstruction(agent_id=agent.id, version=current + 1, content=body.instructions, is_active=True))
    await record_audit(session, cu.id, "agent.updated", f"Agente actualizado: {agent.name}", actor_type="user",
                       target_type="agent", target_id=agent.id, details={"fields": sorted(data)})
    await session.commit()
    await events.publish(cu.id, "agent.updated", {"agent_id": str(agent.id)})
    return await agent_detail(session, agent)


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agent(agent_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> None:
    agent = await owned_agent(session, cu.id, agent_id)
    if agent.is_system:
        raise Forbidden("Los agentes del equipo inicial no se eliminan; podés deshabilitarlos")
    await record_audit(session, cu.id, "agent.deleted", f"Agente eliminado: {agent.name}", actor_type="user",
                       target_type="agent", target_id=agent.id)
    await session.delete(agent)
    await session.commit()


@router.get("/{agent_id}/instructions")
async def instruction_versions(agent_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[dict]:
    await owned_agent(session, cu.id, agent_id)
    rows = (await session.scalars(select(AgentInstruction).where(AgentInstruction.agent_id == agent_id).order_by(AgentInstruction.version.desc()))).all()
    return [{"version": r.version, "content": r.content, "is_active": r.is_active, "created_at": r.created_at} for r in rows]


@router.put("/{agent_id}/permissions", response_model=list[AgentPermissionOut])
async def set_permissions(agent_id: uuid.UUID, body: list[PermissionIn], cu: CurrentUser = Depends(current_user),
                          session: AsyncSession = Depends(get_session)) -> list[AgentPermission]:
    """Reemplaza los permisos del agente. Solo el usuario autenticado puede hacerlo: ninguna
    herramienta de agente escribe permisos."""
    agent = await owned_agent(session, cu.id, agent_id)
    unknown = [p.tool_key for p in body if p.tool_key not in TOOLS]
    if unknown:
        raise NexusError(f"Herramientas desconocidas: {', '.join(unknown)}")
    await session.execute(delete(AgentPermission).where(AgentPermission.agent_id == agent.id))
    for p in body:
        session.add(AgentPermission(agent_id=agent.id, tool_key=p.tool_key, allowed=p.allowed, mode=p.mode, expires_at=p.expires_at))
    await record_audit(session, cu.id, "agent.permissions_changed", f"Permisos de {agent.name} actualizados", actor_type="user",
                       target_type="agent", target_id=agent.id, details={"permissions": [p.model_dump(mode="json") for p in body]})
    await session.commit()
    return list((await session.scalars(select(AgentPermission).where(AgentPermission.agent_id == agent.id))).all())


async def _set_models(session: AsyncSession, user_id: uuid.UUID, agent: Agent, model_ids: list[uuid.UUID]) -> None:
    await session.execute(delete(AgentModel).where(AgentModel.agent_id == agent.id))
    for priority, model_id in enumerate(dict.fromkeys(model_ids)):
        model = await session.get(AIModel, model_id)
        if model is None or model.user_id != user_id:
            raise NotFound("Modelo no encontrado")
        session.add(AgentModel(agent_id=agent.id, model_id=model_id, priority=priority))


@router.put("/{agent_id}/models", response_model=AgentDetailOut)
async def set_models(agent_id: uuid.UUID, body: AgentModelsIn, cu: CurrentUser = Depends(current_user),
                     session: AsyncSession = Depends(get_session)) -> AgentDetailOut:
    agent = await owned_agent(session, cu.id, agent_id)
    await _set_models(session, cu.id, agent, body.model_ids)
    await record_audit(session, cu.id, "agent.models_changed", f"Modelos de {agent.name} actualizados", actor_type="user",
                       target_type="agent", target_id=agent.id)
    await session.commit()
    return await agent_detail(session, agent)


@router.get("/{agent_id}/tasks", response_model=list[TaskOut])
async def agent_tasks(agent_id: uuid.UUID, limit: int = 50, cu: CurrentUser = Depends(current_user),
                      session: AsyncSession = Depends(get_session)) -> list[MissionTask]:
    await owned_agent(session, cu.id, agent_id)
    return list((await session.scalars(
        select(MissionTask).where(MissionTask.agent_id == agent_id).order_by(MissionTask.created_at.desc()).limit(min(limit, 200))
    )).all())


@router.post("/{agent_id}/conversation", response_model=ConversationOut)
async def open_conversation(agent_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> Conversation:
    agent = await owned_agent(session, cu.id, agent_id)
    conv = await session.scalar(
        select(Conversation).where(Conversation.user_id == cu.id, Conversation.agent_id == agent.id).order_by(Conversation.updated_at.desc())
    )
    if conv is None:
        conv = Conversation(user_id=cu.id, agent_id=agent.id, title=f"Conversación con {agent.name}")
        session.add(conv)
        await session.commit()
    return conv
