"""Escenario de punta a punta interrumpiendo el worker en plena misión (PARTE 20)."""

from __future__ import annotations

import asyncio
import json

import httpx
from sqlalchemy import select, text

from app.core.db import session_factory
from app.models import Job, MissionTask, TaskAttempt, ToolExecution
from app.providers import registry
from app.worker import Worker
from tests.conftest import configure_provider, drain
from tests.fake_llm import _text_of

PLAN = {"analysis": "a", "complexity": "simple", "needs_research": False, "strategy": "s",
        "tasks": [{"key": "t1", "title": "Arquitectura", "description": "Diseñar y guardar borrador", "task_type": "code",
                   "agent": "cipher", "depends_on": []}]}


class HangingTransport(httpx.AsyncBaseTransport):
    """Cuelga para siempre la llamada que cumple `predicate` (simula que el proceso muere ahí)."""

    def __init__(self, fake, predicate) -> None:
        self.fake = fake
        self.predicate = predicate
        self.reached = asyncio.Event()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        await request.aread()
        if request.content:
            body = json.loads(request.content)
            if self.predicate(body):
                self.reached.set()
                await asyncio.Event().wait()
        return self.fake.handle(request)


async def test_worker_crash_mid_task_resumes_without_duplicates(api, fake_llm):
    await configure_provider(api)
    fake_llm.plan = PLAN
    fake_llm.task_tools = {"t1": [("drafts__create", {"title": "Arquitectura", "content": "# Capas\nAPI, dominio, datos"})]}
    mid = (await api.post("/missions", {"title": "Crash", "objective": "Probar recuperación"})).json()["id"]
    await drain(max_rounds=1)  # solo la planificación

    def after_tool(body):  # segunda llamada de la tarea: ya se ejecutó la herramienta con efectos
        first = _text_of(body["messages"][0]["content"])
        return "Tu tarea (t1)" in first and len(body["messages"]) > 1

    hanging = HangingTransport(fake_llm, after_tool)
    registry.set_transport_override(hanging)
    doomed = Worker(concurrency=1, worker_id="doomed-worker")
    await doomed.poll_once()
    await asyncio.wait_for(hanging.reached.wait(), timeout=10)
    # El "servidor" muere: se cancela el proceso sin limpieza ordenada.
    for t in list(doomed.running.values()):
        t.cancel()
    await asyncio.sleep(0.05)

    async with session_factory()() as s:
        job = await s.scalar(select(Job).where(Job.kind == "task.run"))
        assert job.status == "running" and job.lease_owner == "doomed-worker"
        task = await s.scalar(select(MissionTask))
        assert task.status == "running"
        executed = (await s.scalars(select(ToolExecution))).all()
        assert len(executed) == 1 and executed[0].status == "succeeded"  # el efecto ya ocurrió y quedó confirmado
        # Pasa el tiempo: el lease vence.
        await s.execute(text("UPDATE jobs SET lease_expires_at = now() - interval '1 second' WHERE status = 'running'"))
        await s.commit()

    registry.set_transport_override(fake_llm.transport())
    await drain(worker_id="recovery-worker")

    detail = (await api.get(f"/missions/{mid}")).json()
    assert detail["status"] == "completed"
    async with session_factory()() as s:
        executions = (await s.scalars(select(ToolExecution).where(ToolExecution.tool_key == "drafts.create"))).all()
        assert len(executions) == 1, "la herramienta con efectos no debe ejecutarse dos veces"
        task = await s.scalar(select(MissionTask))
        attempts = (await s.scalars(select(TaskAttempt).where(TaskAttempt.task_id == task.id).order_by(TaskAttempt.attempt_number))).all()
        assert [a.status for a in attempts] == ["interrupted", "succeeded"]
        assert attempts[1].worker_id == "recovery-worker"
        assert len(task.result_data["drafts"]) == 1
        job = await s.scalar(select(Job).where(Job.kind == "task.run"))
        assert job.status == "succeeded" and job.attempts == 2


async def test_completed_task_not_rerun_after_redelivery(api, fake_llm):
    """Si un trabajo se re-entrega tras completarse la tarea (caída antes de cerrar el job), no se repite."""
    await configure_provider(api)
    fake_llm.plan = PLAN
    mid = (await api.post("/missions", {"title": "Redelivery", "objective": "Probar idempotencia"})).json()["id"]
    await drain()
    calls_before = len(fake_llm.calls)
    async with session_factory()() as s:
        task = await s.scalar(select(MissionTask))
        from app.jobs import queue

        await queue.enqueue(s, "task.run", {"task_id": str(task.id)}, user_id=task.user_id, idempotency_key=f"task.run:{task.id}")
        await s.commit()
    await drain()
    assert len(fake_llm.calls) == calls_before
    assert (await api.get(f"/missions/{mid}")).json()["status"] == "completed"
