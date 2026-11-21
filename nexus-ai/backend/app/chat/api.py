from __future__ import annotations

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.api import owned_agent
from app.api.schemas import ChatMessageIn, ConversationCreate, ConversationOut, MessageOut
from app.auth.deps import CurrentUser, current_user
from app.chat.service import get_conversation, post_user_message
from app.core.db import get_session
from app.core.errors import NexusError, NotFound
from app.jobs import queue
from app.models import AgentMessage, Conversation, ProjectFile
from app.projects.storage import get_project

router = APIRouter(prefix="/conversations", tags=["chat"])


@router.get("", response_model=list[ConversationOut])
async def list_conversations(cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[Conversation]:
    return list((await session.scalars(select(Conversation).where(Conversation.user_id == cu.id).order_by(Conversation.updated_at.desc()).limit(100))).all())


@router.post("", response_model=ConversationOut, status_code=status.HTTP_201_CREATED)
async def create_conversation(body: ConversationCreate, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> Conversation:
    if body.agent_id:
        await owned_agent(session, cu.id, body.agent_id)
    if body.project_id:
        await get_project(session, cu.id, body.project_id)
    conv = Conversation(user_id=cu.id, agent_id=body.agent_id, project_id=body.project_id, title=body.title or "Chat con NEXUS")
    session.add(conv)
    await session.commit()
    return conv


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_conversation(conversation_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> None:
    conv = await get_conversation(session, cu.id, conversation_id)
    await session.execute(AgentMessage.__table__.delete().where(AgentMessage.channel == "chat", AgentMessage.channel_id == conv.id))
    await session.delete(conv)
    await session.commit()


@router.get("/{conversation_id}/messages", response_model=list[MessageOut])
async def messages(conversation_id: uuid.UUID, before: datetime | None = None, limit: int = 60,
                   cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[AgentMessage]:
    conv = await get_conversation(session, cu.id, conversation_id)
    q = select(AgentMessage).where(AgentMessage.channel == "chat", AgentMessage.channel_id == conv.id)
    if before:
        q = q.where(AgentMessage.created_at < before)
    rows = list((await session.scalars(q.order_by(AgentMessage.created_at.desc()).limit(min(limit, 200)))).all())
    rows.reverse()
    return rows


@router.post("/{conversation_id}/messages", response_model=MessageOut, status_code=status.HTTP_202_ACCEPTED)
async def send(conversation_id: uuid.UUID, body: ChatMessageIn, cu: CurrentUser = Depends(current_user),
               session: AsyncSession = Depends(get_session)) -> AgentMessage:
    conv = await get_conversation(session, cu.id, conversation_id)
    attachments = []
    for fid in body.attachment_file_ids:
        pfile = await session.get(ProjectFile, fid)
        if pfile is None or pfile.user_id != cu.id:
            raise NotFound("Adjunto no encontrado")
        if conv.project_id is None:
            conv.project_id = pfile.project_id
        elif pfile.project_id != conv.project_id:
            raise NexusError("Los adjuntos deben pertenecer al proyecto de la conversación")
        attachments.append({"file_id": str(pfile.id), "path": pfile.path})
    msg = await post_user_message(session, conv, body.content, attachments)
    conv.updated_at = msg.created_at
    if conv.title in ("Chat con NEXUS", "Conversación"):
        conv.title = body.content[:60]
    await queue.commit(session)
    return msg
