"""NEXUS Memory Engine: almacenamiento, control de calidad y recuperación selectiva."""

from __future__ import annotations

import hashlib
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NexusError, NotFound
from app.memory.embeddings import LEXICAL_MODEL, embed_with_fallback, lexical_embedding
from app.memory.extract import chunk_text
from app.models import MemoryEmbedding, MemoryItem, Project, ProjectFile
from app.models.enums import MemoryKind, MemoryScope, VerificationStatus


class InvalidMemory(NexusError):
    code = "invalid_memory"


@dataclass
class MemoryHit:
    item: MemoryItem
    score: float
    matched_by: list[str]


def content_hash(text: str) -> str:
    return hashlib.sha256(" ".join(text.split()).lower().encode()).hexdigest()


async def _validate_scope(
    session: AsyncSession, user_id: uuid.UUID, scope: str, agent_id: uuid.UUID | None, project_id: uuid.UUID | None
) -> None:
    if scope not in {s.value for s in MemoryScope}:
        raise InvalidMemory(f"Ámbito de memoria inválido: {scope}")
    if scope == MemoryScope.AGENT and agent_id is None:
        raise InvalidMemory("La memoria individual requiere un agente")
    if scope == MemoryScope.PROJECT:
        if project_id is None:
            raise InvalidMemory("La memoria de proyecto requiere un proyecto")
        project = await session.get(Project, project_id)
        if project is None or project.user_id != user_id:
            raise NotFound("Proyecto no encontrado")


async def store_embeddings(session: AsyncSession, user_id: uuid.UUID, items: list[MemoryItem]) -> None:
    texts = [f"{i.title or ''}\n{i.content}" for i in items]
    for item, text in zip(items, texts):
        session.add(MemoryEmbedding(memory_id=item.id, embedding_model=LEXICAL_MODEL, embedding=lexical_embedding(text)))
    semantic = await embed_with_fallback(session, user_id, texts)
    if semantic is not None:
        label, vectors = semantic
        for item, vec in zip(items, vectors):
            session.add(MemoryEmbedding(memory_id=item.id, embedding_model=label, embedding=vec))
    await session.flush()


async def create_memory(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    scope: str,
    content: str,
    kind: str = MemoryKind.FACT,
    title: str | None = None,
    agent_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    mission_id: uuid.UUID | None = None,
    created_by_agent_id: uuid.UUID | None = None,
    source: str = "agent",
    source_ref: str | None = None,
    source_date: datetime | None = None,
    confidence: float = 0.5,
    verification_status: str = VerificationStatus.UNVERIFIED,
    expires_at: datetime | None = None,
    meta: dict[str, Any] | None = None,
    embed: bool = True,
) -> MemoryItem:
    content = content.strip()
    if len(content) < 3:
        raise InvalidMemory("El recuerdo está vacío")
    if len(content) > 20_000:
        raise InvalidMemory("El recuerdo es demasiado largo (máx. 20.000 caracteres)")
    if kind not in {k.value for k in MemoryKind}:
        raise InvalidMemory(f"Tipo de recuerdo inválido: {kind}")
    await _validate_scope(session, user_id, scope, agent_id, project_id)
    digest = content_hash(content)
    existing = await session.scalar(
        select(MemoryItem).where(
            MemoryItem.user_id == user_id,
            MemoryItem.scope == scope,
            MemoryItem.agent_id.is_(None) if agent_id is None else MemoryItem.agent_id == agent_id,
            MemoryItem.project_id.is_(None) if project_id is None else MemoryItem.project_id == project_id,
            MemoryItem.meta["content_hash"].astext == digest,
        )
    )
    if existing is not None:
        existing.confidence = max(existing.confidence, confidence)
        return existing
    item = MemoryItem(
        user_id=user_id,
        scope=scope,
        kind=kind,
        title=(title or "")[:300] or None,
        content=content,
        agent_id=agent_id,
        project_id=project_id,
        mission_id=mission_id,
        created_by_agent_id=created_by_agent_id,
        source=source,
        source_ref=source_ref,
        source_date=source_date or datetime.now(UTC),
        confidence=max(0.0, min(1.0, confidence)),
        verification_status=verification_status,
        expires_at=expires_at,
        meta={**(meta or {}), "content_hash": digest},
    )
    session.add(item)
    await session.flush()
    if embed:
        await store_embeddings(session, user_id, [item])
    return item


def _access_filter(user_id: uuid.UUID, agent_id: uuid.UUID | None, project_id: uuid.UUID | None, for_agent: bool):
    now = datetime.now(UTC)
    conditions = [
        MemoryItem.user_id == user_id,
        MemoryItem.verification_status != VerificationStatus.REJECTED,
        or_(MemoryItem.expires_at.is_(None), MemoryItem.expires_at > now),
    ]
    if for_agent:
        allowed = [MemoryItem.scope.in_([MemoryScope.SHARED, MemoryScope.USER])]
        if agent_id is not None:
            allowed.append(and_(MemoryItem.scope == MemoryScope.AGENT, MemoryItem.agent_id == agent_id))
        if project_id is not None:
            # Los proyectos no se mezclan: un agente solo ve la memoria del proyecto en curso.
            allowed.append(and_(MemoryItem.scope == MemoryScope.PROJECT, MemoryItem.project_id == project_id))
        conditions.append(or_(*allowed))
    return conditions


