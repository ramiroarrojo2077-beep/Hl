"""Modelos de NEXUS 2.0: acciones, automatizaciones, WhatsApp Business y diagnóstico."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, Timestamps, uuid_pk


class ActionRequest(Base, Timestamps):
    """Una acción pedida por el usuario o propuesta por NEXUS. Las acciones de dispositivo
    (abrir WhatsApp, abrir una app, mapas...) las ejecuta la app Android y reporta el
    resultado; las de servidor (recordatorio, memoria, misión...) las ejecuta el backend."""

    __tablename__ = "action_requests"
    __table_args__ = (Index("ix_action_requests_user_status", "user_id", "status"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("conversations.id", ondelete="SET NULL"))
    action_key: Mapped[str] = mapped_column(String(60), nullable=False)
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    executor: Mapped[str] = mapped_column(String(10), nullable=False)  # server | device
    params: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(30), default="awaiting_confirmation", nullable=False)
    # Estado fino informado por el dispositivo (p. ej. WHATSAPP_OPENED). Nunca se asume un envío.
    state_detail: Mapped[str | None] = mapped_column(String(40))
    requires_confirmation: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    result: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(20), default="jarvis", nullable=False)  # jarvis | user | automation
    confirmed_at: Mapped[datetime | None]
    completed_at: Mapped[datetime | None]
    expires_at: Mapped[datetime | None]


class Automation(Base, Timestamps):
    __tablename__ = "automations"
    __table_args__ = (Index("ix_automations_due", "status", "next_run_at"), Index("ix_automations_event", "user_id", "event_type"))

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str] = mapped_column(Text, default="", nullable=False)
    trigger_type: Mapped[str] = mapped_column(String(20), nullable=False)  # schedule | event
    cron: Mapped[str | None] = mapped_column(String(120))
    run_at: Mapped[datetime | None]
    timezone: Mapped[str] = mapped_column(String(60), default="UTC", nullable=False)
    event_type: Mapped[str | None] = mapped_column(String(60))
    conditions: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    actions: Mapped[list[Any]] = mapped_column(default=list, nullable=False)
    max_runs_per_day: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    max_total_runs: Mapped[int | None] = mapped_column(Integer)
    cooldown_seconds: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    # awaiting_approval (propuesta por NEXUS) | active | paused | exhausted
    status: Mapped[str] = mapped_column(String(20), default="awaiting_approval", nullable=False)
    paused_by_stop: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    next_run_at: Mapped[datetime | None]
    last_run_at: Mapped[datetime | None]
    last_status: Mapped[str | None] = mapped_column(String(40))
    run_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_by: Mapped[str] = mapped_column(String(20), default="user", nullable=False)


class AutomationRun(Base, CreatedAt):
    __tablename__ = "automation_runs"

    id: Mapped[uuid.UUID] = uuid_pk()
    automation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("automations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    trigger: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="running", nullable=False)
    result: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    finished_at: Mapped[datetime | None]


class BusinessMessage(Base, Timestamps):
    """Mensaje enviado por WhatsApp Business Platform (API oficial). Los estados provienen
    exclusivamente de la respuesta de la API y de sus webhooks."""

    __tablename__ = "business_messages"
    __table_args__ = (Index("ix_business_messages_wa", "wa_message_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    action_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("action_requests.id", ondelete="SET NULL"))
    direction: Mapped[str] = mapped_column(String(10), default="outbound", nullable=False)  # outbound | inbound
    # HMAC del número (permite verificar la ventana de 24 h sin guardar el número en claro).
    to_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    to_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    to_masked: Mapped[str] = mapped_column(String(32), nullable=False)
    opt_in_confirmed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    kind: Mapped[str] = mapped_column(String(20), default="text", nullable=False)  # text | template | inbound
    body: Mapped[str | None] = mapped_column(Text)
    template: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    wa_message_id: Mapped[str | None] = mapped_column(String(200))
    status: Mapped[str] = mapped_column(String(20), default="queued", nullable=False)  # queued|accepted|sent|delivered|read|failed
    status_history: Mapped[list[Any]] = mapped_column(default=list, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)


class ModelQualityScore(Base, CreatedAt):
    """Puntaje de calidad por tarea (no por longitud). Alimenta al router."""

    __tablename__ = "model_quality_scores"
    __table_args__ = (Index("ix_model_quality_model_task", "model_id", "task_type", "created_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    model_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("ai_models.id", ondelete="CASCADE"))
    model_label: Mapped[str | None] = mapped_column(String(200))
    task_type: Mapped[str] = mapped_column(String(30), nullable=False)
    source: Mapped[str] = mapped_column(String(30), nullable=False)  # review | deterministic | user_feedback | eval
    mission_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("missions.id", ondelete="SET NULL"))
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("mission_tasks.id", ondelete="SET NULL"))
    message_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agent_messages.id", ondelete="SET NULL"))
    # precision, completeness, instruction_following, consistency, verifiability, format, errors (0-10)
    criteria: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    overall: Mapped[float] = mapped_column(Float, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)


class CrashReport(Base, CreatedAt):
    __tablename__ = "crash_reports"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    app_version: Mapped[str] = mapped_column(String(40), nullable=False)
    device: Mapped[str] = mapped_column(String(120), nullable=False)
    stacktrace: Mapped[str] = mapped_column(Text, nullable=False)
