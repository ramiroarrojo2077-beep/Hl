from __future__ import annotations

import uuid

from sqlalchemy import select

from app.core.db import session_factory
from app.models import Agent, ApprovalRequest, AuditLog, Plugin, PluginPermission, ToolExecution, User, UserSettings
from app.security.policy import class_rule
from app.tools.executor import ApprovalRequired, execute_tool_call
from app.tools.registry import ToolContext


def test_class_rules_matrix():
    assert class_rule("read", "manual", "auto").outcome == "allow"
    assert class_rule("creation", "manual", "auto").outcome == "allow"
    assert class_rule("modification", "manual", "auto").outcome == "approval"
    assert class_rule("modification", "supervised", "auto").outcome == "allow"
    assert class_rule("modification", "supervised", "approval").outcome == "approval"
    assert class_rule("external_communication", "supervised", "auto").outcome == "approval"
    assert class_rule("external_communication", "scheduled", "auto").outcome == "allow"
    assert class_rule("irreversible", "scheduled", "auto").outcome == "approval"
    assert class_rule("account_admin", "scheduled", "auto").outcome == "deny"


async def _ctx(s, slug: str, *, task_id=None, mode="supervised") -> ToolContext:
    user = await s.scalar(select(User))
    agent = await s.scalar(select(Agent).where(Agent.slug == slug))
    return ToolContext(session=s, user_id=user.id, agent=agent, autonomy_mode=mode, task_id=task_id)


async def test_agent_without_permission_is_blocked_and_audited(api):
    async with session_factory()() as s:
        ctx = await _ctx(s, "guardian")
        content, is_error = await execute_tool_call(ctx, "project.write_file", {"path": "a.txt", "content": "x"})
        await s.commit()
        assert is_error and "no tiene permiso" in content
        ex = await s.scalar(select(ToolExecution))
        assert ex.status == "blocked" and ex.decision == "deny"
        log = await s.scalar(select(AuditLog).where(AuditLog.action == "tool.blocked"))
        assert log.outcome == "blocked" and "GUARDIAN" in log.summary


async def test_plugin_must_be_enabled_and_granted(api):
    async with session_factory()() as s:
        ctx = await _ctx(s, "atlas")
        content, is_error = await execute_tool_call(ctx, "web.search", {"query": "x"})
        assert is_error and "plugin" in content
        plugin = await s.scalar(select(Plugin).where(Plugin.key == "web_search"))
        plugin.is_enabled = True
        await s.flush()
        content, is_error = await execute_tool_call(ctx, "web.search", {"query": "x"})
        assert is_error and "tool:web.search" in content
        perm = await s.scalar(select(PluginPermission).where(PluginPermission.plugin_id == plugin.id, PluginPermission.permission == "tool:web.search"))
        perm.granted = True
        await s.flush()
        content, is_error = await execute_tool_call(ctx, "web.search", {"query": "x"})
        assert is_error and "API key" in content  # pasó la política; falla por configuración real faltante


async def test_emergency_stop_denies_everything(api):
    async with session_factory()() as s:
        ctx = await _ctx(s, "nexus")
        settings = await s.get(UserSettings, ctx.user_id)
        settings.emergency_stop = True
        await s.flush()
        content, is_error = await execute_tool_call(ctx, "agents.list", {})
        assert is_error and "STOP ALL" in content


async def test_invalid_arguments_rejected(api):
    async with session_factory()() as s:
        ctx = await _ctx(s, "nexus")
        content, is_error = await execute_tool_call(ctx, "memory.search", {"query": 5})
        assert is_error and "debe ser string" in content
        content, is_error = await execute_tool_call(ctx, "memory.search", {"query": "x", "evil": True})
        assert is_error and "desconocido" in content


async def _real_task(s) -> uuid.UUID:
    from app.models import Mission, MissionTask

    user = await s.scalar(select(User))
    mission = Mission(user_id=user.id, title="m", objective="o", status="running")
    s.add(mission)
    await s.flush()
    task = MissionTask(mission_id=mission.id, user_id=user.id, key="t1", title="t", description="d")
    s.add(task)
    await s.flush()
    return task.id


async def test_approval_required_for_sensitive_tool(api):
    async with session_factory()() as s:
        ctx = await _ctx(s, "cipher", task_id=await _real_task(s))
        try:
            await execute_tool_call(ctx, "project.write_file", {"path": "a.txt", "content": "x"})
            raise AssertionError("debía requerir aprobación")
        except ApprovalRequired as pending:
            approval = await s.get(ApprovalRequest, pending.approval_id)
            assert approval.status == "pending" and approval.operation_class == "modification"
        # Repetir la misma llamada no duplica la solicitud (idempotencia).
        try:
            await execute_tool_call(ctx, "project.write_file", {"path": "a.txt", "content": "x"})
        except ApprovalRequired:
            pass
        assert len((await s.scalars(select(ApprovalRequest))).all()) == 1
