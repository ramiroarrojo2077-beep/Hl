"""Router de modelos: elige el modelo adecuado para cada tarea.

Criterios (en orden): capacidades obligatorias, contexto suficiente, calidad mínima
según el tipo de tarea, asignación explícita del agente, capacidad preferida y, recién
al final, el costo. Nunca elige el más barato si no alcanza la calidad requerida.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AgentModel, AIModel, AIProvider

# Calidad mínima (1-5) y capacidad preferida por tipo de trabajo.
TASK_PROFILES: dict[str, tuple[int, str | None]] = {
    "research": (4, "reasoning"),
    "code": (4, "code"),
    "analysis": (4, "reasoning"),
    "security": (4, "reasoning"),
    "planning": (4, "reasoning"),
    "review": (4, "reasoning"),
    "design": (3, None),
    "writing": (3, None),
    "revision": (3, None),
    "general": (3, None),
    "chat": (3, None),
    "meeting": (3, None),
    "summary": (2, "long_context"),
    "simple": (2, None),
    "vision": (3, "vision"),
}


@dataclass
class Candidate:
    model: AIModel
    provider: AIProvider
    score: float
    reasons: list[str] = field(default_factory=list)
    below_quality: bool = False


@dataclass
class RouteDecision:
    candidates: list[Candidate]
    task_type: str
    required: list[str]
    min_quality: int

    def explain(self) -> list[dict]:
        return [
            {
                "model": c.model.model_name,
                "provider": c.provider.kind,
                "score": round(c.score, 2),
                "reasons": c.reasons,
                "below_quality": c.below_quality,
            }
            for c in self.candidates
        ]


def _cost_index(m: AIModel) -> float | None:
    if m.input_price_per_mtok is None or m.output_price_per_mtok is None:
        return None
    return float(Decimal(m.input_price_per_mtok) + Decimal(m.output_price_per_mtok) * 3)


async def load_usable_models(session: AsyncSession, user_id: uuid.UUID) -> list[tuple[AIModel, AIProvider]]:
    rows = (
        await session.execute(
            select(AIModel, AIProvider)
            .join(AIProvider, AIModel.provider_id == AIProvider.id)
            .where(AIModel.user_id == user_id, AIModel.is_enabled.is_(True), AIProvider.is_enabled.is_(True))
        )
    ).all()
    return [(m, p) for m, p in rows]


async def route(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    task_type: str = "general",
    required: list[str] | None = None,
    agent_id: uuid.UUID | None = None,
    estimated_input_tokens: int = 0,
    exclude_model_ids: set[uuid.UUID] | None = None,
) -> RouteDecision:
    required = sorted(set(required or []) | {"chat"})
    min_quality, preferred = TASK_PROFILES.get(task_type, TASK_PROFILES["general"])
    usable = await load_usable_models(session, user_id)

    assigned: dict[uuid.UUID, int] = {}
    if agent_id is not None:
        for am in (await session.scalars(select(AgentModel).where(AgentModel.agent_id == agent_id))).all():
            assigned[am.model_id] = am.priority

    from app.providers.quality import MIN_SAMPLES, model_adjustments

    measured = await model_adjustments(session, user_id, task_type)
    costs = [c for c in (_cost_index(m) for m, _ in usable) if c is not None]
    max_cost = max(costs) if costs else None

    candidates: list[Candidate] = []
    for model, provider in usable:
        if exclude_model_ids and model.id in exclude_model_ids:
            continue
        caps = set(model.capabilities or [])
        if "embedding" in caps and "chat" not in caps:
            continue
        missing = [c for c in required if c not in caps]
        if missing:
            continue
        if estimated_input_tokens and estimated_input_tokens > model.context_window * 0.9:
            continue
        if provider.status == "error" and provider.last_error and "401" in provider.last_error:
            continue  # credenciales inválidas conocidas
        reasons: list[str] = []
        score = 0.0
        if model.id in assigned:
            score += 100 - assigned[model.id] * 10
            reasons.append(f"asignado al agente (prioridad {assigned[model.id]})")
        below = model.quality_tier < min_quality
        if below:
            score -= 60
            reasons.append(f"calidad {model.quality_tier} < mínima {min_quality}")
        else:
            reasons.append(f"calidad {model.quality_tier} ≥ {min_quality}")
        score += model.quality_tier * 8
        if preferred and preferred in caps:
            score += 15
            reasons.append(f"capacidad preferida: {preferred}")
        if model.is_default:
            score += 5
            reasons.append("modelo predeterminado")
        cost = _cost_index(model)
        if cost is not None and max_cost:
            # El costo solo desempata entre modelos de calidad suficiente.
            score -= (cost / max_cost) * 6
        if provider.status == "error":
            score -= 20
            reasons.append("proveedor con errores recientes")
        if model.id in measured and measured[model.id][1] >= MIN_SAMPLES:
            avg, n = measured[model.id]
            # Calidad medida en tareas reales de este tipo (no longitud): ajusta ±8 puntos.
            score += max(-8.0, min(8.0, (avg - 7.0) * 2))
            reasons.append(f"calidad medida {avg:.1f}/10 en {n} tareas de tipo {task_type}")
        candidates.append(Candidate(model=model, provider=provider, score=score, reasons=reasons, below_quality=below))

    candidates.sort(key=lambda c: c.score, reverse=True)
    # Si existe al menos un modelo de calidad suficiente, los de calidad insuficiente quedan
    # solo como último recurso de fallback.
    good = [c for c in candidates if not c.below_quality]
    weak = [c for c in candidates if c.below_quality]
    return RouteDecision(candidates=good + weak, task_type=task_type, required=required, min_quality=min_quality)
