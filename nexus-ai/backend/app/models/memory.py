from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pgvector.sqlalchemy import Vector
from sqlalchemy import Computed, Float, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedAt, Timestamps, uuid_pk

EMBEDDING_DIM = 768


class MemoryItem(Base, Timestamps):
    __tablename__ = "memory_items"
    __table_args__ = (
        Index("ix_memory_items_user_scope", "user_id", "scope"),
        Index("ix_memory_items_agent", "agent_id"),
        Index("ix_memory_items_project", "project_id"),
        Index("ix_memory_items_search", "search_vector", postgresql_using="gin"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    scope: Mapped[str] = mapped_column(String(20), nullable=False)  # agent | shared | user | project
    kind: Mapped[str] = mapped_column(String(20), default="fact", nullable=False)
    agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id", ondelete="CASCADE"))
    project_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    mission_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("missions.id", ondelete="SET NULL"))
    project_file_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("project_files.id", ondelete="CASCADE"))
    created_by_agent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("agents.id", ondelete="SET NULL"))
    title: Mapped[str | None] = mapped_column(String(300))
    content: Mapped[str] = mapped_column(Text, nullable=False)
    source: Mapped[str] = mapped_column(String(40), default="agent", nullable=False)  # user|agent|document|web|mission
    source_ref: Mapped[str | None] = mapped_column(Text)  # URL, nombre de archivo, id de tarea...
    source_date: Mapped[datetime | None]
    confidence: Mapped[float] = mapped_column(Float, default=0.5, nullable=False)
    verification_status: Mapped[str] = mapped_column(String(20), default="unverified", nullable=False)
    expires_at: Mapped[datetime | None]
    meta: Mapped[dict[str, Any]] = mapped_column("metadata", default=dict, nullable=False)
    search_vector: Mapped[Any] = mapped_column(
        TSVECTOR,
        Computed("to_tsvector('simple', coalesce(title, '') || ' ' || content)", persisted=True),
    )


class MemoryEmbedding(Base, CreatedAt):
    __tablename__ = "memory_embeddings"
    __table_args__ = (
        Index(
            "ix_memory_embeddings_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_with={"m": 16, "ef_construction": 64},
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )

    memory_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("memory_items.id", ondelete="CASCADE"), primary_key=True)
    embedding_model: Mapped[str] = mapped_column(String(200), primary_key=True)
    embedding: Mapped[Any] = mapped_column(Vector(EMBEDDING_DIM), nullable=False)
