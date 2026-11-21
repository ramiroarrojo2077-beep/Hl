package ai.nexus.app.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

// Contrato NEXUS 2.0 (JARVIS CORE, acciones, rutinas, voz, WhatsApp). Ver backend/app/jarvis.

@Serializable data class JarvisMessageBody(
    val content: String,
    @SerialName("input_mode") val inputMode: String = "text",
    @SerialName("conversation_id") val conversationId: String? = null,
    @SerialName("new_conversation") val newConversation: Boolean = false,
    val timezone: String? = null,
    @SerialName("attachment_file_ids") val attachmentFileIds: List<String> = emptyList(),
    @SerialName("interrupted_message_id") val interruptedMessageId: String? = null,
    @SerialName("spoken_chars") val spokenChars: Int? = null,
)

@Serializable data class IntentRoute(
    @SerialName("task_type") val taskType: String = "general",
    @SerialName("response_style") val responseStyle: String = "",
    @SerialName("max_tokens") val maxTokens: Int = 0,
    val specialists: List<String> = emptyList(),
    val handler: String = "model",
)

@Serializable data class IntentDto(
    val category: String,
    val confidence: Double = 0.0,
    val rule: String = "",
    @SerialName("action_key") val actionKey: String? = null,
    val params: JsonObject = JsonObject(emptyMap()),
    val summary: String? = null,
    val missing: List<String> = emptyList(),
    val question: String? = null,
    val control: String? = null,
    @SerialName("needs_model") val needsModel: Boolean = false,
    val specialists: List<String> = emptyList(),
    val assumptions: List<String> = emptyList(),
    val route: IntentRoute = IntentRoute(),
)

@Serializable data class PipelineStage(val stage: String, val status: String = "done", val ms: Double = 0.0)

@Serializable data class ActionDto(
    val id: String,
    @SerialName("action_key") val actionKey: String,
    val name: String = "",
    val category: String = "",
    val executor: String = "device",
    val risk: String? = null,
    val operation: String? = null,
    val params: JsonObject = JsonObject(emptyMap()),
    val summary: String = "",
    val status: String,
    @SerialName("state_detail") val stateDetail: String? = null,
    @SerialName("requires_confirmation") val requiresConfirmation: Boolean = true,
    val result: JsonObject = JsonObject(emptyMap()),
    val error: String? = null,
    val source: String = "jarvis",
    @SerialName("conversation_id") val conversationId: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("completed_at") val completedAt: String? = null,
    @SerialName("expires_at") val expiresAt: String? = null,
    /** Parámetros completos para ejecutar en el teléfono (solo los recibe el dueño; incluye el número descifrado). */
    @SerialName("device_params") val deviceParams: JsonObject? = null,
)

@Serializable data class JarvisResponse(
    @SerialName("conversation_id") val conversationId: String,
    val handled: String,
    val intent: IntentDto,
    val stages: List<PipelineStage> = emptyList(),
    @SerialName("user_message") val userMessage: MessageDto? = null,
    val reply: MessageDto? = null,
    val action: ActionDto? = null,
    val control: String? = null,
)

@Serializable data class JarvisStateDto(
    val state: String = "idle",
    @SerialName("system_state") val systemState: String = "IDLE",
    @SerialName("emergency_stop") val emergencyStop: Boolean = false,
    @SerialName("workers_online") val workersOnline: Int? = null,
    @SerialName("pending_actions") val pendingActions: Int = 0,
    @SerialName("pending_approvals") val pendingApprovals: Int = 0,
    @SerialName("running_tasks") val runningTasks: Int = 0,
    @SerialName("queued_jobs") val queuedJobs: Int = 0,
    @SerialName("collaborating_agents") val collaboratingAgents: List<String> = emptyList(),
    @SerialName("active_agents") val activeAgents: List<String> = emptyList(),
    @SerialName("nexus_status") val nexusStatus: String? = null,
)

