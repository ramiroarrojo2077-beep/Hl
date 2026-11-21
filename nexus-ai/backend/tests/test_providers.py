from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import select

from app.core.db import session_factory
from app.core.errors import BudgetExceeded, ProviderError
from app.models import AIProvider, UsageRecord, User
from app.providers import gateway
from app.providers.base import Message
from app.providers.router import route
from tests.conftest import configure_provider


async def test_provider_key_is_encrypted_and_never_returned(api, fake_llm):
    cfg = await configure_provider(api, key="sk-ant-secret-ABCDEFGH12345")
    assert "secret" not in str(cfg["provider"]) and cfg["provider"]["api_key_hint"].endswith("2345")
    async with session_factory()() as s:
        p = await s.scalar(select(AIProvider))
        assert p.api_key_encrypted and "sk-ant-secret" not in p.api_key_encrypted
    listed = (await api.get("/providers")).text
    assert "sk-ant-secret" not in listed


async def test_connection_test_lists_models_and_detects_bad_key(api, fake_llm):
    cfg = await configure_provider(api)
    ok = (await api.post(f"/providers/{cfg['provider']['id']}/test")).json()
    assert ok["ok"] and "claude-test-opus" in ok["models"]
    await api.patch(f"/providers/{cfg['provider']['id']}", {"api_key": "bad-key"})
    bad = (await api.post(f"/providers/{cfg['provider']['id']}/test")).json()
    assert not bad["ok"] and "401" in bad["error"]
    assert (await api.get("/providers")).json()[0]["status"] == "error"


async def test_model_capability_suggestions_and_default(api, fake_llm):
    cfg = await configure_provider(api, models=[{"model_name": "claude-sonnet-x"}, {"model_name": "text-embedding-3-small"}])
    sonnet, embed = cfg["models"]
    assert "tools" in sonnet["capabilities"] and sonnet["is_default"] and sonnet["quality_tier"] == 4
    assert embed["capabilities"] == ["embedding"] and not embed["is_default"]
    invalid = await api.post("/models", {"provider_id": cfg["provider"]["id"], "model_name": "x", "capabilities": ["telepathy"]})
    assert invalid.status_code == 400


async def _user_id():
    async with session_factory()() as s:
        return (await s.scalar(select(User))).id


async def test_router_respects_capabilities_and_quality(api, fake_llm):
    await configure_provider(api, models=[
        {"model_name": "claude-test-haiku", "quality_tier": 2, "capabilities": ["chat", "tools"], "input_price_per_mtok": "1", "output_price_per_mtok": "5"},
        {"model_name": "claude-test-opus", "quality_tier": 5, "capabilities": ["chat", "tools", "reasoning", "code"], "input_price_per_mtok": "5", "output_price_per_mtok": "25"},
        {"model_name": "vision-only", "quality_tier": 4, "capabilities": ["chat", "vision"]},
    ])
    uid = await _user_id()
    async with session_factory()() as s:
        research = await route(s, uid, task_type="research", required=["tools"])
        # La calidad insuficiente del modelo barato no lo hace preferible.
        assert research.candidates[0].model.model_name == "claude-test-opus"
        assert research.candidates[-1].below_quality
        simple = await route(s, uid, task_type="simple", required=["tools"])
        assert {c.model.model_name for c in simple.candidates} == {"claude-test-haiku", "claude-test-opus"}
        vision = await route(s, uid, task_type="vision", required=["vision"])
        assert [c.model.model_name for c in vision.candidates] == ["vision-only"]


async def test_fallback_to_compatible_model_and_usage_records(api, fake_llm):
    await configure_provider(api, models=[
        {"model_name": "claude-test-opus", "quality_tier": 5, "capabilities": ["chat", "tools"], "is_default": True},
        {"model_name": "claude-test-haiku", "quality_tier": 4, "capabilities": ["chat", "tools"]},
        {"model_name": "no-tools-model", "quality_tier": 5, "capabilities": ["chat"]},
    ])
    fake_llm.failures["claude-test-opus"] = [529, 529, 529]
    uid = await _user_id()
    async with session_factory()() as s:
        ctx = gateway.CallContext(user_id=uid, purpose="test", task_type="general", required_capabilities=["tools"])
        res = await gateway.complete(s, ctx, system="s", messages=[Message(role="user", content="hola")],
                                     tools=[gateway.ToolSpec(name="x", description="d", parameters={"type": "object", "properties": {}})])
        await s.commit()
        assert res.model.model_name == "claude-test-haiku"
        assert len(res.attempts) == 3
        usage = (await s.scalars(select(UsageRecord).order_by(UsageRecord.created_at))).all()
        assert [u.success for u in usage] == [False, False, False, True]
        # Nunca se usó el modelo sin soporte de herramientas.
        assert all(c["model"] != "no-tools-model" for c in fake_llm.calls)


async def test_no_compatible_model_raises(api, fake_llm):
    await configure_provider(api, models=[{"model_name": "plain", "quality_tier": 3, "capabilities": ["chat"]}])
    uid = await _user_id()
    async with session_factory()() as s:
        ctx = gateway.CallContext(user_id=uid, purpose="test", required_capabilities=["vision"])
        with pytest.raises(ProviderError) as exc:
            await gateway.complete(s, ctx, system="s", messages=[Message(role="user", content="x")])
        assert exc.value.code == "no_model_available"


async def test_budget_blocks_new_calls(api, fake_llm):
    await configure_provider(api)
    await api.patch("/settings", {"daily_budget_usd": "0.01"})
    uid = await _user_id()
    async with session_factory()() as s:
        ctx = gateway.CallContext(user_id=uid, purpose="test")
        res = await gateway.complete(s, ctx, system="s", messages=[Message(role="user", content="x")])
        # 1200 tokens in * $5/M + 300 out * $25/M = 0.0135
        assert res.cost_usd == Decimal("0.0135")
        await s.commit()
        with pytest.raises(BudgetExceeded):
            await gateway.complete(s, ctx, system="s", messages=[Message(role="user", content="x")])
        await s.commit()
    notes = (await api.get("/notifications")).json()
    assert any(n["event_type"] == "budget_reached" for n in notes)


async def test_streaming_adapter_emits_deltas(api, fake_llm):
    await configure_provider(api)
    uid = await _user_id()
    chunks: list[str] = []

    async def on_text(t: str) -> None:
        chunks.append(t)

    async with session_factory()() as s:
        res = await gateway.complete(s, gateway.CallContext(user_id=uid, purpose="chat"), system="s",
                                     messages=[Message(role="user", content="x")], on_text=on_text)
    assert len(chunks) >= 1 and "".join(chunks) == res.response.text == "OK"
    assert res.response.usage.output_tokens == 300
