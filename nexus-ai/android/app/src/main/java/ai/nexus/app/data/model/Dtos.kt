package ai.nexus.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

// Contrato con la API v1 del backend. Los decimales llegan como texto para no perder precisión.

@Serializable data class TokenPair(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("access_expires_at") val accessExpiresAt: String,
    @SerialName("refresh_expires_at") val refreshExpiresAt: String,
)

@Serializable data class UserDto(val id: String, val email: String, @SerialName("display_name") val displayName: String)
@Serializable data class AuthResponse(val user: UserDto, val tokens: TokenPair)
@Serializable data class LoginRequest(val email: String, val password: String)
@Serializable data class RegisterRequest(val email: String, val password: String, @SerialName("display_name") val displayName: String)
@Serializable data class RefreshRequest(@SerialName("refresh_token") val refreshToken: String)
@Serializable data class SessionDto(
    @SerialName("family_id") val familyId: String, @SerialName("created_at") val createdAt: String,
    @SerialName("expires_at") val expiresAt: String, @SerialName("user_agent") val userAgent: String? = null,
    val ip: String? = null, val current: Boolean = false,
)

// ------------------------------------------------------------ agentes y personajes

@Serializable data class Traits(
    val personality: Map<String, Int> = emptyMap(),
    val emotions: Map<String, Int> = emptyMap(),
)

@Serializable data class Appearance(
    val body: String = "a",
    val hair: String = "short",
    @SerialName("hair_color") val hairColor: String = "#4A4F5C",
    val eyes: String = "#00D9FF",
    val skin: String = "#E0B899",
    val outfit: String = "suit",
    @SerialName("outfit_color") val outfitColor: String = "#1A2433",
    val accent: String = "#00D9FF",
    val accessory: String = "none",
)

@Serializable data class VoiceSettings(
    val pitch: Double = 1.0,
    val rate: Double = 1.0,
    val locale: String = "es-AR",
    val tone: String = "neutral",
    val enabled: Boolean = true,
)

@Serializable data class AgentProfileDto(
    val avatar: String = "orb",
    val color: String = "#00D9FF",
    val description: String = "",
    val personality: String = "",
    val specialties: List<String> = emptyList(),
    @SerialName("communication_style") val communicationStyle: String = "",
    @SerialName("work_criteria") val workCriteria: String = "",
    val temperature: Double? = null,
    @SerialName("reasoning_level") val reasoningLevel: String = "medium",
    val traits: Traits = Traits(),
    val appearance: Appearance = Appearance(),
    val voice: VoiceSettings = VoiceSettings(),
)

@Serializable data class AgentDto(
    val id: String,
    val slug: String,
    val name: String,
    val role: String,
    @SerialName("is_system") val isSystem: Boolean = false,
    @SerialName("is_enabled") val isEnabled: Boolean = true,
    val status: String = "idle",
    @SerialName("status_detail") val statusDetail: String? = null,
    @SerialName("current_task_id") val currentTaskId: String? = null,
    @SerialName("last_activity_at") val lastActivityAt: String? = null,
    @SerialName("autonomy_level") val autonomyLevel: String = "supervised",
    @SerialName("memory_enabled") val memoryEnabled: Boolean = true,
    @SerialName("participates_in_meetings") val participatesInMeetings: Boolean = true,
    @SerialName("daily_budget_usd") val dailyBudgetUsd: String? = null,
    val profile: AgentProfileDto = AgentProfileDto(),
    @SerialName("primary_model") val primaryModel: String? = null,
)

@Serializable data class AgentModelRef(
    @SerialName("model_id") val modelId: String, val priority: Int,
    @SerialName("model_name") val modelName: String, @SerialName("provider_kind") val providerKind: String,
)

@Serializable data class PermissionDto(
    @SerialName("tool_key") val toolKey: String, val allowed: Boolean = true, val mode: String = "auto",
    @SerialName("expires_at") val expiresAt: String? = null,
)

