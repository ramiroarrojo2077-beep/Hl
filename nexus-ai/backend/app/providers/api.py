from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import (
    EvalCreate,
    ModelCreate,
    ModelOut,
    ModelUpdate,
    ProviderCreate,
    ProviderOut,
    ProviderUpdate,
)
from app.auth.deps import CurrentUser, current_user
from app.core.crypto import encrypt_str, mask_secret
from app.core.db import get_session
from app.core.errors import NexusError, NotFound
from app.jobs import queue
from app.models import AIModel, AIProvider, ModelEvalResult, ModelEvalRun
from app.models.enums import Capability
from app.monitoring.audit import record_audit
from app.providers.base import ProviderCallError
from app.providers.registry import ADAPTERS, adapter_for, suggest_capabilities

router = APIRouter(tags=["providers"])
VALID_CAPS = {c.value for c in Capability}


async def owned_provider(session: AsyncSession, user_id: uuid.UUID, provider_id: uuid.UUID) -> AIProvider:
    provider = await session.get(AIProvider, provider_id)
    if provider is None or provider.user_id != user_id:
        raise NotFound("Proveedor no encontrado")
    return provider


async def owned_model(session: AsyncSession, user_id: uuid.UUID, model_id: uuid.UUID) -> AIModel:
    model = await session.get(AIModel, model_id)
    if model is None or model.user_id != user_id:
        raise NotFound("Modelo no encontrado")
    return model


def _check_caps(caps: list[str] | None) -> None:
    if caps is not None:
        bad = [c for c in caps if c not in VALID_CAPS]
        if bad:
            raise NexusError(f"Capacidades inválidas: {', '.join(bad)}")


@router.get("/providers/kinds")
async def provider_kinds(_: CurrentUser = Depends(current_user)) -> list[dict]:
    return [
        {"kind": k, "label": a.label, "default_base_url": a.default_base_url, "requires_api_key": a.requires_api_key}
        for k, a in ADAPTERS.items()
    ]


