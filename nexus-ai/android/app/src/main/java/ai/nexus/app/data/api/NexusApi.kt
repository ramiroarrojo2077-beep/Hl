package ai.nexus.app.data.api

import ai.nexus.app.core.network.ApiClient
import ai.nexus.app.data.model.*
import kotlinx.serialization.json.JsonObject
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody

/** Todos los endpoints de la API v1 usados por la app. */
class NexusApi(val client: ApiClient) {
    // auth
    suspend fun login(email: String, password: String): AuthResponse = client.post("/auth/login", LoginRequest(email, password), auth = false)
    suspend fun register(email: String, password: String, name: String): AuthResponse =
        client.post("/auth/register", RegisterRequest(email, password, name), auth = false)
    suspend fun logout() { client.raw("POST", "/auth/logout") }
    suspend fun sessions(): List<SessionDto> = client.get("/auth/sessions")
    suspend fun revokeSession(familyId: String) = client.delete("/auth/sessions/$familyId")

    // dashboard y sistema
    suspend fun dashboard(): DashboardDto = client.get("/dashboard")
    suspend fun systemStatus(): SystemStatusDto = client.get("/system/status")
    suspend fun emergencyStop(reason: String?): JsonObject = client.post("/system/emergency-stop", EmergencyStopBody(reason))
    suspend fun clearEmergencyStop(resume: Boolean): JsonObject =
        client.json.decodeFromString(client.raw("DELETE", "/system/emergency-stop", query = mapOf("resume_missions" to resume.toString())))

    // agentes
    suspend fun agents(): List<AgentDto> = client.get("/agents")
    suspend fun agent(id: String): AgentDetailDto = client.get("/agents/$id")
    suspend fun personaCatalog(): PersonaCatalog = client.get("/agents/persona-catalog")
    suspend fun createAgent(body: AgentUpsert): AgentDetailDto = client.post("/agents", body)
    suspend fun updateAgent(id: String, body: AgentUpsert): AgentDetailDto = client.patch("/agents/$id", body)
    suspend fun deleteAgent(id: String) = client.delete("/agents/$id")
    suspend fun setPermissions(id: String, perms: List<PermissionDto>): List<PermissionDto> = client.put("/agents/$id/permissions", perms)
    suspend fun setAgentModels(id: String, modelIds: List<String>): AgentDetailDto = client.put("/agents/$id/models", ModelIdsBody(modelIds))
    suspend fun agentTasks(id: String): List<TaskDto> = client.get("/agents/$id/tasks")
    suspend fun instructionVersions(id: String): List<InstructionVersion> = client.get("/agents/$id/instructions")
    suspend fun agentConversation(id: String): ConversationDto = client.postEmpty("/agents/$id/conversation")

    // misiones
    suspend fun missions(status: String? = null, projectId: String? = null): List<MissionDto> =
        client.get("/missions", mapOf("status" to status, "project_id" to projectId))
    suspend fun mission(id: String): MissionDetailDto = client.get("/missions/$id")
    suspend fun createMission(body: MissionCreate): MissionDto = client.post("/missions", body)
    suspend fun updateMission(id: String, body: MissionPatch): MissionDto = client.patch("/missions/$id", body)
    suspend fun missionAction(id: String, action: String): MissionDto = client.postEmpty("/missions/$id/$action")
    suspend fun taskAction(missionId: String, taskId: String, action: String): TaskDto = client.postEmpty("/missions/$missionId/tasks/$taskId/$action")
    suspend fun taskAttempts(missionId: String, taskId: String): List<AttemptDto> = client.get("/missions/$missionId/tasks/$taskId/attempts")
    suspend fun missionMessages(id: String): List<MessageDto> = client.get("/missions/$id/messages")
    suspend fun approvals(status: String = "pending"): List<ApprovalDto> = client.get("/approvals", mapOf("status" to status))
    suspend fun decide(id: String, approve: Boolean, note: String? = null): ApprovalDto = client.post("/approvals/$id/decision", ApprovalDecision(approve, note))

    // reuniones
    suspend fun meetings(): List<MeetingDto> = client.get("/meetings")
    suspend fun meeting(id: String): MeetingDetailDto = client.get("/meetings/$id")
    suspend fun createMeeting(body: MeetingCreate): MeetingDto = client.post("/meetings", body)
    suspend fun cancelMeeting(id: String): MeetingDto = client.postEmpty("/meetings/$id/cancel")
    suspend fun missionFromMeeting(id: String): MissionDto = client.post("/meetings/$id/mission", MissionFromMeeting())

