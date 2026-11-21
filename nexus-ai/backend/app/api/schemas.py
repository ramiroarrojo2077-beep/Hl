"""Esquemas de entrada/salida de la API v1."""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel):
    items: list[Any]
    next_cursor: str | None = None


# ------------------------------------------------------------ agentes

class AgentProfileOut(ORM):
    avatar: str
    color: str
    description: str
    personality: str
    specialties: list[str]
    communication_style: str
    work_criteria: str
    temperature: float | None
    reasoning_level: str
    traits: dict[str, Any]
    appearance: dict[str, Any]
    voice: dict[str, Any]


class AgentOut(ORM):
    id: uuid.UUID
    slug: str
    name: str
    role: str
    is_system: bool
    is_enabled: bool
    status: str
    status_detail: str | None
    current_task_id: uuid.UUID | None
    last_activity_at: datetime | None
    autonomy_level: str
    memory_enabled: bool
    participates_in_meetings: bool
    daily_budget_usd: Decimal | None
    profile: AgentProfileOut
    created_at: datetime
    primary_model: str | None = None


class AgentModelRef(BaseModel):
    model_id: uuid.UUID
    priority: int
    model_name: str
    provider_kind: str


class AgentPermissionOut(ORM):
    tool_key: str
    allowed: bool
    mode: str
    expires_at: datetime | None


class AgentDetailOut(AgentOut):
    instructions: str
    instructions_version: int
    models: list[AgentModelRef]
    permissions: list[AgentPermissionOut]
    stats: dict[str, Any]


class AgentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    slug: str | None = Field(default=None, pattern=r"^[a-z0-9_\-]{2,40}$")
    role: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    personality: str = Field(default="", max_length=2000)
    specialties: list[str] = Field(default_factory=list, max_length=20)
    communication_style: str = Field(default="", max_length=1000)
    work_criteria: str = Field(default="", max_length=1000)
    instructions: str = Field(min_length=1, max_length=20000)
    avatar: str = Field(default="orb", max_length=60)
    color: str = Field(default="#8A5CFF", pattern=r"^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$")
    temperature: float | None = Field(default=None, ge=0, le=2)
    reasoning_level: str = Field(default="medium", pattern=r"^(low|medium|high)$")
    tools: list[str] = Field(default_factory=lambda: ["memory.search", "memory.propose", "drafts.create"])
    memory_enabled: bool = True
    participates_in_meetings: bool = True
    autonomy_level: str = Field(default="supervised", pattern=r"^(manual|supervised|scheduled)$")
    daily_budget_usd: Decimal | None = Field(default=None, ge=0)
    model_ids: list[uuid.UUID] = Field(default_factory=list)
    traits: dict[str, Any] | None = None
    appearance: dict[str, Any] | None = None
    voice: dict[str, Any] | None = None


class AgentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    role: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    personality: str | None = Field(default=None, max_length=2000)
    specialties: list[str] | None = None
    communication_style: str | None = Field(default=None, max_length=1000)
    work_criteria: str | None = Field(default=None, max_length=1000)
    instructions: str | None = Field(default=None, max_length=20000)
    avatar: str | None = Field(default=None, max_length=60)
    color: str | None = Field(default=None, pattern=r"^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$")
    temperature: float | None = Field(default=None, ge=0, le=2)
    reasoning_level: str | None = Field(default=None, pattern=r"^(low|medium|high)$")
    memory_enabled: bool | None = None
    participates_in_meetings: bool | None = None
    is_enabled: bool | None = None
    autonomy_level: str | None = Field(default=None, pattern=r"^(manual|supervised|scheduled)$")
    daily_budget_usd: Decimal | None = Field(default=None, ge=0)
    clear_temperature: bool = False
    clear_daily_budget: bool = False
    traits: dict[str, Any] | None = None
    appearance: dict[str, Any] | None = None
    voice: dict[str, Any] | None = None


