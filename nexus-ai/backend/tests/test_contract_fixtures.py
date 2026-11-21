"""Contrato backend ↔ app: corre un escenario real (misión, reunión, chat, proyecto) y guarda las
respuestas JSON de la API como fixtures de la app Android. Si cambia el contrato, los tests de
la app (que parsean y renderizan estos JSON) lo detectan."""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import update

from app.core.db import session_factory
from app.models import Agent
from tests.conftest import configure_provider, drain

FIXTURES = Path(__file__).resolve().parents[2] / "android" / "app" / "src" / "test" / "resources" / "fixtures"


async def test_export_api_fixtures(api, fake_llm):
    await configure_provider(api)
    project = (await api.post("/projects", {"name": "APEX F1", "objective": "Simulador de F1 con telemetría", "description": "Juego de carreras"})).json()
    fake_llm.task_tools = {"t3": [("drafts__create", {"title": "Arquitectura", "content": "# Arquitectura\nCapas: API, dominio, datos"})]}
    mission = (await api.post("/missions", {"title": "Crear app de gestión de videojuegos",
                                            "objective": "Diseñar y prototipar una app para gestionar una colección de videojuegos",
                                            "project_id": project["id"]})).json()
    await drain()
    meeting = (await api.post("/meetings", {"topic": "Arquitectura del simulador", "objective": "Elegir motor y arquitectura",
                                            "meeting_type": "technical", "participants": ["atlas", "cipher", "oracle"], "max_rounds": 2})).json()
    await drain()
    conv = (await api.post("/conversations", {})).json()
    await api.post(f"/conversations/{conv['id']}/messages", {"content": "Hola NEXUS, ¿qué podés hacer por mí?"})
    await drain()
    # Escenario visual: dos agentes trabajando en una segunda misión en curso.
    second = (await api.post("/missions", {"title": "Investigar motores de física", "objective": "Comparar motores de física para el simulador"})).json()
    async with session_factory()() as s:
        await s.execute(update(Agent).where(Agent.slug.in_(["atlas", "cipher"])).values(status="working", status_detail="Investigando motores de física"))
        await s.execute(update(Agent).where(Agent.slug == "nexus").values(status="thinking", status_detail="Coordinando la misión"))
        await s.commit()

    # NEXUS 2.0: JARVIS (acción de WhatsApp pendiente, recordatorio ejecutado, respuesta con modelo), rutinas y voz.
    tz = "America/Argentina/Buenos_Aires"
    posts: dict[str, dict] = {}
    posts["jarvis_message_whatsapp"] = (await api.post("/jarvis/message", {"content": "Mandale un mensaje a papá diciendo que llego tarde", "timezone": tz})).json()
    posts["jarvis_message_reminder"] = (await api.post("/jarvis/message", {"content": "Recordame mañana a las 9 llamar al médico", "timezone": tz})).json()
    posts["jarvis_message_open_app"] = (await api.post("/jarvis/message", {"content": "Abrí Spotify", "timezone": tz})).json()
    posts["jarvis_message_model"] = (await api.post("/jarvis/message", {"content": "¿Cuál es la capital de Australia?", "timezone": tz})).json()
    await drain()
    posts["jarvis_message_control"] = (await api.post("/jarvis/message", {"content": "Pará", "timezone": tz})).json()
    wa = posts["jarvis_message_whatsapp"]["action"]
    posts["action_confirm_whatsapp"] = (await api.post(f"/actions/{wa['id']}/confirm", {"params": {"text": "Llego tarde, perdón"}})).json()
    posts["action_report_whatsapp"] = (await api.post(f"/actions/{wa['id']}/report", {"state": "WHATSAPP_OPENED", "result": {"text_chars": 19}})).json()
    await api.post("/automations", {"name": "Resumen diario", "trigger_type": "schedule", "cron": "0 8 * * *", "timezone": tz,
                                    "actions": [{"type": "jarvis_prompt", "prompt": "Resumime mis misiones"}]})
    await api.post("/automations", {"name": "Aviso de misiones", "trigger_type": "event", "event_type": "mission.completed",
                                    "actions": [{"type": "notify", "title": "Terminó una misión"}]})
    posts["whatsapp_prepare"] = (await api.post("/integrations/whatsapp/prepare", {"phone": "011 15 2345-6789", "text": "Hola", "register_action": False})).json()
    posts["intent"] = (await api.post("/jarvis/intent", {"content": "Poné una alarma a las 7", "timezone": tz})).json()

    FIXTURES.mkdir(parents=True, exist_ok=True)
    for name, body in posts.items():
        (FIXTURES / f"{name}.json").write_text(json.dumps(body, ensure_ascii=False, indent=1), encoding="utf-8")
    agents = (await api.get("/agents")).json()
    nova = next(a for a in agents if a["slug"] == "nova")
    endpoints = {
        "dashboard": "/dashboard",
        "system_status": "/system/status",
        "agents": "/agents",
        "agent_detail": f"/agents/{nova['id']}",
        "persona_catalog": "/agents/persona-catalog",
        "agent_tasks": f"/agents/{nova['id']}/tasks",
        "agent_instructions": f"/agents/{nova['id']}/instructions",
        "missions": "/missions",
        "mission_detail": f"/missions/{mission['id']}",
        "mission_messages": f"/missions/{mission['id']}/messages",
        "meetings": "/meetings",
        "meeting_detail": f"/meetings/{meeting['id']}",
        "memory": "/memory",
        "activity": "/activity",
        "notifications": "/notifications",
        "approvals": "/approvals",
        "settings": "/settings",
        "providers": "/providers",
        "provider_kinds": "/providers/kinds",
        "models": "/models",
        "tools": "/tools",
        "plugins": "/plugins",
        "projects": "/projects",
        "project_detail": f"/projects/{project['id']}",
        "project_files": f"/projects/{project['id']}/files",
        "conversations": "/conversations",
        "conversation_messages": f"/conversations/{conv['id']}/messages",
        "schedules": "/schedules",
        "usage_summary": "/usage/summary",
        "memory_stats": "/memory/stats",
        "jarvis_state": "/jarvis/state",
        "jarvis_context": f"/jarvis/context?timezone={tz}",
        "jarvis_settings": "/jarvis/settings",
        "jarvis_conversation_messages": f"/conversations/{posts['jarvis_message_model']['conversation_id']}/messages",
        "jarvis_trace": f"/jarvis/messages/{posts['jarvis_message_model']['user_message']['id']}/trace",
        "actions": "/actions",
        "actions_catalog": "/actions/catalog",
        "automations": "/automations",
        "automation_events": "/automations/events",
        "voice_settings": "/voice/settings",
        "whatsapp_status": "/integrations/whatsapp/status",
        "memory_privacy": "/memory/privacy",
        "quality": "/quality",
    }
    ids = {"nova": nova["id"], "mission": mission["id"], "meeting": meeting["id"], "project": project["id"], "conversation": conv["id"],
           "second_mission": second["id"]}
    for name, path in endpoints.items():
        resp = await api.get(path)
        assert resp.status_code == 200, (path, resp.text)
        (FIXTURES / f"{name}.json").write_text(json.dumps(resp.json(), ensure_ascii=False, indent=1), encoding="utf-8")
    (FIXTURES / "ids.json").write_text(json.dumps(ids), encoding="utf-8")
    assert (FIXTURES / "dashboard.json").exists()
