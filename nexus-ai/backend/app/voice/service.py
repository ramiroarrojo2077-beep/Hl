"""NEXUS Voice Engine (parte servidor).

El reconocimiento y la síntesis por defecto ocurren EN EL TELÉFONO (SpeechRecognizer y
TextToSpeech de Android): el audio no sale del dispositivo. Estas funciones son el modo
"remoto" opcional, que solo funciona si el usuario configuró un modelo con capacidad
`stt` o `tts` (p. ej. un endpoint OpenAI-compatible de audio). El audio recibido se
procesa en memoria y no se guarda nunca.

Retención: las transcripciones de mensajes por voz se redactan pasado el plazo elegido
(transcript_retention_days; 0 = no conservarlas una vez respondidas).
"""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NexusError
from app.models import AgentMessage, UserSettings

DEFAULT_VOICE_SETTINGS: dict[str, Any] = {
    "language": "es-AR",
    "voice_name": None,  # voz del motor TTS del teléfono elegida por el usuario
    "speech_rate": 1.0,
    "pitch": 1.0,
    "volume": 1.0,
    "mode": "push_to_talk",  # push_to_talk | continuous
    "auto_speak": True,
    "barge_in": True,
    "wake_word_enabled": False,
    "wake_word": "nexus",
    "wake_word_consent_at": None,
    "processing": "local",  # local | remote
    "save_transcripts": True,
    "transcript_retention_days": 30,
    "store_audio": False,  # NEXUS nunca guarda audio: el campo es informativo y no se puede activar
    "subtitles": True,
}
LIMITS = {"speech_rate": (0.5, 2.0), "pitch": (0.5, 2.0), "volume": (0.0, 1.0), "transcript_retention_days": (0, 365)}
MAX_AUDIO_BYTES = 10 * 1024 * 1024
ALLOWED_AUDIO = {"audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/m4a", "audio/aac", "audio/ogg", "audio/webm", "audio/3gpp", "audio/amr"}


class VoiceError(NexusError):
    code = "voice_error"


def current(settings: UserSettings) -> dict[str, Any]:
    return {**DEFAULT_VOICE_SETTINGS, **(settings.voice_settings or {}), "store_audio": False}


def apply_patch(settings: UserSettings, patch: dict[str, Any]) -> dict[str, Any]:
    merged = current(settings)
    for key, value in patch.items():
        if key not in DEFAULT_VOICE_SETTINGS or key in ("store_audio", "wake_word_consent_at"):
            continue
        if value is None and key not in ("voice_name",):
            continue
        if key in LIMITS:
            lo, hi = LIMITS[key]
            try:
                value = type(DEFAULT_VOICE_SETTINGS[key])(value)
            except (TypeError, ValueError) as exc:
                raise VoiceError(f"Valor inválido para {key}") from exc
            if not lo <= value <= hi:
                raise VoiceError(f"{key} debe estar entre {lo} y {hi}")
        elif key == "mode" and value not in ("push_to_talk", "continuous"):
            raise VoiceError("mode debe ser push_to_talk o continuous")
        elif key == "processing" and value not in ("local", "remote"):
            raise VoiceError("processing debe ser local o remote")
        elif key == "wake_word":
            value = str(value).strip().lower()[:24]
            if len(value) < 3:
                raise VoiceError("La palabra de activación debe tener al menos 3 letras")
        elif key in ("auto_speak", "barge_in", "save_transcripts", "subtitles", "wake_word_enabled"):
            value = bool(value)
        elif key == "language":
            value = str(value)[:12]
        merged[key] = value
    if patch.get("wake_word_enabled") and not (settings.voice_settings or {}).get("wake_word_enabled"):
        if not patch.get("wake_word_consent"):
            raise VoiceError("Activar la palabra de activación requiere tu consentimiento explícito (wake_word_consent=true)")
        merged["wake_word_consent_at"] = datetime.now(UTC).isoformat()
    if patch.get("wake_word_enabled") is False:
        merged["wake_word_consent_at"] = None
    settings.voice_settings = merged
    return merged


async def _model_with(session: AsyncSession, user_id: uuid.UUID, capability: str):
    from app.providers.router import load_usable_models

    for model, provider in await load_usable_models(session, user_id):
        if capability in (model.capabilities or []):
            return model, provider
    return None


