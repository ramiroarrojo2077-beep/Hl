"""Endpoints de voz (/api/v1/voice). El audio nunca se almacena."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import CurrentUser, current_user
from app.core.db import get_session
from app.models import UserSettings
from app.monitoring.audit import record_audit
from app.voice import service

router = APIRouter(prefix="/voice", tags=["voice"])


class SynthesisIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    voice: str | None = Field(default=None, max_length=40)
    speed: float = Field(default=1.0, ge=0.5, le=2.0)
    format: str = Field(default="mp3", pattern=r"^(mp3|wav|opus|aac)$")


@router.get("/settings")
async def get_settings_(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    settings = await session.get(UserSettings, cu.id)
    assert settings is not None
    return {**service.current(settings), "remote": await service.remote_status(session, cu.id)}


@router.patch("/settings")
async def patch_settings(body: dict[str, Any], cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    settings = await session.get(UserSettings, cu.id)
    assert settings is not None
    merged = service.apply_patch(settings, body)
    await record_audit(session, cu.id, "voice.settings_updated", "Preferencias de voz actualizadas", actor_type="user",
                       details={"fields": sorted(body)})
    await session.commit()
    return {**merged, "remote": await service.remote_status(session, cu.id)}


@router.post("/transcriptions")
async def transcriptions(file: UploadFile = File(...), language: str | None = Form(default=None),
                         cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    audio = await file.read(service.MAX_AUDIO_BYTES + 1)
    return await service.transcribe(session, cu.id, audio, file.filename or "audio", file.content_type or "application/octet-stream", language)


@router.post("/synthesis")
async def synthesis(body: SynthesisIn, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> Response:
    audio, mime, model = await service.synthesize(session, cu.id, body.text, body.voice, body.speed, body.format)
    return Response(content=audio, media_type=mime, headers={"x-nexus-tts-model": model, "cache-control": "no-store"})
