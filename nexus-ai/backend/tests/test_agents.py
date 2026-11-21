from __future__ import annotations

from sqlalchemy import select

from app.agents.runtime import build_system_prompt
from app.core.db import session_factory
from app.models import Agent
from tests.conftest import register


async def test_six_agents_with_distinct_personas(api):
    agents = (await api.get("/agents")).json()
    assert [a["slug"] for a in agents][:6] and len(agents) == 6
    nova = next(a for a in agents if a["slug"] == "nova")
    assert nova["profile"]["traits"]["emotions"]["empathy"] == 95
    assert nova["profile"]["appearance"]["hair"] == "asymmetric"
    assert nova["profile"]["voice"]["tone"] == "bright"
    assert len({a["profile"]["appearance"]["accent"] for a in agents}) == 6


async def test_persona_catalog(api):
    cat = (await api.get("/agents/persona-catalog")).json()
    assert {a["key"] for a in cat["personality_axes"]} >= {"introvert_extrovert", "analytical_creative"}
    assert "helmet" in cat["appearance_options"]["hair"]


async def test_create_custom_agent_with_persona(api):
    body = {
        "name": "ARCHITECT", "role": "Arquitecto de videojuegos", "personality": "Analítico, detallista y exigente",
        "specialties": ["Unreal Engine 5", "C++", "Blueprints", "optimización"],
        "instructions": "Diseñás arquitecturas de videojuegos eficientes.",
        "tools": ["documents.read", "project.list_files", "memory.search"],
        "traits": {"personality": {"analytical_creative": 10, "playful_serious": 90}, "emotions": {"patience": 30}},
        "appearance": {"hair": "buzz", "outfit": "armor", "accent": "#ff8800"},
        "voice": {"pitch": 0.8, "locale": "es-ES"},
    }
    r = await api.post("/agents", body)
    assert r.status_code == 201, r.text
    agent = r.json()
    assert agent["slug"] == "architect" and not agent["is_system"]
    assert agent["profile"]["appearance"]["accent"] == "#FF8800" and agent["profile"]["appearance"]["hair"] == "buzz"
    assert {p["tool_key"] for p in agent["permissions"]} == set(body["tools"])
    async with session_factory()() as s:
        a = await s.get(Agent, __import__("uuid").UUID(agent["id"]))
        prompt, _ = await build_system_prompt(s, a)
    assert "analítico (90/100 hacia analítico)" in prompt
    assert "Paciencia: baja (30/100)" in prompt
    assert "Unreal Engine 5" in prompt and "Diseñás arquitecturas" in prompt


async def test_invalid_persona_rejected(api):
    bad = await api.post("/agents", {"name": "X", "role": "r", "instructions": "i", "traits": {"personality": {"telepatia": 50}}})
    assert bad.status_code == 400
    bad2 = await api.post("/agents", {"name": "Y", "role": "r", "instructions": "i", "appearance": {"hair": "afro-cuántico"}})
    assert bad2.status_code == 400


async def test_update_versions_instructions_and_persona(api):
    nova = next(a for a in (await api.get("/agents")).json() if a["slug"] == "nova")
    r = await api.patch(f"/agents/{nova['id']}", {"instructions": "Nuevas instrucciones", "traits": {"personality": {"introvert_extrovert": 20}},
                                                  "voice": {"pitch": 1.4}})
    assert r.status_code == 200, r.text
    detail = r.json()
    assert detail["instructions_version"] == 2 and detail["instructions"] == "Nuevas instrucciones"
    assert detail["profile"]["traits"]["personality"] == {"introvert_extrovert": 20}
    assert detail["profile"]["voice"]["pitch"] == 1.4 and detail["profile"]["voice"]["tone"] == "bright"
    versions = (await api.get(f"/agents/{nova['id']}/instructions")).json()
    assert [v["version"] for v in versions] == [2, 1] and versions[0]["is_active"] and not versions[1]["is_active"]


async def test_system_agents_protected(api):
    agents = {a["slug"]: a for a in (await api.get("/agents")).json()}
    assert (await api.delete(f"/agents/{agents['oracle']['id']}")).status_code == 403
    assert (await api.patch(f"/agents/{agents['nexus']['id']}", {"is_enabled": False})).status_code == 403


async def test_permissions_replace_and_validate(api):
    atlas = next(a for a in (await api.get("/agents")).json() if a["slug"] == "atlas")
    r = await api.put(f"/agents/{atlas['id']}/permissions", [{"tool_key": "web.fetch", "mode": "approval"}])
    assert r.status_code == 200 and r.json() == [{"tool_key": "web.fetch", "allowed": True, "mode": "approval", "expires_at": None}]
    assert (await api.put(f"/agents/{atlas['id']}/permissions", [{"tool_key": "root.shell"}])).status_code == 400


async def test_user_isolation(client):
    a = await register(client, "a@example.com", "A")
    b = await register(client, "b@example.com", "B")
    a_agent = (await a.get("/agents")).json()[0]
    assert (await b.get(f"/agents/{a_agent['id']}")).status_code == 404
    assert (await b.patch(f"/agents/{a_agent['id']}", {"name": "hack"})).status_code == 404
    proj = (await a.post("/projects", {"name": "APEX F1"})).json()
    assert (await b.get(f"/projects/{proj['id']}")).status_code == 404
    mem = (await a.post("/memory", {"scope": "user", "content": "Prefiere respuestas directas"})).json()
    assert (await b.delete(f"/memory/{mem['id']}")).status_code == 404
    hits = (await b.post("/memory/search", {"query": "respuestas directas"})).json()
    assert hits == []
    async with session_factory()() as s:
        assert len((await s.scalars(select(Agent))).all()) == 12