@Serializable data class AgentDetailDto(
    val id: String,
    val slug: String,
    val name: String,
    val role: String,
    @SerialName("is_system") val isSystem: Boolean = false,
    @SerialName("is_enabled") val isEnabled: Boolean = true,
    val status: String = "idle",
    @SerialName("status_detail") val statusDetail: String? = null,
    @SerialName("last_activity_at") val lastActivityAt: String? = null,
    @SerialName("autonomy_level") val autonomyLevel: String = "supervised",
    @SerialName("memory_enabled") val memoryEnabled: Boolean = true,
    @SerialName("participates_in_meetings") val participatesInMeetings: Boolean = true,
    @SerialName("daily_budget_usd") val dailyBudgetUsd: String? = null,
    val profile: AgentProfileDto = AgentProfileDto(),
    val instructions: String = "",
    @SerialName("instructions_version") val instructionsVersion: Int = 0,
    val models: List<AgentModelRef> = emptyList(),
    val permissions: List<PermissionDto> = emptyList(),
    val stats: JsonObject = JsonObject(emptyMap()),
)

@Serializable data class PersonaAxis(val key: String, val left: String, val right: String)
@Serializable data class PersonaTrait(val key: String, val label: String)
@Serializable data class PersonaCatalog(
    @SerialName("personality_axes") val personalityAxes: List<PersonaAxis> = emptyList(),
    @SerialName("emotional_traits") val emotionalTraits: List<PersonaTrait> = emptyList(),
    @SerialName("appearance_options") val appearanceOptions: Map<String, List<String>> = emptyMap(),
    @SerialName("voice_tones") val voiceTones: List<String> = emptyList(),
    val presets: Map<String, Appearance> = emptyMap(),
)

@Serializable data class AgentUpsert(
    val name: String? = null,
    val role: String? = null,
    val description: String? = null,
    val personality: String? = null,
    val specialties: List<String>? = null,
    @SerialName("communication_style") val communicationStyle: String? = null,
    @SerialName("work_criteria") val workCriteria: String? = null,
    val instructions: String? = null,
    val color: String? = null,
    val temperature: Double? = null,
    @SerialName("reasoning_level") val reasoningLevel: String? = null,
    val tools: List<String>? = null,
    @SerialName("memory_enabled") val memoryEnabled: Boolean? = null,
    @SerialName("participates_in_meetings") val participatesInMeetings: Boolean? = null,
    @SerialName("is_enabled") val isEnabled: Boolean? = null,
    @SerialName("autonomy_level") val autonomyLevel: String? = null,
    @SerialName("daily_budget_usd") val dailyBudgetUsd: String? = null,
    @SerialName("clear_daily_budget") val clearDailyBudget: Boolean? = null,
    @SerialName("model_ids") val modelIds: List<String>? = null,
    val traits: Traits? = null,
    val appearance: Appearance? = null,
    val voice: VoiceSettings? = null,
)

@Serializable data class ModelIdsBody(@SerialName("model_ids") val modelIds: List<String>)
@Serializable data class InstructionVersion(val version: Int, val content: String, @SerialName("is_active") val isActive: Boolean, @SerialName("created_at") val createdAt: String)

// ------------------------------------------------------------ misiones

@Serializable data class MissionDto(
    val id: String,
    @SerialName("project_id") val projectId: String? = null,
    val title: String,
    val objective: String,
    val description: String? = null,
    val status: String,
    @SerialName("status_reason") val statusReason: String? = null,
    val priority: Int = 3,
    @SerialName("autonomy_mode") val autonomyMode: String = "supervised",
    @SerialName("budget_usd") val budgetUsd: String? = null,
    @SerialName("spent_usd") val spentUsd: String = "0",
    @SerialName("tokens_used") val tokensUsed: Int = 0,
    val result: String? = null,
    val error: String? = null,
    @SerialName("started_at") val startedAt: String? = null,
    @SerialName("completed_at") val completedAt: String? = null,
    @SerialName("created_at") val createdAt: String,
    @SerialName("updated_at") val updatedAt: String,
    val progress: Double = 0.0,
    @SerialName("task_counts") val taskCounts: Map<String, Int> = emptyMap(),
    @SerialName("agent_ids") val agentIds: List<String> = emptyList(),
)

