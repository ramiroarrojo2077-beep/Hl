"""API de NEXUS AI (FastAPI)."""

from __future__ import annotations

import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from sqlalchemy import text

from app.actions.api import router as actions_router
from app.agents.api import router as agents_router
from app.automations.api import router as automations_router
from app.integrations.whatsapp.api import router as whatsapp_router
from app.jarvis.api import router as jarvis_router
from app.monitoring.diagnostics import router as diagnostics_router
from app.voice.api import router as voice_router
from app.api.ws import router as ws_router
from app.auth.api import router as auth_router
from app.chat.api import router as chat_router
from app.core.config import get_settings
from app.core.db import dispose_engine, session_factory
from app.core.errors import install_handlers
from app.core.logging import setup_logging
from app.core.redis import close_redis, get_redis
from app.meetings.api import router as meetings_router
from app.memory.api import router as memory_router
from app.missions.api import router as missions_router
from app.monitoring import metrics
from app.monitoring.api import router as monitoring_router
from app.projects.api import router as projects_router
from app.providers.api import router as providers_router
from app.providers.registry import close_http_client
from app.settings.api import router as settings_router
from app.tools.registry import sync_tool_definitions

VERSION = "2.0.0"


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    setup_logging(settings.log_level)
    async with session_factory()() as session:
        await sync_tool_definitions(session)
        await session.commit()
    yield
    await close_http_client()
    await close_redis()
    await dispose_engine()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="NEXUS AI API", version=VERSION, lifespan=lifespan,
                  docs_url="/docs" if settings.env != "production" else None, redoc_url=None)
    install_handlers(app)
    if settings.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False,
                           allow_methods=["*"], allow_headers=["authorization", "content-type"])

    @app.middleware("http")
    async def security_and_metrics(request: Request, call_next):
        if settings.require_https:
            proto = request.headers.get("x-forwarded-proto", request.url.scheme)
            if proto != "https" and request.url.path not in ("/health", "/ready"):
                return JSONResponse({"error": "https_required", "message": "Se requiere HTTPS"}, status_code=403)
        started = time.perf_counter()
        response = await call_next(request)
        route = request.scope.get("route")
        path = getattr(route, "path", "unmatched")
        metrics.REQUESTS.labels(request.method, path, str(response.status_code)).inc()
        metrics.REQUEST_SECONDS.labels(path).observe(time.perf_counter() - started)
        response.headers["x-content-type-options"] = "nosniff"
        response.headers["x-frame-options"] = "DENY"
        response.headers["referrer-policy"] = "no-referrer"
        if settings.require_https:
            response.headers["strict-transport-security"] = "max-age=31536000; includeSubDomains"
        return response

    v1 = APIRouter(prefix="/api/v1")
    for r in (auth_router, agents_router, missions_router, meetings_router, memory_router, providers_router,
              monitoring_router, settings_router, projects_router, chat_router, ws_router,
              jarvis_router, actions_router, automations_router, whatsapp_router, voice_router, diagnostics_router):
        v1.include_router(r)
    app.include_router(v1)

    @app.get("/health", include_in_schema=False)
    async def health() -> dict:
        return {"status": "ok", "version": VERSION}

    @app.get("/ready", include_in_schema=False)
    async def ready() -> JSONResponse:
        checks = {}
        try:
            async with session_factory()() as session:
                await session.execute(text("SELECT 1"))
            checks["database"] = "ok"
        except Exception as exc:  # noqa: BLE001
            checks["database"] = f"error: {type(exc).__name__}"
        redis = await get_redis()
        checks["redis"] = "ok" if redis is not None else ("not_configured" if not settings.redis_url else "unavailable")
        ok = checks["database"] == "ok" and checks["redis"] in ("ok", "not_configured")
        return JSONResponse({"status": "ok" if ok else "degraded", "checks": checks}, status_code=200 if ok else 503)

    @app.get("/metrics", include_in_schema=False)
    async def prometheus() -> PlainTextResponse:
        return PlainTextResponse(generate_latest().decode(), media_type=CONTENT_TYPE_LATEST)

    return app


app = create_app()
