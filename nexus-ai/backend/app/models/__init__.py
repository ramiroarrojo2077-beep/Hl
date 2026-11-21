"""Importa todos los modelos para que Alembic y SQLAlchemy conozcan el esquema completo."""

from app.models.agents import Agent, AgentInstruction, AgentModel, AgentPermission, AgentProfile
from app.models.base import Base
from app.models.collab import AgentMessage, Conversation, Meeting, MeetingParticipant
from app.models.memory import MemoryEmbedding, MemoryItem
from app.models.missions import ApprovalRequest, Mission, MissionTask, TaskAttempt, TaskDependency
from app.models.ops import (
    AuditLog,
    Job,
    ModelEvalResult,
    ModelEvalRun,
    Notification,
    Plugin,
    PluginPermission,
    ScheduledJob,
    ToolDefinition,
    ToolExecution,
    UsageRecord,
)
from app.models.projects import Project, ProjectAgent, ProjectFile
from app.models.providers import AIModel, AIProvider
from app.models.users import DeviceToken, RefreshToken, User, UserSettings

__all__ = [
    "AIModel",
    "AIProvider",
    "Agent",
    "AgentInstruction",
    "AgentMessage",
    "AgentModel",
    "AgentPermission",
    "AgentProfile",
    "ApprovalRequest",
    "AuditLog",
    "Base",
    "Conversation",
    "DeviceToken",
    "Job",
    "Meeting",
    "MeetingParticipant",
    "MemoryEmbedding",
    "MemoryItem",
    "Mission",
    "MissionTask",
    "ModelEvalResult",
    "ModelEvalRun",
    "Notification",
    "Plugin",
    "PluginPermission",
    "Project",
    "ProjectAgent",
    "ProjectFile",
    "RefreshToken",
    "ScheduledJob",
    "TaskAttempt",
    "TaskDependency",
    "ToolDefinition",
    "ToolExecution",
    "UsageRecord",
    "User",
    "UserSettings",
]