@Serializable data class TaskDto(
    val id: String,
    @SerialName("mission_id") val missionId: String,
    val key: String,
    val title: String,
    val description: String,
    @SerialName("task_type") val taskType: String,
    @SerialName("agent_id") val agentId: String? = null,
    val status: String,
    val priority: Int = 3,
    @SerialName("requires_approval") val requiresApproval: Boolean = false,
    @SerialName("revision_of_id") val revisionOfId: String? = null,
    val result: String? = null,
    val error: String? = null,
    val attempts: Int = 0,
    @SerialName("max_attempts") val maxAttempts: Int = 3,
    @SerialName("model_used") val modelUsed: String? = null,
    @SerialName("actual_cost_usd") val actualCostUsd: String = "0",
    @SerialName("tokens_used") val tokensUsed: Int = 0,
    @SerialName("started_at") val startedAt: String? = null,
    @SerialName("completed_at") val completedAt: String? = null,
    @SerialName("duration_ms") val durationMs: Int? = null,
    @SerialName("created_at") val createdAt: String,
    @SerialName("depends_on") val dependsOn: List<String> = emptyList(),
    val citations: List<JsonObject> = emptyList(),
    val drafts: List<JsonObject> = emptyList(),
)

@Serializable data class MissionDetailDto(
    val id: String,
    @SerialName("project_id") val projectId: String? = null,
    val title: String,
    val objective: String,
    val description: String? = null,
    val status: String,
    @SerialName("status_reason") val statusReason: String? = null,
    val priority: Int = 3,
    @SerialName("autonomy_mode") val autonomyMode: String = "supervised",
    @SerialName("budget_usd") val budgetUsd: String? = null,
    @SerialName("spent_usd") val spentUsd: String = "0",
    @SerialName("tokens_used") val tokensUsed: Int = 0,
    val result: String? = null,
    @SerialName("started_at") val startedAt: String? = null,
    @SerialName("completed_at") val completedAt: String? = null,
    @SerialName("created_at") val createdAt: String,
    val progress: Double = 0.0,
    val plan: JsonObject = JsonObject(emptyMap()),
    val review: JsonObject = JsonObject(emptyMap()),
    @SerialName("security_review") val securityReview: JsonObject = JsonObject(emptyMap()),
    val tasks: List<TaskDto> = emptyList(),
)

@Serializable data class MissionCreate(
    val title: String, val objective: String, val description: String? = null,
    @SerialName("project_id") val projectId: String? = null, val priority: Int = 3,
    @SerialName("budget_usd") val budgetUsd: String? = null, @SerialName("autonomy_mode") val autonomyMode: String? = null,
)

@Serializable data class MissionPatch(val priority: Int? = null, @SerialName("budget_usd") val budgetUsd: String? = null)

@Serializable data class AttemptDto(
    val id: String, @SerialName("attempt_number") val attemptNumber: Int, @SerialName("worker_id") val workerId: String,
    val status: String, @SerialName("started_at") val startedAt: String, @SerialName("finished_at") val finishedAt: String? = null,
    val error: String? = null, @SerialName("model_used") val modelUsed: String? = null, @SerialName("cost_usd") val costUsd: String = "0",
    val steps: List<JsonElement> = emptyList(),
)

@Serializable data class MessageDto(
    val id: String,
    val channel: String,
    @SerialName("channel_id") val channelId: String,
    @SerialName("sender_type") val senderType: String,
    @SerialName("sender_agent_id") val senderAgentId: String? = null,
    @SerialName("recipient_agent_id") val recipientAgentId: String? = null,
    @SerialName("message_type") val messageType: String = "message",
    val content: String,
    val meta: JsonObject = JsonObject(emptyMap()),
    @SerialName("model_used") val modelUsed: String? = null,
    val turn: Int? = null,
    @SerialName("created_at") val createdAt: String,
)

@Serializable data class ApprovalDto(
    val id: String,
    val kind: String,
    @SerialName("mission_id") val missionId: String? = null,
    @SerialName("task_id") val taskId: String? = null,
    @SerialName("agent_id") val agentId: String? = null,
    @SerialName("operation_class") val operationClass: String? = null,
    val title: String,
    val details: JsonObject = JsonObject(emptyMap()),
    val status: String,
    @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("created_at") val createdAt: String,
)

@Serializable data class ApprovalDecision(val approve: Boolean, val note: String? = null)

// ------------------------------------------------------------ reuniones

@Serializable data class ParticipantDto(
    @SerialName("agent_id") val agentId: String, val role: String, @SerialName("turns_taken") val turnsTaken: Int = 0,
    val name: String, val slug: String,
)

