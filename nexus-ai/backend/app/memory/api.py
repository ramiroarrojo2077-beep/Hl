from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.api import owned_agent
from app.api.schemas import MemoryCreate, MemoryHitOut, MemoryOut, MemorySearch, MemoryUpdate
from app.auth.deps import CurrentUser, current_user
from app.core.db import get_session
from app.core.errors import NexusError, NotFound
from app.memory import service
from app.memory.service import content_hash, store_embeddings
from app.models import MemoryEmbedding, MemoryItem
from app.monitoring.audit import record_audit

router = APIRouter(prefix="/memory", tags=["memory"])


async def owned_memory(session: AsyncSession, user_id: uuid.UUID, memory_id: uuid.UUID) -> MemoryItem:
    item = await session.get(MemoryItem, memory_id)
    if item is None or item.user_id != user_id:
        raise NotFound("Recuerdo no encontrado")
    return item


@router.get("", response_model=list[MemoryOut])
async def list_memory(
    scope: str | None = None,
    kind: str | None = None,
    agent_id: uuid.UUID | None = None,
    project_id: uuid.UUID | None = None,
    verification: str | None = None,
    q: str | None = Query(default=None, max_length=200),
    before: datetime | None = None,
    limit: int = 50,
    cu: CurrentUser = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> list[MemoryItem]:
    query = select(MemoryItem).where(MemoryItem.user_id == cu.id).order_by(MemoryItem.created_at.desc()).limit(min(limit, 200))
    if scope:
        query = query.where(MemoryItem.scope == scope)
    if kind:
        query = query.where(MemoryItem.kind == kind)
    if agent_id:
        query = query.where(or_(MemoryItem.agent_id == agent_id, MemoryItem.created_by_agent_id == agent_id))
    if project_id:
        query = query.where(MemoryItem.project_id == project_id)
    if verification:
        query = query.where(MemoryItem.verification_status == verification)
    if q:
        query = query.where(MemoryItem.content.ilike(f"%{q}%"))
    if before:
        query = query.where(MemoryItem.created_at < before)
    return list((await session.scalars(query)).all())


@router.get("/privacy")
async def privacy(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict:
    """Panel de privacidad: qué categorías hay, cuáles están desactivadas, procedencia y vigencia."""
    from app.jarvis.service import STALE_DAYS
    from app.jarvis.settings import MEMORY_CATEGORIES, privacy_view
    from app.models import UserSettings

    settings = await session.get(UserSettings, cu.id)
    disabled = privacy_view(settings.privacy_settings if settings else None)["disabled_memory_categories"]
    by_cat = dict((await session.execute(select(MemoryItem.category, func.count()).where(MemoryItem.user_id == cu.id)
                                         .group_by(MemoryItem.category))).all())
    by_source = dict((await session.execute(select(MemoryItem.source, func.count()).where(MemoryItem.user_id == cu.id)
                                            .group_by(MemoryItem.source))).all())
    cutoff = datetime.now(UTC) - timedelta(days=STALE_DAYS)
    stale = await session.scalar(select(func.count()).select_from(MemoryItem).where(
        MemoryItem.user_id == cu.id, func.coalesce(MemoryItem.last_verified_at, MemoryItem.source_date, MemoryItem.created_at) < cutoff))
    return {"categories": [{"key": c, "count": by_cat.get(c, 0), "disabled": c in disabled} for c in MEMORY_CATEGORIES],
            "by_source": by_source, "stale": stale or 0, "stale_after_days": STALE_DAYS,
            "policy": {"contacts_sent_to_models": False, "audio_stored": False, "used_for_training": False}}


@router.post("/bulk-delete")
async def bulk_delete(category: str | None = None, all_items: bool = False, confirm: bool = False,
                      cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict:
    """Borrado irreversible por categoría o total (requiere confirm=true)."""
    if not confirm:
        raise NexusError("El borrado es irreversible: enviá confirm=true")
    if not category and not all_items:
        raise NexusError("Indicá una categoría o all_items=true")
    q = MemoryItem.__table__.delete().where(MemoryItem.user_id == cu.id)
    if category:
        q = q.where(MemoryItem.category == category)
    result = await session.execute(q)
    await record_audit(session, cu.id, "memory.bulk_deleted", f"Recuerdos borrados ({category or 'todos'})", actor_type="user",
                       details={"category": category, "deleted": result.rowcount or 0})
    await session.commit()
    return {"deleted": result.rowcount or 0}


@router.get("/stats")
async def stats(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict:
    return await service.memory_stats(session, cu.id)


@router.post("", response_model=MemoryOut, status_code=status.HTTP_201_CREATED)
async def create(body: MemoryCreate, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> MemoryItem:
    if body.agent_id:
        await owned_agent(session, cu.id, body.agent_id)
    item = await service.create_memory(
        session, cu.id, scope=body.scope, content=body.content, kind=body.kind, title=body.title, agent_id=body.agent_id,
        project_id=body.project_id, source="user", source_ref=body.source_ref, confidence=body.confidence,
        verification_status="verified", expires_at=body.expires_at,
    )
    item.category = body.category
    item.last_verified_at = datetime.now(UTC)
    await record_audit(session, cu.id, "memory.created", "Recuerdo agregado por el usuario", actor_type="user",
                       target_type="memory", target_id=item.id, project_id=body.project_id)
    await session.commit()
    return item


@router.post("/search", response_model=list[MemoryHitOut])
async def search(body: MemorySearch, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[MemoryHitOut]:
    hits = await service.search(
        session, cu.id, body.query, agent_id=body.agent_id, project_id=body.project_id, for_agent=False,
        scopes=body.scopes, kinds=body.kinds, limit=body.limit,
    )
    return [MemoryHitOut(item=MemoryOut.model_validate(h.item), score=round(h.score, 5), matched_by=h.matched_by) for h in hits]


@router.patch("/{memory_id}", response_model=MemoryOut)
async def update(memory_id: uuid.UUID, body: MemoryUpdate, cu: CurrentUser = Depends(current_user),
                 session: AsyncSession = Depends(get_session)) -> MemoryItem:
    item = await owned_memory(session, cu.id, memory_id)
    reembed = False
    if body.content is not None and body.content != item.content:
        item.content = body.content.strip()
        item.meta = {**item.meta, "content_hash": content_hash(item.content), "edited_by_user": True}
        item.verification_status = "verified"
        reembed = True
    if body.title is not None:
        item.title = body.title
        reembed = True
    if body.verification_status is not None:
        item.verification_status = body.verification_status
    if body.confidence is not None:
        item.confidence = body.confidence
    if body.expires_at is not None:
        item.expires_at = body.expires_at
    if body.clear_expiry:
        item.expires_at = None
    if body.category is not None:
        item.category = body.category
    if body.mark_verified or reembed:
        item.last_verified_at = datetime.now(UTC)
        if body.mark_verified:
            item.verification_status = "verified"
    if reembed:
        await session.execute(MemoryEmbedding.__table__.delete().where(MemoryEmbedding.memory_id == item.id))
        await session.flush()
        await store_embeddings(session, cu.id, [item])
    await record_audit(session, cu.id, "memory.updated", "Recuerdo corregido por el usuario", actor_type="user",
                       target_type="memory", target_id=item.id)
    await session.commit()
    await session.refresh(item)
    return item


@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete(memory_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> None:
    item = await owned_memory(session, cu.id, memory_id)
    await record_audit(session, cu.id, "memory.deleted", "Recuerdo eliminado por el usuario", actor_type="user",
                       target_type="memory", target_id=item.id, details={"scope": item.scope, "kind": item.kind})
    await session.delete(item)
    await session.commit()
