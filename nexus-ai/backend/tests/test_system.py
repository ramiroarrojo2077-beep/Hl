from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select, text

from app.core import events
from app.core.db import session_factory
from app.core.errors import EmergencyStopActive
from app.models import Agent, AgentPermission, Job, Mission, Notification, ScheduledJob, User
from app.providers import gateway
from app.providers.base import Message
from tests.conftest import configure_provider, drain


async def test_stop_all_agents_and_resume(api, fake_llm):
    await configure_provider(api)
    mid = (await api.post("/missions", {"title": "Larga", "objective": "Misión a detener"})).json()["id"]
    await drain(max_rounds=1)
    async with session_factory()() as s:
        atlas = await s.scalar(select(Agent).where(Agent.slug == "atlas"))
        s.add(AgentPermission(agent_id=atlas.id, tool_key="webhook.send", expires_at=datetime.now(UTC) + timedelta(hours=1)))
        await s.commit()
    r = await api.post("/system/emergency-stop", {"reason": "prueba"})
    assert r.status_code == 200 and r.json()["missions_paused"] == 1 and r.json()["temporary_permissions_revoked"] == 1
    detail = (await api.get(f"/missions/{mid}")).json()
    assert detail["status"] == "paused" and detail["status_reason"] == "STOP ALL AGENTS"
    assert all(a["status"] == "paused" for a in (await api.get("/agents")).json())
    calls = len(fake_llm.calls)
    await drain()
    assert len(fake_llm.calls) == calls, "ningún agente debe llamar a modelos con STOP ALL activo"
    async with session_factory()() as s:
        uid = (await s.scalar(select(User))).id
        with pytest.raises(EmergencyStopActive):
            await gateway.complete(s, gateway.CallContext(user_id=uid, purpose="x"), system="s", messages=[Message(role="user", content="x")])
    assert (await api.post(f"/missions/{mid}/resume")).status_code == 409
    cleared = await api.delete("/system/emergency-stop")
    assert cleared.json()["missions_resumed"] == 1
    await drain()
    assert (await api.get(f"/missions/{mid}")).json()["status"] == "completed"
    activity = (await api.get("/activity", params={"action": "system."})).json()
    assert {a["action"] for a in activity} == {"system.emergency_stop", "system.emergency_stop_cleared"}


async def test_chat_streams_and_nexus_creates_mission(api, fake_llm):
    await configure_provider(api)
    fake_llm.chat_tool = ("missions__create", {"title": "Investigar motores", "objective": "Comparar motores de juego 2D"})
    conv = (await api.post("/conversations", {})).json()
    received: list[dict] = []

    async def listen():
        async for ev in events.subscribe(api.user["id"]):
            received.append(ev)

    listener = asyncio.create_task(listen())
    await asyncio.sleep(0)
    r = await api.post(f"/conversations/{conv['id']}/messages", {"content": "Creá una misión para investigar motores de juego"})
    assert r.status_code == 202
    await drain(max_rounds=1)
    listener.cancel()
    msgs = (await api.get(f"/conversations/{conv['id']}/messages")).json()
    assert [m["sender_type"] for m in msgs] == ["user", "agent"]
    reply = msgs[1]
    assert reply["meta"]["tools_used"] == ["missions.create"] and reply["model_used"] == "anthropic:claude-test-opus"
    deltas = "".join(e["data"]["delta"] for e in received if e["type"] == "chat.delta")
    assert deltas == reply["content"] and reply["content"].startswith("Listo:")
    missions = (await api.get("/missions")).json()
    assert missions[0]["title"] == "Investigar motores"
    assert any(e["type"] == "agent.status" for e in received)


async def test_chat_error_is_reported_not_faked(api):
    conv = (await api.post("/conversations", {})).json()
    await api.post(f"/conversations/{conv['id']}/messages", {"content": "Hola"})
    await drain()
    msgs = (await api.get(f"/conversations/{conv['id']}/messages")).json()
    assert msgs[1]["sender_type"] == "system" and "Configurá un proveedor" in msgs[1]["content"]


