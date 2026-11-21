from __future__ import annotations

from sqlalchemy import select

from app.core.db import session_factory
from app.models import AgentMessage, ProjectFile, ToolExecution
from tests.conftest import configure_provider, drain

PLAN = {"analysis": "a", "complexity": "simple", "needs_research": False, "strategy": "s",
        "tasks": [{"key": "t1", "title": "Código", "description": "Escribir main.py", "task_type": "code", "agent": "cipher", "depends_on": []}]}


async def _mission_with_write(api, fake_llm):
    await configure_provider(api)
    fake_llm.plan = PLAN
    fake_llm.task_tools = {"t1": [("project__write_file", {"path": "src/main.py", "content": "print('hola')"})]}
    project = (await api.post("/projects", {"name": "Juego"})).json()
    mid = (await api.post("/missions", {"title": "Código", "objective": "Escribir el main", "project_id": project["id"]})).json()["id"]
    await drain()
    return project, mid


async def test_sensitive_operation_waits_for_approval_then_resumes(api, fake_llm):
    project, mid = await _mission_with_write(api, fake_llm)
    detail = (await api.get(f"/missions/{mid}")).json()
    assert detail["tasks"][0]["status"] == "awaiting_approval"
    approvals = (await api.get("/approvals")).json()
    assert len(approvals) == 1 and approvals[0]["kind"] == "tool" and approvals[0]["details"]["tool"] == "project.write_file"
    assert any(n["event_type"] == "approval_requested" for n in (await api.get("/notifications")).json())
    calls_before = len(fake_llm.calls_matching("Tu tarea (t1)"))
    r = await api.post(f"/approvals/{approvals[0]['id']}/decision", {"approve": True, "note": "ok"})
    assert r.status_code == 200 and r.json()["status"] == "approved"
    await drain()
    detail = (await api.get(f"/missions/{mid}")).json()
    assert detail["status"] == "completed"
    # Se reanudó la conversación guardada (no se reinició): una sola llamada más para t1, con el resultado de la herramienta.
    t1_calls = fake_llm.calls_matching("Tu tarea (t1)")
    assert len(t1_calls) == calls_before + 1
    assert any(isinstance(m["content"], list) and m["content"][0].get("type") == "tool_result" for m in t1_calls[-1]["messages"])
    files = (await api.get(f"/projects/{project['id']}/files")).json()
    assert [f["path"] for f in files] == ["src/main.py"] and files[0]["version"] == 1
    async with session_factory()() as s:
        ex = (await s.scalars(select(ToolExecution).where(ToolExecution.tool_key == "project.write_file"))).all()
        assert len(ex) == 1 and ex[0].status == "succeeded"
    # Repetir la decisión no está permitido
    assert (await api.post(f"/approvals/{approvals[0]['id']}/decision", {"approve": False})).status_code == 409


async def test_rejected_operation_is_not_executed(api, fake_llm):
    project, mid = await _mission_with_write(api, fake_llm)
    approval = (await api.get("/approvals")).json()[0]
    await api.post(f"/approvals/{approval['id']}/decision", {"approve": False})
    await drain()
    assert (await api.get(f"/missions/{mid}")).json()["status"] == "completed"
    assert (await api.get(f"/projects/{project['id']}/files")).json() == []
    async with session_factory()() as s:
        ex = await s.scalar(select(ToolExecution).where(ToolExecution.tool_key == "project.write_file"))
        assert ex.status == "rejected"


async def test_manual_mode_requires_plan_approval(api, fake_llm):
    await configure_provider(api)
    await api.patch("/settings", {"autonomy_mode": "manual"})
    mid = (await api.post("/missions", {"title": "Manual", "objective": "Probar modo manual"})).json()["id"]
    await drain()
    detail = (await api.get(f"/missions/{mid}")).json()
    assert detail["status"] == "awaiting_approval" and all(t["status"] == "pending" for t in detail["tasks"])
    plan_approval = next(a for a in (await api.get("/approvals")).json() if a["kind"] == "mission_plan")
    await api.post(f"/approvals/{plan_approval['id']}/decision", {"approve": True})
    await drain()
    assert (await api.get(f"/missions/{mid}")).json()["status"] == "completed"


async def test_meeting_one_round_then_summary(api, fake_llm):
    await configure_provider(api)
    r = await api.post("/meetings", {"topic": "Arquitectura del juego", "objective": "Elegir arquitectura", "meeting_type": "technical",
                                     "participants": ["atlas", "oracle"], "max_rounds": 3})
    assert r.status_code == 201, r.text
    mid = r.json()["id"]
    assert {p["slug"] for p in r.json()["participants"]} == {"nexus", "atlas", "oracle"}
    await drain()
    detail = (await api.get(f"/meetings/{mid}")).json()
    assert detail["status"] == "completed" and detail["current_round"] == 1
    speakers = [m for m in detail["messages"] if m["message_type"] != "summary"]
    assert len(speakers) == 3 and all(m["model_used"] for m in speakers)
    assert all(m["message_type"] == "proposal" for m in speakers)
    assert detail["outcome"]["decisions"] == ["Usar arquitectura modular"] and detail["summary"]
    assert any(n["event_type"] == "meeting_finished" for n in (await api.get("/notifications")).json())
    mission = await api.post(f"/meetings/{mid}/mission", {})
    assert mission.status_code == 201 and "Prototipo" in mission.json()["objective"]


async def test_meeting_respects_round_limit(api, fake_llm):
    await configure_provider(api)
    fake_llm.meeting_continue = True
    mid = (await api.post("/meetings", {"topic": "Debate", "objective": "Debatir opciones", "participants": ["nova", "cipher"],
                                        "max_rounds": 2})).json()["id"]
    await drain()
    detail = (await api.get(f"/meetings/{mid}")).json()
    assert detail["status"] == "completed" and detail["current_round"] == 2
    async with session_factory()() as s:
        msgs = (await s.scalars(select(AgentMessage).where(AgentMessage.channel_id == detail["id"]))).all()
    kinds = [m.message_type for m in msgs]
    assert kinds.count("proposal") == 5 and kinds.count("moderation") == 1 and kinds.count("summary") == 1
    assert detail["stop_reason"] == "Se alcanzó el máximo de rondas"