async def search(
    session: AsyncSession,
    user_id: uuid.UUID,
    query: str,
    *,
    agent_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    for_agent: bool = True,
    scopes: list[str] | None = None,
    kinds: list[str] | None = None,
    limit: int = 6,
) -> list[MemoryHit]:
    query = query.strip()
    if not query:
        return []
    base = _access_filter(user_id, agent_id, project_id, for_agent)
    if for_agent:
        from app.models import UserSettings

        settings = await session.get(UserSettings, user_id)
        disabled = list(((settings.privacy_settings or {}) if settings else {}).get("disabled_memory_categories") or [])
        if disabled:
            # Categorías desactivadas por el usuario: no llegan a ningún agente ni modelo.
            base.append(MemoryItem.category.not_in(disabled))
    if scopes:
        base.append(MemoryItem.scope.in_(scopes))
    if kinds:
        base.append(MemoryItem.kind.in_(kinds))
    pool = max(limit * 4, 20)
    rankings: dict[str, list[uuid.UUID]] = {}

    async def vector_rank(model_label: str, vector: list[float]) -> list[uuid.UUID]:
        distance = MemoryEmbedding.embedding.cosine_distance(vector)
        rows = await session.execute(
            select(MemoryItem.id, distance.label("d"))
            .join(MemoryEmbedding, MemoryEmbedding.memory_id == MemoryItem.id)
            .where(MemoryEmbedding.embedding_model == model_label, *base)
            .order_by(distance)
            .limit(pool)
        )
        # Se descartan coincidencias muy lejanas para no inyectar ruido en el contexto.
        return [r.id for r in rows if r.d is not None and r.d < 0.95]

    rankings["lexical"] = await vector_rank(LEXICAL_MODEL, lexical_embedding(query))
    semantic = await embed_with_fallback(session, user_id, [query])
    if semantic is not None:
        rankings["semantic"] = await vector_rank(semantic[0], semantic[1][0])

    tsquery = func.websearch_to_tsquery("simple", query)
    fts_rows = await session.execute(
        select(MemoryItem.id)
        .where(MemoryItem.search_vector.op("@@")(tsquery), *base)
        .order_by(func.ts_rank(MemoryItem.search_vector, tsquery).desc())
        .limit(pool)
    )
    rankings["fulltext"] = [r.id for r in fts_rows]

    # Fusión por Reciprocal Rank Fusion.
    scores: dict[uuid.UUID, float] = {}
    matched: dict[uuid.UUID, list[str]] = {}
    for name, ids in rankings.items():
        weight = 1.3 if name == "semantic" else 1.0
        for rank, mid in enumerate(ids):
            scores[mid] = scores.get(mid, 0.0) + weight / (60 + rank)
            matched.setdefault(mid, []).append(name)
    if not scores:
        return []
    items = {i.id: i for i in (await session.scalars(select(MemoryItem).where(MemoryItem.id.in_(list(scores))))).all()}
    hits = []
    for mid, score in scores.items():
        item = items.get(mid)
        if item is None:
            continue
        quality = 0.7 + 0.3 * item.confidence
        if item.verification_status == VerificationStatus.VERIFIED:
            quality += 0.15
        hits.append(MemoryHit(item=item, score=score * quality, matched_by=matched[mid]))
    hits.sort(key=lambda h: h.score, reverse=True)
    return hits[:limit]


def format_for_prompt(hits: list[MemoryHit]) -> str:
    if not hits:
        return ""
    lines = []
    for i, h in enumerate(hits, 1):
        m = h.item
        date = m.source_date.date().isoformat() if m.source_date else "s/f"
        lines.append(
            f"[M{i}] ({m.scope}/{m.kind}; fuente: {m.source}{' ' + m.source_ref if m.source_ref else ''}; "
            f"fecha: {date}; confianza: {m.confidence:.2f}; {m.verification_status})\n{m.content.strip()[:1500]}"
        )
    return "\n\n".join(lines)


async def index_project_file(session: AsyncSession, pfile: ProjectFile, text: str) -> int:
    """Indexa un archivo de proyecto como memoria de proyecto, reemplazando versiones previas."""
    await session.execute(
        delete(MemoryItem).where(
            MemoryItem.project_id == pfile.project_id,
            MemoryItem.kind == MemoryKind.DOCUMENT,
            MemoryItem.meta["path"].astext == pfile.path,
        )
    )
    chunks = chunk_text(text)
    items: list[MemoryItem] = []
    for idx, chunk in enumerate(chunks[:400]):
        item = MemoryItem(
            user_id=pfile.user_id,
            scope=MemoryScope.PROJECT,
            kind=MemoryKind.DOCUMENT,
            title=f"{pfile.path} (fragmento {idx + 1}/{len(chunks)})",
            content=chunk,
            project_id=pfile.project_id,
            project_file_id=pfile.id,
            source="document",
            source_ref=f"{pfile.path}@v{pfile.version}",
            source_date=datetime.now(UTC),
            confidence=0.9,
            verification_status=VerificationStatus.VERIFIED,
            meta={"path": pfile.path, "chunk": idx, "content_hash": content_hash(chunk)},
        )
        session.add(item)
        items.append(item)
    await session.flush()
    if items:
        await store_embeddings(session, pfile.user_id, items)
    pfile.indexed = True
    pfile.index_error = None
    return len(items)


async def memory_stats(session: AsyncSession, user_id: uuid.UUID) -> dict[str, Any]:
    rows = await session.execute(
        select(MemoryItem.scope, MemoryItem.verification_status, func.count())
        .where(MemoryItem.user_id == user_id)
        .group_by(MemoryItem.scope, MemoryItem.verification_status)
    )
    stats: dict[str, Any] = {"total": 0, "by_scope": {}, "by_verification": {}}
    for scope, verification, count in rows:
        stats["total"] += count
        stats["by_scope"][scope] = stats["by_scope"].get(scope, 0) + count
        stats["by_verification"][verification] = stats["by_verification"].get(verification, 0) + count
    return stats


__all__ = [
    "InvalidMemory",
    "MemoryHit",
    "create_memory",
    "format_for_prompt",
    "index_project_file",
    "memory_stats",
    "search",
]
