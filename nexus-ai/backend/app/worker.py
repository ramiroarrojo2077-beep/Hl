"""Proceso worker: ejecuta los trabajos de la cola durable.

Los agentes trabajan aquí, independientemente de la API y de que la app Android esté
abierta. Se pueden correr varios workers en paralelo (escalado horizontal).

Uso:  python -m app.worker
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import socket
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update

from app.core.config import get_settings
from app.core.db import dispose_engine, session_factory
from app.core.logging import log, setup_logging
from app.core.redis import close_redis, get_redis
from app.jobs import queue
from app.jobs.handlers import HANDLERS, on_job_failed_permanently
from app.jobs.scheduler import tick
from app.models import Agent, Job
from app.monitoring import metrics
from app.providers.registry import close_http_client
from app.tools.registry import sync_tool_definitions

logger = logging.getLogger("nexus.worker")

# Errores que no tiene sentido reintentar.
NON_RETRYABLE = {"budget_exceeded", "emergency_stop", "no_model_available", "not_found", "invalid_memory"}


class Worker:
    def __init__(self, concurrency: int | None = None, worker_id: str | None = None) -> None:
        settings = get_settings()
        self.concurrency = concurrency or settings.worker_concurrency
        self.worker_id = worker_id or f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:6]}"
        self.running: dict[uuid.UUID, asyncio.Task[None]] = {}
        self.stopping = asyncio.Event()
        self._last_recovery = datetime.min.replace(tzinfo=UTC)
        self._last_schedule = datetime.min.replace(tzinfo=UTC)
        self._last_housekeeping = datetime.min.replace(tzinfo=UTC)

    async def run_job(self, job: Job) -> None:
        handler = HANDLERS.get(job.kind)
        heartbeat = asyncio.create_task(self._heartbeat(job.id))
        started = asyncio.get_running_loop().time()
        try:
            async with session_factory()() as session:
                if handler is None:
                    await queue.mark_failed(session, job.id, self.worker_id, f"Tipo de trabajo desconocido: {job.kind}", retry=False)
                    await session.commit()
                    return
                try:
                    job_row = await session.get(Job, job.id)
                    assert job_row is not None
                    await handler(session, job_row, self.worker_id)
                    await queue.mark_succeeded(session, job.id, self.worker_id)
                    await queue.commit(session)
                    metrics.JOBS.labels(job.kind, "succeeded").inc()
                except Exception as exc:  # noqa: BLE001
                    code = getattr(exc, "code", None)
                    message = getattr(exc, "message", None) or f"{type(exc).__name__}: {exc}"
                    log(logger, logging.WARNING, "Trabajo falló", job_id=str(job.id), kind=job.kind, error=message[:500])
                    await session.rollback()
                    retried = await queue.mark_failed(session, job.id, self.worker_id, message, retry=code not in NON_RETRYABLE)
                    if not retried:
                        job_row = await session.get(Job, job.id)
                        if job_row is not None:
                            await on_job_failed_permanently(session, job_row, message)
                    await queue.commit(session)
                    metrics.JOBS.labels(job.kind, "retried" if retried else "failed").inc()
        finally:
            heartbeat.cancel()
            metrics.JOB_SECONDS.labels(job.kind).observe(asyncio.get_running_loop().time() - started)

    async def _heartbeat(self, job_id: uuid.UUID) -> None:
        interval = max(get_settings().job_lease_seconds / 3, 1)
        while True:
            await asyncio.sleep(interval)
            try:
                async with session_factory()() as session:
                    await queue.heartbeat(session, job_id, self.worker_id)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Heartbeat falló para %s: %s", job_id, exc)

    async def maintenance(self) -> None:
        now = datetime.now(UTC)
        async with session_factory()() as session:
            if now - self._last_recovery > timedelta(seconds=15):
                await queue.recover_expired(session)
                self._last_recovery = now
            if now - self._last_schedule > timedelta(seconds=20):
                await tick(session)
                self._last_schedule = now
            if now - self._last_housekeeping > timedelta(seconds=60):
                # Avatares en "completed" vuelven a reposo pasado un minuto sin actividad.
                await session.execute(
                    update(Agent)
                    .where(Agent.status == "completed", Agent.last_activity_at < now - timedelta(seconds=60))
                    .values(status="idle")
                )
                await session.commit()
                self._last_housekeeping = now

    async def poll_once(self) -> int:
        free = self.concurrency - len(self.running)
        if free <= 0:
            return 0
        async with session_factory()() as session:
            jobs = await queue.claim(session, self.worker_id, limit=free)
        for job in jobs:
            task = asyncio.create_task(self.run_job(job))
            self.running[job.id] = task
            task.add_done_callback(lambda _t, jid=job.id: self.running.pop(jid, None))
        return len(jobs)

    async def wait_for_work(self) -> None:
        timeout = get_settings().worker_poll_seconds
        redis = await get_redis()
        if redis is not None:
            try:
                await redis.blpop([queue.WAKE_KEY], timeout=max(1, int(timeout)))
                return
            except Exception:  # noqa: BLE001
                pass
        try:
            await asyncio.wait_for(self.stopping.wait(), timeout=timeout)
        except TimeoutError:
            pass

    async def run(self) -> None:
        log(logger, logging.INFO, "Worker iniciado", worker_id=self.worker_id, concurrency=self.concurrency)
        async with session_factory()() as session:
            await sync_tool_definitions(session)
            await session.commit()
            await queue.recover_expired(session)
        while not self.stopping.is_set():
            try:
                await self.maintenance()
                claimed = await self.poll_once()
                if claimed == 0:
                    await self.wait_for_work()
            except Exception:  # noqa: BLE001 - el bucle del worker nunca debe morir
                logger.exception("Error en el bucle del worker")
                await asyncio.sleep(2)
        await self.shutdown()

    async def shutdown(self, grace_seconds: float = 20) -> None:
        log(logger, logging.INFO, "Apagando worker", running=len(self.running))
        if self.running:
            _, pending = await asyncio.wait(list(self.running.values()), timeout=grace_seconds)
            pending_ids = [jid for jid, t in self.running.items() if t in pending]
            for task in pending:
                task.cancel()
            # Los trabajos no terminados se liberan para que otro worker los retome de inmediato.
            async with session_factory()() as session:
                for job_id in pending_ids:
                    await queue.release(session, job_id, self.worker_id)


async def main() -> None:
    settings = get_settings()
    setup_logging(settings.log_level)
    worker = Worker()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, worker.stopping.set)
    metrics.start_worker_metrics_server()
    try:
        await worker.run()
    finally:
        await close_http_client()
        await close_redis()
        await dispose_engine()


if __name__ == "__main__":
    asyncio.run(main())