    // memoria
    suspend fun memories(scope: String? = null, projectId: String? = null, verification: String? = null): List<MemoryDto> =
        client.get("/memory", mapOf("scope" to scope, "project_id" to projectId, "verification" to verification, "limit" to "100"))
    suspend fun searchMemory(body: MemorySearch): List<MemoryHitDto> = client.post("/memory/search", body)
    suspend fun createMemory(body: MemoryCreate): MemoryDto = client.post("/memory", body)
    suspend fun updateMemory(id: String, body: MemoryPatch): MemoryDto = client.patch("/memory/$id", body)
    suspend fun deleteMemory(id: String) = client.delete("/memory/$id")
    suspend fun memoryStats(): JsonObject = client.get("/memory/stats")

    // proveedores y modelos
    suspend fun providerKinds(): List<ProviderKindDto> = client.get("/providers/kinds")
    suspend fun providers(): List<ProviderDto> = client.get("/providers")
    suspend fun createProvider(body: ProviderCreate): ProviderDto = client.post("/providers", body)
    suspend fun updateProvider(id: String, body: ProviderPatch): ProviderDto = client.patch("/providers/$id", body)
    suspend fun deleteProvider(id: String) = client.delete("/providers/$id")
    suspend fun testProvider(id: String): ProviderTestResult = client.postEmpty("/providers/$id/test")
    suspend fun models(): List<ModelDto> = client.get("/models")
    suspend fun createModel(body: ModelCreate): ModelDto = client.post("/models", body)
    suspend fun updateModel(id: String, body: ModelPatch): ModelDto = client.patch("/models/$id", body)
    suspend fun deleteModel(id: String) = client.delete("/models/$id")
    suspend fun evals(): List<EvalRunDto> = client.get("/evals")
    suspend fun createEval(body: EvalCreate): JsonObject = client.post("/evals", body)
    suspend fun evalDetail(id: String): JsonObject = client.get("/evals/$id")

    // actividad y consumo
    suspend fun activity(agentId: String? = null, missionId: String? = null, projectId: String? = null, outcome: String? = null,
                         dateFrom: String? = null, before: String? = null): List<ActivityDto> =
        client.get("/activity", mapOf("agent_id" to agentId, "mission_id" to missionId, "project_id" to projectId, "outcome" to outcome,
            "date_from" to dateFrom, "before" to before, "limit" to "50"))
    suspend fun usageSummary(days: Int = 30): JsonObject = client.get("/usage/summary", mapOf("days" to days.toString()))

    // notificaciones
    suspend fun notifications(unreadOnly: Boolean = false): List<NotificationDto> =
        client.get("/notifications", mapOf("unread_only" to unreadOnly.toString()))
    suspend fun markRead(id: String) { client.raw("POST", "/notifications/$id/read") }
    suspend fun markAllRead() { client.raw("POST", "/notifications/read-all") }
    suspend fun registerDevice(token: String) { client.raw("POST", "/devices", client.json.encodeToString(DeviceBody.serializer(), DeviceBody(token))) }

    // ajustes
    suspend fun settings(): SettingsDto = client.get("/settings")
    suspend fun updateSettings(body: SettingsPatch): SettingsDto = client.patch("/settings", body)
    suspend fun exportData(): String = client.raw("GET", "/export")

    // proyectos
    suspend fun projects(): List<ProjectDto> = client.get("/projects")
    suspend fun project(id: String): ProjectDto = client.get("/projects/$id")
    suspend fun createProject(body: ProjectUpsert): ProjectDto = client.post("/projects", body)
    suspend fun updateProject(id: String, body: ProjectUpsert): ProjectDto = client.patch("/projects/$id", body)
    suspend fun deleteProject(id: String) = client.delete("/projects/$id")
    suspend fun projectFiles(id: String, path: String? = null): List<ProjectFileDto> = client.get("/projects/$id/files", mapOf("path" to path))
    suspend fun uploadFile(projectId: String, fileName: String, mime: String?, bytes: ByteArray): ProjectFileDto {
        val body = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", fileName, bytes.toRequestBody(mime?.toMediaTypeOrNull()))
            .build()
        return client.json.decodeFromString(client.raw("POST", "/projects/$projectId/files", requestBody = body))
    }

    // chat
    suspend fun conversations(): List<ConversationDto> = client.get("/conversations")
    suspend fun createConversation(body: ConversationCreate): ConversationDto = client.post("/conversations", body)
    suspend fun deleteConversation(id: String) = client.delete("/conversations/$id")
    suspend fun conversationMessages(id: String): List<MessageDto> = client.get("/conversations/$id/messages")
    suspend fun sendMessage(id: String, content: String, attachments: List<String> = emptyList()): MessageDto =
        client.post("/conversations/$id/messages", ChatMessageBody(content, attachments))