async def remote_status(session: AsyncSession, user_id: uuid.UUID) -> dict[str, Any]:
    stt = await _model_with(session, user_id, "stt")
    tts = await _model_with(session, user_id, "tts")
    return {"stt": {"available": stt is not None, "model": stt[0].display_name if stt else None},
            "tts": {"available": tts is not None, "model": tts[0].display_name if tts else None}}


async def transcribe(session: AsyncSession, user_id: uuid.UUID, audio: bytes, filename: str, content_type: str, language: str | None) -> dict[str, Any]:
    from app.providers.base import ProviderCallError
    from app.providers.registry import adapter_for

    if not audio:
        raise VoiceError("El audio está vacío")
    if len(audio) > MAX_AUDIO_BYTES:
        raise VoiceError("El audio supera 10 MB")
    if content_type.split(";")[0].strip() not in ALLOWED_AUDIO:
        raise VoiceError(f"Formato de audio no soportado: {content_type}")
    found = await _model_with(session, user_id, "stt")
    if found is None:
        raise VoiceError("No hay un modelo de transcripción remota configurado (capacidad «stt»). La app usa el reconocimiento local.",
                         code="no_stt_model")
    model, provider = found
    started = time.perf_counter()
    try:
        text = await adapter_for(provider).transcribe(model.model_name, audio, filename or "audio", content_type, language)
    except ProviderCallError as exc:
        raise VoiceError(f"La transcripción remota falló: {exc}", code="stt_failed") from exc
    # El audio no se persiste: se descarta al terminar esta función.
    return {"text": text, "model": model.display_name, "latency_ms": int((time.perf_counter() - started) * 1000), "audio_stored": False}


async def synthesize(session: AsyncSession, user_id: uuid.UUID, text: str, voice: str | None, speed: float, fmt: str) -> tuple[bytes, str, str]:
    from app.providers.base import ProviderCallError
    from app.providers.registry import adapter_for

    text = (text or "").strip()
    if not text:
        raise VoiceError("No hay texto para sintetizar")
    if len(text) > 4000:
        raise VoiceError("El texto supera 4000 caracteres")
    found = await _model_with(session, user_id, "tts")
    if found is None:
        raise VoiceError("No hay un modelo de síntesis remota configurado (capacidad «tts»). La app usa la voz del teléfono.",
                         code="no_tts_model")
    model, provider = found
    try:
        audio = await adapter_for(provider).synthesize(model.model_name, text, voice or "alloy", max(0.5, min(speed, 2.0)), fmt)
    except ProviderCallError as exc:
        raise VoiceError(f"La síntesis remota falló: {exc}", code="tts_failed") from exc
    mime = {"mp3": "audio/mpeg", "wav": "audio/wav", "opus": "audio/ogg", "aac": "audio/aac"}.get(fmt, "application/octet-stream")
    return audio, mime, model.display_name


_last_purge = 0.0


async def purge_expired_transcripts(session: AsyncSession, *, force: bool = False) -> int:
    """Redacta las transcripciones de voz vencidas según la política de cada usuario (cada hora)."""
    global _last_purge
    if not force and time.monotonic() - _last_purge < 3600:
        return 0
    _last_purge = time.monotonic()
    redacted = 0
    for settings in (await session.scalars(select(UserSettings))).all():
        vs = current(settings)
        days = int(vs.get("transcript_retention_days", 30)) if vs.get("save_transcripts", True) else 0
        cutoff = datetime.now(UTC) - (timedelta(days=days) if days else timedelta(minutes=10))
        rows = (await session.scalars(
            select(AgentMessage).where(AgentMessage.user_id == settings.user_id, AgentMessage.sender_type == "user",
                                       AgentMessage.meta["input_mode"].astext == "voice", AgentMessage.created_at < cutoff,
                                       AgentMessage.meta["redacted"].astext.is_(None))
            .limit(500)
        )).all()
        for m in rows:
            m.content = "(transcripción de voz eliminada por la política de retención)"
            m.meta = {**(m.meta or {}), "redacted": True, "redacted_at": datetime.now(UTC).isoformat()}
            redacted += 1
    return redacted