class PermissionIn(BaseModel):
    tool_key: str
    allowed: bool = True
    mode: str = Field(default="auto", pattern=r"^(auto|approval)$")
    expires_at: datetime | None = None


class AgentModelsIn(BaseModel):
    model_ids: list[uuid.UUID] = Field(max_length=6)


# ------------------------------------------------------------ misiones

class TaskOut(ORM):
    id: uuid.UUID
    mission_id: uuid.UUID
    key: str
    title: str
    description: str
    task_type: str
    agent_id: uuid.UUID | None
    status: str
    priority: int
    requires_approval: bool
    approved_at: datetime | None
    revision_of_id: uuid.UUID | None
    result: str | None
    error: str | None
    attempts: int
    max_attempts: int
    model_used: str | None
    actual_cost_usd: Decimal
    tokens_used: int
    started_at: datetime | None
    completed_at: datetime | None
    duration_ms: int | None
    created_at: datetime
    depends_on: list[uuid.UUID] = []
    citations: list[dict[str, Any]] = []
    drafts: list[dict[str, Any]] = []


class MissionOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID | None
    title: str
    objective: str
    description: str | None
    status: str
    status_reason: str | None
    priority: int
    autonomy_mode: str
    budget_usd: Decimal | None
    spent_usd: Decimal
    tokens_used: int
    result: str | None
    error: str | None
    started_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    progress: float = 0.0
    task_counts: dict[str, int] = {}
    agent_ids: list[uuid.UUID] = []


class MissionDetailOut(MissionOut):
    plan: dict[str, Any]
    review: dict[str, Any]
    security_review: dict[str, Any]
    tasks: list[TaskOut]


class MissionCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    objective: str = Field(min_length=3, max_length=20000)
    description: str | None = Field(default=None, max_length=20000)
    project_id: uuid.UUID | None = None
    priority: int = Field(default=3, ge=1, le=5)
    budget_usd: Decimal | None = Field(default=None, ge=0)
    autonomy_mode: str | None = Field(default=None, pattern=r"^(manual|supervised|scheduled)$")


class MissionUpdate(BaseModel):
    priority: int | None = Field(default=None, ge=1, le=5)
    budget_usd: Decimal | None = Field(default=None, ge=0)
    title: str | None = Field(default=None, max_length=200)


class AttemptOut(ORM):
    id: uuid.UUID
    attempt_number: int
    worker_id: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    error: str | None
    model_used: str | None
    cost_usd: Decimal
    steps: list[Any]


class MessageOut(ORM):
    id: uuid.UUID
    channel: str
    channel_id: uuid.UUID
    sender_type: str
    sender_agent_id: uuid.UUID | None
    recipient_agent_id: uuid.UUID | None
    message_type: str
    content: str
    meta: dict[str, Any]
    model_used: str | None
    turn: int | None
    created_at: datetime


class ApprovalOut(ORM):
    id: uuid.UUID
    kind: str
    mission_id: uuid.UUID | None
    task_id: uuid.UUID | None
    tool_execution_id: uuid.UUID | None
    agent_id: uuid.UUID | None
    operation_class: str | None
    title: str
    details: dict[str, Any]
    status: str
    decided_at: datetime | None
    decision_note: str | None
    expires_at: datetime | None
    created_at: datetime


class ApprovalDecision(BaseModel):
    approve: bool
    note: str | None = Field(default=None, max_length=1000)


# ------------------------------------------------------------ reuniones

class MeetingParticipantOut(BaseModel):
    agent_id: uuid.UUID
    role: str
    turns_taken: int
    name: str
    slug: str


class MeetingOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID | None
    mission_id: uuid.UUID | None
    meeting_type: str
    topic: str
    objective: str
    status: str
    max_rounds: int
    max_duration_seconds: int
    budget_usd: Decimal | None
    spent_usd: Decimal
    tokens_used: int
    current_round: int
    stop_reason: str | None
    summary: str | None
    started_at: datetime | None
    ended_at: datetime | None
    created_at: datetime
    participants: list[MeetingParticipantOut] = []


