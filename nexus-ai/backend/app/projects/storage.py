"""Almacenamiento de archivos de proyecto en disco, aislado por usuario y proyecto.

Las claves de almacenamiento las genera el servidor (nunca derivan de rutas del cliente),
lo que evita escapes de directorio. La interfaz permite cambiar a S3 u otro backend.
"""

from __future__ import annotations

import hashlib
import mimetypes
import posixpath
import re
import uuid
from pathlib import Path

import anyio
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import NexusError, NotFound
from app.models import Project, ProjectFile

_PATH_RE = re.compile(r"^[\w\-. /()áéíóúñÁÉÍÓÚÑ]+$")


class InvalidPath(NexusError):
    code = "invalid_path"


def normalize_path(path: str) -> str:
    path = path.strip().replace("\\", "/")
    norm = posixpath.normpath("/" + path).lstrip("/")
    if not norm or norm.startswith("..") or len(norm) > 400 or not _PATH_RE.match(norm):
        raise InvalidPath(f"Ruta inválida: {path!r}")
    return norm


def guess_type(path: str) -> str:
    ctype, _ = mimetypes.guess_type(path)
    if ctype:
        return ctype
    if path.endswith((".md", ".markdown")):
        return "text/markdown"
    if path.endswith((".kt", ".kts", ".py", ".ts", ".tsx", ".gradle", ".toml", ".yaml", ".yml")):
        return "text/plain"
    return "application/octet-stream"


def _root() -> Path:
    return Path(get_settings().storage_dir).resolve()


async def write_bytes(storage_key: str, data: bytes) -> None:
    target = _root() / storage_key
    await anyio.Path(target.parent).mkdir(parents=True, exist_ok=True)
    await anyio.Path(target).write_bytes(data)


async def read_bytes(storage_key: str) -> bytes:
    target = (_root() / storage_key).resolve()
    if not str(target).startswith(str(_root())):
        raise InvalidPath("Clave de almacenamiento inválida")
    return await anyio.Path(target).read_bytes()


async def get_project(session: AsyncSession, user_id: uuid.UUID, project_id: uuid.UUID) -> Project:
    project = await session.get(Project, project_id)
    if project is None or project.user_id != user_id:
        raise NotFound("Proyecto no encontrado")
    return project


async def save_file(
    session: AsyncSession,
    project: Project,
    path: str,
    data: bytes,
    *,
    content_type: str | None = None,
    agent_id: uuid.UUID | None = None,
    mission_id: uuid.UUID | None = None,
    change_note: str | None = None,
) -> ProjectFile:
    settings = get_settings()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise NexusError(f"El archivo supera {settings.max_upload_mb} MB")
    path = normalize_path(path)
    current = await session.scalar(
        select(func.max(ProjectFile.version)).where(ProjectFile.project_id == project.id, ProjectFile.path == path)
    )
    version = (current or 0) + 1
    storage_key = f"{project.user_id}/{project.id}/{uuid.uuid4().hex}"
    await write_bytes(storage_key, data)
    await session.execute(
        update(ProjectFile).where(ProjectFile.project_id == project.id, ProjectFile.path == path).values(is_latest=False)
    )
    pfile = ProjectFile(
        project_id=project.id,
        user_id=project.user_id,
        path=path,
        version=version,
        is_latest=True,
        content_type=content_type or guess_type(path),
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
        storage_key=storage_key,
        created_by_agent_id=agent_id,
        mission_id=mission_id,
        change_note=change_note,
    )
    session.add(pfile)
    await session.flush()
    return pfile


async def latest_file(session: AsyncSession, project_id: uuid.UUID, path: str) -> ProjectFile | None:
    return await session.scalar(
        select(ProjectFile).where(
            ProjectFile.project_id == project_id, ProjectFile.path == normalize_path(path), ProjectFile.is_latest.is_(True)
        )
    )
