"""Registro, login, rotación de refresh tokens y cierre de sesión."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.schemas import TokenPair
from app.core.config import get_settings
from app.core.errors import Conflict, Forbidden, NexusError
from app.core.security import (
    create_access_token,
    hash_password,
    hash_token,
    new_refresh_token,
    password_needs_rehash,
    verify_password,
)
from app.models import RefreshToken, User

# Hash fijo para igualar el tiempo de respuesta cuando el email no existe.
_DUMMY_HASH = hash_password("dummy-password-for-timing-1A")


class InvalidCredentials(NexusError):
    status_code = 401
    code = "invalid_credentials"


async def register_user(session: AsyncSession, email: str, password: str, display_name: str) -> User:
    from app.agents.bootstrap import bootstrap_user  # evita import circular

    settings = get_settings()
    if not settings.allow_registration:
        raise Forbidden("El registro de usuarios está deshabilitado en este servidor")
    email = email.strip().lower()
    exists = await session.scalar(select(User.id).where(User.email == email))
    if exists:
        raise Conflict("Ya existe una cuenta con ese email", code="email_taken")
    user = User(email=email, password_hash=hash_password(password), display_name=display_name.strip())
    session.add(user)
    await session.flush()
    await bootstrap_user(session, user)
    return user


async def authenticate(session: AsyncSession, email: str, password: str) -> User:
    user = await session.scalar(select(User).where(User.email == email.strip().lower()))
    if user is None:
        verify_password(_DUMMY_HASH, password)
        raise InvalidCredentials("Email o contraseña incorrectos")
    if not verify_password(user.password_hash, password):
        raise InvalidCredentials("Email o contraseña incorrectos")
    if not user.is_active:
        raise Forbidden("La cuenta está desactivada")
    if password_needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    user.last_login_at = datetime.now(UTC)
    return user


async def issue_tokens(
    session: AsyncSession,
    user: User,
    *,
    family_id: uuid.UUID | None = None,
    user_agent: str | None = None,
    ip: str | None = None,
) -> tuple[TokenPair, RefreshToken]:
    settings = get_settings()
    family = family_id or uuid.uuid4()
    raw = new_refresh_token()
    refresh_expires = datetime.now(UTC) + timedelta(days=settings.refresh_token_ttl_days)
    record = RefreshToken(
        user_id=user.id,
        family_id=family,
        token_hash=hash_token(raw),
        expires_at=refresh_expires,
        user_agent=(user_agent or "")[:300] or None,
        ip=ip,
    )
    session.add(record)
    await session.flush()
    access, access_expires = create_access_token(user.id, family)
    return (
        TokenPair(
            access_token=access,
            refresh_token=raw,
            access_expires_at=access_expires,
            refresh_expires_at=refresh_expires,
        ),
        record,
    )


async def rotate_refresh_token(
    session: AsyncSession, raw_token: str, *, user_agent: str | None = None, ip: str | None = None
) -> tuple[User, TokenPair]:
    record = await session.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_token(raw_token)).with_for_update()
    )
    now = datetime.now(UTC)
    if record is None:
        raise InvalidCredentials("Sesión inválida. Iniciá sesión de nuevo.")
    if record.revoked_at is not None:
        # Reutilización de un token ya rotado: posible robo. Se revoca toda la familia.
        await revoke_family(session, record.family_id)
        await session.commit()
        raise InvalidCredentials("La sesión fue revocada por seguridad. Iniciá sesión de nuevo.")
    if record.expires_at <= now:
        raise InvalidCredentials("La sesión expiró. Iniciá sesión de nuevo.")
    user = await session.get(User, record.user_id)
    if user is None or not user.is_active:
        raise InvalidCredentials("Sesión inválida.")
    pair, new_record = await issue_tokens(session, user, family_id=record.family_id, user_agent=user_agent, ip=ip)
    record.revoked_at = now
    record.replaced_by_id = new_record.id
    return user, pair


async def revoke_family(session: AsyncSession, family_id: uuid.UUID) -> None:
    await session.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )


async def session_is_active(session: AsyncSession, user_id: uuid.UUID, family_id: uuid.UUID) -> bool:
    found = await session.scalar(
        select(RefreshToken.id)
        .where(
            RefreshToken.user_id == user_id,
            RefreshToken.family_id == family_id,
            RefreshToken.revoked_at.is_(None),
            RefreshToken.expires_at > datetime.now(UTC),
        )
        .limit(1)
    )
    return found is not None
