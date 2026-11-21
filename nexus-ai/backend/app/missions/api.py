from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import (
    ApprovalDecision,
    ApprovalOut,
    AttemptOut,
    MessageOut,
    MissionCreate,
    MissionDetailOut,
    MissionOut,
    MissionUpdate,
    TaskOut,
)
from app.auth.deps import CurrentUser, current_user
from app.core.db import get_session
from app.jobs import queue
from app.missions import service
from app.models import AgentMessage, ApprovalRequest, Mission, MissionTask, TaskAttempt, TaskDependency
from app.security.approvals import decide

router = APIRouter(tags=["missions"])


async def _task_out(session: AsyncSession, tasks: list[MissionTask]) -> list[TaskOut]:
    deps: dict[uuid.UUID, list[uuid.UUID]] = {}
    if tasks:
        for d in (await session.scalars(select(TaskDependency).where(TaskDependency.task_id.in_([t.id for t in tasks])))).all():
            deps.setdefault(d.task_id, []).append(d.depends_on_id)
    out = []
    for t in tasks:
        item = TaskOut.model_validate(t)
        item.depends_on = deps.get(t.id, [])
        item.citations = t.result_data.get("citations", []) or []
        item.drafts = t.result_data.get("drafts", []) or []
        out.append(item)
    return out


async def _mission_out(session: AsyncSession, missions: list[Mission]) -> list[MissionOut]:
    if not missions:
        return []
    rows = (await session.execute(
        select(MissionTask.mission_id, MissionTask.status, func.count()).where(MissionTask.mission_id.in_([m.id for m in missions]))
        .group_by(MissionTask.mission_id, MissionTask.status)
    )).all()
    agents = (await session.execute(
        select(MissionTask.mission_id, MissionTask.agent_id).where(MissionTask.mission_id.in_([m.id for m in missions])).distinct()
    )).all()
    counts: dict[uuid.UUID, dict[str, int]] = {}
    for mid, st, c in rows:
        counts.setdefault(mid, {})[st] = c
    agent_ids: dict[uuid.UUID, list[uuid.UUID]] = {}
    for mid, aid in agents:
        if aid:
            agent_ids.setdefault(mid, []).append(aid)
    out = []
    for m in missions:
        item = MissionOut.model_validate(m)
        c = counts.get(m.id, {})
        total = sum(c.values())
        done = c.get("completed", 0) + c.get("skipped", 0)
        # Progreso real: tareas terminadas sobre el total; las etapas finales suman el tramo restante.
        stage_bonus = {"reviewing": 0.9, "consolidating": 0.95, "completed": 1.0}.get(m.status)
        item.progress = stage_bonus if stage_bonus else (round(done / total * 0.85, 3) if total else 0.0)
        item.task_counts = c
        item.agent_ids = agent_ids.get(m.id, [])
        out.append(item)
    return out