@Serializable data class MeetingDto(
    val id: String,
    @SerialName("project_id") val projectId: String? = null,
    @SerialName("meeting_type") val meetingType: String,
    val topic: String,
    val objective: String,
    val status: String,
    @SerialName("max_rounds") val maxRounds: Int = 3,
    @SerialName("spent_usd") val spentUsd: String = "0",
    @SerialName("tokens_used") val tokensUsed: Int = 0,
    @SerialName("current_round") val currentRound: Int = 0,
    @SerialName("stop_reason") val stopReason: String? = null,
    val summary: String? = null,
    @SerialName("started_at") val startedAt: String? = null,
    @SerialName("ended_at") val endedAt: String? = null,
    @SerialName("created_at") val createdAt: String,
    val participants: List<ParticipantDto> = emptyList(),
)

@Serializable data class MeetingDetailDto(
    val id: String,
    @SerialName("meeting_type") val meetingType: String,
    val topic: String,
    val objective: String,
    val status: String,
    @SerialName("max_rounds") val maxRounds: Int = 3,
    @SerialName("spent_usd") val spentUsd: String = "0",
    @SerialName("current_round") val currentRound: Int = 0,
    @SerialName("stop_reason") val stopReason: String? = null,
    val summary: String? = null,
    @SerialName("created_at") val createdAt: String,
    val participants: List<ParticipantDto> = emptyList(),
    val context: String? = null,
    @SerialName("expected_outcomes") val expectedOutcomes: String? = null,
    val outcome: JsonObject = JsonObject(emptyMap()),
    val messages: List<MessageDto> = emptyList(),
)

@Serializable data class MeetingCreate(
    val topic: String, val objective: String, @SerialName("meeting_type") val meetingType: String,
    val participants: List<String>, @SerialName("max_rounds") val maxRounds: Int,
    @SerialName("max_duration_seconds") val maxDurationSeconds: Int = 900,
    @SerialName("budget_usd") val budgetUsd: String? = null, @SerialName("project_id") val projectId: String? = null,
    val context: String? = null, @SerialName("expected_outcomes") val expectedOutcomes: String? = null,
)

@Serializable data class MissionFromMeeting(val title: String? = null)

// ------------------------------------------------------------ memoria

@Serializable data class MemoryDto(
    val id: String,
    val scope: String,
    val kind: String,
    @SerialName("agent_id") val agentId: String? = null,
    @SerialName("project_id") val projectId: String? = null,
    @SerialName("created_by_agent_id") val createdByAgentId: String? = null,
    val title: String? = null,
    val content: String,
    val source: String,
    @SerialName("source_ref") val sourceRef: String? = null,
    @SerialName("source_date") val sourceDate: String? = null,
    val confidence: Double = 0.5,
    @SerialName("verification_status") val verificationStatus: String,
    @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("created_at") val createdAt: String,
)

@Serializable data class MemoryHitDto(val item: MemoryDto, val score: Double, @SerialName("matched_by") val matchedBy: List<String> = emptyList())
@Serializable data class MemorySearch(val query: String, val scopes: List<String>? = null, @SerialName("project_id") val projectId: String? = null, val limit: Int = 20)
@Serializable data class MemoryCreate(val scope: String, val content: String, val title: String? = null, val kind: String = "fact",
    @SerialName("agent_id") val agentId: String? = null, @SerialName("project_id") val projectId: String? = null)
@Serializable data class MemoryPatch(val content: String? = null, @SerialName("verification_status") val verificationStatus: String? = null)

// ------------------------------------------------------------ proveedores y modelos

@Serializable data class ProviderDto(
    val id: String, val kind: String, val name: String, @SerialName("base_url") val baseUrl: String? = null,
    @SerialName("api_key_hint") val apiKeyHint: String? = null, @SerialName("is_enabled") val isEnabled: Boolean = true,
    val status: String = "unknown", @SerialName("last_checked_at") val lastCheckedAt: String? = null,
    @SerialName("last_error") val lastError: String? = null, @SerialName("known_limits") val knownLimits: JsonObject = JsonObject(emptyMap()),
)

