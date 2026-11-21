"""Comparación experimental de modelos sobre un conjunto de pruebas.

Mide latencia, tokens, costo y tasa de errores de forma objetiva. La calidad, precisión y
cumplimiento de instrucciones se evalúan con un modelo juez a ciegas (no sabe qué modelo
produjo cada salida, se le indica no premiar la longitud) y, si el caso define
`expected_contains`, con verificación determinista de palabras clave.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from statistics import mean

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NexusError
from app.models import AIModel, ModelEvalResult, ModelEvalRun
from app.orchestrator.jsonutil import JSONExtractionError, extract_json
from app.providers import gateway
from app.providers.base import Message

JUDGE_PROMPT = """Evaluá la RESPUESTA a la TAREA de forma objetiva. No premies la longitud: una respuesta breve y
correcta vale más que una larga con relleno. No sabés qué modelo la produjo.

TAREA:
{prompt}

{reference}RESPUESTA:
{output}

Respondé SOLO JSON: {{"quality": 0-10, "accuracy": 0-10, "instruction_following": 0-10, "notes": "justificación breve"}}"""


async def run_evaluation(session: AsyncSession, run_id: uuid.UUID) -> None:
    run = await session.get(ModelEvalRun, run_id)
    if run is None or run.status == "completed":
        return
    run.status = "running"
    await session.commit()
    model_ids = [uuid.UUID(m) for m in run.model_ids]
    for model_id in model_ids:
        for idx, case in enumerate(run.cases):
            done = await session.scalar(
                select(ModelEvalResult.id).where(ModelEvalResult.run_id == run.id, ModelEvalResult.model_id == model_id,
                                                 ModelEvalResult.case_index == idx)
            )
            if done:
                continue
            result = ModelEvalResult(run_id=run.id, model_id=model_id, case_index=idx)
            ctx = gateway.CallContext(user_id=run.user_id, purpose="eval", task_type="general", model_id=model_id)
            try:
                res = await gateway.complete(
                    session, ctx, system=case.get("system") or "Respondé con precisión.",
                    messages=[Message(role="user", content=case["prompt"])], max_tokens=int(case.get("max_tokens", 2000)),
                )
                result.output = res.response.text
                result.latency_ms = res.latency_ms
                result.tokens_in = res.response.usage.input_tokens
                result.tokens_out = res.response.usage.output_tokens
                result.cost_usd = res.cost_usd
            except NexusError as exc:
                result.error = exc.message
            scores: dict = {}
            expected = case.get("expected_contains") or []
            if expected and result.output:
                hits = sum(1 for kw in expected if kw.lower() in result.output.lower())
                scores["keyword_accuracy"] = round(10 * hits / len(expected), 2)
            if run.judge_model_id and result.output:
                reference = f"RESPUESTA DE REFERENCIA (orientativa):\n{case['reference']}\n\n" if case.get("reference") else ""
                jctx = gateway.CallContext(user_id=run.user_id, purpose="eval", task_type="review", model_id=run.judge_model_id)
                try:
                    judged = await gateway.complete(
                        session, jctx, system="Sos un evaluador estricto e imparcial.", max_tokens=600,
                        messages=[Message(role="user", content=JUDGE_PROMPT.format(prompt=case["prompt"], reference=reference, output=result.output[:12000]))],
                    )
                    data = extract_json(judged.response.text)
                    for key in ("quality", "accuracy", "instruction_following"):
                        if isinstance(data.get(key), (int, float)):
                            scores[key] = float(data[key])
                    result.judge_notes = str(data.get("notes", ""))[:2000]
                except (NexusError, JSONExtractionError, AttributeError) as exc:
                    result.judge_notes = f"El juez no pudo evaluar: {exc}"
            result.scores = scores
            numeric = [v for v in scores.values() if isinstance(v, (int, float))]
            result.overall = round(mean(numeric), 2) if numeric else None
            session.add(result)
            await session.commit()
    run.summary = await summarize_run(session, run)
    run.status = "completed"


async def summarize_run(session: AsyncSession, run: ModelEvalRun) -> dict:
    results = (await session.scalars(select(ModelEvalResult).where(ModelEvalResult.run_id == run.id))).all()
    models = {m.id: m for m in (await session.scalars(select(AIModel).where(AIModel.id.in_([r.model_id for r in results])))).all()} if results else {}
    summary: dict = {"models": []}
    by_model: dict[uuid.UUID, list[ModelEvalResult]] = {}
    for r in results:
        by_model.setdefault(r.model_id, []).append(r)
    for model_id, rows in by_model.items():
        ok = [r for r in rows if r.error is None]
        def avg(key: str) -> float | None:
            vals = [r.scores[key] for r in ok if key in r.scores]
            return round(mean(vals), 2) if vals else None
        summary["models"].append({
            "model_id": str(model_id),
            "model": models[model_id].model_name if model_id in models else str(model_id),
            "cases": len(rows),
            "error_rate": round(1 - len(ok) / len(rows), 3) if rows else None,
            "avg_latency_ms": round(mean(r.latency_ms for r in ok)) if ok else None,
            "total_tokens": sum(r.tokens_in + r.tokens_out for r in ok),
            "total_cost_usd": str(sum((r.cost_usd or Decimal(0)) for r in ok)),
            "quality": avg("quality"), "accuracy": avg("accuracy"), "instruction_following": avg("instruction_following"),
            "keyword_accuracy": avg("keyword_accuracy"),
            "overall": round(mean([r.overall for r in ok if r.overall is not None]), 2) if any(r.overall is not None for r in ok) else None,
        })
    summary["models"].sort(key=lambda m: (m["overall"] is None, -(m["overall"] or 0)))
    return summary
