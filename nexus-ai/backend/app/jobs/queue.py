"""Cola de trabajos durable sobre PostgreSQL.

- Encolar ocurre en la misma transacción que el cambio de estado que lo origina
  (outbox transaccional): no hay trabajos perdidos ni huérfanos.
- Los workers reclaman con FOR UPDATE SKIP LOCKED y un lease con vencimiento.
- Si un worker muere, el lease vence y `recover_expired` devuelve el trabajo a la cola.
- `idempotency_key` impide encolar dos veces el mismo trabajo lógico.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select, text, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.redis import get_redis
from app.models import Job
from app.models.enums import JobStatus

logger = logging.getLogger(__name__)
WAKE_KEY = "nexus:jobs:wake"
# Tipos de trabajo que consumen modelos y cuentan para el límite de concurrencia por usuario.
LIMITED_KINDS = ["task.run", "meeting.round", "mission.plan", "mission.review", "mission.security", "mission.consolidate"]
# Tipos que siguen funcionando aunque STOP ALL esté activo.
HOUSEKEEPING_KINDS = ["file.index", "notification.deliver"]


async def enqueue(
    session: AsyncSession,
    kind: str,
    payload: dict[str, Any],
    *,
    user_id: uuid.UUID | None,
    priority: int = 5,
    delay_seconds: float = 0,
    idempotency_key: str | None = None,
    max_attempts: int | None = None,
) -> uuid.UUID | None:
    """Inserta un trabajo. Si ya hay uno ACTIVO (en cola o ejecutándose) con la misma
    idempotency_key, no hace nada."""
    values = {
        "id": uuid.uuid4(),
        "user_id": user_id,
        "kind": kind,
        "payload": payload,
        "status": JobStatus.QUEUED,
        "priority": priority,
        "run_after": datetime.now(UTC) + timedelta(seconds=delay_seconds),
        "attempts": 0,
        "max_attempts": max_attempts or get_settings().job_max_attempts,
        "idempotency_key": idempotency_key,
    }
    stmt = insert(Job).values(**values)
    if idempotency_key:
        stmt = stmt.on_conflict_do_nothing(
            index_elements=["idempotency_key"], index_where=text("status IN ('queued', 'running')")
        )
    result = await session.execute(stmt.returning(Job.id))
    job_id = result.scalar_one_or_none()
    session.info["wake_workers"] = True
    return job_id


async def wake_workers() -> None:
    redis = await get_redis()
    if redis is not None:
        try:
            await redis.lpush(WAKE_KEY, "1")
            await redis.ltrim(WAKE_KEY, 0, 50)
        except Exception as exc:  # noqa: BLE001
            logger.debug("No se pudo despertar workers: %s", exc)


async def commit(session: AsyncSession) -> None:
    """Confirma la transacción y, si se encolaron trabajos, despierta a los workers."""
    should_wake = session.info.pop("wake_workers", False)
    await session.commit()
    if should_wake:
        await wake_workers()


_CLAIM_SQL = text(
    """
    WITH running AS (
        SELECT user_id, count(*) AS c FROM jobs
        WHERE status = 'running' AND kind = ANY(:limited)
        GROUP BY user_id
    ), candidates AS (
        SELECT j.id FROM jobs j
        LEFT JOIN running r ON r.user_id = j.user_id
        LEFT JOIN user_settings s ON s.user_id = j.user_id
        WHERE j.status = 'queued' AND j.run_after <= now()
          AND (j.kind = ANY(:housekeeping) OR NOT coalesce(s.emergency_stop, false))
          AND (NOT (j.kind = ANY(:limited)) OR coalesce(r.c, 0) < coalesce(s.max_concurrent_tasks, 3))
        ORDER BY j.priority, j.run_after
        LIMIT :limit
        FOR UPDATE OF j SKIP LOCKED
    )
    UPDATE jobs SET status = 'running', lease_owner = :worker,
        lease_expires_at = now() + make_interval(secs => :lease),
        attempts = attempts + 1, updated_at = now()
    WHERE id IN (SELECT id FROM candidates)
    RETURNING id
    """
)


async def claim(session: AsyncSession, worker_id: str, limit: int = 1) -> list[Job]:
    rows = await session.execute(
        _CLAIM_SQL,
        {"limited": LIMITED_KINDS, "housekeeping": HOUSEKEEPING_KINDS, "limit": limit, "worker": worker_id,
         "lease": get_settings().job_lease_seconds},
    )
    ids = [r[0] for r in rows]
    await session.commit()
    if not ids:
        return []
    return list((await session.scalars(select(Job).where(Job.id.in_(ids)))).all())


async def heartbeat(session: AsyncSession, job_id: uuid.UUID, worker_id: str) -> bool:
    result = await session.execute(
        update(Job)
        .where(Job.id == job_id, Job.lease_owner == worker_id, Job.status == JobStatus.RUNNING)
        .values(lease_expires_at=datetime.now(UTC) + timedelta(seconds=get_settings().job_lease_seconds))
    )
    await session.commit()
    return result.rowcount == 1


async def mark_succeeded(session: AsyncSession, job_id: uuid.UUID, worker_id: str) -> None:
    await session.execute(
        update(Job)
        .where(Job.id == job_id, Job.lease_owner == worker_id)
        .values(status=JobStatus.SUCCEEDED, finished_at=datetime.now(UTC), lease_owner=None, lease_expires_at=None)
    )


async def mark_failed(session: AsyncSession, job_id: uuid.UUID, worker_id: str, error: str, *, retry: bool) -> bool:
    """Devuelve True si el trabajo se reprogramó para otro intento."""
    job = await session.get(Job, job_id, populate_existing=True)
    if job is None or job.lease_owner != worker_id:
        return False
    job.last_error = error[:4000]
    job.lease_owner = None
    job.lease_expires_at = None
    if retry and job.attempts < job.max_attempts:
        job.status = JobStatus.QUEUED
        job.run_after = datetime.now(UTC) + timedelta(seconds=min(5 * 2 ** job.attempts, 300))
        session.info["wake_workers"] = True
        return True
    job.status = JobStatus.FAILED
    job.finished_at = datetime.now(UTC)
    return False


async def release(session: AsyncSession, job_id: uuid.UUID, worker_id: str) -> None:
    """Devuelve un trabajo a la cola sin consumir intento (apagado ordenado del worker)."""
    await session.execute(
        update(Job)
        .where(Job.id == job_id, Job.lease_owner == worker_id, Job.status == JobStatus.RUNNING)
        .values(status=JobStatus.QUEUED, lease_owner=None, lease_expires_at=None, attempts=Job.attempts - 1)
    )
    await session.commit()


async def recover_expired(session: AsyncSession) -> list[uuid.UUID]:
    """Trabajos cuyo worker murió: vuelven a la cola, o fallan si agotaron intentos."""
    now = datetime.now(UTC)
    expired = (
        await session.scalars(
            select(Job).where(Job.status == JobStatus.RUNNING, Job.lease_expires_at < now).with_for_update(skip_locked=True)
        )
    ).all()
    recovered = []
    for job in expired:
        job.lease_owner = None
        job.lease_expires_at = None
        job.last_error = "El worker dejó de responder (lease vencido); trabajo recuperado"
        if job.attempts < job.max_attempts:
            job.status = JobStatus.QUEUED
            job.run_after = now
            recovered.append(job.id)
        else:
            job.status = JobStatus.FAILED
            job.finished_at = now
            from app.jobs.handlers import on_job_exhausted

            await on_job_exhausted(session, job)
    await session.commit()
    if recovered:
        logger.warning("Recuperados %d trabajos interrumpidos", len(recovered))
        await wake_workers()
    return recovered


async def cancel_jobs(session: AsyncSession, *, user_id: uuid.UUID, kind: str | None = None, payload_key: str | None = None,
                      payload_value: str | None = None) -> int:
    q = update(Job).where(Job.user_id == user_id, Job.status == JobStatus.QUEUED)
    if kind:
        q = q.where(Job.kind == kind)
    if payload_key and payload_value:
        q = q.where(Job.payload[payload_key].astext == payload_value)
    result = await session.execute(q.values(status=JobStatus.CANCELLED, finished_at=datetime.now(UTC)))
    return result.rowcount or 0
