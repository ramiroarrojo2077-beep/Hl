from __future__ import annotations

from sqlalchemy import select

from app.core.db import session_factory
from app.models import Agent, Plugin, User
from tests.conftest import register


async def test_register_bootstraps_team_and_hashes_password(client):
    api = await register(client)
    assert api.tokens["access_token"] and api.tokens["refresh_token"]
    async with session_factory()() as s:
        user = await s.scalar(select(User))
        assert user.password_hash.startswith("$argon2") and "Segura12345" not in user.password_hash
        slugs = sorted((await s.scalars(select(Agent.slug).where(Agent.user_id == user.id))).all())
        assert slugs == ["atlas", "cipher", "guardian", "nexus", "nova", "oracle"]
        assert len((await s.scalars(select(Plugin).where(Plugin.user_id == user.id))).all()) == 3


async def test_register_validation_and_duplicates(client):
    weak = await client.post("/api/v1/auth/register", json={"email": "x@example.com", "password": "solominusculas", "display_name": "X"})
    assert weak.status_code == 422
    await register(client, "dup@example.com")
    dup = await client.post("/api/v1/auth/register", json={"email": "DUP@example.com", "password": "Segura12345", "display_name": "X"})
    assert dup.status_code == 409


async def test_login_me_and_wrong_password(client):
    await register(client)
    bad = await client.post("/api/v1/auth/login", json={"email": "ana@example.com", "password": "Incorrecta123"})
    assert bad.status_code == 401
    ok = await client.post("/api/v1/auth/login", json={"email": "ana@example.com", "password": "Segura12345"})
    assert ok.status_code == 200
    token = ok.json()["tokens"]["access_token"]
    me = await client.get("/api/v1/auth/me", headers={"authorization": f"Bearer {token}"})
    assert me.status_code == 200 and me.json()["email"] == "ana@example.com"
    assert (await client.get("/api/v1/auth/me")).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers={"authorization": "Bearer basura"})).status_code == 401


async def test_refresh_rotation_and_reuse_detection(client):
    api = await register(client)
    old_refresh = api.tokens["refresh_token"]
    r1 = await client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
    assert r1.status_code == 200
    new = r1.json()
    assert new["refresh_token"] != old_refresh
    # Reutilizar el token viejo revoca toda la familia (posible robo).
    reuse = await client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh})
    assert reuse.status_code == 401
    after = await client.post("/api/v1/auth/refresh", json={"refresh_token": new["refresh_token"]})
    assert after.status_code == 401
    me = await client.get("/api/v1/auth/me", headers={"authorization": f"Bearer {new['access_token']}"})
    assert me.status_code == 401


async def test_logout_invalidates_access_token(client):
    api = await register(client)
    assert (await api.get("/auth/me")).status_code == 200
    assert (await api.post("/auth/logout")).status_code == 204
    assert (await api.get("/auth/me")).status_code == 401


async def test_sessions_listing_and_revoke(client):
    api = await register(client)
    other = await client.post("/api/v1/auth/login", json={"email": "ana@example.com", "password": "Segura12345"})
    sessions = (await api.get("/auth/sessions")).json()
    assert len(sessions) == 2 and sum(s["current"] for s in sessions) == 1
    target = next(s for s in sessions if not s["current"])
    assert (await api.delete(f"/auth/sessions/{target['family_id']}")).status_code == 204
    revoked = await client.get("/api/v1/auth/me", headers={"authorization": f"Bearer {other.json()['tokens']['access_token']}"})
    assert revoked.status_code == 401


async def test_auth_rate_limit(client, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "auth_rate_limit_per_minute", 3)
    codes = [(await client.post("/api/v1/auth/login", json={"email": "n@example.com", "password": "Xx1234567890"})).status_code for _ in range(5)]
    assert codes[:3] == [401, 401, 401] and 429 in codes[3:]
