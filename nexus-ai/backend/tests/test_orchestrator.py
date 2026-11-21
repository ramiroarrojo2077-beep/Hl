"""Escenario obligatorio de punta a punta (PARTE 20)."""

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.core.db import session_factory
from app.models import AgentMessage, AuditLog, Job, MemoryItem, MissionTask, TaskAttempt, ToolExecution, UsageRecord
from app.orchestrator.planner import PlanValidationError, parse_plan
from tests.conftest import configure_provider, drain

SLUGS = {"nexus", "atlas", "cipher", "nova", "oracle", "guardian"}


def test_plan_validation():
    ok = parse_plan('{"tasks":[{"key":"a","title":"t","description":"d","agent":"atlas"},'
                    '{"key":"b","title":"t","description":"d","agent":"cipher","depends_on":["a"]}]}', SLUGS)
    assert [t.key for t in ok.tasks] == ["a", "b"]
    with pytest.raises(PlanValidationError, match="ciclo"):
        parse_plan('{"tasks":[{"key":"a","title":"t","description":"d","agent":"atlas","depends_on":["b"]},'
                   '{"key":"b","title":"t","description":"d","agent":"atlas","depends_on":["a"]}]}', SLUGS)
    with pytest.raises(PlanValidationError, match="inexistente"):
        parse_plan('{"tasks":[{"key":"a","title":"t","description":"d","agent":"jarvis"}]}', SLUGS)
    with pytest.raises(PlanValidationError):
        parse_plan("no es json", SLUGS)
    fenced = parse_plan('Plan:\n```json\n{"tasks":[{"title":"t","description":"d","agent":"nexus"}]}\n```', SLUGS)
    assert fenced.tasks[0].key == "t1"


async def test_end_to_end_mission(api, fake_llm):
    await configure_provider(api)
    fake_llm.task_tools = {"t1": [("memory__search", {"query": "stacks de apps de videojuegos"})],
                           "t3": [("drafts__create", {"title": "Arquitectura", "content": "# Arquitectura\nAPI + DB"})]}
    # 1-2: el usuario (autenticado) crea una misión
    r = await api.post("/missions", {"title": "App de videojuegos", "objective": "Crear una aplicación de gestión de videojuegos"})
    assert r.status_code == 201, r.text
    mission_id = r.json()["id"]
    assert r.json()["status"] == "planning"
    await drain()

    detail = (await api.get(f"/missions/{mission_id}")).json()
    assert detail["status"] == "completed", detail.get("status_reason")
    # 3-5: NEXUS analizó, creó subtareas y asignó agentes
    assert detail["plan"]["complexity"] == "complex" and len(detail["plan"]["tasks"]) == 3
    tasks = {t["key"]: t for t in detail["tasks"]}
    agents = {a["id"]: a["slug"] for a in (await api.get("/agents")).json()}
    assert {k: agents[t["agent_id"]] for k, t in tasks.items()} == {"t1": "atlas", "t2": "nova", "t3": "cipher"}
    assert tasks["t3"]["depends_on"] and set(tasks["t3"]["depends_on"]) == {tasks["t1"]["id"], tasks["t2"]["id"]}
    # 6-8: tareas reales ejecutadas con el modelo y resultados guardados
    assert all(t["status"] == "completed" and t["result"] and t["model_used"] == "anthropic:claude-test-opus" for t in tasks.values())
    assert tasks["t3"]["drafts"][0]["title"] == "Arquitectura"
    # t3 recibió los resultados de t1 y t2 en su contexto
    t3_call = next(c for c in fake_llm.calls_matching("Tu tarea (t3)"))
    first = t3_call["messages"][0]["content"]
    assert "Resultado de t1" in first and "Resultado de t2" in first
    # t1 y t2 independientes: arrancaron antes de que terminara la otra (paralelas)
    assert tasks["t1"]["started_at"] < tasks["t2"]["completed_at"] and tasks["t2"]["started_at"] < tasks["t1"]["completed_at"]
    # 9: ORACLE revisó; 10: GUARDIAN auditó con evidencia real
    assert detail["review"]["verdict"] == "approve" and detail["review"]["model"]
    sec = detail["security_review"]
    assert sec["assessment"]["status"] == "ok" and sec["evidence"]["tool_executions"] == 2
    # 11-12: NEXUS consolidó y el usuario recibe el resultado
    assert detail["result"].startswith("# Informe final") and "```json" not in detail["result"]
    notes = (await api.get("/notifications")).json()
    assert any(n["event_type"] == "mission_completed" and n["data"]["mission_id"] == mission_id for n in notes)
    # 14: aprendizajes archivados como memoria no verificada
    async with session_factory()() as s:
        learning = await s.scalar(select(MemoryItem).where(MemoryItem.source == "mission"))
        assert learning is not None and learning.verification_status == "unverified"
        usage = await s.scalar(select(func.count()).select_from(UsageRecord).where(UsageRecord.success.is_(True)))
        # plan + 3 tareas (t1 y t3 con herramienta = 2 llamadas c/u) + revisión + auditoría + consolidación
        assert usage == 1 + 5 + 1 + 1 + 1
        actions = set((await s.scalars(select(AuditLog.action))).all())
        assert {"mission.created", "mission.planned", "task.completed", "tool.executed", "mission.reviewed",
                "mission.security_review", "mission.completed"} <= actions
        msgs = (await s.scalars(select(AgentMessage.message_type).where(AgentMessage.channel == "mission"))).all()
        assert {"plan", "result", "review", "security", "summary"} <= set(msgs)
    assert detail["progress"] == 1.0 and float(detail["spent_usd"]) > 0


