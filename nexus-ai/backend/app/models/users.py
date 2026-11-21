from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, Timestamps, uuid_pk


class User(Base, Timestamps):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_login_at: Mapped[datetime | None]


class RefreshToken(Base, CreatedAt):
    """Refresh tokens opacos con rotación por familia. Si se reutiliza un token ya
    rotado, se revoca toda la familia (detección de robo)."""

    __tablename__ = "refresh_tokens"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    family_id: Mapped[uuid.UUID] = mapped_column(nullable=False, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(nullable=False)
    revoked_at: Mapped[datetime | None]
    replaced_by_id: Mapped[uuid.UUID | None]
    user_agent: Mapped[str | None] = mapped_column(String(300))
    ip: Mapped[str | None] = mapped_column(String(64))


class UserSettings(Base, Timestamps):
    __tablename__ = "user_settings"

    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    autonomy_mode: Mapped[str] = mapped_column(String(20), default="supervised", nullable=False)
    emergency_stop: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    emergency_stop_at: Mapped[datetime | None]
    emergency_stop_reason: Mapped[str | None] = mapped_column(Text)

    daily_budget_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    monthly_budget_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    default_mission_budget_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    # Tope duro de tokens por misión: protege incluso si un modelo no tiene precio configurado.
    max_tokens_per_mission: Mapped[int] = mapped_column(Integer, default=400_000, nullable=False)
    max_concurrent_tasks: Mapped[int] = mapped_column(Integer, default=3, nullable=False)

    language: Mapped[str] = mapped_column(String(10), default="es", nullable=False)
    notification_prefs: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    appearance: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    memory_settings: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)


class DeviceToken(Base, CreatedAt):
    __tablename__ = "device_tokens"
    __table_args__ = (Index("ix_device_tokens_user", "user_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    platform: Mapped[str] = mapped_column(String(20), default="android", nullable=False)
    last_seen_at: Mapped[datetime | None]