@router.get("/providers", response_model=list[ProviderOut])
async def list_providers(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[AIProvider]:
    return list((await session.scalars(select(AIProvider).where(AIProvider.user_id == cu.id).order_by(AIProvider.created_at))).all())


@router.post("/providers", response_model=ProviderOut, status_code=status.HTTP_201_CREATED)
async def create_provider(body: ProviderCreate, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> AIProvider:
    adapter_cls = ADAPTERS[body.kind]
    if adapter_cls.requires_api_key and not body.api_key:
        raise NexusError(f"{adapter_cls.label} requiere una API key")
    if body.base_url and not body.base_url.startswith(("https://", "http://")):
        raise NexusError("La URL base debe empezar con http:// o https://")
    provider = AIProvider(
        user_id=cu.id, kind=body.kind, name=body.name, base_url=body.base_url or None,
        api_key_encrypted=encrypt_str(body.api_key) if body.api_key else None, api_key_hint=mask_secret(body.api_key),
        known_limits=body.known_limits, max_concurrency=body.max_concurrency,
    )
    session.add(provider)
    await session.flush()
    await record_audit(session, cu.id, "provider.created", f"Proveedor agregado: {body.name} ({body.kind})", actor_type="user",
                       target_type="provider", target_id=provider.id)
    await session.commit()
    return provider


@router.patch("/providers/{provider_id}", response_model=ProviderOut)
async def update_provider(provider_id: uuid.UUID, body: ProviderUpdate, cu: CurrentUser = Depends(current_user),
                          session: AsyncSession = Depends(get_session)) -> AIProvider:
    provider = await owned_provider(session, cu.id, provider_id)
    data = body.model_dump(exclude_unset=True)
    if "api_key" in data:
        key = data.pop("api_key")
        provider.api_key_encrypted = encrypt_str(key) if key else None
        provider.api_key_hint = mask_secret(key)
        provider.status = "unknown"
        provider.last_error = None
    for k, v in data.items():
        if v is not None:
            setattr(provider, k, v)
    await record_audit(session, cu.id, "provider.updated", f"Proveedor actualizado: {provider.name}", actor_type="user",
                       target_type="provider", target_id=provider.id, details={"fields": sorted(data)})
    await session.commit()
    return provider


@router.delete("/providers/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider(provider_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> None:
    provider = await owned_provider(session, cu.id, provider_id)
    await record_audit(session, cu.id, "provider.deleted", f"Proveedor eliminado: {provider.name}", actor_type="user",
                       target_type="provider", target_id=provider.id)
    await session.delete(provider)
    await session.commit()


@router.post("/providers/{provider_id}/test")
async def test_provider(provider_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict:
    """Comprueba la conexión real listando los modelos del proveedor."""
    provider = await owned_provider(session, cu.id, provider_id)
    started = datetime.now(UTC)
    try:
        models = await adapter_for(provider).list_models()
        provider.status = "ok"
        provider.last_error = None
        ok, error = True, None
    except ProviderCallError as exc:
        provider.status = "error"
        provider.last_error = exc.message[:500]
        models, ok, error = [], False, exc.message
    provider.last_checked_at = datetime.now(UTC)
    await record_audit(session, cu.id, "provider.tested", f"Prueba de conexión {provider.name}: {'OK' if ok else 'error'}",
                       actor_type="user", target_type="provider", target_id=provider.id, outcome="success" if ok else "failure")
    await session.commit()
    return {"ok": ok, "error": error, "models": models[:300],
            "latency_ms": int((datetime.now(UTC) - started).total_seconds() * 1000)}


def _model_out(model: AIModel, provider: AIProvider | None) -> ModelOut:
    out = ModelOut.model_validate(model)
    out.provider_kind = provider.kind if provider else None
    return out


@router.get("/models", response_model=list[ModelOut])
async def list_models(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[ModelOut]:
    rows = (await session.execute(
        select(AIModel, AIProvider).join(AIProvider, AIProvider.id == AIModel.provider_id).where(AIModel.user_id == cu.id)
        .order_by(AIProvider.created_at, AIModel.model_name)
    )).all()
    return [_model_out(m, p) for m, p in rows]


async def _unset_defaults(session: AsyncSession, user_id: uuid.UUID, *, chat: bool, embedding: bool) -> None:
    if chat:
        await session.execute(update(AIModel).where(AIModel.user_id == user_id).values(is_default=False))
    if embedding:
        await session.execute(update(AIModel).where(AIModel.user_id == user_id).values(is_embedding_default=False))


@router.post("/models", response_model=ModelOut, status_code=status.HTTP_201_CREATED)
async def create_model(body: ModelCreate, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> ModelOut:
    provider = await owned_provider(session, cu.id, body.provider_id)
    _check_caps(body.capabilities)
    suggested_caps, suggested_tier = suggest_capabilities(body.model_name)
    caps = body.capabilities if body.capabilities is not None else suggested_caps
    existing_default = await session.scalar(select(AIModel.id).where(AIModel.user_id == cu.id, AIModel.is_default.is_(True)))
    make_default = body.is_default or (existing_default is None and "chat" in caps)
    await _unset_defaults(session, cu.id, chat=make_default, embedding=body.is_embedding_default)
    model = AIModel(
        provider_id=provider.id, user_id=cu.id, model_name=body.model_name.strip(),
        display_name=body.display_name or body.model_name, capabilities=caps, context_window=body.context_window,
        max_output_tokens=body.max_output_tokens, input_price_per_mtok=body.input_price_per_mtok,
        output_price_per_mtok=body.output_price_per_mtok, quality_tier=body.quality_tier or suggested_tier,
        is_default=make_default, is_embedding_default=body.is_embedding_default,
    )
    session.add(model)
    await session.flush()
    await record_audit(session, cu.id, "model.created", f"Modelo habilitado: {model.model_name}", actor_type="user",
                       target_type="model", target_id=model.id)
    await session.commit()
    return _model_out(model, provider)


@router.patch("/models/{model_id}", response_model=ModelOut)
async def update_model(model_id: uuid.UUID, body: ModelUpdate, cu: CurrentUser = Depends(current_user),
                       session: AsyncSession = Depends(get_session)) -> ModelOut:
    model = await owned_model(session, cu.id, model_id)
    data = body.model_dump(exclude_unset=True)
    _check_caps(data.get("capabilities"))
    await _unset_defaults(session, cu.id, chat=bool(data.get("is_default")), embedding=bool(data.get("is_embedding_default")))
    for k, v in data.items():
        setattr(model, k, v)
    await session.commit()
    return _model_out(model, await session.get(AIProvider, model.provider_id))


@router.delete("/models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_model(model_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> None:
    model = await owned_model(session, cu.id, model_id)
    await session.delete(model)
    await session.commit()


@router.post("/evals", status_code=status.HTTP_201_CREATED)
async def create_eval(body: EvalCreate, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict:
    for mid in [*body.model_ids, *([body.judge_model_id] if body.judge_model_id else [])]:
        await owned_model(session, cu.id, mid)
    for case in body.cases:
        if not isinstance(case.get("prompt"), str) or not case["prompt"].strip():
            raise NexusError("Cada caso necesita un 'prompt'")
    run = ModelEvalRun(user_id=cu.id, name=body.name, model_ids=[str(m) for m in body.model_ids],
                       judge_model_id=body.judge_model_id, cases=body.cases)
    session.add(run)
    await session.flush()
    await queue.enqueue(session, "eval.run", {"run_id": str(run.id)}, user_id=cu.id, idempotency_key=f"eval.run:{run.id}")
    await queue.commit(session)
    return {"id": str(run.id), "status": run.status}


@router.get("/evals")
async def list_evals(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[dict]:
    runs = (await session.scalars(select(ModelEvalRun).where(ModelEvalRun.user_id == cu.id).order_by(ModelEvalRun.created_at.desc()).limit(50))).all()
    return [{"id": str(r.id), "name": r.name, "status": r.status, "summary": r.summary, "created_at": r.created_at} for r in runs]


@router.get("/evals/{run_id}")
async def get_eval(run_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict:
    run = await session.get(ModelEvalRun, run_id)
    if run is None or run.user_id != cu.id:
        raise NotFound("Evaluación no encontrada")
    results = (await session.scalars(select(ModelEvalResult).where(ModelEvalResult.run_id == run.id).order_by(ModelEvalResult.case_index))).all()
    return {
        "id": str(run.id), "name": run.name, "status": run.status, "summary": run.summary, "cases": run.cases,
        "results": [{"model_id": str(r.model_id), "case_index": r.case_index, "output": r.output, "error": r.error,
                     "latency_ms": r.latency_ms, "tokens_in": r.tokens_in, "tokens_out": r.tokens_out,
                     "cost_usd": str(r.cost_usd) if r.cost_usd is not None else None, "scores": r.scores,
                     "judge_notes": r.judge_notes, "overall": r.overall} for r in results],
    }
