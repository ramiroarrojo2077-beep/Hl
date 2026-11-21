"""NEXUS 2.0 — automatizaciones, voz, WhatsApp, STOP ALL ampliado, calidad y diagnóstico."""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from sqlalchemy import select, update

from app.core.config import get_settings
from app.core.db import session_factory
from app.models import AgentMessage, Automation, AutomationRun, Notification
from tests.conftest import configure_provider, drain

TZ = "America/Argentina/Buenos_Aires"
VECTORS = json.loads((Path(__file__).resolve().parents[2] / "shared" / "phone_vectors_ar.json").read_text())


# ------------------------------------------------------------------ WhatsApp

def test_phone_normalizer_matches_shared_vectors():
    from app.integrations.whatsapp.phone import normalize

    for case in VECTORS["cases"]:
        r = normalize(case["input"], case["default_area_code"])
        assert (r.status, r.e164, r.masked, r.display) == (case["status"], case["e164"], case["masked"], case["display"]), case


async def test_prepare_resolve_and_draft(api, fake_llm):
    amb = (await api.post("/integrations/whatsapp/prepare", {"phone": "15 2345 6789", "text": "hola"})).json()
    assert amb["phone"]["status"] == "needs_area_code" and amb["link"] is None and amb["action"] is None
    ok = (await api.post("/integrations/whatsapp/prepare", {"phone": "011 15 2345-6789", "text": "Llego en 5", "contact_label": "Papá"})).json()
    assert ok["link"] == "https://wa.me/5491123456789?text=Llego%20en%205" and ok["state"] == "AWAITING_CONFIRMATION"
    assert ok["action"]["params"]["recipient_masked"] == "+54 9 11 ****-6789" and "phone" not in ok["action"]["params"]
    res = (await api.post("/integrations/whatsapp/contact/resolve", {"query": "mi viejo", "candidates": [
        {"id": "1", "label": "Papá", "aliases": []}, {"id": "2", "label": "Mamá"}, {"id": "3", "label": "Pablo Gómez"}]})).json()
    assert res["status"] == "resolved" and res["match"]["id"] == "1"
    res = (await api.post("/integrations/whatsapp/contact/resolve", {"query": "Juan", "candidates": [
        {"id": "1", "label": "Juan Pérez"}, {"id": "2", "label": "Juan Gómez"}]})).json()
    assert res["status"] == "ambiguous" and {m["id"] for m in res["matches"]} == {"1", "2"}
    leak = await api.post("/integrations/whatsapp/contact/resolve", {"query": "Juan", "candidates": [{"id": "1", "label": "Juan", "phone": "11"}]})
    assert leak.status_code == 400
    # sin modelo: lo dice, no inventa
    no_model = await api.post("/integrations/whatsapp/draft", {"text": "llego tarde", "mode": "tone", "tone": "formal"})
    assert no_model.status_code >= 400
    await configure_provider(api)
    draft = (await api.post("/integrations/whatsapp/draft", {"text": "Llego tarde", "mode": "tone", "tone": "formal"})).json()
    assert draft["text"] == "Hola, llego tarde Saludos." and draft["original"] == "Llego tarde"
    sent = fake_llm.calls[-1]
    assert "No agregues hechos" in sent["system"] and "formal" in str(sent["messages"])
    status = (await api.get("/integrations/whatsapp/status")).json()
    assert status["personal"]["can_confirm_delivery"] is False and status["business"]["configured"] is False


