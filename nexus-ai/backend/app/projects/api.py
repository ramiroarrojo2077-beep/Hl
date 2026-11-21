from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.api import owned_agent
from app.api.schemas import ProjectAgentOut, ProjectCreate, ProjectFileOut, ProjectOut, ProjectUpdate
from app.auth.deps import CurrentUser, current_user
from app.core.config import get_settings
from app.core.db import get_session
from app.core.errors import NexusError, NotFound
from app.jobs import queue
from app.models import Conversation, MemoryItem, Mission, Project, ProjectAgent, ProjectFile
from app.monitoring.audit import record_audit
from app.projects import storage

router = APIRouter(prefix="/projects", tags=["projects"])


async def _out(session: AsyncSession, project: Project) -> ProjectOut:
    item = ProjectOut.model_validate(project)
    agents = (await session.scalars(select(ProjectAgent).where(ProjectAgent.project_id == project.id))).all()
    item.agents = [ProjectAgentOut(agent_id=a.agent_id, responsibility=a.responsibility) for a in agents]

    async def count(model, *where) -> int:
        return int(await session.scalar(select(func.count()).select_from(model).where(*where)) or 0)

    item.counts = {
        "missions": await count(Mission, Mission.project_id == project.id),
        "files": await count(ProjectFile, ProjectFile.project_id == project.id, ProjectFile.is_latest.is_(True)),
        "memories": await count(MemoryItem, MemoryItem.project_id == project.id),
        "conversations": await count(Conversation, Conversation.project_id == project.id),
    }
    return item


async def _set_agents(session: AsyncSession, user_id: uuid.UUID, project: Project, agents: list[ProjectAgentOut]) -> None:
    await session.execute(delete(ProjectAgent).where(ProjectAgent.project_id == project.id))
    for a in agents:
        await owned_agent(session, user_id, a.agent_id)
        session.add(ProjectAgent(project_id=project.id, agent_id=a.agent_id, responsibility=a.responsibility[:200]))


@router.get("", response_model=list[ProjectOut])
async def list_projects(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[ProjectOut]:
    projects = (await session.scalars(select(Project).where(Project.user_id == cu.id).order_by(Project.updated_at.desc()))).all()
    return [await _out(session, p) for p in projects]


@router.post("", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
async def create_project(body: ProjectCreate, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> ProjectOut:
    project = Project(user_id=cu.id, name=body.name, description=body.description, objective=body.objective)
    session.add(project)
    await session.flush()
    await _set_agents(session, cu.id, project, body.agents)
    await record_audit(session, cu.id, "project.created", f"Proyecto creado: {project.name}", actor_type="user",
                       target_type="project", target_id=project.id, project_id=project.id)
    await session.commit()
    return await _out(session, project)


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(project_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> ProjectOut:
    return await _out(session, await storage.get_project(session, cu.id, project_id))


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(project_id: uuid.UUID, body: ProjectUpdate, cu: CurrentUser = Depends(current_user),
                         session: AsyncSession = Depends(get_session)) -> ProjectOut:
    project = await storage.get_project(session, cu.id, project_id)
    data = body.model_dump(exclude_unset=True, exclude={"agents"})
    for k, v in data.items():
        if v is not None:
            setattr(project, k, v)
    if body.agents is not None:
        await _set_agents(session, cu.id, project, body.agents)
    await record_audit(session, cu.id, "project.updated", f"Proyecto actualizado: {project.name}", actor_type="user",
                       target_type="project", target_id=project.id, project_id=project.id)
    await session.commit()
    return await _out(session, project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> None:
    project = await storage.get_project(session, cu.id, project_id)
    await record_audit(session, cu.id, "project.deleted", f"Proyecto eliminado: {project.name}", actor_type="user")
    await session.delete(project)
    await session.commit()


@router.get("/{project_id}/files", response_model=list[ProjectFileOut])
async def list_files(project_id: uuid.UUID, path: str | None = None, cu: CurrentUser = Depends(current_user),
                     session: AsyncSession = Depends(get_session)) -> list[ProjectFile]:
    """Sin `path`: última versión de cada archivo. Con `path`: historial de versiones."""
    await storage.get_project(session, cu.id, project_id)
    q = select(ProjectFile).where(ProjectFile.project_id == project_id)
    if path:
        q = q.where(ProjectFile.path == storage.normalize_path(path)).order_by(ProjectFile.version.desc())
    else:
        q = q.where(ProjectFile.is_latest.is_(True)).order_by(ProjectFile.path)
    return list((await session.scalars(q)).all())


@router.post("/{project_id}/files", response_model=ProjectFileOut, status_code=status.HTTP_201_CREATED)
async def upload_file(project_id: uuid.UUID, file: UploadFile = File(...), path: str | None = Form(default=None),
                      cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> ProjectFile:
    project = await storage.get_project(session, cu.id, project_id)
    limit = get_settings().max_upload_mb * 1024 * 1024
    data = await file.read(limit + 1)
    if len(data) > limit:
        raise NexusError(f"El archivo supera {get_settings().max_upload_mb} MB")
    target = path or file.filename or "archivo"
    pfile = await storage.save_file(session, project, target, data, content_type=file.content_type or None,
                                    change_note="Subido por el usuario")
    await queue.enqueue(session, "file.index", {"file_id": str(pfile.id)}, user_id=cu.id, idempotency_key=f"file.index:{pfile.id}")
    await record_audit(session, cu.id, "project.file_uploaded", f"Archivo subido: {pfile.path} v{pfile.version}", actor_type="user",
                       target_type="file", target_id=pfile.id, project_id=project.id)
    await queue.commit(session)
    return pfile


@router.get("/{project_id}/files/{file_id}/content")
async def download_file(project_id: uuid.UUID, file_id: uuid.UUID, cu: CurrentUser = Depends(current_user),
                        session: AsyncSession = Depends(get_session)) -> Response:
    await storage.get_project(session, cu.id, project_id)
    pfile = await session.get(ProjectFile, file_id)
    if pfile is None or pfile.project_id != project_id:
        raise NotFound("Archivo no encontrado")
    data = await storage.read_bytes(pfile.storage_key)
    filename = pfile.path.rsplit("/", 1)[-1].replace('"', "")
    return Response(content=data, media_type=pfile.content_type, headers={"content-disposition": f'attachment; filename="{filename}"'})