class MeetingDetailOut(MeetingOut):
    context: str | None
    expected_outcomes: str | None
    outcome: dict[str, Any]
    messages: list[MessageOut]


class MeetingCreate(BaseModel):
    topic: str = Field(min_length=1, max_length=300)
    objective: str = Field(min_length=3, max_length=8000)
    meeting_type: str = Field(default="planning", pattern=r"^(planning|research|technical|review|problem_solving|evaluation)$")
    participants: list[str] = Field(default_factory=list, max_length=10)
    max_rounds: int = Field(default=3, ge=1, le=6)
    max_duration_seconds: int = Field(default=900, ge=60, le=7200)
    budget_usd: Decimal | None = Field(default=None, ge=0)
    project_id: uuid.UUID | None = None
    mission_id: uuid.UUID | None = None
    context: str | None = Field(default=None, max_length=20000)
    expected_outcomes: str | None = Field(default=None, max_length=4000)


# ------------------------------------------------------------ memoria

class MemoryOut(ORM):
    id: uuid.UUID
    scope: str
    kind: str
    agent_id: uuid.UUID | None
    project_id: uuid.UUID | None
    mission_id: uuid.UUID | None
    created_by_agent_id: uuid.UUID | None
    title: str | None
    content: str
    source: str
    source_ref: str | None
    source_date: datetime | None
    confidence: float
    verification_status: str
    expires_at: datetime | None
    created_at: datetime
    updated_at: datetime


class MemoryHitOut(BaseModel):
    item: MemoryOut
    score: float
    matched_by: list[str]


class MemoryCreate(BaseModel):
    scope: str = Field(pattern=r"^(agent|shared|user|project)$")
    content: str = Field(min_length=3, max_length=20000)
    title: str | None = Field(default=None, max_length=300)
    kind: str = "fact"
    agent_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    source_ref: str | None = Field(default=None, max_length=1000)
    confidence: float = Field(default=0.9, ge=0, le=1)
    expires_at: datetime | None = None


class MemoryUpdate(BaseModel):
    content: str | None = Field(default=None, min_length=3, max_length=20000)
    title: str | None = Field(default=None, max_length=300)
    verification_status: str | None = Field(default=None, pattern=r"^(unverified|verified|rejected)$")
    confidence: float | None = Field(default=None, ge=0, le=1)
    expires_at: datetime | None = None
    clear_expiry: bool = False


class MemorySearch(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    scopes: list[str] | None = None
    kinds: list[str] | None = None
    agent_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None
    limit: int = Field(default=10, ge=1, le=50)


# ------------------------------------------------------------ proveedores y modelos

class ProviderOut(ORM):
    id: uuid.UUID
    kind: str
    name: str
    base_url: str | None
    api_key_hint: str | None
    is_enabled: bool
    status: str
    last_checked_at: datetime | None
    last_error: str | None
    known_limits: dict[str, Any]
    max_concurrency: int
    created_at: datetime


class ProviderCreate(BaseModel):
    kind: str = Field(pattern=r"^(anthropic|openai|openai_compatible|gemini|ollama)$")
    name: str = Field(min_length=1, max_length=80)
    base_url: str | None = Field(default=None, max_length=500)
    api_key: str | None = Field(default=None, max_length=500)
    known_limits: dict[str, Any] = Field(default_factory=dict)
    max_concurrency: int = Field(default=4, ge=1, le=64)


class ProviderUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=80)
    base_url: str | None = Field(default=None, max_length=500)
    api_key: str | None = Field(default=None, max_length=500)
    is_enabled: bool | None = None
    known_limits: dict[str, Any] | None = None
    max_concurrency: int | None = Field(default=None, ge=1, le=64)