@router.get("/missions", response_model=list[MissionOut])
async def list_missions(status_filter: str | None = Query(default=None, alias="status"), project_id: uuid.UUID | None = None, limit: int = 50,
                        cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> list[MissionOut]:
    q = select(Mission).where(Mission.user_id == cu.id).order_by(Mission.created_at.desc()).limit(min(limit, 200))
    if status_filter:
        q = q.where(Mission.status.in_(status_filter.split(",")))
    if project_id:
        q = q.where(Mission.project_id == project_id)
    return await _mission_out(session, list((await session.scalars(q)).all()))


@router.post("/missions", response_model=MissionOut, status_code=status.HTTP_201_CREATED)
async def create_mission(body: MissionCreate, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> MissionOut:
    mission = await service.create_mission(
        session, cu.id, title=body.title, objective=body.objective, description=body.description, project_id=body.project_id,
        priority=body.priority, budget_usd=body.budget_usd, autonomy_mode=body.autonomy_mode,
    )
    await queue.commit(session)
    return (await _mission_out(session, [mission]))[0]


@router.get("/missions/{mission_id}", response_model=MissionDetailOut)
async def get_mission(mission_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> MissionDetailOut:
    mission = await service.get_mission(session, cu.id, mission_id)
    tasks = list((await session.scalars(select(MissionTask).where(MissionTask.mission_id == mission.id).order_by(MissionTask.created_at, MissionTask.key))).all())
    base = (await _mission_out(session, [mission]))[0].model_dump()
    plan = {k: v for k, v in (mission.plan or {}).items() if not k.startswith("_")}
    return MissionDetailOut(**base, plan=plan, review=mission.review or {}, security_review=mission.security_review or {},
                            tasks=await _task_out(session, tasks))


@router.patch("/missions/{mission_id}", response_model=MissionOut)
async def update_mission(mission_id: uuid.UUID, body: MissionUpdate, cu: CurrentUser = Depends(current_user),
                         session: AsyncSession = Depends(get_session)) -> MissionOut:
    mission = await service.get_mission(session, cu.id, mission_id)
    if body.priority is not None:
        mission.priority = body.priority
        for t in (await session.scalars(select(MissionTask).where(MissionTask.mission_id == mission.id))).all():
            t.priority = min(t.priority, body.priority)
    if body.budget_usd is not None:
        mission.budget_usd = body.budget_usd
    if body.title:
        mission.title = body.title
    await session.commit()
    return (await _mission_out(session, [mission]))[0]


@router.post("/missions/{mission_id}/pause", response_model=MissionOut)
async def pause(mission_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> MissionOut:
    mission = await service.get_mission(session, cu.id, mission_id)
    await service.pause_mission(session, mission)
    await queue.commit(session)
    return (await _mission_out(session, [mission]))[0]


@router.post("/missions/{mission_id}/resume", response_model=MissionOut)
async def resume(mission_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> MissionOut:
    mission = await service.get_mission(session, cu.id, mission_id)
    await service.resume(session, mission)
    await queue.commit(session)
    return (await _mission_out(session, [mission]))[0]


@router.post("/missions/{mission_id}/cancel", response_model=MissionOut)
async def cancel(mission_id: uuid.UUID, cu: CurrentUser = Depends(current_user), session: AsyncSession = Depends(get_session)) -> MissionOut:
    mission = await service.get_mission(session, cu.id, mission_id)
    await service.cancel_mission(session, mission)
    await queue.commit(session)
    return (await _mission_out(session, [mission]))[0]


@router.post("/missions/{mission_id}/tasks/{task_id}/retry", response_model=TaskOut)
async def retry_task(mission_id: uuid.UUID, task_id: uuid.UUID, cu: CurrentUser = Depends(current_user),
                     session: AsyncSession = Depends(get_session)) -> TaskOut:
    mission = await service.get_mission(session, cu.id, mission_id)
    task = await service.retry_task(session, mission, task_id)
    await queue.commit(session)
    return (await _task_out(session, [task]))[0]


@router.post("/missions/{mission_id}/tasks/{task_id}/cancel", response_model=TaskOut)
async def cancel_task(mission_id: uuid.UUID, task_id: uuid.UUID, cu: CurrentUser = Depends(current_user),
                      session: AsyncSession = Depends(get_session)) -> TaskOut:
    mission = await service.get_mission(session, cu.id, mission_id)
    task = await service.cancel_task(session, mission, task_id)
    await queue.commit(session)
    return (await _task_out(session, [task]))[0]


@router.post("/missions/{mission_id}/tasks/{task_id}/skip", response_model=TaskOut)
async def skip_task(mission_id: uuid.UUID, task_id: uuid.UUID, cu: CurrentUser = Depends(current_user),
                    session: AsyncSession = Depends(get_session)) -> TaskOut:
    mission = await service.get_mission(session, cu.id, mission_id)
    task = await service.skip_task(session, mission, task_id)
    await queue.commit(session)
    return (await _task_out(session, [task]))[0]


@router.get("/missions/{mission_id}/tasks/{task_id}/attempts", response_model=list[AttemptOut])
async def task_attempts(mission_id: uuid.UUID, task_id: uuid.UUID, cu: CurrentUser = Depends(current_user),
                        session: AsyncSession = Depends(get_session)) -> list[TaskAttempt]:
    await service.get_mission(session, cu.id, mission_id)
    return list((await session.scalars(
        select(TaskAttempt).join(MissionTask, MissionTask.id == TaskAttempt.task_id)
        .where(TaskAttempt.task_id == task_id, MissionTask.mission_id == mission_id).order_by(TaskAttempt.attempt_number)
    )).all())


@router.get("/missions/{mission_id}/messages", response_model=list[MessageOut])
async def mission_messages(mission_id: uuid.UUID, cu: CurrentUser = Depends(current_user),
                           session: AsyncSession = Depends(get_session)) -> list[AgentMessage]:
    await service.get_mission(session, cu.id, mission_id)
    return list((await session.scalars(
        select(AgentMessage).where(AgentMessage.channel == "mission", AgentMessage.channel_id == mission_id).order_by(AgentMessage.created_at)
    )).all())


@router.get("/approvals", response_model=list[ApprovalOut])
async def list_approvals(status_filter: str = Query(default="pending", alias="status"), cu: CurrentUser = Depends(current_user),
                         session: AsyncSession = Depends(get_session)) -> list[ApprovalRequest]:
    q = select(ApprovalRequest).where(ApprovalRequest.user_id == cu.id).order_by(ApprovalRequest.created_at.desc()).limit(100)
    if status_filter != "all":
        q = q.where(ApprovalRequest.status == status_filter)
    return list((await session.scalars(q)).all())


@router.post("/approvals/{approval_id}/decision", response_model=ApprovalOut)
async def decide_approval(approval_id: uuid.UUID, body: ApprovalDecision, cu: CurrentUser = Depends(current_user),
                          session: AsyncSession = Depends(get_session)) -> ApprovalRequest:
    approval = await decide(session, cu.id, approval_id, body.approve, body.note)
    await queue.commit(session)
    return approval
