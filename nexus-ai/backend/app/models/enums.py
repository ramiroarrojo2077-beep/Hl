"""Valores permitidos de los campos de estado. Se guardan como texto para que las
migraciones sean simples; la validación ocurre en la capa de aplicación."""

from __future__ import annotations

from enum import StrEnum


class AutonomyMode(StrEnum):
    MANUAL = "manual"
    SUPERVISED = "supervised"
    SCHEDULED = "scheduled"


class AgentStatus(StrEnum):
    IDLE = "idle"
    THINKING = "thinking"
    WORKING = "working"
    COLLABORATING = "collaborating"
    COMPLETED = "completed"
    ERROR = "error"
    PAUSED = "paused"


class OperationClass(StrEnum):
    READ = "read"
    ANALYSIS = "analysis"
    CREATION = "creation"
    MODIFICATION = "modification"
    EXTERNAL_COMMUNICATION = "external_communication"
    IRREVERSIBLE = "irreversible"
    ACCOUNT_ADMIN = "account_admin"


class MissionStatus(StrEnum):
    PLANNING = "planning"
    AWAITING_APPROVAL = "awaiting_approval"
    RUNNING = "running"
    PAUSED = "paused"
    REVIEWING = "reviewing"
    CONSOLIDATING = "consolidating"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    BLOCKED = "blocked"


ACTIVE_MISSION_STATUSES = {
    MissionStatus.PLANNING,
    MissionStatus.RUNNING,
    MissionStatus.REVIEWING,
    MissionStatus.CONSOLIDATING,
}
TERMINAL_MISSION_STATUSES = {MissionStatus.COMPLETED, MissionStatus.FAILED, MissionStatus.CANCELLED}


class TaskStatus(StrEnum):
    PENDING = "pending"  # esperando dependencias
    READY = "ready"  # encolada
    RUNNING = "running"
    AWAITING_APPROVAL = "awaiting_approval"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    SKIPPED = "skipped"


TERMINAL_TASK_STATUSES = {TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED, TaskStatus.SKIPPED}


class TaskType(StrEnum):
    RESEARCH = "research"
    CODE = "code"
    DESIGN = "design"
    WRITING = "writing"
    ANALYSIS = "analysis"
    SECURITY = "security"
    GENERAL = "general"
    REVISION = "revision"


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    CANCELLED = "cancelled"


class MeetingStatus(StrEnum):
    SCHEDULED = "scheduled"
    RUNNING = "running"
    SUMMARIZING = "summarizing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class MeetingType(StrEnum):
    PLANNING = "planning"
    RESEARCH = "research"
    TECHNICAL = "technical"
    REVIEW = "review"
    PROBLEM_SOLVING = "problem_solving"
    EVALUATION = "evaluation"


class MemoryScope(StrEnum):
    AGENT = "agent"
    SHARED = "shared"
    USER = "user"
    PROJECT = "project"


class MemoryKind(StrEnum):
    FACT = "fact"
    DECISION = "decision"
    EXPERIENCE = "experience"
    ERROR = "error"
    PREFERENCE = "preference"
    RESULT = "result"
    DOCUMENT = "document"
    LEARNING = "learning"


class VerificationStatus(StrEnum):
    UNVERIFIED = "unverified"
    VERIFIED = "verified"
    REJECTED = "rejected"


class ApprovalStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    EXPIRED = "expired"


class ToolExecutionStatus(StrEnum):
    PENDING_APPROVAL = "pending_approval"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    BLOCKED = "blocked"
    REJECTED = "rejected"


class ProviderKind(StrEnum):
    ANTHROPIC = "anthropic"
    OPENAI = "openai"
    OPENAI_COMPATIBLE = "openai_compatible"
    GEMINI = "gemini"
    OLLAMA = "ollama"


class Capability(StrEnum):
    CHAT = "chat"
    TOOLS = "tools"
    REASONING = "reasoning"
    CODE = "code"
    VISION = "vision"
    LONG_CONTEXT = "long_context"
    EMBEDDING = "embedding"
    WEB_SEARCH = "web_search"