@Serializable data class QuickActionPref(val key: String, val visible: Boolean = true)
@Serializable data class QuietHours(val start: String? = null, val end: String? = null)
@Serializable data class ProactivePrefs(
    val level: String = "normal",
    @SerialName("quiet_hours") val quietHours: QuietHours = QuietHours(),
    val categories: List<String> = emptyList(),
    @SerialName("max_per_day") val maxPerDay: Int = 10,
)
@Serializable data class JarvisPrefs(
    @SerialName("confirm_local_actions") val confirmLocalActions: Boolean = false,
    @SerialName("quick_actions") val quickActions: List<QuickActionPref> = emptyList(),
    val proactive: ProactivePrefs = ProactivePrefs(),
    @SerialName("advanced_view") val advancedView: Boolean = false,
    val timezone: String? = null,
)
@Serializable data class PrivacyPrefs(
    @SerialName("disabled_memory_categories") val disabledMemoryCategories: List<String> = emptyList(),
    @SerialName("crash_reports_consent") val crashReportsConsent: Boolean = false,
    @SerialName("share_contacts_with_models") val shareContactsWithModels: Boolean = false,
)
@Serializable data class JarvisSettingsDto(val jarvis: JarvisPrefs = JarvisPrefs(), val privacy: PrivacyPrefs = PrivacyPrefs())

@Serializable data class ContextCounts(
    @SerialName("pending_actions") val pendingActions: Int = 0,
    @SerialName("pending_approvals") val pendingApprovals: Int = 0,
    @SerialName("missions_running") val missionsRunning: Int = 0,
    @SerialName("missions_blocked") val missionsBlocked: Int = 0,
    @SerialName("missions_finished_since_last_visit") val missionsFinished: Int = 0,
    @SerialName("reminders_today") val remindersToday: Int = 0,
    @SerialName("unread_notifications") val unreadNotifications: Int = 0,
    @SerialName("active_automations") val activeAutomations: Int = 0,
)
@Serializable data class IdTitle(val id: String, val title: String)
@Serializable data class ReminderItem(val id: String, val title: String, val at: String)
@Serializable data class JarvisContextDto(
    val headline: String = "",
    val message: String = "",
    val lines: List<String> = emptyList(),
    val timezone: String? = null,
    val counts: ContextCounts = ContextCounts(),
    @SerialName("finished_missions") val finishedMissions: List<IdTitle> = emptyList(),
    @SerialName("reminders_today") val remindersToday: List<ReminderItem> = emptyList(),
    @SerialName("conversation_id") val conversationId: String? = null,
    @SerialName("jarvis_settings") val jarvisSettings: JarvisPrefs = JarvisPrefs(),
)

@Serializable data class JarvisTraceReply(
    val id: String, val model: String? = null, @SerialName("tools_used") val toolsUsed: List<String?> = emptyList(),
    @SerialName("consulted_agents") val consultedAgents: List<String> = emptyList(), val tokens: Int? = null,
    @SerialName("cost_usd") val costUsd: String? = null, @SerialName("degraded_quality") val degradedQuality: Boolean? = null,
    val models: List<String?>? = null, @SerialName("tool_errors") val toolErrors: Int? = null, val interrupted: Boolean = false,
    @SerialName("action_id") val actionId: String? = null,
)
@Serializable data class TraceCollab(val from: String? = null, val to: String? = null, val type: String = "", val content: String = "",
                                     val model: String? = null, val at: String? = null)
@Serializable data class JarvisTraceDto(
    @SerialName("message_id") val messageId: String,
    val intent: JsonObject? = null,
    val route: IntentRoute? = null,
    val pipeline: List<PipelineStage>? = null,
    val reply: JarvisTraceReply? = null,
    val collaboration: List<TraceCollab> = emptyList(),
)