@Serializable data class ProviderKindDto(val kind: String, val label: String, @SerialName("default_base_url") val defaultBaseUrl: String,
    @SerialName("requires_api_key") val requiresApiKey: Boolean)

@Serializable data class ProviderCreate(val kind: String, val name: String, @SerialName("base_url") val baseUrl: String? = null,
    @SerialName("api_key") val apiKey: String? = null)

@Serializable data class ProviderPatch(@SerialName("is_enabled") val isEnabled: Boolean? = null, @SerialName("api_key") val apiKey: String? = null,
    val name: String? = null, @SerialName("base_url") val baseUrl: String? = null)

@Serializable data class ProviderTestResult(val ok: Boolean, val error: String? = null, val models: List<String> = emptyList(),
    @SerialName("latency_ms") val latencyMs: Int = 0)

@Serializable data class ModelDto(
    val id: String, @SerialName("provider_id") val providerId: String, @SerialName("model_name") val modelName: String,
    @SerialName("display_name") val displayName: String, val capabilities: List<String> = emptyList(),
    @SerialName("context_window") val contextWindow: Int = 0, @SerialName("max_output_tokens") val maxOutputTokens: Int = 0,
    @SerialName("input_price_per_mtok") val inputPrice: String? = null, @SerialName("output_price_per_mtok") val outputPrice: String? = null,
    @SerialName("quality_tier") val qualityTier: Int = 3, @SerialName("is_default") val isDefault: Boolean = false,
    @SerialName("is_enabled") val isEnabled: Boolean = true, @SerialName("is_embedding_default") val isEmbeddingDefault: Boolean = false,
    @SerialName("provider_kind") val providerKind: String? = null,
)

@Serializable data class ModelCreate(@SerialName("provider_id") val providerId: String, @SerialName("model_name") val modelName: String)

@Serializable data class ModelPatch(
    val capabilities: List<String>? = null, @SerialName("quality_tier") val qualityTier: Int? = null,
    @SerialName("input_price_per_mtok") val inputPrice: String? = null, @SerialName("output_price_per_mtok") val outputPrice: String? = null,
    @SerialName("context_window") val contextWindow: Int? = null, @SerialName("is_default") val isDefault: Boolean? = null,
    @SerialName("is_enabled") val isEnabled: Boolean? = null, @SerialName("is_embedding_default") val isEmbeddingDefault: Boolean? = null,
)

@Serializable data class EvalCreate(val name: String, @SerialName("model_ids") val modelIds: List<String>,
    @SerialName("judge_model_id") val judgeModelId: String? = null, val cases: List<JsonObject>)

@Serializable data class EvalRunDto(val id: String, val name: String, val status: String, val summary: JsonObject = JsonObject(emptyMap()),
    @SerialName("created_at") val createdAt: String? = null)

// ------------------------------------------------------------ actividad, notificaciones, ajustes

@Serializable data class ActivityDto(
    val id: String, @SerialName("actor_type") val actorType: String, @SerialName("agent_id") val agentId: String? = null,
    val action: String, @SerialName("mission_id") val missionId: String? = null, @SerialName("project_id") val projectId: String? = null,
    val outcome: String, val summary: String, val details: JsonObject = JsonObject(emptyMap()),
    @SerialName("model_used") val modelUsed: String? = null, val tokens: Int? = null, @SerialName("cost_usd") val costUsd: String? = null,
    @SerialName("created_at") val createdAt: String,
)

@Serializable data class NotificationDto(
    val id: String, @SerialName("event_type") val eventType: String, val title: String, val body: String,
    val data: JsonObject = JsonObject(emptyMap()), @SerialName("read_at") val readAt: String? = null,
    @SerialName("created_at") val createdAt: String,
)

@Serializable data class DeviceBody(val token: String, val platform: String = "android")

