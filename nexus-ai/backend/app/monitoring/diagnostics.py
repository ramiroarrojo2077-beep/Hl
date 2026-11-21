"""Reportes de fallos de la app, SOLO con consentimiento explícito del usuario."""

from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import CurrentUser, current_user
from app.core.db import get_session
from app.core.errors import NexusError
from app.models import CrashReport, UserSettings

router = APIRouter(prefix="/diagnostics", tags=["diagnostics"])
# Se quitan del stacktrace números de teléfono, emails y tokens antes de guardarlo.
_SCRUB = [(re.compile(r"\+?\d[\d\s\-]{7,}\d"), "<número>"), (re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+"), "<email>"),
          (re.compile(r"(?i)(bearer|token|key)[=: ]+\S+"), r"\1=<redactado>")]


class CrashIn(BaseModel):
    app_version: str = Field(max_length=40)
    device: str = Field(max_length=120)
    stacktrace: str = Field(max_length=20_000)


def scrub(text: str) -> str:
    for pattern, repl in _SCRUB:
        text = pattern.sub(repl, text)
    return text


@router.post("/crash", status_code=status.HTTP_201_CREATED)
async def report_crash(body: CrashIn, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    settings = await session.get(UserSettings, cu.id)
    if not (settings and (settings.privacy_settings or {}).get("crash_reports_consent")):
        raise NexusError("No diste consentimiento para enviar reportes de fallos", code="no_consent")
    row = CrashReport(user_id=cu.id, app_version=body.app_version, device=body.device, stacktrace=scrub(body.stacktrace))
    session.add(row)
    await session.commit()
    return {"id": str(row.id)}


@router.get("/crash")
async def list_crashes(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[dict[str, Any]]:
    rows = (await session.scalars(select(CrashReport).where(CrashReport.user_id == cu.id).order_by(CrashReport.created_at.desc()).limit(50))).all()
    return [{"id": str(r.id), "app_version": r.app_version, "device": r.device, "created_at": r.created_at.isoformat(),
             "stacktrace": r.stacktrace[:4000]} for r in rows]