async def test_oracle_requests_revision(api, fake_llm):
    await configure_provider(api)
    fake_llm.plan = {"analysis": "a", "complexity": "simple", "needs_research": False, "strategy": "s",
                     "tasks": [{"key": "t1", "title": "Informe", "description": "Escribir", "task_type": "writing", "agent": "nova", "depends_on": []}]}
    fake_llm.review_verdicts = [
        {"verdict": "revise", "score": 4, "summary": "Falta detalle", "issues": [{"task_key": "t1", "severity": "high", "problem": "incompleto", "fix": "agregar costos"}]},
        {"verdict": "approve", "score": 8, "summary": "Corregido", "issues": []},
    ]
    mid = (await api.post("/missions", {"title": "Informe", "objective": "Escribir informe"})).json()["id"]
    await drain()
    detail = (await api.get(f"/missions/{mid}")).json()
    assert detail["status"] == "completed"
    keys = [t["key"] for t in detail["tasks"]]
    assert keys == ["t1", "t1-r1"]
    revision = detail["tasks"][1]
    assert revision["task_type"] == "revision" and "agregar costos" in revision["description"]
    assert revision["revision_of_id"] == detail["tasks"][0]["id"]
    assert len(fake_llm.calls_matching("Revisá el trabajo del equipo")) == 2


async def test_task_failure_retries_then_blocks_and_manual_retry(api, fake_llm):
    await configure_provider(api)
    fake_llm.plan = {"analysis": "a", "complexity": "simple", "needs_research": False, "strategy": "s",
                     "tasks": [{"key": "t1", "title": "Algo", "description": "d", "task_type": "general", "agent": "nova", "depends_on": []}]}
    from tests.fake_llm import _text_of

    failing = {"on": True, "count": 0}

    def fail_task(body):
        if failing["on"] and "Tu tarea (t1)" in _text_of(body["messages"][0]["content"]):
            failing["count"] += 1
            return 500
        return None

    fake_llm.fail_when = fail_task
    mid = (await api.post("/missions", {"title": "Falla", "objective": "Probar fallas"})).json()["id"]
    await drain()
    # 3 intentos de la tarea x 3 llamadas HTTP (con reintento) cada uno
    assert failing["count"] == 9
    detail = (await api.get(f"/missions/{mid}")).json()
    assert detail["status"] == "blocked"
    task = detail["tasks"][0]
    assert task["status"] == "failed" and task["attempts"] == 3
    notes = {n["event_type"] for n in (await api.get("/notifications")).json()}
    assert {"important_error", "mission_blocked"} <= notes
    # El usuario reintenta y ahora el proveedor responde
    failing["on"] = False
    r = await api.post(f"/missions/{mid}/tasks/{task['id']}/retry")
    assert r.status_code == 200, r.text
    await drain()
    detail = (await api.get(f"/missions/{mid}")).json()
    assert detail["status"] == "completed" and detail["tasks"][0]["status"] == "completed"


async def test_pause_resume_cancel(api, fake_llm):
    await configure_provider(api)
    mid = (await api.post("/missions", {"title": "Pausa", "objective": "objetivo de prueba"})).json()["id"]
    await drain(max_rounds=2)  # planifica y encola tareas
    assert (await api.post(f"/missions/{mid}/pause")).json()["status"] == "paused"
    await drain()
    detail = (await api.get(f"/missions/{mid}")).json()
    assert detail["status"] == "paused"
    assert not any(t["status"] == "completed" for t in detail["tasks"] if t["key"] == "t3")
    assert (await api.post(f"/missions/{mid}/resume")).json()["status"] == "running"
    await drain()
    assert (await api.get(f"/missions/{mid}")).json()["status"] == "completed"
    mid2 = (await api.post("/missions", {"title": "Cancelar", "objective": "objetivo de prueba"})).json()["id"]
    cancelled = (await api.post(f"/missions/{mid2}/cancel")).json()
    assert cancelled["status"] == "cancelled"
    await drain()
    async with session_factory()() as s:
        jobs = (await s.scalars(select(Job).where(Job.payload["mission_id"].astext == mid2))).all()
        assert all(j.status == "cancelled" for j in jobs)
