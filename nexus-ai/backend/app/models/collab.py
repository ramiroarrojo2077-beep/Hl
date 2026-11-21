"""Conversaciones, mensajes entre agentes y reuniones."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, Timestamps, uuid_pk


class Conversation(Base, Timestamps):
    __tablename__ = "conversations"
    __table_args__ = (Index("ix_conversations_user", "user_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id", ondelete="SET NULL"))
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(200), default="Conversación", nullable=False)


class AgentMessage(Base, CreatedAt):
    """Mensaje real producido por un usuario o por la ejecución de un modelo.

    channel: chat | meeting | mission | direct
    """

    __tablename__ = "agent_messages"
    __table_args__ = (
        Index("ix_agent_messages_channel", "channel", "channel_id", "created_at"),
        Index("ix_agent_messages_user", "user_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    channel: Mapped[str] = mapped_column(String(20), nullable=False)
    channel_id: Mapped[uuid.UUID] = mapped_column(nullable=False)
    sender_type: Mapped[str] = mapped_column(String(10), nullable=False)  # user | agent | system
    sender_agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id", ondelete="SET NULL"))
    recipient_agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id", ondelete="SET NULL"))
    message_type: Mapped[str] = mapped_column(String(20), default="message", nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    meta: Mapped[dict[str, Any]] = mapped_column("metadata", default=dict, nullable=False)
    model_used: Mapped[str | None] = mapped_column(String(200))
    turn: Mapped[int | None] = mapped_column(Integer)


class Meeting(Base, Timestamps):
    __tablename__ = "meetings"
    __table_args__ = (Index("ix_meetings_user_status", "user_id", "status"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"))
    mission_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("missions.id", ondelete="SET NULL"))
    scheduled_job_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("scheduled_jobs.id", ondelete="SET NULL"))
    meeting_type: Mapped[str] = mapped_column(String(30), nullable=False)
    topic: Mapped[str] = mapped_column(String(300), nullable=False)
    objective: Mapped[str] = mapped_column(Text, nullable=False)
    context: Mapped[str | None] = mapped_column(Text)
    expected_outcomes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="scheduled", nullable=False)
    max_rounds: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    max_duration_seconds: Mapped[int] = mapped_column(Integer, default=900, nullable=False)
    budget_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    spent_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal(0), nullable=False)
    tokens_used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    current_round: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    stop_reason: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)
    outcome: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    started_at: Mapped[datetime | None]
    ended_at: Mapped[datetime | None]


class MeetingParticipant(Base):
    __tablename__ = "meeting_participants"

    meeting_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("meetings.id", ondelete="CASCADE"), primary_key=True)
    agent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"), primary_key=True)
    role: Mapped[str] = mapped_column(String(20), default="participant", nullable=False)  # moderator | participant
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    turns_taken: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
