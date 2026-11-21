from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select

from app.core.db import session_factory
from app.memory import service as memory
from app.memory.embeddings import lexical_embedding
from app.memory.extract import chunk_text, extract_text
from app.models import Agent, MemoryEmbedding, User
from tests.conftest import drain


async def _ids(s):
    user = await s.scalar(select(User))
    agents = {a.slug: a for a in (await s.scalars(select(Agent))).all()}
    return user, agents


def test_lexical_embedding_properties():
    a = lexical_embedding("Arquitectura de microservicios con colas")
    b = lexical_embedding("microservicios y colas en la arquitectura")
    c = lexical_embedding("receta de empanadas salteñas")
    dot = lambda x, y: sum(i * j for i, j in zip(x, y))  # noqa: E731
    assert len(a) == 768 and abs(dot(a, a) - 1) < 1e-6
    assert dot(a, b) > dot(a, c)


def test_chunking_and_extraction():
    text = "\n\n".join(f"Párrafo {i} " + "palabra " * 80 for i in range(10))
    chunks = chunk_text(text, size=800, overlap=100)
    assert len(chunks) > 3 and all(len(c) <= 900 for c in chunks)
    assert extract_text(b"# Titulo\nhola", "text/markdown", "a.md").startswith("# Titulo")


async def test_scopes_isolation_and_quality_controls(api):
    p1 = (await api.post("/projects", {"name": "APEX F1"})).json()
    p2 = (await api.post("/projects", {"name": "Otro"})).json()
    async with session_factory()() as s:
        user, agents = await _ids(s)
        await memory.create_memory(s, user.id, scope="agent", agent_id=agents["atlas"].id, content="ATLAS prefiere fuentes primarias sobre blogs")
        await memory.create_memory(s, user.id, scope="agent", agent_id=agents["nova"].id, content="NOVA usa paletas oscuras con acento cian")
        await memory.create_memory(s, user.id, scope="project", project_id=p1["id"], content="APEX F1 usa telemetría de neumáticos en tiempo real")
        await memory.create_memory(s, user.id, scope="project", project_id=p2["id"], content="Otro proyecto usa telemetría de bicicletas")
        await memory.create_memory(s, user.id, scope="shared", content="Rechazado: la telemetría es inútil", verification_status="rejected")
        await memory.create_memory(s, user.id, scope="shared", content="Telemetría caducada de 2019", expires_at=datetime.now(UTC) - timedelta(days=1))
        await s.commit()

        atlas_hits = await memory.search(s, user.id, "fuentes primarias paletas", agent_id=agents["atlas"].id)
        contents = " ".join(h.item.content for h in atlas_hits)
        assert "ATLAS prefiere" in contents and "NOVA usa" not in contents

        proj_hits = await memory.search(s, user.id, "telemetría", agent_id=agents["cipher"].id, project_id=p1["id"])
        contents = " ".join(h.item.content for h in proj_hits)
        assert "neumáticos" in contents
        assert "bicicletas" not in contents  # proyectos no se mezclan
        assert "Rechazado" not in contents and "caducada" not in contents

        # Deduplicación
        again = await memory.create_memory(s, user.id, scope="agent", agent_id=agents["atlas"].id, content="ATLAS  prefiere fuentes primarias sobre blogs", confidence=0.9)
        assert again.confidence == 0.9
        assert await s.scalar(select(func.count()).select_from(MemoryEmbedding)) == 6


async def test_memory_api_crud_and_search(api):
    m = (await api.post("/memory", {"scope": "user", "content": "El usuario prefiere respuestas directas y en español"})).json()
    assert m["verification_status"] == "verified" and m["source"] == "user"
    hits = (await api.post("/memory/search", {"query": "respuestas directas"})).json()
    assert hits and hits[0]["item"]["id"] == m["id"] and set(hits[0]["matched_by"]) >= {"lexical"}
    upd = (await api.patch(f"/memory/{m['id']}", {"content": "El usuario prefiere respuestas breves"})).json()
    assert upd["content"].endswith("breves")
    hits = (await api.post("/memory/search", {"query": "breves"})).json()
    assert hits and hits[0]["item"]["id"] == m["id"]
    rej = (await api.patch(f"/memory/{m['id']}", {"verification_status": "rejected"})).json()
    assert rej["verification_status"] == "rejected"
    assert (await api.delete(f"/memory/{m['id']}")).status_code == 204
    assert (await api.get("/memory")).json() == []
    stats = (await api.get("/memory/stats")).json()
    assert stats["total"] == 0


async def test_document_upload_is_indexed_into_project_memory(api):
    p = (await api.post("/projects", {"name": "Docs"})).json()
    doc = "# Especificación\n\nEl motor de físicas usa integración Verlet a 240 Hz.\n\nLos autos tienen cinco compuestos de neumáticos."
    r = await api.post(f"/projects/{p['id']}/files", files={"file": ("spec.md", doc.encode(), "text/markdown")})
    assert r.status_code == 201, r.text
    await drain()
    files = (await api.get(f"/projects/{p['id']}/files")).json()
    assert files[0]["indexed"] and files[0]["version"] == 1
    hits = (await api.post("/memory/search", {"query": "integración Verlet", "project_id": p["id"]})).json()
    assert hits and "Verlet" in hits[0]["item"]["content"] and hits[0]["item"]["source_ref"] == "spec.md@v1"
    # Nueva versión: reemplaza los fragmentos indexados
    await api.post(f"/projects/{p['id']}/files", files={"file": ("spec.md", b"Ahora usamos Runge-Kutta.", "text/markdown")})
    await drain()
    history = (await api.get(f"/projects/{p['id']}/files", params={"path": "spec.md"})).json()
    assert [f["version"] for f in history] == [2, 1]
    hits = (await api.post("/memory/search", {"query": "Verlet Runge-Kutta", "project_id": p["id"]})).json()
    assert all("Verlet" not in h["item"]["content"] for h in hits) and any("Runge" in h["item"]["content"] for h in hits)
    content = await api.get(f"/projects/{p['id']}/files/{history[1]['id']}/content")
    assert b"Verlet" in content.content