async def test_recurring_mission_and_reminder(api, fake_llm):
    await configure_provider(api)
    bad = await api.post("/schedules", {"kind": "mission", "name": "x", "cron": "no es cron", "payload": {"objective": "o"}})
    assert bad.status_code == 400
    r = await api.post("/schedules", {"kind": "mission", "name": "Revisión diaria", "cron": "0 9 * * *", "timezone": "America/Argentina/Buenos_Aires",
                                      "payload": {"title": "Revisión diaria", "objective": "Revisar proyectos activos"}})
    assert r.status_code == 201, r.text
    sched = r.json()
    assert datetime.fromisoformat(sched["next_run_at"]).astimezone(UTC).hour == 12  # 9:00 ART = 12:00 UTC
    reminder = (await api.post("/schedules", {"kind": "reminder", "name": "Llamar", "run_once_at": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
                                              "payload": {"title": "Llamar al equipo", "body": "Daily"}})).json()
    async with session_factory()() as s:
        await s.execute(text("UPDATE scheduled_jobs SET next_run_at = now() - interval '1 second'"))
        await s.commit()
    await drain()
    missions = (await api.get("/missions")).json()
    assert len(missions) == 1 and missions[0]["status"] == "completed" and missions[0]["autonomy_mode"] == "scheduled"
    schedules = {x["id"]: x for x in (await api.get("/schedules")).json()}
    assert schedules[sched["id"]]["run_count"] == 1 and datetime.fromisoformat(schedules[sched["id"]]["next_run_at"]) > datetime.now(UTC)
    assert schedules[reminder["id"]]["is_enabled"] is False
    notes = (await api.get("/notifications")).json()
    assert any(n["event_type"] == "reminder" and n["title"] == "Llamar al equipo" for n in notes)


async def _ws_session(app_messages: list, token: str | None):
    from app.main import app

    incoming: asyncio.Queue = asyncio.Queue()
    await incoming.put({"type": "websocket.connect"})
    if token is not None:
        await incoming.put({"type": "websocket.receive", "text": json.dumps({"type": "auth", "token": token})})
        await incoming.put({"type": "websocket.receive", "text": json.dumps({"type": "ping"})})

    async def receive():
        return await incoming.get()

    async def send(msg):
        app_messages.append(msg)

    scope = {"type": "websocket", "path": "/api/v1/ws", "raw_path": b"/api/v1/ws", "query_string": b"", "headers": [],
             "scheme": "ws", "server": ("test", 80), "client": ("1.2.3.4", 1), "subprotocols": [], "asgi": {"version": "3.0"}, "root_path": ""}
    task = asyncio.create_task(app(scope, receive, send))
    return task, incoming


async def test_websocket_requires_auth_and_delivers_user_events(api, monkeypatch):
    from app.api import ws as ws_module

    monkeypatch.setattr(ws_module, "AUTH_TIMEOUT", 0.3)
    sent: list = []
    task, _ = await _ws_session(sent, None)
    await asyncio.wait_for(task, 3)
    assert any(m.get("type") == "websocket.close" and m.get("code") == 4401 for m in sent)

    sent = []
    task, incoming = await _ws_session(sent, api.tokens["access_token"])
    for _ in range(50):
        if any(m.get("type") == "websocket.send" and "pong" in m.get("text", "") for m in sent):
            break
        await asyncio.sleep(0.02)
    await events.publish(api.user["id"], "mission.updated", {"id": "x", "status": "running"})
    await events.publish("00000000-0000-0000-0000-000000000000", "mission.updated", {"id": "otro-usuario"})
    await asyncio.sleep(0.05)
    texts = [json.loads(m["text"]) for m in sent if m.get("type") == "websocket.send"]
    assert texts[0]["type"] == "ready"
    assert any(t.get("type") == "pong" for t in texts)
    assert [t["data"]["id"] for t in texts if t.get("type") == "mission.updated"] == ["x"]
    await incoming.put({"type": "websocket.disconnect", "code": 1000})
    await asyncio.wait_for(task, 3)


async def test_dashboard_and_usage_report_real_numbers(api, fake_llm):
    await configure_provider(api)
    empty = (await api.get("/dashboard")).json()
    assert empty["missions"]["running"] == 0 and empty["usage"]["calls_today"] == 0 and empty["agents"]["total"] == 6
    await api.post("/missions", {"title": "Dash", "objective": "Probar dashboard"})
    await drain()
    dash = (await api.get("/dashboard")).json()
    assert dash["missions"]["completed"] == 1 and dash["tasks"]["completed_today"] == 3 and dash["usage"]["calls_today"] > 0
    assert dash["providers"][0]["models"] == 1 and dash["timeline"][0]["title"] == "Dash"
    usage = (await api.get("/usage/summary")).json()
    assert usage["totals"]["calls"] == dash["usage"]["calls_today"]
    assert {r["agent_name"] for r in usage["by_agent"]} >= {"NEXUS", "ATLAS", "ORACLE", "GUARDIAN"}
    status = (await api.get("/system/status")).json()
    assert 0 <= status["server"]["cpu_percent"] <= 100 and status["push_configured"] is False
    export = (await api.get("/export")).json()
    assert export["missions"] and "api_key_encrypted" not in json.dumps(export, default=str)


async def test_learning_archive_can_be_disabled(api, fake_llm):
    await configure_provider(api)
    await api.patch("/settings", {"memory_settings": {"archive_learnings": False}})
    await api.post("/missions", {"title": "Sin memoria", "objective": "No archivar aprendizajes"})
    await drain()
    assert (await api.get("/missions")).json()[0]["status"] == "completed"
    assert (await api.get("/memory")).json() == []