class ModelOut(ORM):
    id: uuid.UUID
    provider_id: uuid.UUID
    model_name: str
    display_name: str
    capabilities: list[str]
    context_window: int
    max_output_tokens: int
    input_price_per_mtok: Decimal | None
    output_price_per_mtok: Decimal | None
    quality_tier: int
    is_default: bool
    is_enabled: bool
    is_embedding_default: bool
    provider_kind: str | None = None


class ModelCreate(BaseModel):
    provider_id: uuid.UUID
    model_name: str = Field(min_length=1, max_length=160)
    display_name: str | None = Field(default=None, max_length=160)
    capabilities: list[str] | None = None
    context_window: int = Field(default=128_000, ge=1000)
    max_output_tokens: int = Field(default=8192, ge=256)
    input_price_per_mtok: Decimal | None = Field(default=None, ge=0)
    output_price_per_mtok: Decimal | None = Field(default=None, ge=0)
    quality_tier: int | None = Field(default=None, ge=1, le=5)
    is_default: bool = False
    is_embedding_default: bool = False


class ModelUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=160)
    capabilities: list[str] | None = None
    context_window: int | None = Field(default=None, ge=1000)
    max_output_tokens: int | None = Field(default=None, ge=256)
    input_price_per_mtok: Decimal | None = Field(default=None, ge=0)
    output_price_per_mtok: Decimal | None = Field(default=None, ge=0)
    quality_tier: int | None = Field(default=None, ge=1, le=5)
    is_default: bool | None = None
    is_enabled: bool | None = None
    is_embedding_default: bool | None = None


class EvalCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    model_ids: list[uuid.UUID] = Field(min_length=1, max_length=6)
    judge_model_id: uuid.UUID | None = None
    cases: list[dict[str, Any]] = Field(min_length=1, max_length=30)


# ------------------------------------------------------------ actividad, notificaciones, ajustes

class ActivityOut(ORM):
    id: uuid.UUID
    actor_type: str
    agent_id: uuid.UUID | None
    action: str
    target_type: str | None
    target_id: uuid.UUID | None
    mission_id: uuid.UUID | None
    project_id: uuid.UUID | None
    outcome: str
    summary: str
    details: dict[str, Any]
    model_used: str | None
    tokens: int | None
    cost_usd: Decimal | None
    created_at: datetime


class NotificationOut(ORM):
    id: uuid.UUID
    event_type: str
    title: str
    body: str
    data: dict[str, Any]
    read_at: datetime | None
    push_status: str
    created_at: datetime


class DeviceIn(BaseModel):
    token: str = Field(min_length=10, max_length=512)
    platform: str = Field(default="android", pattern=r"^(android|ios|web|desktop)$")


class SettingsOut(ORM):
    autonomy_mode: str
    emergency_stop: bool
    emergency_stop_at: datetime | None
    emergency_stop_reason: str | None
    daily_budget_usd: Decimal | None
    monthly_budget_usd: Decimal | None
    default_mission_budget_usd: Decimal | None
    max_tokens_per_mission: int
    max_concurrent_tasks: int
    language: str
    notification_prefs: dict[str, Any]
    appearance: dict[str, Any]
    memory_settings: dict[str, Any]


class SettingsUpdate(BaseModel):
    autonomy_mode: str | None = Field(default=None, pattern=r"^(manual|supervised|scheduled)$")
    daily_budget_usd: Decimal | None = Field(default=None, ge=0)
    monthly_budget_usd: Decimal | None = Field(default=None, ge=0)
    default_mission_budget_usd: Decimal | None = Field(default=None, ge=0)
    clear_daily_budget: bool = False
    clear_monthly_budget: bool = False
    clear_default_mission_budget: bool = False
    max_tokens_per_mission: int | None = Field(default=None, ge=1000, le=50_000_000)
    max_concurrent_tasks: int | None = Field(default=None, ge=1, le=32)
    language: str | None = Field(default=None, max_length=10)
    notification_prefs: dict[str, bool] | None = None
    appearance: dict[str, Any] | None = None
    memory_settings: dict[str, Any] | None = None
    display_name: str | None = Field(default=None, min_length=1, max_length=120)


