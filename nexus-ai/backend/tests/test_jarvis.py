"""NEXUS 2.0 — JARVIS CORE: pipeline modular, acciones, estado, contexto y barge-in."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.core import events
from app.core.db import session_factory
from app.models import AgentMessage, MemoryItem, ModelQualityScore, ScheduledJob
from tests.conftest import configure_provider, drain

TZ = "America/Argentina/Buenos_Aires"


async def jarvis(api, content: str, **extra) -> dict:
    r = await api.post("/jarvis/message", {"content": content, "timezone": TZ, **extra})
    assert r.status_code == 202, r.text
    return r.json()


async def test_direct_action_runs_only_needed_stages_without_model(api, fake_llm):
    out = await jarvis(api, "Recordame mañana a las 9 llamar al médico")
    assert out["handled"] == "action"
    stages = [s["stage"] for s in out["stages"]]
    assert stages[:4] == ["input", "understanding", "intent", "routing"]
    assert "verification" in stages and "context" not in stages  # no se consultó memoria ni modelo
    action = out["action"]
    assert action["action_key"] == "reminder.create" and action["status"] == "completed"
    assert action["result"]["verified"] is True
    assert fake_llm.calls == []  # ninguna llamada a modelo
    async with session_factory()() as s:
        job = await s.scalar(select(ScheduledJob).where(ScheduledJob.kind == "reminder"))
    local = job.next_run_at.astimezone(ZoneInfo(TZ))
    assert (local.hour, local.minute) == (9, 0) and job.payload["title"] == "Llamar al médico"
    assert "te lo recuerdo mañana a las 09:00" in out["reply"]["content"]
    # La conversación de JARVIS es una conversación normal (aparece en el historial del CHAT)
    msgs = (await api.get(f"/conversations/{out['conversation_id']}/messages")).json()
    assert [m["sender_type"] for m in msgs] == ["user", "agent"]
    assert msgs[1]["meta"]["kind"] == "action_proposal"


async def test_whatsapp_flow_never_claims_sent(api):
    # 1-3: pedir el mensaje → contacto por alias (se resuelve en el teléfono) → borrador
    out = await jarvis(api, "Mandale un mensaje a papá diciendo que llego tarde")
    a = out["action"]
    assert a["action_key"] == "whatsapp.open_chat" and a["status"] == "awaiting_confirmation"
    assert a["state_detail"] == "AWAITING_CONFIRMATION" and a["risk"] == "EXTERNAL_COMMUNICATION"
    assert a["params"] == {"recipient_query": "papá", "text": "Llego tarde"}
    # 4-5: vista previa y cancelación
    r = await api.post(f"/actions/{a['id']}/report", {"state": "CONTACT_RESOLVED", "result": {"recipient_masked": "+54 9 11 ****-6789"}})
    assert r.json()["state_detail"] == "CONTACT_RESOLVED"
    cancelled = (await api.post(f"/actions/{a['id']}/cancel", {"reason": "cambié de idea"})).json()
    assert cancelled["status"] == "cancelled"
    assert (await api.post(f"/actions/{a['id']}/confirm", {})).status_code == 400
    # 6: volver a preparar, ahora con número explícito
    out = await jarvis(api, "Mandá un WhatsApp a +54 9 11 2345-6789 que llego en 10")
    a = out["action"]
    assert "phone" not in a["params"] and a["params"]["recipient_masked"] == "+54 9 11 ****-6789"
    async with session_factory()() as s:
        from app.models import ActionRequest

        stored = await s.get(ActionRequest, __import__("uuid").UUID(a["id"]))
        assert "2345" not in str(stored.params)  # el número no queda en claro en la base
    detail = (await api.get(f"/actions/{a['id']}")).json()
    assert detail["device_params"]["phone"] == "+5491123456789"
    # 7: confirmar con el texto editado en la vista previa
    confirmed = (await api.post(f"/actions/{a['id']}/confirm", {"params": {"text": "Llego en 10 minutos"}})).json()
    assert confirmed["status"] == "ready" and confirmed["state_detail"] == "READY_TO_OPEN"
    assert confirmed["device_params"]["text"] == "Llego en 10 minutos"
    # Un estado inventado ("enviado") se rechaza: no es verificable
    assert (await api.post(f"/actions/{a['id']}/report", {"state": "SENT"})).status_code == 400
    # 8-9: la app abrió WhatsApp con el texto preparado
    done = (await api.post(f"/actions/{a['id']}/report", {"state": "WHATSAPP_OPENED", "result": {"text_chars": 19}})).json()
    assert done["status"] == "completed" and done["state_detail"] == "WHATSAPP_OPENED"
    # Reintento idempotente del mismo informe
    assert (await api.post(f"/actions/{a['id']}/report", {"state": "WHATSAPP_OPENED"})).status_code == 200
    # 10: NEXUS nunca afirma que se envió
    msgs = (await api.get(f"/conversations/{out['conversation_id']}/messages")).json()
    texts = " ".join(m["content"].lower() for m in msgs if m["sender_type"] != "user")
    assert "todavía no está enviado" in texts
    for claim in ("mensaje enviado", "se envió", "ya lo envié", "entregado", "leído"):
        assert claim not in texts


async def test_model_path_streams_and_exposes_real_trace(api, fake_llm):
    await configure_provider(api)
    received: list[dict] = []

    async def listen():
        async for ev in events.subscribe(api.user["id"]):
            received.append(ev)

    listener = asyncio.create_task(listen())
    await asyncio.sleep(0)
    out = await jarvis(api, "¿Cuál es la capital de Australia?")
    assert out["handled"] == "model" and out["intent"]["category"] == "information"
    await drain(max_rounds=3)
    listener.cancel()
    msgs = (await api.get(f"/conversations/{out['conversation_id']}/messages")).json()
    reply = msgs[-1]
    assert reply["content"] == "Canberra es la capital de Australia." and reply["model_used"] == "anthropic:claude-test-opus"
    deltas = "".join(e["data"]["delta"] for e in received if e["type"] == "chat.delta")
    assert deltas == reply["content"]
    states = [e["data"]["state"] for e in received if e["type"] == "jarvis.state"]
    assert states[0] == "thinking" and states[-1] == "idle"
    assert all(e["data"].get("entity") for e in received if e["type"] == "jarvis.state")
    system = fake_llm.calls[-1]["system"]
    assert "NEXUS como asistente personal" in system and "voseo" in system and "Respuesta directa" in system
    trace = (await api.get(f"/jarvis/messages/{out['user_message']['id']}/trace")).json()
    assert trace["intent"]["category"] == "information" and trace["reply"]["model"] == "anthropic:claude-test-opus"
    assert [s["stage"] for s in trace["pipeline"]][-1] == "execution"
    async with session_factory()() as s:
        score = await s.scalar(select(ModelQualityScore))
    assert score.source == "deterministic" and score.criteria["format"] == 10.0
    # feedback del usuario también alimenta la calidad
    assert (await api.post(f"/jarvis/messages/{reply['id']}/feedback", {"rating": 1})).status_code == 204
    quality = (await api.get("/quality")).json()
    assert {i["source"] for i in quality["items"]} == {"deterministic", "user_feedback"}


async def test_voice_input_uses_spoken_format(api, fake_llm):
    await configure_provider(api)
    await jarvis(api, "Contame algo de Marte", input_mode="voice")
    await drain(max_rounds=3)
    call = fake_llm.calls[-1]
    assert "Respuesta hablada" in call["system"] and call["max_tokens"] <= 750


async def test_without_model_it_says_so_but_actions_still_work(api):
    out = await jarvis(api, "Hola, cómo andás?")
    assert out["handled"] == "no_model" and "no hay ninguno configurado" in out["reply"]["content"]
    out = await jarvis(api, "Abrí Spotify")
    assert out["action"]["status"] == "ready" and out["action"]["device_params"] == {"app": "Spotify"}
    assert out["reply"]["content"] == "Abriendo Spotify."


async def test_barge_in_stops_generation(api, fake_llm):
    await configure_provider(api)
    out = await jarvis(api, "Explicame la teoría de la relatividad")
    stop = await jarvis(api, "Pará")
    assert stop["handled"] == "control" and stop["control"] == "stop" and stop["user_message"] is None
    await drain(max_rounds=3)
    msgs = (await api.get(f"/conversations/{out['conversation_id']}/messages")).json()
    assert [m["sender_type"] for m in msgs] == ["user"]  # la respuesta pendiente no se generó
    assert msgs[0]["meta"]["cancel_requested"] is True
    assert fake_llm.calls == []
    # una nueva instrucción conserva el contexto y responde
    await jarvis(api, "Mejor contame de Marte")
    await drain(max_rounds=3)
    msgs = (await api.get(f"/conversations/{out['conversation_id']}/messages")).json()
    assert msgs[-1]["sender_type"] == "agent"
    assert "relatividad" in str(fake_llm.calls[-1]["messages"])


async def test_model_can_propose_actions_through_registry(api, fake_llm):
    await configure_provider(api)
    fake_llm.jarvis_text = "x"
    fake_llm.jarvis_tool = ("actions__propose", {"action_key": "device.navigate", "params": {"destination": "Obelisco"},
                                                 "summary": "Ruta al Obelisco"})
    out = await jarvis(api, "Necesito estar en el Obelisco en un rato, ayudame")
    await drain(max_rounds=3)
    actions = (await api.get("/actions")).json()
    assert actions[0]["action_key"] == "device.navigate" and actions[0]["status"] == "ready" and actions[0]["source"] == "jarvis"
    msgs = (await api.get(f"/conversations/{out['conversation_id']}/messages")).json()
    assert msgs[-1]["meta"]["proposed_actions"] == 1 and "actions.propose" in msgs[-1]["meta"]["tools_used"]


async def test_clarification_fills_missing_time(api):
    out = await jarvis(api, "recordame el viernes pagar la luz")
    assert out["handled"] == "direct" and out["reply"]["content"] == "¿A qué hora te lo recuerdo?"
    out = await jarvis(api, "a las 10")
    a = out["action"]
    assert a["action_key"] == "reminder.create" and a["status"] == "completed"
    at = datetime.fromisoformat(a["params"]["at"]).astimezone(ZoneInfo(TZ))
    assert at.weekday() == 4 and at.hour == 10 and a["params"]["title"] == "Pagar la luz"
    # cancelar una pregunta abierta
    await jarvis(api, "poné un timer")
    out = await jarvis(api, "no, dejalo")
    assert out["reply"]["content"] == "Listo, lo dejo."


async def test_memory_save_lookup_privacy_and_forget(api):
    out = await jarvis(api, "Acordate de que mi hermana se llama Ana")
    a = out["action"]
    assert a["action_key"] == "memory.remember" and a["status"] == "awaiting_confirmation"  # dato personal: SENSITIVE
    done = (await api.post(f"/actions/{a['id']}/confirm", {})).json()
    assert done["status"] == "completed" and done["result"]["verified"]
    out = await jarvis(api, "¿Qué sabés de mí?")
    assert "Mi hermana se llama Ana" in out["reply"]["content"] and "me lo dijiste vos" in out["reply"]["content"]
    privacy = (await api.get("/memory/privacy")).json()
    assert next(c for c in privacy["categories"] if c["key"] == "personal")["count"] == 1
    assert privacy["policy"]["contacts_sent_to_models"] is False
    # desactivar la categoría: deja de usarse
    assert (await api.patch("/settings", {"privacy_settings": {"disabled_memory_categories": ["personal"]}})).status_code == 200
    out = await jarvis(api, "¿Qué sabés de mí?")
    assert "Todavía no tengo recuerdos" in out["reply"]["content"]
    async with session_factory()() as s:
        from app.memory.service import search

        assert await search(s, __import__("uuid").UUID(api.user["id"]), "hermana Ana", for_agent=True) == []
    await api.patch("/settings", {"privacy_settings": {"disabled_memory_categories": []}})
    out = await jarvis(api, "Olvidate de que mi hermana se llama Ana")
    a = out["action"]
    assert a["action_key"] == "memory.forget" and a["risk"] == "IRREVERSIBLE" and a["status"] == "awaiting_confirmation"
    done = (await api.post(f"/actions/{a['id']}/confirm", {})).json()
    assert done["result"]["deleted"] == 1
    async with session_factory()() as s:
        assert await s.scalar(select(MemoryItem.id)) is None


async def test_context_and_state_reflect_real_data(api):
    ctx = (await api.get("/jarvis/context", params={"timezone": TZ})).json()
    assert ctx["lines"] == [] and ctx["message"].endswith("¿Qué hacemos hoy?")
    assert ctx["headline"].startswith(("Buen día", "Buenas tardes", "Buenas noches"))
    state = (await api.get("/jarvis/state")).json()
    assert state["state"] == "idle" and state["pending_actions"] == 0
    await jarvis(api, "Mandale un whatsapp a Juan que ya salgo")
    state = (await api.get("/jarvis/state")).json()
    assert state["state"] == "waiting_confirmation" and state["system_state"] == "WAITING_USER"
    ctx = (await api.get("/jarvis/context", params={"timezone": TZ})).json()
    assert ctx["counts"]["pending_actions"] == 1 and "1 acción esperando tu confirmación" in ctx["message"]


async def test_actions_expire_and_catalog(api):
    catalog = (await api.get("/actions/catalog")).json()
    keys = {a["key"]: a for a in catalog}
    assert keys["whatsapp.open_chat"]["always_confirm"] and keys["device.open_settings"]["risk"] == "READ_ONLY"
    assert set(keys["device.set_alarm"]["android_permissions"]) == {"com.android.alarm.permission.SET_ALARM"}
    out = await jarvis(api, "Llamá a mi hermana")
    aid = out["action"]["id"]
    async with session_factory()() as s:
        from app.actions.service import expire_stale
        from app.models import ActionRequest

        a = await s.get(ActionRequest, __import__("uuid").UUID(aid))
        a.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await s.commit()
        assert await expire_stale(s) == 1
        await s.commit()
    assert (await api.get(f"/actions/{aid}")).json()["status"] == "expired"
    bad = await api.post("/actions/execute", {"action_key": "device.set_alarm", "params": {"hour": 25}})
    assert bad.status_code == 400 and "hora" in bad.json()["message"]


async def test_conversation_summary_job(api, fake_llm):
    await configure_provider(api)
    from app.jarvis.service import get_or_create_jarvis_conversation, summarize_conversation
    from app.agents.runtime import record_message
    import uuid as _uuid

    uid = _uuid.UUID(api.user["id"])
    async with session_factory()() as s:
        conv = await get_or_create_jarvis_conversation(s, uid)
        for i in range(40):
            await record_message(s, uid, channel="chat", channel_id=conv.id, content=f"mensaje {i}", sender_type="user" if i % 2 == 0 else "agent")
        await s.commit()
        await summarize_conversation(s, conv.id)
        await s.commit()
        await s.refresh(conv)
        assert conv.summary == "El usuario conversó con NEXUS sobre varios temas." and conv.summary_until is not None


async def test_history_delete_requires_confirmation(api):
    await jarvis(api, "Abrí la configuración de bluetooth")
    assert (await api.delete("/jarvis/history")).status_code == 400
    r = await api.delete("/jarvis/history", params={"confirm": "true"})
    assert r.json()["messages_deleted"] == 2
    async with session_factory()() as s:
        assert await s.scalar(select(AgentMessage.id)) is None


async def test_history_keeps_question_before_answer(api):
    """El mensaje del usuario y la respuesta se guardan en la misma transacción: igual deben quedar ordenados."""
    prompts = ["Recordame mañana a las 9 llamar al médico", "Abrí Spotify", "Abrí la configuración de bluetooth",
               "Recordame el viernes a las 18 comprar pan"]
    conv = None
    for p in prompts:
        conv = (await jarvis(api, p))["conversation_id"]
    msgs = (await api.get(f"/conversations/{conv}/messages")).json()
    assert [m["sender_type"] for m in msgs] == ["user", "agent"] * len(prompts)
    assert [m["content"] for m in msgs[::2]] == prompts
    stamps = [m["created_at"] for m in msgs]
    assert len(set(stamps)) == len(stamps), "sin empates de marca de tiempo"


async def test_state_ignores_device_action_that_expired_unreported(api):
    out = await jarvis(api, "Abrí Spotify")  # acción del teléfono: queda «ready» hasta que la app reporte
    assert out["action"]["status"] == "ready"
    assert (await api.get("/jarvis/state")).json()["state"] == "executing"
    async with session_factory()() as s:
        from app.models import ActionRequest

        a = await s.get(ActionRequest, __import__("uuid").UUID(out["action"]["id"]))
        a.expires_at = datetime.now(UTC) - timedelta(seconds=1)  # la app nunca reportó y venció
        await s.commit()
    state = (await api.get("/jarvis/state")).json()
    assert state["state"] == "idle" and state["system_state"] in ("IDLE", "ERROR")