@Serializable data class SettingsDto(
    @SerialName("autonomy_mode") val autonomyMode: String = "supervised",
    @SerialName("emergency_stop") val emergencyStop: Boolean = false,
    @SerialName("emergency_stop_reason") val emergencyStopReason: String? = null,
    @SerialName("daily_budget_usd") val dailyBudgetUsd: String? = null,
    @SerialName("monthly_budget_usd") val monthlyBudgetUsd: String? = null,
    @SerialName("default_mission_budget_usd") val defaultMissionBudgetUsd: String? = null,
    @SerialName("max_tokens_per_mission") val maxTokensPerMission: Int = 400000,
    @SerialName("max_concurrent_tasks") val maxConcurrentTasks: Int = 3,
    val language: String = "es",
    @SerialName("notification_prefs") val notificationPrefs: Map<String, Boolean> = emptyMap(),
    val appearance: JsonObject = JsonObject(emptyMap()),
    @SerialName("memory_settings") val memorySettings: JsonObject = JsonObject(emptyMap()),
)

@Serializable data class SettingsPatch(
    @SerialName("autonomy_mode") val autonomyMode: String? = null,
    @SerialName("daily_budget_usd") val dailyBudgetUsd: String? = null,
    @SerialName("monthly_budget_usd") val monthlyBudgetUsd: String? = null,
    @SerialName("default_mission_budget_usd") val defaultMissionBudgetUsd: String? = null,
    @SerialName("clear_daily_budget") val clearDailyBudget: Boolean? = null,
    @SerialName("clear_monthly_budget") val clearMonthlyBudget: Boolean? = null,
    @SerialName("clear_default_mission_budget") val clearDefaultMissionBudget: Boolean? = null,
    @SerialName("max_tokens_per_mission") val maxTokensPerMission: Int? = null,
    @SerialName("max_concurrent_tasks") val maxConcurrentTasks: Int? = null,
    @SerialName("notification_prefs") val notificationPrefs: Map<String, Boolean>? = null,
    val appearance: JsonObject? = null,
    @SerialName("memory_settings") val memorySettings: JsonObject? = null,
    @SerialName("display_name") val displayName: String? = null,
)

@Serializable data class EmergencyStopBody(val reason: String? = null)

// ------------------------------------------------------------ dashboard y sistema

@Serializable data class DashAgent(val id: String, val slug: String, val name: String, val role: String, val status: String,
    @SerialName("status_detail") val statusDetail: String? = null, val color: String = "#00D9FF",
    val appearance: Appearance = Appearance(), @SerialName("last_activity_at") val lastActivityAt: String? = null)
@Serializable data class DashAgents(val total: Int = 0, val active: Int = 0, val items: List<DashAgent> = emptyList())
@Serializable data class DashMissions(val running: Int = 0, val pending: Int = 0, val completed: Int = 0, val failed: Int = 0)
@Serializable data class DashTasks(@SerialName("completed_today") val completedToday: Int = 0, @SerialName("completed_total") val completedTotal: Int = 0)
@Serializable data class DashUsage(@SerialName("tokens_today") val tokensToday: Long = 0, @SerialName("cost_today_usd") val costTodayUsd: String = "0",
    @SerialName("calls_today") val callsToday: Int = 0, @SerialName("cost_month_usd") val costMonthUsd: String = "0")
@Serializable data class DashProvider(val id: String, val kind: String, val name: String, val status: String,
    @SerialName("is_enabled") val isEnabled: Boolean = true, val models: Int = 0)
@Serializable data class DashTimeline(val id: String, val title: String, val status: String, @SerialName("updated_at") val updatedAt: String)
@Serializable data class DashAlert(val id: String, @SerialName("event_type") val eventType: String, val title: String, val body: String,
    @SerialName("created_at") val createdAt: String)
@Serializable data class DashUser(@SerialName("display_name") val displayName: String)

@Serializable data class DashboardDto(
    val user: DashUser,
    @SerialName("emergency_stop") val emergencyStop: Boolean = false,
    @SerialName("autonomy_mode") val autonomyMode: String = "supervised",
    val agents: DashAgents = DashAgents(),
    val missions: DashMissions = DashMissions(),
    val tasks: DashTasks = DashTasks(),
    @SerialName("meetings_active") val meetingsActive: Int = 0,
    @SerialName("pending_approvals") val pendingApprovals: Int = 0,
    @SerialName("unread_notifications") val unreadNotifications: Int = 0,
    val memories: Int = 0,
    val usage: DashUsage = DashUsage(),
    val providers: List<DashProvider> = emptyList(),
    val timeline: List<DashTimeline> = emptyList(),
    @SerialName("recent_activity") val recentActivity: List<ActivityDto> = emptyList(),
    val alerts: List<DashAlert> = emptyList(),
)

