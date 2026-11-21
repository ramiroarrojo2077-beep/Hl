from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import CurrentUser, current_user
from app.auth.schemas import (
    AuthResponse,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    SessionOut,
    TokenPair,
    UserOut,
)
from app.auth.service import authenticate, issue_tokens, register_user, revoke_family, rotate_refresh_token
from app.core.db import get_session
from app.core.errors import NotFound
from app.core.ratelimit import client_ip, limit_auth
from app.models import RefreshToken
from app.monitoring.audit import record_audit

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(limit_auth)])
async def register(body: RegisterRequest, request: Request, session: AsyncSession = Depends(get_session)) -> AuthResponse:
    user = await register_user(session, body.email, body.password, body.display_name)
    pair, _ = await issue_tokens(session, user, user_agent=request.headers.get("user-agent"), ip=client_ip(request))
    await record_audit(session, user.id, "user.registered", "Cuenta creada", actor_type="user")
    await session.commit()
    return AuthResponse(user=UserOut.model_validate(user), tokens=pair)


@router.post("/login", response_model=AuthResponse, dependencies=[Depends(limit_auth)])
async def login(body: LoginRequest, request: Request, session: AsyncSession = Depends(get_session)) -> AuthResponse:
    user = await authenticate(session, body.email, body.password)
    pair, _ = await issue_tokens(session, user, user_agent=request.headers.get("user-agent"), ip=client_ip(request))
    await record_audit(session, user.id, "user.login", "Inicio de sesión", actor_type="user", details={"ip": client_ip(request)})
    await session.commit()
    return AuthResponse(user=UserOut.model_validate(user), tokens=pair)


@router.post("/refresh", response_model=TokenPair, dependencies=[Depends(limit_auth)])
async def refresh(body: RefreshRequest, request: Request, session: AsyncSession = Depends(get_session)) -> TokenPair:
    _, pair = await rotate_refresh_token(
        session, body.refresh_token, user_agent=request.headers.get("user-agent"), ip=client_ip(request)
    )
    await session.commit()
    return pair


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> None:
    await revoke_family(session, cu.session_id)
    await record_audit(session, cu.id, "user.logout", "Cierre de sesión", actor_type="user")
    await session.commit()


@router.get("/me", response_model=UserOut)
async def me(cu: CurrentUser = Depends(current_user)) -> UserOut:
    return UserOut.model_validate(cu.user)


@router.get("/sessions", response_model=list[SessionOut])
async def sessions(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[SessionOut]:
    rows = (
        await session.scalars(
            select(RefreshToken)
            .where(RefreshToken.user_id == cu.id, RefreshToken.revoked_at.is_(None))
            .order_by(RefreshToken.created_at.desc())
        )
    ).all()
    return [
        SessionOut(
            family_id=r.family_id,
            created_at=r.created_at,
            expires_at=r.expires_at,
            user_agent=r.user_agent,
            ip=r.ip,
            current=r.family_id == cu.session_id,
        )
        for r in rows
    ]


@router.delete("/sessions/{family_id}", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_session(
    family_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)
) -> None:
    owned = await session.scalar(
        select(RefreshToken.id).where(RefreshToken.user_id == cu.id, RefreshToken.family_id == family_id).limit(1)
    )
    if not owned:
        raise NotFound("Sesión no encontrada")
    await revoke_family(session, family_id)
    await record_audit(session, cu.id, "user.session_revoked", "Sesión revocada", actor_type="user")
    await session.commit()