@Serializable data class FeedbackBody(val rating: Int, val comment: String? = null)
@Serializable data class VoiceSessionBody(val action: String, val mode: String = "push_to_talk", @SerialName("session_id") val sessionId: String? = null,
                                          val turns: Int? = null, @SerialName("duration_seconds") val durationSeconds: Int? = null)

// ------------------------------------------------------------ acciones

@Serializable data class ActionExecuteBody(
    @SerialName("action_key") val actionKey: String,
    val params: JsonObject,
    val summary: String? = null,
    @SerialName("conversation_id") val conversationId: String? = null,
)
@Serializable data class ActionConfirmBody(val params: JsonObject? = null)
@Serializable data class ActionCancelBody(val reason: String? = null)
@Serializable data class ActionReportBody(val state: String, val result: JsonObject = JsonObject(emptyMap()))
@Serializable data class ActionCatalogItem(
    val key: String, val name: String, val description: String = "", val category: String = "", val risk: String = "",
    val operation: String = "", val executor: String = "", @SerialName("always_confirm") val alwaysConfirm: Boolean = false,
    @SerialName("android_permissions") val androidPermissions: List<String> = emptyList(),
)

// ------------------------------------------------------------ automatizaciones

@Serializable data class AutomationDto(
    val id: String,
    val name: String,
    val description: String = "",
    @SerialName("trigger_type") val triggerType: String,
    val cron: String? = null,
    @SerialName("run_at") val runAt: String? = null,
    val timezone: String = "UTC",
    @SerialName("event_type") val eventType: String? = null,
    val conditions: JsonObject = JsonObject(emptyMap()),
    val actions: List<JsonObject> = emptyList(),
    @SerialName("max_runs_per_day") val maxRunsPerDay: Int = 5,
    @SerialName("cooldown_seconds") val cooldownSeconds: Int = 60,
    val status: String,
    @SerialName("paused_by_stop") val pausedByStop: Boolean = false,
    @SerialName("next_run_at") val nextRunAt: String? = null,
    @SerialName("last_run_at") val lastRunAt: String? = null,
    @SerialName("last_status") val lastStatus: String? = null,
    @SerialName("run_count") val runCount: Int = 0,
    @SerialName("created_by") val createdBy: String = "user",
)
@Serializable data class AutomationCreate(
    val name: String,
    @SerialName("trigger_type") val triggerType: String,
    val cron: String? = null,
    @SerialName("run_at") val runAt: String? = null,
    val timezone: String? = null,
    @SerialName("event_type") val eventType: String? = null,
    val actions: List<JsonObject>,
    @SerialName("max_runs_per_day") val maxRunsPerDay: Int? = null,
)
@Serializable data class AutomationRunDto(val id: String, val status: String, val error: String? = null, @SerialName("created_at") val createdAt: String,
                                          val result: JsonObject = JsonObject(emptyMap()))
@Serializable data class AutomationEventsDto(val events: Map<String, String> = emptyMap(), @SerialName("action_types") val actionTypes: List<String> = emptyList())

// ------------------------------------------------------------ voz

