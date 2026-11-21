"""Puntaje de calidad por tarea (capítulo 8). No mide longitud.

Criterios (0-10): precision, completeness, instruction_following, consistency,
verifiability, format, errors (10 = sin errores).

Fuentes reales:
- deterministic: comprobaciones objetivas de cada ejecución (respuesta vacía, errores de
  herramientas, JSON inválido cuando se pidió JSON, citas presentes en investigación).
- review: la revisión estructurada de ORACLE sobre las tareas de una misión.
- user_feedback: 👍/👎 del usuario sobre una respuesta.
- eval: resultados del comparador de modelos.

El router usa el promedio reciente (mínimo de muestras) como ajuste de ranking.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AIModel, ModelQualityScore

CRITERIA = ("precision", "completeness", "instruction_following", "consistency", "verifiability", "format", "errors")
MIN_SAMPLES = 3
WINDOW_DAYS = 30


def overall(criteria: dict[str, float]) -> float:
    vals = [float(criteria[c]) for c in CRITERIA if c in criteria]
    return round(sum(vals) / len(vals), 2) if vals else 0.0


async def _model_id(session: AsyncSession, user_id: uuid.UUID, label: str | None) -> uuid.UUID | None:
    if not label:
        return None
    name = label.split(":", 1)[-1]
    return await session.scalar(select(AIModel.id).where(AIModel.user_id == user_id, AIModel.model_name == name).limit(1))


async def record(session: AsyncSession, user_id: uuid.UUID, *, model_label: str | None, task_type: str, source: str,
                 criteria: dict[str, float], notes: str | None = None, mission_id: uuid.UUID | None = None,
                 task_id: uuid.UUID | None = None, message_id: uuid.UUID | None = None) -> ModelQualityScore | None:
    if not model_label:
        return None
    clean = {c: max(0.0, min(10.0, float(v))) for c, v in criteria.items() if c in CRITERIA}
    row = ModelQualityScore(user_id=user_id, model_id=await _model_id(session, user_id, model_label), model_label=model_label,
                            task_type=task_type, source=source, criteria=clean, overall=overall(clean), notes=(notes or "")[:1000] or None,
                            mission_id=mission_id, task_id=task_id, message_id=message_id)
    session.add(row)
    await session.flush()
    return row


async def record_deterministic(session: AsyncSession, user_id: uuid.UUID, result: Any, *, task_type: str,
                               message_id: uuid.UUID | None = None, mission_id: uuid.UUID | None = None,
                               task_id: uuid.UUID | None = None, expected_json: bool = False) -> ModelQualityScore | None:
    tool_steps = [s for s in result.steps if s.get("type") == "tool"]
    errors = sum(1 for s in tool_steps if s.get("is_error"))
    text = (result.text or "").strip()
    criteria: dict[str, float] = {
        "format": 10.0 if text else 0.0,
        "errors": max(0.0, 10.0 - 3.0 * errors),
    }
    if expected_json:
        from app.orchestrator.jsonutil import JSONExtractionError, extract_json

        try:
            extract_json(text)
            criteria["format"] = 10.0
        except JSONExtractionError:
            criteria["format"] = 2.0
    if task_type == "research":
        criteria["verifiability"] = 10.0 if result.citations else 4.0
    return await record(session, user_id, model_label=result.model_label, task_type=task_type, source="deterministic",
                        criteria=criteria, message_id=message_id, mission_id=mission_id, task_id=task_id)


def criteria_from_review(review: dict[str, Any]) -> dict[str, float]:
    """Traduce la revisión de ORACLE (score 0-10, issues) a criterios."""
    score = review.get("score")
    try:
        base = float(score)
    except (TypeError, ValueError):
        base = 7.0 if review.get("approved") else 4.0
    if base <= 1.0:
        base *= 10
    issues = review.get("issues") or []
    return {"precision": base, "completeness": base, "instruction_following": base, "consistency": base,
            "errors": max(0.0, 10.0 - 1.5 * len(issues))}


async def model_adjustments(session: AsyncSession, user_id: uuid.UUID, task_type: str) -> dict[uuid.UUID, tuple[float, int]]:
    """Promedio reciente por modelo para este tipo de tarea: {model_id: (promedio, muestras)}."""
    since = datetime.now(UTC) - timedelta(days=WINDOW_DAYS)
    rows = (await session.execute(
        select(ModelQualityScore.model_id, func.avg(ModelQualityScore.overall), func.count())
        .where(ModelQualityScore.user_id == user_id, ModelQualityScore.task_type == task_type,
               ModelQualityScore.model_id.is_not(None), ModelQualityScore.created_at > since)
        .group_by(ModelQualityScore.model_id)
    )).all()
    return {r[0]: (float(r[1]), int(r[2])) for r in rows}


async def summary(session: AsyncSession, user_id: uuid.UUID) -> list[dict[str, Any]]:
    since = datetime.now(UTC) - timedelta(days=WINDOW_DAYS)
    rows = (await session.execute(
        select(ModelQualityScore.model_label, ModelQualityScore.task_type, ModelQualityScore.source,
               func.avg(ModelQualityScore.overall), func.count())
        .where(ModelQualityScore.user_id == user_id, ModelQualityScore.created_at > since)
        .group_by(ModelQualityScore.model_label, ModelQualityScore.task_type, ModelQualityScore.source)
        .order_by(ModelQualityScore.model_label)
    )).all()
    return [{"model": r[0], "task_type": r[1], "source": r[2], "average": round(float(r[3]), 2), "samples": int(r[4])} for r in rows]
