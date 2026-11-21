"""AI Provider Gateway: punto único por el que pasan todas las llamadas a modelos.

Se encarga de: comprobar STOP ALL y presupuestos, elegir modelo (router), reintentar
errores transitorios, aplicar fallback solo hacia modelos compatibles, registrar consumo
y costos, y limitar la concurrencia por proveedor.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import EmergencyStopActive, ProviderError
from app.models import AIModel, AIProvider, Meeting, Mission, MissionTask, UsageRecord, UserSettings
from app.providers.base import ChatRequest, ChatResponse, Message, ProviderCallError, ToolSpec
from app.providers.budget import check_budget, estimate_cost
from app.providers.registry import adapter_for
from app.providers.router import Candidate, route

logger = logging.getLogger(__name__)

_provider_semaphores: dict[uuid.UUID, asyncio.Semaphore] = defaultdict(lambda: asyncio.Semaphore(4))

TextCallback = Callable[[str], Awaitable[None]]


@dataclass
class CallContext:
    user_id: uuid.UUID
    purpose: str  # task | planning | review | security | consolidation | meeting | chat | memory | eval
    task_type: str = "general"
    agent_id: uuid.UUID | None = None
    mission_id: uuid.UUID | None = None
    task_id: uuid.UUID | None = None
    meeting_id: uuid.UUID | None = None
    required_capabilities: list[str] = field(default_factory=list)
    model_id: uuid.UUID | None = None  # fuerza un modelo concreto (comparación de modelos)
    enforce_budget: bool = True
    # El acta final de una reunión puede cerrar aunque la reunión haya agotado su presupuesto propio.
    check_meeting_budget: bool = True


@dataclass
class GatewayResult:
    response: ChatResponse
    model: AIModel
    provider: AIProvider
    cost_usd: Decimal | None
    latency_ms: int
    attempts: list[dict]
    degraded_quality: bool = False

    @property
    def model_label(self) -> str:
        return f"{self.provider.kind}:{self.model.model_name}"


def estimate_tokens(system: str, messages: list[Message], tools: list[ToolSpec]) -> int:
    chars = len(system) + sum(len(m.content or "") for m in messages) + sum(len(str(t.parameters)) + len(t.description) for t in tools)
    return chars // 3


async def ensure_not_stopped(session: AsyncSession, user_id: uuid.UUID) -> None:
    settings = await session.get(UserSettings, user_id, populate_existing=True)
    if settings and settings.emergency_stop:
        raise EmergencyStopActive("STOP ALL AGENTS está activo. Reanudá desde la app para continuar.")


async def _record_usage(
    session: AsyncSession,
    ctx: CallContext,
    model: AIModel,
    provider: AIProvider,
    *,
    tokens_in: int,
    tokens_out: int,
    latency_ms: int,
    success: bool,
    error: str | None = None,
    meta: dict | None = None,
) -> Decimal | None:
    cost = estimate_cost(tokens_in, tokens_out, model.input_price_per_mtok, model.output_price_per_mtok) if success else None
    session.add(
        UsageRecord(
            user_id=ctx.user_id,
            agent_id=ctx.agent_id,
            mission_id=ctx.mission_id,
            task_id=ctx.task_id,
            meeting_id=ctx.meeting_id,
            provider_id=provider.id,
            model_id=model.id,
            provider_kind=provider.kind,
            model_name=model.model_name,
            purpose=ctx.purpose,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            cost_estimated_usd=cost,
            latency_ms=latency_ms,
            success=success,
            error=error[:1000] if error else None,
            meta=meta or {},
        )
    )
    if success:
        total = tokens_in + tokens_out
        if ctx.mission_id:
            mission = await session.get(Mission, ctx.mission_id)
            if mission:
                mission.tokens_used += total
                mission.spent_usd = (mission.spent_usd or Decimal(0)) + (cost or Decimal(0))
        if ctx.task_id:
            task = await session.get(MissionTask, ctx.task_id)
            if task:
                task.tokens_used += total
                task.actual_cost_usd = (task.actual_cost_usd or Decimal(0)) + (cost or Decimal(0))
        if ctx.meeting_id:
            meeting = await session.get(Meeting, ctx.meeting_id)
            if meeting:
                meeting.tokens_used += total
                meeting.spent_usd = (meeting.spent_usd or Decimal(0)) + (cost or Decimal(0))
    await session.flush()
    return cost


async def _candidates(session: AsyncSession, ctx: CallContext, req_est_tokens: int) -> tuple[list[Candidate], bool]:
    if ctx.model_id is not None:
        model = await session.get(AIModel, ctx.model_id)
        if model is None or model.user_id != ctx.user_id:
            raise ProviderError("Modelo no encontrado")
        provider = await session.get(AIProvider, model.provider_id)
        assert provider is not None
        return [Candidate(model=model, provider=provider, score=0, reasons=["modelo solicitado explícitamente"])], False
    decision = await route(
        session,
        ctx.user_id,
        task_type=ctx.task_type,
        required=ctx.required_capabilities,
        agent_id=ctx.agent_id,
        estimated_input_tokens=req_est_tokens,
    )
    good = [c for c in decision.candidates if not c.below_quality]
    if good:
        return good, False
    # Solo hay modelos por debajo de la calidad recomendada: se usan, pero queda registrado.
    return decision.candidates, True


async def complete(
    session: AsyncSession,
    ctx: CallContext,
    *,
    system: str,
    messages: list[Message],
    tools: list[ToolSpec] | None = None,
    max_tokens: int = 4096,
    temperature: float | None = None,
    reasoning: str | None = None,
    native_web_search: bool = False,
    json_output: bool = False,
    on_text: TextCallback | None = None,
) -> GatewayResult:
    settings = get_settings()
    await ensure_not_stopped(session, ctx.user_id)
    if ctx.enforce_budget:
        await check_budget(
            session, ctx.user_id, agent_id=ctx.agent_id, mission_id=ctx.mission_id,
            meeting_id=ctx.meeting_id if ctx.check_meeting_budget else None,
        )

    tools = tools or []
    required = list(ctx.required_capabilities)
    if tools and "tools" not in required:
        required.append("tools")
    ctx.required_capabilities = required
    est = estimate_tokens(system, messages, tools)
    candidates, degraded = await _candidates(session, ctx, est)
    if not candidates:
        raise ProviderError(
            "No hay ningún modelo configurado que cumpla los requisitos de esta tarea "
            f"(capacidades: {', '.join(required) or 'chat'}). Configurá un proveedor en Ajustes > Proveedores.",
            code="no_model_available",
        )

    attempts: list[dict] = []
    for candidate in candidates:
        model, provider = candidate.model, candidate.provider
        caps = set(model.capabilities or [])
        req = ChatRequest(
            model=model.model_name,
            system=system,
            messages=messages,
            tools=tools,
            max_tokens=min(max_tokens, model.max_output_tokens),
            temperature=temperature,
            reasoning=reasoning if "reasoning" in caps else None,
            native_web_search=native_web_search and "web_search" in caps and provider.kind == "anthropic",
            json_output=json_output,
        )
        adapter = adapter_for(provider)
        for retry in range(settings.llm_max_retries + 1):
            started = time.monotonic()
            try:
                async with _provider_semaphores[provider.id]:
                    if on_text is not None:
                        response: ChatResponse | None = None
                        async for event in adapter.stream(req):
                            if event.type == "text_delta" and event.text:
                                await on_text(event.text)
                            elif event.type == "done":
                                response = event.response
                        if response is None:
                            raise ProviderCallError("El stream terminó sin respuesta final", retryable=True)
                    else:
                        response = await adapter.chat(req)
            except ProviderCallError as exc:
                latency = int((time.monotonic() - started) * 1000)
                attempts.append({"model": model.model_name, "provider": provider.kind, "error": exc.message, "retry": retry})
                await _record_usage(session, ctx, model, provider, tokens_in=0, tokens_out=0, latency_ms=latency, success=False, error=exc.message)
                if exc.auth_error:
                    provider.status = "error"
                    provider.last_error = exc.message[:500]
                    break
                if exc.retryable and retry < settings.llm_max_retries:
                    await asyncio.sleep(min(2 ** retry, 8) * (0.05 if settings.is_test else 1))
                    continue
                logger.warning("Fallback desde %s:%s tras error: %s", provider.kind, model.model_name, exc.message)
                break
            latency = int((time.monotonic() - started) * 1000)
            meta = {"route": candidate.reasons, "fallback_from": attempts} if attempts else {"route": candidate.reasons}
            if degraded:
                meta["degraded_quality"] = True
            cost = await _record_usage(
                session, ctx, model, provider,
                tokens_in=response.usage.input_tokens, tokens_out=response.usage.output_tokens,
                latency_ms=latency, success=True, meta=meta,
            )
            if provider.status != "ok":
                provider.status = "ok"
                provider.last_error = None
            return GatewayResult(
                response=response, model=model, provider=provider, cost_usd=cost,
                latency_ms=latency, attempts=attempts, degraded_quality=degraded,
            )

    summary = "; ".join(f"{a['provider']}:{a['model']} → {a['error']}" for a in attempts[-4:])
    raise ProviderError(f"Ningún modelo compatible pudo completar la solicitud. {summary}", code="all_providers_failed")