async def test_whatsapp_business_send_and_signed_webhooks(api, client, monkeypatch):
    from app.integrations.whatsapp import business

    s = get_settings()
    for k, v in {"whatsapp_business_token": "EAAG-test", "whatsapp_phone_number_id": "1234567890", "whatsapp_app_secret": "app-secret",
                 "whatsapp_verify_token": "verify-me", "whatsapp_business_owner_email": "ana@example.com"}.items():
        monkeypatch.setattr(s, k, v)
    graph_calls: list[dict] = []

    def graph(request: httpx.Request) -> httpx.Response:
        graph_calls.append({"url": str(request.url), "auth": request.headers.get("authorization"), "body": json.loads(request.content)})
        return httpx.Response(200, json={"messaging_product": "whatsapp", "messages": [{"id": "wamid.TEST1"}]})

    monkeypatch.setattr(business, "transport_override", httpx.MockTransport(graph))
    st = (await api.get("/integrations/whatsapp/business/status")).json()
    assert st["configured"] and st["enabled_for_user"]
    # verificación del webhook
    ok = await client.get("/api/v1/integrations/whatsapp/business/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "42"})
    assert ok.text == "42"
    bad = await client.get("/api/v1/integrations/whatsapp/business/webhook", params={"hub.mode": "subscribe", "hub.verify_token": "x", "hub.challenge": "42"})
    assert bad.status_code == 403
    # fuera de la ventana de 24 h el texto libre se rechaza
    a = (await api.post("/actions/execute", {"action_key": "whatsapp.business_send", "params": {"phone": "+5491123456789", "text": "Hola", "opt_in_confirmed": True}})).json()
    assert a["status"] == "awaiting_confirmation"
    failed = (await api.post(f"/actions/{a['id']}/confirm", {})).json()
    assert failed["status"] == "failed" and "24 h" in failed["error"] and graph_calls == []

    def signed(payload: dict) -> tuple[bytes, dict]:
        raw = json.dumps(payload).encode()
        sig = "sha256=" + hmac.new(b"app-secret", raw, hashlib.sha256).hexdigest()
        return raw, {"x-hub-signature-256": sig, "content-type": "application/json"}

    inbound = {"entry": [{"changes": [{"value": {"messages": [{"from": "5491123456789", "id": "wamid.IN1", "type": "text"}]}}]}]}
    raw, headers = signed(inbound)
    assert (await client.post("/api/v1/integrations/whatsapp/business/webhook", content=raw, headers={**headers, "x-hub-signature-256": "sha256=00"})).status_code == 401
    r = await client.post("/api/v1/integrations/whatsapp/business/webhook", content=raw, headers=headers)
    assert r.json()["inbound"] == 1
    # dentro de la ventana: se envía por la API oficial y queda ACCEPTED (no "entregado")
    a = (await api.post("/actions/execute", {"action_key": "whatsapp.business_send", "params": {"phone": "+5491123456789", "text": "Hola", "opt_in_confirmed": True}})).json()
    done = (await api.post(f"/actions/{a['id']}/confirm", {})).json()
    assert done["status"] == "completed" and done["state_detail"] == "ACCEPTED" and done["result"]["wa_message_id"] == "wamid.TEST1"
    assert graph_calls[0]["url"] == "https://graph.facebook.com/v21.0/1234567890/messages" and graph_calls[0]["auth"] == "Bearer EAAG-test"
    for status_name in ("sent", "delivered", "delivered", "read"):
        raw, headers = signed({"entry": [{"changes": [{"value": {"statuses": [{"id": "wamid.TEST1", "status": status_name, "timestamp": "1700000000"}]}}]}]})
        await client.post("/api/v1/integrations/whatsapp/business/webhook", content=raw, headers=headers)
    action = (await api.get(f"/actions/{a['id']}")).json()
    assert action["state_detail"] == "READ" and action["result"]["delivery_status"] == "read"
    st = (await api.get("/integrations/whatsapp/business/status")).json()
    # el rechazo por la ventana de 24 h ocurrió antes de llamar a la API: no hay mensaje registrado
    assert st["messages_by_status"] == {"read": 1}


# ------------------------------------------------------------------ automatizaciones

async def test_automation_validation_limits_and_manual_run(api):
    bad = await api.post("/automations", {"name": "x", "trigger_type": "schedule", "cron": "* * * * *", "actions": [{"type": "notify", "title": "hola"}]})
    assert bad.status_code == 400 and "15 minutos" in bad.json()["message"]
    bad = await api.post("/automations", {"name": "x", "trigger_type": "event", "event_type": "nope", "actions": [{"type": "notify", "title": "h"}]})
    assert bad.status_code == 400
    bad = await api.post("/automations", {"name": "x", "trigger_type": "event", "event_type": "user.manual",
                                          "actions": [{"type": "action", "action_key": "automation.create", "params": {}}]})
    assert bad.status_code == 400
    a = (await api.post("/automations", {"name": "Aviso", "trigger_type": "event", "event_type": "user.manual", "cooldown_seconds": 600,
                                         "actions": [{"type": "notify", "title": "Rutina manual", "body": "funciona"}]})).json()
    assert a["status"] == "active"
    assert (await api.post(f"/automations/{a['id']}/run")).status_code == 202
    await drain()
    async with session_factory()() as s:
        await s.execute(update(Job_()).values(idempotency_key=None))  # permite un segundo disparo manual en el mismo minuto
        await s.commit()
    await api.post(f"/automations/{a['id']}/run")
    await drain()
    runs = (await api.get(f"/automations/{a['id']}/runs")).json()
    assert [r["status"] for r in runs] == ["skipped", "succeeded"] and "enfriamiento" in runs[0]["error"]
    async with session_factory()() as s:
        n = await s.scalar(select(Notification).where(Notification.event_type == "automation"))
    assert n.title == "Rutina manual"
    paused = (await api.post(f"/automations/{a['id']}/pause")).json()
    assert paused["status"] == "paused"
    assert (await api.post(f"/automations/{a['id']}/run")).status_code == 400


def Job_():
    from app.models import Job

    return Job


async def test_schedule_automation_fires_and_jarvis_prompt(api, fake_llm):
    await configure_provider(api)
    out = (await api.post("/jarvis/message", {"content": "todos los días a las 8 mandame un resumen de mis misiones", "timezone": TZ})).json()
    act = out["action"]
    assert act["action_key"] == "automation.create" and act["status"] == "awaiting_confirmation"
    assert act["params"]["cron"] == "0 8 * * *"
    done = (await api.post(f"/actions/{act['id']}/confirm", {})).json()
    auto_id = done["result"]["automation_id"]
    auto = (await api.get(f"/automations/{auto_id}")).json()
    assert auto["status"] == "active" and auto["timezone"] == TZ
    nxt = datetime.fromisoformat(auto["next_run_at"])
    assert nxt.astimezone(__import__("zoneinfo").ZoneInfo(TZ)).hour == 8
    async with session_factory()() as s:
        await s.execute(update(Automation).values(next_run_at=datetime.now(UTC) - timedelta(seconds=5)))
        await s.commit()
    await drain()
    runs = (await api.get(f"/automations/{auto_id}/runs")).json()
    assert runs[0]["status"] == "succeeded" and runs[0]["result"]["actions"][0]["queued"]
    async with session_factory()() as s:
        msg = await s.scalar(select(AgentMessage).where(AgentMessage.meta["kind"].astext == "automation_result"))
        n = await s.scalar(select(Notification).where(Notification.event_type == "automation"))
        a = await s.get(Automation, uuid.UUID(auto_id))
    assert msg.content == "Resumen de la rutina: no hay misiones en curso." and n.body == msg.content
    assert a.next_run_at > datetime.now(UTC)  # reprogramada, no repetida


async def test_event_automation_on_mission_completion_without_loops(api, fake_llm):
    await configure_provider(api)
    out = (await api.post("/jarvis/message", {"content": "Avisame cuando termine una misión", "timezone": TZ})).json()
    done = (await api.post(f"/actions/{out['action']['id']}/confirm", {})).json()
    auto_id = done["result"]["automation_id"]
    r = await api.post("/missions", {"title": "Juegos", "objective": "Diseñar una app de gestión de videojuegos", "autonomy_mode": "scheduled"})
    assert r.status_code == 201
    await drain()
    runs = (await api.get(f"/automations/{auto_id}/runs")).json()
    assert len(runs) == 1 and runs[0]["status"] == "succeeded" and runs[0]["trigger"]["event_type"] == "mission.completed"
    # Una misión creada por una automatización no dispara automatizaciones (anti-bucle)
    m2 = (await api.post("/automations", {"name": "Crea misión", "trigger_type": "event", "event_type": "user.manual",
                                          "actions": [{"type": "mission", "objective": "Investigar motores de juego 2D"}]})).json()
    await api.post(f"/automations/{m2['id']}/run")
    await drain()
    runs = (await api.get(f"/automations/{auto_id}/runs")).json()
    assert len(runs) == 1
    async with session_factory()() as s:
        count = await s.scalar(select(__import__("sqlalchemy").func.count()).select_from(AutomationRun))
    assert count == 2


async def test_stop_all_pauses_automations_and_cancels_pending_actions(api):
    a = (await api.post("/automations", {"name": "Aviso", "trigger_type": "event", "event_type": "user.manual",
                                         "actions": [{"type": "notify", "title": "x"}]})).json()
    out = (await api.post("/jarvis/message", {"content": "Mandale un whatsapp a Juan que ya salgo", "timezone": TZ})).json()
    stop = (await api.post("/system/emergency-stop", {"reason": "prueba"})).json()
    assert stop["automations_paused"] == 1 and stop["pending_actions_cancelled"] == 1
    assert (await api.get(f"/automations/{a['id']}")).json()["paused_by_stop"] is True
    assert (await api.get(f"/actions/{out['action']['id']}")).json()["status"] == "cancelled"
    assert (await api.post(f"/automations/{a['id']}/resume")).status_code == 400
    # NEXUS no puede proponer acciones nuevas automáticamente durante STOP ALL
    blocked = (await api.post("/jarvis/message", {"content": "Recordame en 10 minutos llamar a Pedro", "timezone": TZ})).json()
    assert blocked["action"]["status"] == "blocked" and "STOP ALL" in blocked["reply"]["content"]
    state = (await api.get("/jarvis/state")).json()
    assert state["state"] == "stopped" and state["system_state"] == "STOPPED"
    await api.delete("/system/emergency-stop")
    assert (await api.post(f"/automations/{a['id']}/resume")).json()["status"] == "active"


# ------------------------------------------------------------------ voz

async def test_voice_settings_consent_and_remote_engines(api, monkeypatch):
    from app.providers import registry

    vs = (await api.get("/voice/settings")).json()
    assert vs["mode"] == "push_to_talk" and vs["wake_word_enabled"] is False and vs["store_audio"] is False
    assert vs["remote"]["stt"]["available"] is False
    assert (await api.patch("/voice/settings", {"speech_rate": 3})).status_code == 400
    no_consent = await api.patch("/voice/settings", {"wake_word_enabled": True})
    assert no_consent.status_code == 400 and "consentimiento" in no_consent.json()["message"]
    ok = (await api.patch("/voice/settings", {"wake_word_enabled": True, "wake_word_consent": True, "speech_rate": 1.2, "store_audio": True})).json()
    assert ok["wake_word_enabled"] and ok["wake_word_consent_at"] and ok["speech_rate"] == 1.2 and ok["store_audio"] is False
    session_start = (await api.post("/jarvis/voice/session", {"action": "start", "mode": "wake_word"})).json()
    assert session_start["active"] and session_start["audio_stored"] is False
    off = (await api.patch("/voice/settings", {"wake_word_enabled": False})).json()
    assert off["wake_word_consent_at"] is None
    assert (await api.post("/jarvis/voice/session", {"action": "start", "mode": "wake_word"})).status_code == 400
    r = await api.post("/voice/transcriptions", files={"file": ("a.wav", b"RIFF....", "audio/wav")})
    assert r.status_code == 400 and r.json()["error"] == "no_stt_model"

    seen: list[str] = []

    def audio_api(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        if request.url.path.endswith("/audio/transcriptions"):
            assert b"es" in request.content and b"RIFF" in request.content
            return httpx.Response(200, json={"text": "recordame comprar pan"})
        if request.url.path.endswith("/audio/speech"):
            return httpx.Response(200, content=b"ID3fakeaudio", headers={"content-type": "audio/mpeg"})
        return httpx.Response(404)

    registry.set_transport_override(httpx.MockTransport(audio_api))
    try:
        prov = (await api.post("/providers", {"kind": "openai_compatible", "name": "Audio", "api_key": "k-123456789",
                                              "base_url": "https://audio.example.test/v1"})).json()
        for name, cap in (("whisper-x", "stt"), ("voice-x", "tts")):
            assert (await api.post("/models", {"provider_id": prov["id"], "model_name": name, "capabilities": [cap]})).status_code == 201
        t = (await api.post("/voice/transcriptions", files={"file": ("a.wav", b"RIFF....", "audio/wav")}, data={"language": "es-AR"})).json()
        assert t["text"] == "recordame comprar pan" and t["audio_stored"] is False
        speech = await api.post("/voice/synthesis", {"text": "Hola, soy NEXUS"})
        assert speech.status_code == 200 and speech.content == b"ID3fakeaudio" and speech.headers["content-type"] == "audio/mpeg"
    finally:
        registry.set_transport_override(None)
    assert seen == ["/v1/audio/transcriptions", "/v1/audio/speech"]


async def test_voice_transcripts_retention(api):
    await api.patch("/voice/settings", {"transcript_retention_days": 1})
    out = (await api.post("/jarvis/message", {"content": "Abrí Spotify", "input_mode": "voice", "timezone": TZ})).json()
    async with session_factory()() as s:
        from app.voice.service import purge_expired_transcripts

        await s.execute(update(AgentMessage).where(AgentMessage.id == uuid.UUID(out["user_message"]["id"]))
                        .values(created_at=datetime.now(UTC) - timedelta(days=2)))
        await s.commit()
        assert await purge_expired_transcripts(s, force=True) == 1
        await s.commit()
        msg = await s.get(AgentMessage, uuid.UUID(out["user_message"]["id"]))
    assert "eliminada por la política de retención" in msg.content and msg.meta["redacted"]


# ------------------------------------------------------------------ calidad, ajustes, diagnóstico

async def test_router_uses_measured_quality(api):
    from app.providers.quality import record
    from app.providers.router import route

    cfg = await configure_provider(api, models=[
        {"model_name": "claude-test-opus", "quality_tier": 4, "capabilities": ["chat", "tools"]},
        {"model_name": "claude-test-haiku", "quality_tier": 4, "capabilities": ["chat", "tools"]}])
    uid = uuid.UUID(api.user["id"])
    async with session_factory()() as s:
        for _ in range(3):
            await record(s, uid, model_label="anthropic:claude-test-haiku", task_type="code", source="review",
                         criteria={"precision": 10, "completeness": 10, "errors": 10})
            await record(s, uid, model_label="anthropic:claude-test-opus", task_type="code", source="review",
                         criteria={"precision": 3, "completeness": 3, "errors": 4})
        await s.commit()
        decision = await route(s, uid, task_type="code")
    assert decision.candidates[0].model.model_name == "claude-test-haiku"
    assert any("calidad medida" in r for r in decision.candidates[0].reasons)
    assert len(cfg["models"]) == 2


async def test_jarvis_and_privacy_settings_validation(api):
    r = await api.patch("/settings", {"jarvis_settings": {"quick_actions": [{"key": "memory"}, {"key": "whatsapp", "visible": False}],
                                                         "proactive": {"level": "low", "quiet_hours": {"start": "22:30", "end": "07:00"}}}})
    assert r.status_code == 200
    js = (await api.get("/jarvis/settings")).json()
    order = [q["key"] for q in js["jarvis"]["quick_actions"]]
    assert order[:2] == ["memory", "whatsapp"] and len(order) == 8 and js["jarvis"]["quick_actions"][1]["visible"] is False
    assert js["jarvis"]["proactive"]["quiet_hours"] == {"start": "22:30", "end": "07:00"}
    assert (await api.patch("/settings", {"jarvis_settings": {"quick_actions": [{"key": "hack"}]}})).status_code == 400
    assert (await api.patch("/settings", {"privacy_settings": {"share_contacts_with_models": True}})).status_code == 400


async def test_crash_reports_need_consent_and_are_scrubbed(api):
    body = {"app_version": "2.0.0", "device": "Pixel", "stacktrace": "NPE at Foo; user +54 9 11 2345-6789 mail a@b.com token=abc123"}
    assert (await api.post("/diagnostics/crash", body)).status_code == 400
    await api.patch("/settings", {"privacy_settings": {"crash_reports_consent": True}})
    assert (await api.post("/diagnostics/crash", body)).status_code == 201
    stored = (await api.get("/diagnostics/crash")).json()[0]["stacktrace"]
    assert "2345" not in stored and "a@b.com" not in stored and "abc123" not in stored and "<número>" in stored