    // herramientas, plugins y programación
    suspend fun tools(): List<ToolDto> = client.get("/tools")
    suspend fun plugins(): List<PluginDto> = client.get("/plugins")
    suspend fun updatePlugin(key: String, body: PluginPatch): PluginDto = client.patch("/plugins/$key", body)
    suspend fun setPluginPermission(key: String, permission: String, granted: Boolean): PluginDto =
        client.put("/plugins/$key/permissions", PluginPermissionBody(permission, granted))
    suspend fun schedules(): List<ScheduleDto> = client.get("/schedules")
    suspend fun createSchedule(body: ScheduleCreate): ScheduleDto = client.post("/schedules", body)
    suspend fun updateSchedule(id: String, body: SchedulePatch): ScheduleDto = client.patch("/schedules/$id", body)
    suspend fun deleteSchedule(id: String) = client.delete("/schedules/$id")

    // ------------------------------------------------------------ NEXUS 2.0
    // JARVIS CORE
    suspend fun jarvisMessage(body: JarvisMessageBody): JarvisResponse = client.post("/jarvis/message", body)
    suspend fun jarvisState(): JarvisStateDto = client.get("/jarvis/state")
    suspend fun jarvisContext(timezone: String?): JarvisContextDto = client.get("/jarvis/context", mapOf("timezone" to timezone))
    suspend fun jarvisSettings(): JarvisSettingsDto = client.get("/jarvis/settings")
    suspend fun jarvisTrace(messageId: String): JarvisTraceDto = client.get("/jarvis/messages/$messageId/trace")
    suspend fun jarvisFeedback(messageId: String, rating: Int) { client.raw("POST", "/jarvis/messages/$messageId/feedback",
        client.json.encodeToString(FeedbackBody.serializer(), FeedbackBody(rating))) }
    suspend fun voiceSession(body: VoiceSessionBody): JsonObject = client.post("/jarvis/voice/session", body)
    suspend fun deleteJarvisHistory(): JsonObject =
        client.json.decodeFromString(client.raw("DELETE", "/jarvis/history", query = mapOf("confirm" to "true")))
    suspend fun updateSettingsV2(body: SettingsV2Patch): SettingsDto = client.patch("/settings", body)

    // Action Registry
    suspend fun actions(status: String? = null): List<ActionDto> = client.get("/actions", mapOf("status" to status))
    suspend fun action(id: String): ActionDto = client.get("/actions/$id")
    suspend fun actionCatalog(): List<ActionCatalogItem> = client.get("/actions/catalog")
    suspend fun executeAction(body: ActionExecuteBody): ActionDto = client.post("/actions/execute", body)
    suspend fun confirmAction(id: String, params: JsonObject? = null): ActionDto = client.post("/actions/$id/confirm", ActionConfirmBody(params))
    suspend fun cancelAction(id: String, reason: String? = null): ActionDto = client.post("/actions/$id/cancel", ActionCancelBody(reason))
    suspend fun reportAction(id: String, state: String, result: JsonObject = JsonObject(emptyMap())): ActionDto =
        client.post("/actions/$id/report", ActionReportBody(state, result))

    // Automatizaciones
    suspend fun automations(): List<AutomationDto> = client.get("/automations")
    suspend fun automationEvents(): AutomationEventsDto = client.get("/automations/events")
    suspend fun createAutomation(body: AutomationCreate): AutomationDto = client.post("/automations", body)
    suspend fun automationAction(id: String, action: String): AutomationDto = client.postEmpty("/automations/$id/$action")
    suspend fun runAutomation(id: String): JsonObject = client.postEmpty("/automations/$id/run")
    suspend fun automationRuns(id: String): List<AutomationRunDto> = client.get("/automations/$id/runs")
    suspend fun deleteAutomation(id: String) = client.delete("/automations/$id")

    // Voz
    suspend fun voicePrefs(): VoicePrefs = client.get("/voice/settings")
    suspend fun updateVoicePrefs(body: VoicePrefsPatch): VoicePrefs = client.patch("/voice/settings", body)
    suspend fun transcribe(fileName: String, mime: String, bytes: ByteArray, language: String?): TranscriptionDto {
        val builder = MultipartBody.Builder().setType(MultipartBody.FORM)
            .addFormDataPart("file", fileName, bytes.toRequestBody(mime.toMediaTypeOrNull()))
        if (language != null) builder.addFormDataPart("language", language)
        return client.json.decodeFromString(client.raw("POST", "/voice/transcriptions", requestBody = builder.build()))
    }

    // WhatsApp
    suspend fun whatsappStatus(): WhatsAppStatusDto = client.get("/integrations/whatsapp/status")
    suspend fun whatsappDraft(body: DraftBody): DraftDto = client.post("/integrations/whatsapp/draft", body)

    // Memoria: privacidad
    suspend fun memoryPrivacy(): MemoryPrivacyDto = client.get("/memory/privacy")

    // Diagnóstico (solo con consentimiento)
    suspend fun reportCrash(body: CrashBody): JsonObject = client.post("/diagnostics/crash", body)
}
