from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import Boolean, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, Timestamps, uuid_pk


class AIProvider(Base, Timestamps):
    __tablename__ = "ai_providers"
    __table_args__ = (Index("ix_ai_providers_user", "user_id"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    base_url: Mapped[str | None] = mapped_column(String(500))
    # Cifrado con Fernet; nunca se devuelve al cliente ni se pasa a los agentes.
    api_key_encrypted: Mapped[str | None] = mapped_column(Text)
    api_key_hint: Mapped[str | None] = mapped_column(String(20))
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="unknown", nullable=False)  # unknown|ok|error
    last_checked_at: Mapped[datetime | None]
    last_error: Mapped[str | None] = mapped_column(Text)
    known_limits: Mapped[dict[str, Any]] = mapped_column(default=dict, nullable=False)
    max_concurrency: Mapped[int] = mapped_column(Integer, default=4, nullable=False)


class AIModel(Base, Timestamps):
    __tablename__ = "ai_models"
    __table_args__ = (UniqueConstraint("provider_id", "model_name", name="uq_ai_models_provider_name"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    provider_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ai_providers.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    model_name: Mapped[str] = mapped_column(String(160), nullable=False)
    display_name: Mapped[str] = mapped_column(String(160), nullable=False)
    capabilities: Mapped[list[Any]] = mapped_column(default=list, nullable=False)
    context_window: Mapped[int] = mapped_column(Integer, default=128_000, nullable=False)
    max_output_tokens: Mapped[int] = mapped_column(Integer, default=8192, nullable=False)
    # Precios en USD por millón de tokens. None = desconocido (el costo no se puede estimar).
    input_price_per_mtok: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    output_price_per_mtok: Mapped[Decimal | None] = mapped_column(Numeric(12, 4))
    quality_tier: Mapped[int] = mapped_column(Integer, default=3, nullable=False)  # 1 (básico) .. 5 (máximo)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_embedding_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