@Serializable data class ServerMetrics(@SerialName("cpu_percent") val cpu: Double = 0.0, @SerialName("memory_percent") val memory: Double = 0.0,
    @SerialName("disk_percent") val disk: Double = 0.0, @SerialName("measured_at") val measuredAt: String? = null)
@Serializable data class QueueStatus(val queued: Int = 0, val running: Int = 0)
@Serializable data class SystemStatusDto(val server: ServerMetrics = ServerMetrics(), val queue: QueueStatus = QueueStatus(),
    @SerialName("push_configured") val pushConfigured: Boolean = false)

// ------------------------------------------------------------ proyectos, chat, plugins, programaciones

@Serializable data class ProjectAgentDto(@SerialName("agent_id") val agentId: String, val responsibility: String = "")

@Serializable data class ProjectDto(
    val id: String, val name: String, val description: String = "", val objective: String = "", val status: String = "active",
    val documentation: String = "", @SerialName("created_at") val createdAt: String, @SerialName("updated_at") val updatedAt: String,
    val agents: List<ProjectAgentDto> = emptyList(), val counts: Map<String, Int> = emptyMap(),
)

@Serializable data class ProjectUpsert(val name: String? = null, val description: String? = null, val objective: String? = null,
    val documentation: String? = null, val status: String? = null, val agents: List<ProjectAgentDto>? = null)

@Serializable data class ProjectFileDto(
    val id: String, @SerialName("project_id") val projectId: String, val path: String, val version: Int,
    @SerialName("content_type") val contentType: String, @SerialName("size_bytes") val sizeBytes: Long,
    @SerialName("created_by_agent_id") val createdByAgentId: String? = null, @SerialName("change_note") val changeNote: String? = null,
    val indexed: Boolean = false, @SerialName("index_error") val indexError: String? = null, @SerialName("created_at") val createdAt: String,
)

@Serializable data class ConversationDto(val id: String, @SerialName("agent_id") val agentId: String? = null,
    @SerialName("project_id") val projectId: String? = null, val title: String, @SerialName("updated_at") val updatedAt: String)
@Serializable data class ConversationCreate(val title: String? = null, @SerialName("agent_id") val agentId: String? = null,
    @SerialName("project_id") val projectId: String? = null)
@Serializable data class ChatMessageBody(val content: String, @SerialName("attachment_file_ids") val attachmentFileIds: List<String> = emptyList())

@Serializable data class ToolDto(val key: String, val name: String, val description: String, val category: String,
    @SerialName("operation_class") val operationClass: String, @SerialName("requires_plugin") val requiresPlugin: String? = null)

@Serializable data class PluginPermissionDto(val permission: String, val granted: Boolean)
@Serializable data class PluginDto(val key: String, val name: String, val description: String, @SerialName("is_enabled") val isEnabled: Boolean,
    @SerialName("config_public") val configPublic: JsonObject = JsonObject(emptyMap()), @SerialName("has_secret") val hasSecret: Boolean = false,
    val permissions: List<PluginPermissionDto> = emptyList(), @SerialName("config_fields") val configFields: JsonObject = JsonObject(emptyMap()))
@Serializable data class PluginPatch(@SerialName("is_enabled") val isEnabled: Boolean? = null, val config: Map<String, String>? = null)
@Serializable data class PluginPermissionBody(val permission: String, val granted: Boolean)

@Serializable data class ScheduleDto(val id: String, val kind: String, val name: String, val cron: String? = null,
    @SerialName("run_once_at") val runOnceAt: String? = null, val timezone: String = "UTC", val payload: JsonObject = JsonObject(emptyMap()),
    @SerialName("is_enabled") val isEnabled: Boolean = true, @SerialName("next_run_at") val nextRunAt: String? = null,
    @SerialName("last_run_at") val lastRunAt: String? = null, @SerialName("run_count") val runCount: Int = 0)
@Serializable data class ScheduleCreate(val kind: String, val name: String, val cron: String? = null, val timezone: String = "UTC",
    val payload: JsonObject, @SerialName("run_once_at") val runOnceAt: String? = null)
@Serializable data class SchedulePatch(@SerialName("is_enabled") val isEnabled: Boolean? = null)
