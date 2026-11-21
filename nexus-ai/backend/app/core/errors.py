"""Errores de dominio y su traducción a HTTP sin filtrar detalles internos."""

from __future__ import annotations

import logging

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)


class NexusError(Exception):
    status_code = 400
    code = "error"

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        if code:
            self.code = code


class NotFound(NexusError):
    status_code = 404
    code = "not_found"


class Conflict(NexusError):
    status_code = 409
    code = "conflict"


class Forbidden(NexusError):
    status_code = 403
    code = "forbidden"


class BudgetExceeded(NexusError):
    status_code = 402
    code = "budget_exceeded"


class EmergencyStopActive(NexusError):
    status_code = 423
    code = "emergency_stop"


class ProviderError(NexusError):
    status_code = 502
    code = "provider_error"


def install_handlers(app: FastAPI) -> None:
    @app.exception_handler(NexusError)
    async def _nexus(_: Request, exc: NexusError) -> JSONResponse:
        return JSONResponse({"error": exc.code, "message": exc.message}, status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Error no controlado en %s %s", request.method, request.url.path)
        return JSONResponse(
            {"error": "internal_error", "message": "Error interno. Quedó registrado para su revisión."},
            status_code=500,
        )
