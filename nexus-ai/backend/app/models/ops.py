"""Herramientas, plugins, notificaciones, auditoría, consumo, cola y programación."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, Timestamps, uuid_pk


class ToolDefinition(Base, Timestamps):
    """Catálogo de herramientas (sincronizado desde el registro en código al arrancar)."""

    __tablename__ = "tool_definitions"

    id: Mapped[uuid.UUID] = uuid_pk()
    key: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(40), nullable=False)
    operation_class: Mapped[str] = mapped_column(String(30), nullable=False)
    parameters_schema: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    requires_plugin: Mapped[str | None] = mapped_column(String(80))
    limits: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class ToolExecution(Base, Timestamps):
    __tablename__ = "tool_executions"
    __table_args__ = (
        Index("ix_tool_executions_user", "user_id", "created_at"),
        Index("ix_tool_executions_task", "task_id"),
        UniqueConstraint("idempotency_key", name="uq_tool_executions_idempotency"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    tool_key: Mapped[str] = mapped_column(String(80), nullable=False)
    operation_class: Mapped[str] = mapped_column(String(30), nullable=False)
    agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id", ondelete="SET NULL"))
    mission_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("missions.id", ondelete="SET NULL"))
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("mission_tasks.id", ondelete="SET NULL"))
    arguments: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    decision: Mapped[str] = mapped_column(String(20), nullable=False)  # allow | approval | deny
    decision_reason: Mapped[str | None] = mapped_column(Text)
    result: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    duration_ms: Mapped[int | None] = mapped_column(Integer)
    idempotency_key: Mapped[str | None] = mapped_column(String(128))


class Plugin(Base, Timestamps):
    __tablename__ = "plugins"
    __table_args__ = (UniqueConstraint("user_id", "key", name="uq_plugins_user_key"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    config_encrypted: Mapped[str | None] = mapped_column(Text)
    config_public: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    last_used_at: Mapped[datetime | None]


class PluginPermission(Base, Timestamps):
    __tablename__ = "plugin_permissions"
    __table_args__ = (UniqueConstraint("plugin_id", "permission", name="uq_plugin_permissions_perm"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    plugin_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("plugins.id", ondelete="CASCADE"), nullable=False, index=True)
    permission: Mapped[str] = mapped_column(String(120), nullable=False)
    granted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    granted_at: Mapped[datetime | None]
    revoked_at: Mapped[datetime | None]


class Notification(Base, CreatedAt):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notifications_user_created", "user_id", "created_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    data: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    read_at: Mapped[datetime | None]
    push_status: Mapped[str] = mapped_column(String(20), default="not_sent", nullable=False)
    deliver_at: Mapped[datetime | None]


class AuditLog(Base, CreatedAt):
    """Registro inmutable de actividad. Alimenta el Activity Center."""

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_user_created", "user_id", "created_at"),
        Index("ix_audit_logs_mission", "mission_id"),
        Index("ix_audit_logs_agent", "agent_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    actor_type: Mapped[str] = mapped_column(String(10), nullable=False)  # user | agent | system
    agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(40))
    target_id: Mapped[uuid.UUID | None]
    mission_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("missions.id", ondelete="SET NULL"))
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="SET NULL"))
    outcome: Mapped[str] = mapped_column(String(20), default="success", nullable=False)  # success|failure|blocked|info
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    model_used: Mapped[str | None] = mapped_column(String(200))
    tokens: Mapped[int | None] = mapped_column(Integer)
    cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 6))


class UsageRecord(Base, CreatedAt):
    __tablename__ = "usage_records"
    __table_args__ = (
        Index("ix_usage_records_user_created", "user_id", "created_at"),
        Index("ix_usage_records_mission", "mission_id"),
        Index("ix_usage_records_agent", "agent_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id", ondelete="SET NULL"))
    mission_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("missions.id", ondelete="SET NULL"))
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("mission_tasks.id", ondelete="SET NULL"))
    meeting_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("meetings.id", ondelete="SET NULL"))
    provider_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ai_providers.id", ondelete="SET NULL"))
    model_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ai_models.id", ondelete="SET NULL"))
    provider_kind: Mapped[str] = mapped_column(String(30), nullable=False)
    model_name: Mapped[str] = mapped_column(String(200), nullable=False)
    purpose: Mapped[str] = mapped_column(String(40), nullable=False)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cost_estimated_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 6))
    cost_confirmed_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 6))
    latency_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    success: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    meta: Mapped[dict[str, Any]] = mapped_column("metadata", default=dict, nullable=False)


class Job(Base, Timestamps):
    """Cola durable en PostgreSQL. Los workers reclaman trabajos con
    FOR UPDATE SKIP LOCKED y un lease con vencimiento; si un worker muere, el lease
    vence y otro worker lo recupera. Los handlers son idempotentes respecto del estado."""

    __tablename__ = "jobs"
    __table_args__ = (
        Index("ix_jobs_claim", "status", "run_after", "priority"),
        Index("ix_jobs_user", "user_id"),
        # Como máximo un trabajo ACTIVO por clave lógica: evita duplicados concurrentes y permite
        # volver a encolar (p.ej. al reanudar una misión) cuando el anterior ya terminó.
        Index("uq_jobs_active_idempotency", "idempotency_key", unique=True,
              postgresql_where=text("status IN ('queued', 'running')")),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(40), nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="queued", nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=5, nullable=False)  # menor = antes
    run_after: Mapped[datetime] = mapped_column(nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    lease_owner: Mapped[str | None] = mapped_column(String(120))
    lease_expires_at: Mapped[datetime | None]
    idempotency_key: Mapped[str | None] = mapped_column(String(200))
    last_error: Mapped[str | None] = mapped_column(Text)
    finished_at: Mapped[datetime | None]


class ScheduledJob(Base, Timestamps):
    __tablename__ = "scheduled_jobs"
    __table_args__ = (Index("ix_scheduled_jobs_due", "is_enabled", "next_run_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)  # mission | meeting | reminder
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    cron: Mapped[str | None] = mapped_column(String(120))
    run_once_at: Mapped[datetime | None]
    timezone: Mapped[str] = mapped_column(String(60), default="UTC", nullable=False)
    payload: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    next_run_at: Mapped[datetime | None]
    last_run_at: Mapped[datetime | None]
    last_status: Mapped[str | None] = mapped_column(String(20))
    run_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by_agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id", ondelete="SET NULL"))


class ModelEvalRun(Base, Timestamps):
    __tablename__ = "model_eval_runs"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    model_ids: Mapped[list[Any]] = mapped_column(default=list, nullable=False)
    judge_model_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ai_models.id", ondelete="SET NULL"))
    cases: Mapped[list[Any]] = mapped_column(default=list, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="queued", nullable=False)
    summary: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)


class ModelEvalResult(Base, CreatedAt):
    __tablename__ = "model_eval_results"
    __table_args__ = (UniqueConstraint("run_id", "model_id", "case_index", name="uq_model_eval_results_case"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("model_eval_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    model_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ai_models.id", ondelete="CASCADE"), nullable=False)
    case_index: Mapped[int] = mapped_column(Integer, nullable=False)
    output: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 6))
    scores: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)  # quality, accuracy, instruction_following
    judge_notes: Mapped[str | None] = mapped_column(Text)
    overall: Mapped[float | None] = mapped_column(Float)
