"""Dependencias de autenticación. Los permisos se derivan siempre del servidor:
nunca se confía en datos de autorización enviados por el cliente."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.service import session_is_active
from app.core.config import get_settings
from app.core.db import get_session
from app.core.ratelimit import hit
from app.core.security import InvalidToken, decode_access_token
from app.models import User

_bearer = HTTPBearer(auto_error=False)


@dataclass
class CurrentUser:
    user: User
    session_id: uuid.UUID

    @property
    def id(self) -> uuid.UUID:
        return self.user.id


async def resolve_token(session: AsyncSession, token: str) -> CurrentUser:
    try:
        payload = decode_access_token(token)
        user_id = uuid.UUID(payload["sub"])
        session_id = uuid.UUID(payload["sid"])
    except (InvalidToken, KeyError, ValueError) as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido o expirado") from exc
    user = await session.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuario inválido")
    if not await session_is_active(session, user_id, session_id):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "La sesión fue cerrada")
    return CurrentUser(user=user, session_id=session_id)


async def current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    session: AsyncSession = Depends(get_session),
) -> CurrentUser:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Falta el token de acceso")
    cu = await resolve_token(session, credentials.credentials)
    if not await hit(f"user:{cu.id}", get_settings().rate_limit_per_minute):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Demasiadas solicitudes. Esperá un momento.")
    request.state.user_id = cu.id
    return cu