@Serializable data class RemoteEngine(val available: Boolean = false, val model: String? = null)
@Serializable data class RemoteVoice(val stt: RemoteEngine = RemoteEngine(), val tts: RemoteEngine = RemoteEngine())
@Serializable data class VoicePrefs(
    val language: String = "es-AR",
    @SerialName("voice_name") val voiceName: String? = null,
    @SerialName("speech_rate") val speechRate: Double = 1.0,
    val pitch: Double = 1.0,
    val volume: Double = 1.0,
    val mode: String = "push_to_talk",
    @SerialName("auto_speak") val autoSpeak: Boolean = true,
    @SerialName("barge_in") val bargeIn: Boolean = true,
    @SerialName("wake_word_enabled") val wakeWordEnabled: Boolean = false,
    @SerialName("wake_word") val wakeWord: String = "nexus",
    @SerialName("wake_word_consent_at") val wakeWordConsentAt: String? = null,
    val processing: String = "local",
    @SerialName("save_transcripts") val saveTranscripts: Boolean = true,
    @SerialName("transcript_retention_days") val transcriptRetentionDays: Int = 30,
    @SerialName("store_audio") val storeAudio: Boolean = false,
    val subtitles: Boolean = true,
    val remote: RemoteVoice = RemoteVoice(),
)
@Serializable data class VoicePrefsPatch(
    val language: String? = null,
    @SerialName("voice_name") val voiceName: String? = null,
    @SerialName("speech_rate") val speechRate: Double? = null,
    val pitch: Double? = null,
    val volume: Double? = null,
    val mode: String? = null,
    @SerialName("auto_speak") val autoSpeak: Boolean? = null,
    @SerialName("barge_in") val bargeIn: Boolean? = null,
    @SerialName("wake_word_enabled") val wakeWordEnabled: Boolean? = null,
    @SerialName("wake_word_consent") val wakeWordConsent: Boolean? = null,
    @SerialName("wake_word") val wakeWord: String? = null,
    val processing: String? = null,
    @SerialName("save_transcripts") val saveTranscripts: Boolean? = null,
    @SerialName("transcript_retention_days") val transcriptRetentionDays: Int? = null,
    val subtitles: Boolean? = null,
)
@Serializable data class TranscriptionDto(val text: String, val model: String? = null, @SerialName("audio_stored") val audioStored: Boolean = false)

// ------------------------------------------------------------ WhatsApp

@Serializable data class PhoneResultDto(
    val input: String = "", val status: String, val e164: String? = null, val display: String? = null, val masked: String? = null,
    val country: String? = null, val assumptions: List<String> = emptyList(), val message: String = "",
)
@Serializable data class DraftBody(
    val text: String, val mode: String = "tone", val tone: String? = null,
    @SerialName("target_language") val targetLanguage: String? = null,
    @SerialName("recipient_first_name") val recipientFirstName: String? = null,
)
@Serializable data class DraftDto(val text: String, val original: String = "", val mode: String = "", val tone: String? = null, val model: String? = null)
@Serializable data class BusinessStatusDto(
    val configured: Boolean = false,
    @SerialName("enabled_for_user") val enabledForUser: Boolean = false,
    @SerialName("webhook_verification_configured") val webhookVerification: Boolean = false,
    @SerialName("webhook_signature_configured") val webhookSignature: Boolean = false,
    @SerialName("messages_by_status") val messagesByStatus: Map<String, Int> = emptyMap(),
    val notes: String? = null,
)
@Serializable data class PersonalWaStatus(val available: Boolean = true, val method: String = "click_to_chat",
                                          @SerialName("can_confirm_delivery") val canConfirmDelivery: Boolean = false, val note: String = "")
@Serializable data class WhatsAppStatusDto(val personal: PersonalWaStatus = PersonalWaStatus(), val business: BusinessStatusDto = BusinessStatusDto(),
                                           val recent: List<ActionDto> = emptyList())

// ------------------------------------------------------------ memoria y privacidad

@Serializable data class MemoryCategoryDto(val key: String, val count: Int = 0, val disabled: Boolean = false)
@Serializable data class MemoryPrivacyDto(
    val categories: List<MemoryCategoryDto> = emptyList(),
    @SerialName("by_source") val bySource: Map<String, Int> = emptyMap(),
    val stale: Int = 0,
    @SerialName("stale_after_days") val staleAfterDays: Int = 180,
    val policy: Map<String, JsonElement> = emptyMap(),
)
@Serializable data class CrashBody(@SerialName("app_version") val appVersion: String, val device: String, val stacktrace: String)

@Serializable data class SettingsV2Patch(
    @SerialName("jarvis_settings") val jarvisSettings: JsonObject? = null,
    @SerialName("privacy_settings") val privacySettings: JsonObject? = null,
)
