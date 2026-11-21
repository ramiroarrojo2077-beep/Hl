from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, Timestamps, uuid_pk


class Mission(Base, Timestamps):
    __tablename__ = "missions"
    __table_args__ = (Index("ix_missions_user_status", "user_id", "status"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"))
    scheduled_job_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("scheduled_jobs.id", ondelete="SET NULL"))
    source_meeting_id: Mapped[uuid.UUID | None]
    automation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("automations.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    objective: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="planning", nullable=False)
    status_reason: Mapped[str | None] = mapped_column(Text)
    priority: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    autonomy_mode: Mapped[str] = mapped_column(String(20), default="supervised", nullable=False)
    budget_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    spent_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal(0), nullable=False)
    tokens_used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # Plan generado por NEXUS: análisis, complejidad, necesidad de investigación.
    plan: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    review: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    security_review: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    review_round: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    result: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[datetime | None]
    completed_at: Mapped[datetime | None]


class MissionTask(Base, Timestamps):
    __tablename__ = "mission_tasks"
    __table_args__ = (
        UniqueConstraint("mission_id", "key", name="uq_mission_tasks_key"),
        Index("ix_mission_tasks_mission_status", "mission_id", "status"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    mission_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("missions.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    task_type: Mapped[str] = mapped_column(String(20), default="general", nullable=False)
    agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    requires_approval: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    approved_at: Mapped[datetime | None]
    revision_of_id: Mapped[uuid.UUID | None]
    result: Mapped[str | None] = mapped_column(Text)
    result_data: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    model_used: Mapped[str | None] = mapped_column(String(200))
    estimated_cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 6))
    actual_cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal(0), nullable=False)
    tokens_used: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    started_at: Mapped[datetime | None]
    completed_at: Mapped[datetime | None]
    duration_ms: Mapped[int | None] = mapped_column(Integer)


class TaskDependency(Base):
    __tablename__ = "task_dependencies"

    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mission_tasks.id", ondelete="CASCADE"), primary_key=True)
    depends_on_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mission_tasks.id", ondelete="CASCADE"), primary_key=True)


class TaskAttempt(Base, CreatedAt):
    __tablename__ = "task_attempts"
    __table_args__ = (UniqueConstraint("task_id", "attempt_number", name="uq_task_attempts_number"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("mission_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    attempt_number: Mapped[int] = mapped_column(Integer, nullable=False)
    worker_id: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="running", nullable=False)
    started_at: Mapped[datetime] = mapped_column(nullable=False)
    finished_at: Mapped[datetime | None]
    output: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    model_used: Mapped[str | None] = mapped_column(String(200))
    tokens_in: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cost_usd: Mapped[Decimal] = mapped_column(Numeric(12, 6), default=Decimal(0), nullable=False)
    steps: Mapped[list[Any]] = mapped_column(default=list, nullable=False)


class ApprovalRequest(Base, Timestamps):
    __tablename__ = "approval_requests"
    __table_args__ = (Index("ix_approval_requests_user_status", "user_id", "status"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # mission_plan | task | tool
    mission_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("missions.id", ondelete="CASCADE"))
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("mission_tasks.id", ondelete="CASCADE"))
    tool_execution_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tool_executions.id", ondelete="CASCADE"))
    agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id", ondelete="SET NULL"))
    operation_class: Mapped[str | None] = mapped_column(String(30))
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    details: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    decided_at: Mapped[datetime | None]
    decision_note: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime | None]
