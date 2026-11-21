from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import MeetingCreate, MeetingDetailOut, MeetingOut, MeetingParticipantOut, MessageOut, MissionOut
from app.auth.deps import CurrentUser, current_user
from app.core.db import get_session
from app.core.errors import Conflict
from app.jobs import queue
from app.meetings import service
from app.models import AgentMessage, Meeting
from app.missions.api import _mission_out
from app.missions.service import create_mission

router = APIRouter(prefix="/meetings", tags=["meetings"])


async def _out(session: AsyncSession, meeting: Meeting, cls=MeetingOut):
    roster = await service.participants_of(session, meeting.id)
    item = cls.model_validate(meeting) if cls is MeetingOut else None
    participants = [MeetingParticipantOut(agent_id=a.id, role=p.role, turns_taken=p.turns_taken, name=a.name, slug=a.slug) for p, a in roster]
    if item is not None:
        item.participants = participants
        return item
    return participants


@router.get("", response_model=list[MeetingOut])
async def list_meetings(status_filter: str | None = Query(default=None, alias="status"), limit: int = 50,
                        cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[MeetingOut]:
    q = select(Meeting).where(Meeting.user_id == cu.id).order_by(Meeting.created_at.desc()).limit(min(limit, 200))
    if status_filter:
        q = q.where(Meeting.status.in_(status_filter.split(",")))
    return [await _out(session, m) for m in (await session.scalars(q)).all()]


@router.post("", response_model=MeetingOut, status_code=status.HTTP_201_CREATED)
async def create(body: MeetingCreate, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> MeetingOut:
    meeting = await service.create_meeting(
        session, cu.id, topic=body.topic, objective=body.objective, meeting_type=body.meeting_type,
        participant_slugs=body.participants, max_rounds=body.max_rounds, max_duration_seconds=body.max_duration_seconds,
        budget_usd=body.budget_usd, project_id=body.project_id, mission_id=body.mission_id, context=body.context,
        expected_outcomes=body.expected_outcomes,
    )
    await queue.commit(session)
    return await _out(session, meeting)


@router.get("/{meeting_id}", response_model=MeetingDetailOut)
async def get(meeting_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> MeetingDetailOut:
    meeting = await service.get_meeting(session, cu.id, meeting_id)
    messages = (await session.scalars(
        select(AgentMessage).where(AgentMessage.channel == "meeting", AgentMessage.channel_id == meeting.id).order_by(AgentMessage.created_at)
    )).all()
    base = (await _out(session, meeting)).model_dump()
    return MeetingDetailOut(**base, context=meeting.context, expected_outcomes=meeting.expected_outcomes, outcome=meeting.outcome or {},
                            messages=[MessageOut.model_validate(m) for m in messages])


@router.post("/{meeting_id}/cancel", response_model=MeetingOut)
async def cancel(meeting_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> MeetingOut:
    meeting = await service.get_meeting(session, cu.id, meeting_id)
    await service.cancel_meeting(session, meeting)
    await queue.commit(session)
    return await _out(session, meeting)


class MissionFromMeeting(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    task_indexes: list[int] | None = None


@router.post("/{meeting_id}/mission", response_model=MissionOut, status_code=status.HTTP_201_CREATED)
async def mission_from_meeting(meeting_id: uuid.UUID, body: MissionFromMeeting, cu: CurrentUser = Depends(current_user),
                               session: AsyncSession = Depends(get_session)) -> MissionOut:
    """Convierte las tareas derivadas de una reunión en una misión real."""
    meeting = await service.get_meeting(session, cu.id, meeting_id)
    if meeting.status != "completed":
        raise Conflict("La reunión todavía no terminó")
    derived = (meeting.outcome or {}).get("derived_tasks") or []
    if body.task_indexes is not None:
        derived = [d for i, d in enumerate(derived) if i in set(body.task_indexes)]
    if not derived:
        raise Conflict("La reunión no tiene tareas derivadas seleccionadas")
    lines = [f"- {d.get('title')}: {d.get('description', '')} (sugerido: {d.get('agent', 'nexus')})" for d in derived if isinstance(d, dict)]
    decisions = "\n".join(f"- {d}" for d in (meeting.outcome or {}).get("decisions", []))
    mission = await create_mission(
        session, cu.id, title=body.title or f"Acciones de: {meeting.topic}"[:200],
        objective=f"Ejecutar las tareas acordadas en la reunión «{meeting.topic}».\n\nDecisiones:\n{decisions}\n\nTareas:\n" + "\n".join(lines),
        project_id=meeting.project_id, source_meeting_id=meeting.id,
    )
    await queue.commit(session)
    return (await _mission_out(session, [mission]))[0]
