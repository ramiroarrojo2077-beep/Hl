from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import tempfile
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

from cryptography.fernet import Fernet

TEST_DB = os.environ.get("NEXUS_TEST_DATABASE_URL", "postgresql+asyncpg://nexus:nexus@localhost:5432/nexus_test")
os.environ.update({
    "NEXUS_ENV": "test",
    "NEXUS_DATABASE_URL": TEST_DB,
    "NEXUS_REDIS_URL": "",
    "NEXUS_SECRET_KEY": "test-secret-key-0123456789-abcdefghijklmnopqrstuvwxyz",
    "NEXUS_ENCRYPTION_KEYS": Fernet.generate_key().decode(),
    "NEXUS_STORAGE_DIR": tempfile.mkdtemp(prefix="nexus-test-storage-"),
    "NEXUS_AUTH_RATE_LIMIT_PER_MINUTE": "1000",
    "NEXUS_JOB_LEASE_SECONDS": "30",
    "NEXUS_SANDBOX_ENABLED": "false",
    "NEXUS_WORKER_METRICS_PORT": "0",
})

import httpx  # noqa: E402
import pytest  # noqa: E402
import pytest_asyncio  # noqa: E402
from sqlalchemy import select, text, update  # noqa: E402

from app.core import ratelimit  # noqa: E402
from app.core.db import dispose_engine, session_factory  # noqa: E402
from app.models import Job  # noqa: E402
from app.providers import registry  # noqa: E402
from tests.fake_llm import FakeAnthropic  # noqa: E402

BACKEND = Path(__file__).resolve().parents[1]


def pytest_sessionstart(session) -> None:  # noqa: ARG001
    env = {**os.environ}
    subprocess.run([sys.executable, "-m", "alembic", "downgrade", "base"], cwd=BACKEND, env=env, check=True, capture_output=True)
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=BACKEND, env=env, check=True, capture_output=True)


TABLES_SQL = text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('alembic_version', 'tool_definitions')")


@pytest_asyncio.fixture(autouse=True)
async def clean_db() -> AsyncIterator[None]:
    async with session_factory()() as session:
        tables = [r[0] for r in await session.execute(TABLES_SQL)]
        await session.execute(text(f"TRUNCATE {', '.join(tables)} RESTART IDENTITY CASCADE"))
        from app.tools.registry import sync_tool_definitions

        await sync_tool_definitions(session)
        await session.commit()
    ratelimit.reset_local()
    yield
    await dispose_engine()


@pytest.fixture
def fake_llm() -> AsyncIterator[FakeAnthropic]:
    fake = FakeAnthropic()
    registry.set_transport_override(fake.transport())
    yield fake
    registry.set_transport_override(None)


@pytest_asyncio.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    from app.main import app

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as c:
        yield c


class Api:
    """Cliente autenticado de conveniencia."""

    def __init__(self, client: httpx.AsyncClient, tokens: dict, user: dict) -> None:
        self.client = client
        self.tokens = tokens
        self.user = user

    @property
    def headers(self) -> dict:
        return {"authorization": f"Bearer {self.tokens['access_token']}"}

    async def get(self, url: str, **kw) -> httpx.Response:
        return await self.client.get(f"/api/v1{url}", headers=self.headers, **kw)

    async def post(self, url: str, json=None, **kw) -> httpx.Response:
        return await self.client.post(f"/api/v1{url}", headers=self.headers, json=json, **kw)

    async def patch(self, url: str, json=None) -> httpx.Response:
        return await self.client.patch(f"/api/v1{url}", headers=self.headers, json=json)

    async def put(self, url: str, json=None) -> httpx.Response:
        return await self.client.put(f"/api/v1{url}", headers=self.headers, json=json)

    async def delete(self, url: str, **kw) -> httpx.Response:
        return await self.client.delete(f"/api/v1{url}", headers=self.headers, **kw)


async def register(client: httpx.AsyncClient, email: str = "ana@example.com", name: str = "Ana") -> Api:
    resp = await client.post("/api/v1/auth/register", json={"email": email, "password": "Segura12345", "display_name": name})
    assert resp.status_code == 201, resp.text
    data = resp.json()
    return Api(client, data["tokens"], data["user"])


@pytest_asyncio.fixture
async def api(client: httpx.AsyncClient) -> Api:
    return await register(client)


async def configure_provider(api: Api, *, key: str = "sk-ant-test-1234567890", models: list[dict] | None = None) -> dict:
    resp = await api.post("/providers", {"kind": "anthropic", "name": "Anthropic", "api_key": key, "base_url": "https://fake-anthropic.test"})
    assert resp.status_code == 201, resp.text
    provider = resp.json()
    created = []
    for m in models or [{"model_name": "claude-test-opus", "quality_tier": 5, "input_price_per_mtok": "5", "output_price_per_mtok": "25",
                         "capabilities": ["chat", "tools", "reasoning", "code", "long_context"]}]:
        r = await api.post("/models", {"provider_id": provider["id"], **m})
        assert r.status_code == 201, r.text
        created.append(r.json())
    return {"provider": provider, "models": created}


async def drain(max_rounds: int = 200, concurrency: int = 4, worker_id: str = "test-worker") -> int:
    """Ejecuta el worker real hasta que no queden trabajos pendientes."""
    from app.worker import Worker

    worker = Worker(concurrency=concurrency, worker_id=worker_id)
    processed = 0
    for _ in range(max_rounds):
        await worker.maintenance()
        async with session_factory()() as session:
            # Adelanta reintentos con backoff para no esperar en los tests.
            await session.execute(update(Job).where(Job.status == "queued").values(run_after=datetime.now(UTC)))
            await session.commit()
        claimed = await worker.poll_once()
        processed += claimed
        if worker.running:
            await asyncio.gather(*list(worker.running.values()), return_exceptions=True)
            await asyncio.sleep(0)
            continue
        async with session_factory()() as session:
            pending = await session.scalar(select(Job.id).where(Job.status.in_(["queued", "running"])).limit(1))
        if pending is None and claimed == 0:
            break
    return processed