class EmergencyStopIn(BaseModel):
    reason: str | None = Field(default=None, max_length=500)


# ------------------------------------------------------------ proyectos

class ProjectAgentOut(BaseModel):
    agent_id: uuid.UUID
    responsibility: str


class ProjectOut(ORM):
    id: uuid.UUID
    name: str
    description: str
    objective: str
    status: str
    documentation: str
    created_at: datetime
    updated_at: datetime
    agents: list[ProjectAgentOut] = []
    counts: dict[str, int] = {}


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=8000)
    objective: str = Field(default="", max_length=8000)
    agents: list[ProjectAgentOut] = Field(default_factory=list)


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=160)
    description: str | None = Field(default=None, max_length=8000)
    objective: str | None = Field(default=None, max_length=8000)
    status: str | None = Field(default=None, pattern=r"^(active|paused|archived)$")
    documentation: str | None = Field(default=None, max_length=200_000)
    agents: list[ProjectAgentOut] | None = None


class ProjectFileOut(ORM):
    id: uuid.UUID
    project_id: uuid.UUID
    path: str
    version: int
    is_latest: bool
    content_type: str
    size_bytes: int
    sha256: str
    created_by_agent_id: uuid.UUID | None
    mission_id: uuid.UUID | None
    change_note: str | None
    indexed: bool
    index_error: str | None
    created_at: datetime


# ------------------------------------------------------------ chat

class ConversationOut(ORM):
    id: uuid.UUID
    agent_id: uuid.UUID | None
    project_id: uuid.UUID | None
    title: str
    created_at: datetime
    updated_at: datetime


class ConversationCreate(BaseModel):
    title: str | None = Field(default=None, max_length=200)
    agent_id: uuid.UUID | None = None
    project_id: uuid.UUID | None = None


class ChatMessageIn(BaseModel):
    content: str = Field(min_length=1, max_length=20000)
    attachment_file_ids: list[uuid.UUID] = Field(default_factory=list, max_length=10)


# ------------------------------------------------------------ herramientas, plugins, programación

class ToolOut(ORM):
    key: str
    name: str
    description: str
    category: str
    operation_class: str
    parameters_schema: dict[str, Any]
    requires_plugin: str | None
    is_enabled: bool


class PluginOut(BaseModel):
    key: str
    name: str
    description: str
    is_enabled: bool
    config_public: dict[str, Any]
    has_secret: bool
    permissions: list[dict[str, Any]]
    config_fields: dict[str, Any]
    last_used_at: datetime | None


class PluginUpdate(BaseModel):
    is_enabled: bool | None = None
    config: dict[str, Any] | None = None


class PluginPermissionIn(BaseModel):
    permission: str
    granted: bool


class ScheduleOut(ORM):
    id: uuid.UUID
    kind: str
    name: str
    cron: str | None
    run_once_at: datetime | None
    timezone: str
    payload: dict[str, Any]
    is_enabled: bool
    next_run_at: datetime | None
    last_run_at: datetime | None
    last_status: str | None
    run_count: int
    created_at: datetime


class ScheduleCreate(BaseModel):
    kind: str = Field(pattern=r"^(mission|meeting|reminder)$")
    name: str = Field(min_length=1, max_length=200)
    cron: str | None = Field(default=None, max_length=120)
    run_once_at: datetime | None = None
    timezone: str = Field(default="UTC", max_length=60)
    payload: dict[str, Any]
    is_enabled: bool = True


class ScheduleUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    cron: str | None = Field(default=None, max_length=120)
    timezone: str | None = Field(default=None, max_length=60)
    payload: dict[str, Any] | None = None
    is_enabled: bool | None = None
