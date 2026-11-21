from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, CreatedAt, Timestamps, uuid_pk


class Agent(Base, Timestamps):
    __tablename__ = "agents"
    __table_args__ = (
        UniqueConstraint("user_id", "slug", name="uq_agents_user_slug"),
        Index("ix_agents_user", "user_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    slug: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    role: Mapped[str] = mapped_column(String(120), nullable=False)
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    status: Mapped[str] = mapped_column(String(20), default="idle", nullable=False)
    status_detail: Mapped[str | None] = mapped_column(Text)
    current_task_id: Mapped[uuid.UUID | None]
    last_activity_at: Mapped[datetime | None]

    autonomy_level: Mapped[str] = mapped_column(String(20), default="supervised", nullable=False)
    memory_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    participates_in_meetings: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    daily_budget_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))

    profile: Mapped[AgentProfile] = relationship(back_populates="agent", uselist=False, lazy="selectin", cascade="all, delete-orphan")


class AgentProfile(Base, Timestamps):
    __tablename__ = "agent_profiles"

    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"), primary_key=True)
    avatar: Mapped[str] = mapped_column(String(60), default="orb", nullable=False)
    color: Mapped[str] = mapped_column(String(9), default="#00D9FF", nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    personality: Mapped[str] = mapped_column(Text, default="", nullable=False)
    specialties: Mapped[list[Any]] = mapped_column(default=list, nullable=False)
    communication_style: Mapped[str] = mapped_column(Text, default="", nullable=False)
    work_criteria: Mapped[str] = mapped_column(Text, default="", nullable=False)
    temperature: Mapped[float | None] = mapped_column(Float)
    reasoning_level: Mapped[str] = mapped_column(String(10), default="medium", nullable=False)  # low|medium|high
    # Personaje: rasgos (0-100) que modulan el tono en el prompt, apariencia del avatar y voz (TTS del cliente).
    traits: Mapped[dict[str, Any]] = mapped_column(default=dict, server_default="{}", nullable=False)
    appearance: Mapped[dict[str, Any]] = mapped_column(default=dict, server_default="{}", nullable=False)
    voice: Mapped[dict[str, Any]] = mapped_column(default=dict, server_default="{}", nullable=False)

    agent: Mapped[Agent] = relationship(back_populates="profile")


class AgentInstruction(Base, CreatedAt):
    """Instrucciones de sistema versionadas: cada edición crea una versión nueva."""

    __tablename__ = "agent_instructions"
    __table_args__ = (UniqueConstraint("agent_id", "version", name="uq_agent_instructions_version"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, index=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class AgentPermission(Base, Timestamps):
    """Permiso de un agente sobre una herramienta. Solo el usuario los modifica;
    los agentes no tienen ninguna herramienta que escriba en esta tabla."""

    __tablename__ = "agent_permissions"
    __table_args__ = (UniqueConstraint("agent_id", "tool_key", name="uq_agent_permissions_tool"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, index=True)
    tool_key: Mapped[str] = mapped_column(String(80), nullable=False)
    allowed: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # auto: sin aprobación (si la política global lo permite) | approval: siempre pedir
    mode: Mapped[str] = mapped_column(String(12), default="auto", nullable=False)
    expires_at: Mapped[datetime | None]


class AgentModel(Base, CreatedAt):
    """Modelos asignados a un agente, en orden de preferencia (0 = principal)."""

    __tablename__ = "agent_models"
    __table_args__ = (UniqueConstraint("agent_id", "model_id", name="uq_agent_models_pair"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"), nullable=False, index=True)
    model_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ai_models.id", ondelete="CASCADE"), nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
