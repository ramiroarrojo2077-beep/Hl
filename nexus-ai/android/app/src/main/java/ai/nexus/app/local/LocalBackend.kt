package ai.nexus.app.local

import ai.nexus.app.core.network.NexusJson
import ai.nexus.app.core.session.SecretBox
import ai.nexus.app.data.model.*
import android.app.ActivityManager
import android.content.Context
import android.os.StatFs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit

class LocalError(val status: Int, val code: String, override val message: String) : Exception(message)
fun bad(msg: String) = LocalError(400, "validation_error", msg)
fun notFound(msg: String = "No encontrado.") = LocalError(404, "not_found", msg)

class Req(val method: String, val path: String, val query: Map<String, String>, val body: String?, val parts: List<Part> = emptyList()) {
    class Part(val name: String, val fileName: String?, val contentType: String?, val bytes: ByteArray)
    fun q(k: String) = query[k]
}

inline fun <reified T> j(v: T): String = NexusJson.encodeToString(v)
inline fun <reified T> Req.parse(): T = NexusJson.decodeFromString(body?.takeIf { it.isNotBlank() } ?: "{}")
fun Req.obj(): JsonObject = runCatching { NexusJson.parseToJsonElement(body ?: "{}").jsonObject }.getOrDefault(JsonObject(emptyMap()))

private class Route(val method: String, val regex: Regex, val names: List<String>, val handler: suspend (Req, Map<String, String>) -> String)

/**
 * Backend completo dentro del teléfono (modo local, sin servidor). Atiende las mismas rutas de la
 * API v1 que el servidor, así todas las pantallas funcionan igual. Los datos viven en SQLite local y
 * los modelos de IA se llaman directo desde el teléfono con la clave que cargó el usuario.
 */
class LocalBackend(
    internal val context: Context,
    internal val store: LocalStore,
    internal val llm: LocalLlm,
    internal val crypto: SecretBox,
    internal val scope: CoroutineScope,
) {
    private val _events = MutableSharedFlow<String>(extraBufferCapacity = 512)
    val events: SharedFlow<String> = _events
    internal val seed: JsonObject by lazy {
        NexusJson.parseToJsonElement(context.assets.open("local/seed.json").bufferedReader().use { it.readText() }).jsonObject
    }
    private val routes = mutableListOf<Route>()
    internal val running = java.util.concurrent.ConcurrentHashMap<String, kotlinx.coroutines.Job>()
    internal val cancelRequested = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    internal var notifier: (NotificationDto) -> Unit = {}
    internal var scheduleWake: (Long) -> Unit = {}
    /** Envía una respuesta por la notificación de WhatsApp. Devuelve null si se la pasó a WhatsApp, o el motivo del fallo. */
    internal var waSender: (String, String) -> String? = { _, _ -> "El envío automático no está disponible" }

    init {
        registerCore()
        registerJarvis()
        registerWork()
    }

    internal fun route(method: String, pattern: String, handler: suspend (Req, Map<String, String>) -> String) {
        val names = Regex("""\{(\w+)\}""").findAll(pattern).map { it.groupValues[1] }.toList()
        val regex = Regex("^" + pattern.replace(Regex("""\{\w+\}"""), "([^/]+)") + "$")
        routes += Route(method, regex, names, handler)
    }

    /** Devuelve (código HTTP, JSON). */
    suspend fun handle(req: Req): Pair<Int, String> = try {
        val r = routes.firstOrNull { it.method == req.method && it.regex.matches(req.path) }
            ?: throw LocalError(404, "not_found", "Esta función no está disponible en el modo local (${req.method} ${req.path}).")
        val m = r.regex.matchEntire(req.path)!!
        val params = r.names.mapIndexed { i, n -> n to m.groupValues[i + 1] }.toMap()
        ensureUser()
        200 to r.handler(req, params)
    } catch (e: LocalError) {
        e.status to j(buildJsonObject { put("error", e.code); put("message", e.message) })
    } catch (e: kotlinx.serialization.SerializationException) {
        422 to j(buildJsonObject { put("error", "validation_error"); put("message", "Datos inválidos: ${e.message?.take(200)}") })
    } catch (e: Exception) {
        500 to j(buildJsonObject { put("error", "internal_error"); put("message", "Error interno del modo local: ${e.javaClass.simpleName}: ${e.message?.take(200)}") })
    }

    // ------------------------------------------------------------ eventos

    internal fun emit(type: String, data: JsonObject) {
        _events.tryEmit(j(buildJsonObject { put("id", newId()); put("type", type); put("ts", nowIso()); put("data", data) }))
    }

    // ------------------------------------------------------------ usuario y ajustes

    @Synchronized
    fun ensureUser(name: String? = null): LocalUser {
        store.get(C.META, "user", LocalUser.serializer())?.let { u ->
            if (name != null && name.isNotBlank() && name != u.name) { val n = u.copy(name = name.trim()); store.put(C.META, "user", LocalUser.serializer(), n); return n }
            return u
        }
        val user = LocalUser(newId(), "local@nexus", name?.trim()?.ifBlank { null } ?: "Usuario")
        store.put(C.META, "user", LocalUser.serializer(), user)
        store.put(C.META, "settings", LocalSettings.serializer(), LocalSettings(
            jarvis = seed["default_jarvis"]!!.jsonObject, privacy = seed["default_privacy"]!!.jsonObject,
            voice = VoicePrefs(language = "es-AR")))
        seedAgents()
        return user
    }

    fun user(): LocalUser = ensureUser()
    internal fun settings(): LocalSettings = store.get(C.META, "settings", LocalSettings.serializer()) ?: LocalSettings()
    internal fun saveSettings(s: LocalSettings) = store.put(C.META, "settings", LocalSettings.serializer(), s)

    internal fun zone(override: String? = null): ZoneId {
        for (n in listOf(override, settings().jarvis["timezone"]?.jsonPrimitive?.contentOrNull)) {
            if (!n.isNullOrBlank()) runCatching { return ZoneId.of(n) }
        }
        return ZoneId.systemDefault()
    }

    internal fun authResponse(u: LocalUser) = AuthResponse(UserDto(u.id, u.email, u.name),
        TokenPair("local", "local", "2099-01-01T00:00:00Z", "2099-01-01T00:00:00Z"))

    // ------------------------------------------------------------ agentes

    private fun seedAgents() {
        if (store.count(C.AGENTS) > 0) return
        for (el in seed["agents"]!!.jsonArray) {
            val a = el.jsonObject
            fun s(k: String) = a[k]?.jsonPrimitive?.contentOrNull ?: ""
            val approvals = a["approval_tools"]?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty()
            val detail = AgentDetailDto(
                id = newId(), slug = s("slug"), name = s("name"), role = s("role"), isSystem = true,
                profile = AgentProfileDto(
                    avatar = s("avatar"), color = s("color"), description = s("description"), personality = s("personality"),
                    specialties = a["specialties"]!!.jsonArray.map { it.jsonPrimitive.content }, communicationStyle = s("communication_style"),
                    workCriteria = s("work_criteria"), temperature = a["temperature"]?.jsonPrimitive?.doubleOrNull, reasoningLevel = s("reasoning_level"),
                    traits = NexusJson.decodeFromJsonElement(Traits.serializer(), a["traits"]!!),
                    appearance = NexusJson.decodeFromJsonElement(Appearance.serializer(), a["appearance"]!!),
                    voice = NexusJson.decodeFromJsonElement(VoiceSettings.serializer(), a["voice"]!!),
                ),
                instructions = s("instructions"), instructionsVersion = 1,
                permissions = a["tools"]!!.jsonArray.map { t -> PermissionDto(t.jsonPrimitive.content, true, if (t.jsonPrimitive.content in approvals) "approval" else "auto") },
            )
            store.put(C.AGENTS, detail.id, AgentRec.serializer(), AgentRec(detail, listOf(InstructionVersion(1, detail.instructions, true, nowIso()))))
        }
    }

    internal fun agents(): List<AgentRec> = store.all(C.AGENTS, AgentRec.serializer())
    internal fun agent(id: String) = store.get(C.AGENTS, id, AgentRec.serializer()) ?: throw notFound("Agente no encontrado")
    internal fun agentBySlug(slug: String) = agents().firstOrNull { it.d.slug == slug }
    internal fun nexus() = agentBySlug("nexus") ?: throw notFound("No existe el agente NEXUS")
    internal fun saveAgent(r: AgentRec) = store.put(C.AGENTS, r.d.id, AgentRec.serializer(), r)

    internal fun AgentDetailDto.toDto() = AgentDto(id, slug, name, role, isSystem, isEnabled, status, statusDetail, null, lastActivityAt,
        autonomyLevel, memoryEnabled, participatesInMeetings, dailyBudgetUsd, profile, models.firstOrNull()?.modelName)

    internal fun setAgentStatus(id: String, status: String, detail: String? = null) {
        val r = store.get(C.AGENTS, id, AgentRec.serializer()) ?: return
        saveAgent(r.copy(d = r.d.copy(status = status, statusDetail = detail, lastActivityAt = nowIso())))
        emit("agent.status", buildJsonObject { put("agent_id", id); put("slug", r.d.slug); put("status", status); detail?.let { put("detail", it) } })
    }

    private fun upsertAgent(existing: AgentRec?, b: AgentUpsert): AgentRec {
        val base = existing?.d ?: AgentDetailDto(id = newId(), slug = "", name = b.name ?: throw bad("Falta el nombre"), role = b.role ?: throw bad("Falta el rol"),
            profile = AgentProfileDto(appearance = NexusJson.decodeFromJsonElement(Appearance.serializer(), seed["generic_persona"]!!.jsonObject["appearance"]!!),
                traits = NexusJson.decodeFromJsonElement(Traits.serializer(), seed["generic_persona"]!!.jsonObject["traits"]!!)))
        val p = base.profile
        val profile = p.copy(
            description = b.description ?: p.description, personality = b.personality ?: p.personality, specialties = b.specialties ?: p.specialties,
            communicationStyle = b.communicationStyle ?: p.communicationStyle, workCriteria = b.workCriteria ?: p.workCriteria,
            color = b.color ?: p.color, temperature = b.temperature ?: p.temperature, reasoningLevel = b.reasoningLevel ?: p.reasoningLevel,
            traits = b.traits?.let { Traits(p.traits.personality + it.personality.mapValues { v -> v.value.coerceIn(0, 100) },
                p.traits.emotions + it.emotions.mapValues { v -> v.value.coerceIn(0, 100) }) } ?: p.traits,
            appearance = b.appearance ?: p.appearance, voice = b.voice ?: p.voice,
        )
        val name = b.name ?: base.name
        val slug = base.slug.ifBlank { normalize(name).replace(Regex("[^a-z0-9]+"), "-").trim('-').ifBlank { "agente" } + "-" + newId().take(4) }
        var versions = existing?.versions.orEmpty()
        var instructions = base.instructions
        var version = base.instructionsVersion
        if (b.instructions != null && b.instructions != base.instructions) {
            version += 1
            instructions = b.instructions
            versions = versions.map { it.copy(isActive = false) } + InstructionVersion(version, instructions, true, nowIso())
        }
        val perms = b.tools?.map { PermissionDto(it, true, "auto") } ?: base.permissions
        val models = b.modelIds?.let { modelRefs(it) } ?: base.models
        val d = base.copy(name = name, role = b.role ?: base.role, slug = slug, profile = profile, instructions = instructions, instructionsVersion = version,
            memoryEnabled = b.memoryEnabled ?: base.memoryEnabled, participatesInMeetings = b.participatesInMeetings ?: base.participatesInMeetings,
            isEnabled = b.isEnabled ?: base.isEnabled, autonomyLevel = b.autonomyLevel ?: base.autonomyLevel,
            dailyBudgetUsd = if (b.clearDailyBudget == true) null else b.dailyBudgetUsd ?: base.dailyBudgetUsd, permissions = perms, models = models)
        return AgentRec(d, versions)
    }

    private fun modelRefs(ids: List<String>): List<AgentModelRef> = ids.mapIndexedNotNull { i, id ->
        val m = store.get(C.MODELS, id, ModelDto.serializer()) ?: return@mapIndexedNotNull null
        AgentModelRef(m.id, i, m.displayName, m.providerKind ?: "")
    }

    private fun agentStats(id: String): JsonObject {
        val tasks = store.all(C.TASKS, TaskDto.serializer()).filter { it.agentId == id }
        return buildJsonObject {
            put("tasks_total", tasks.size); put("tasks_completed", tasks.count { it.status == "completed" })
            put("tasks_failed", tasks.count { it.status == "failed" }); put("tokens", tasks.sumOf { it.tokensUsed })
        }
    }

    // ------------------------------------------------------------ proveedores y modelos

    internal fun providers() = store.all(C.PROVIDERS, ProviderRec.serializer())
    internal fun keyOf(p: ProviderRec): String? = p.keyEnc?.let { crypto.decrypt(it) }

    private fun hint(key: String?) = key?.takeIf { it.length >= 8 }?.let { "…" + it.takeLast(4) }

    // ------------------------------------------------------------ memoria

    internal fun memories() = store.all(C.MEMORY, MemoryRec.serializer())

    internal fun searchMemory(query: String, scopes: List<String>? = null, projectId: String? = null, limit: Int = 8): List<Pair<MemoryRec, Double>> {
        val terms = normalize(query).split(Regex("[^a-z0-9ñ]+")).filter { it.length >= 3 }.toSet()
        if (terms.isEmpty()) return emptyList()
        val blocked = disabledCategories()
        return memories().asSequence()
            .filter { scopes == null || it.m.scope in scopes }
            .filter { projectId == null || it.m.projectId == projectId || it.m.projectId == null }
            .filter { it.m.verificationStatus != "rejected" && it.category !in blocked }
            .map { r ->
                val words = normalize((r.m.title ?: "") + " " + r.m.content).split(Regex("[^a-z0-9ñ]+")).toSet()
                val hits = terms.count { t -> words.any { w -> w.startsWith(t) || t.startsWith(w) && w.length >= 4 } }
                r to hits.toDouble() / terms.size
            }
            .filter { it.second > 0 }
            .sortedByDescending { it.second }
            .take(limit).toList()
    }

    internal fun disabledCategories(): Set<String> =
        settings().privacy["disabled_memory_categories"]?.jsonArray?.map { it.jsonPrimitive.content }?.toSet().orEmpty()

    internal fun createMemory(scope: String, content: String, title: String? = null, kind: String = "fact", source: String = "user",
                              sourceRef: String? = null, confidence: Double = 0.95, verification: String = "verified", category: String = "personal",
                              agentId: String? = null, projectId: String? = null): MemoryRec {
        val now = nowIso()
        val rec = MemoryRec(MemoryDto(newId(), scope, kind, agentId, projectId, null, title, content.take(4000), source, sourceRef, now, confidence,
            verification, null, now), category, if (verification == "verified") now else null, now)
        store.put(C.MEMORY, rec.m.id, MemoryRec.serializer(), rec)
        return rec
    }

    // ------------------------------------------------------------ notificaciones y actividad

    internal fun notify(eventType: String, title: String, body: String, data: Map<String, String> = emptyMap(), push: Boolean = true) {
        val n = NotificationDto(newId(), eventType, title, body, JsonObject(data.mapValues { JsonPrimitive(it.value) }), null, nowIso())
        store.put(C.NOTIFS, n.id, NotificationDto.serializer(), n)
        emit("notification.created", NexusJson.encodeToJsonElement(NotificationDto.serializer(), n).jsonObject)
        if (push) runCatching { notifier(n) }
    }

    internal fun activity(action: String, summary: String, outcome: String = "success", agentId: String? = null, missionId: String? = null,
                          projectId: String? = null, model: String? = null, tokens: Int? = null, actor: String = "agent") {
        val a = ActivityDto(newId(), actor, agentId, action, missionId, projectId, outcome, summary.take(500), JsonObject(emptyMap()), model, tokens, null, nowIso())
        store.put(C.ACTIVITY, a.id, ActivityDto.serializer(), a)
        emit("activity.created", NexusJson.encodeToJsonElement(ActivityDto.serializer(), a).jsonObject)
    }

    // ------------------------------------------------------------ conversaciones y mensajes

    internal fun convs() = store.all(C.CONVS, ConvRec.serializer())
    internal fun conv(id: String) = store.get(C.CONVS, id, ConvRec.serializer()) ?: throw notFound("Conversación no encontrada")

    internal fun messagesOf(channel: String, channelId: String): List<MessageDto> =
        store.all(C.MSGS, MessageDto.serializer()).filter { it.channel == channel && it.channelId == channelId }

    private var lastMsgInstant: Instant = Instant.EPOCH

    @Synchronized
    private fun monotonicNow(): String {
        var t = Instant.now()
        if (!t.isAfter(lastMsgInstant)) t = lastMsgInstant.plusNanos(1000)
        lastMsgInstant = t
        return t.toString()
    }

    internal fun recordMessage(channel: String, channelId: String, content: String, senderType: String, senderAgentId: String? = null,
                               messageType: String = "message", model: String? = null, meta: JsonObject = JsonObject(emptyMap()), turn: Int? = null): MessageDto {
        val m = MessageDto(newId(), channel, channelId, senderType, senderAgentId, null, messageType, content, meta, model, turn, monotonicNow())
        store.put(C.MSGS, m.id, MessageDto.serializer(), m)
        if (channel == "chat") store.get(C.CONVS, channelId, ConvRec.serializer())?.let { c ->
            store.put(C.CONVS, c.c.id, ConvRec.serializer(), c.copy(c = c.c.copy(updatedAt = m.createdAt)))
        }
        emit("message.created", buildJsonObject {
            put("id", m.id); put("channel", channel); put("channel_id", channelId); put("sender_type", senderType)
            senderAgentId?.let { put("sender_agent_id", it) }; put("message_type", messageType)
        })
        return m
    }

    internal fun updateMessage(m: MessageDto) = store.put(C.MSGS, m.id, MessageDto.serializer(), m)

    // ------------------------------------------------------------ rutas base

    private fun registerCore() {
        // auth (perfil local, sin contraseña: los datos nunca salen del teléfono)
        route("POST", "/auth/login") { r, _ -> j(authResponse(ensureUser())) }
        route("POST", "/auth/register") { r, _ -> j(authResponse(ensureUser(r.parse<RegisterRequest>().displayName))) }
        route("POST", "/auth/refresh") { _, _ -> j(authResponse(user()).tokens) }
        route("POST", "/auth/logout") { _, _ -> "{}" }
        route("GET", "/auth/me") { _, _ -> user().let { j(UserDto(it.id, it.email, it.name)) } }
        route("GET", "/auth/sessions") { _, _ -> j(listOf(SessionDto("local", nowIso(), "2099-01-01T00:00:00Z", "Este teléfono", null, true))) }
        route("DELETE", "/auth/sessions/{id}") { _, _ -> "{}" }

        // dashboard y sistema
        route("GET", "/dashboard") { _, _ -> j(dashboard()) }
        route("GET", "/system/status") { _, _ -> j(systemStatus()) }
        route("POST", "/system/emergency-stop") { r, _ -> j(emergencyStop(r.obj()["reason"]?.jsonPrimitive?.contentOrNull)) }
        route("DELETE", "/system/emergency-stop") { r, _ -> j(clearEmergencyStop(r.q("resume_missions") == "true")) }

        // agentes
        route("GET", "/agents") { _, _ -> j(agents().map { it.d.toDto() }) }
        route("GET", "/agents/persona-catalog") { _, _ -> j(NexusJson.decodeFromJsonElement(PersonaCatalog.serializer(), seed["persona_catalog"]!!)) }
        route("POST", "/agents") { r, _ -> val rec = upsertAgent(null, r.parse()); saveAgent(rec); emit("agent.updated", buildJsonObject { put("agent_id", rec.d.id) }); j(rec.d) }
        route("GET", "/agents/{id}") { _, p -> val a = agent(p.getValue("id")); j(a.d.copy(stats = agentStats(a.d.id))) }
        route("PATCH", "/agents/{id}") { r, p ->
            val rec = upsertAgent(agent(p.getValue("id")), r.parse()); saveAgent(rec); emit("agent.updated", buildJsonObject { put("agent_id", rec.d.id) }); j(rec.d)
        }
        route("DELETE", "/agents/{id}") { _, p ->
            val a = agent(p.getValue("id")); if (a.d.isSystem) throw LocalError(409, "conflict", "Los agentes del sistema no se pueden eliminar")
            store.delete(C.AGENTS, a.d.id); "{}"
        }
        route("PUT", "/agents/{id}/permissions") { r, p ->
            val a = agent(p.getValue("id")); val perms = NexusJson.decodeFromString(ListSerializer(PermissionDto.serializer()), r.body ?: "[]")
            saveAgent(a.copy(d = a.d.copy(permissions = perms))); j(perms)
        }
        route("PUT", "/agents/{id}/models") { r, p ->
            val a = agent(p.getValue("id")); val d = a.d.copy(models = modelRefs(r.parse<ModelIdsBody>().modelIds)); saveAgent(a.copy(d = d)); j(d)
        }
        route("GET", "/agents/{id}/tasks") { _, p -> j(store.all(C.TASKS, TaskDto.serializer()).filter { it.agentId == p["id"] }.sortedByDescending { it.createdAt }.take(50)) }
        route("GET", "/agents/{id}/instructions") { _, p -> j(agent(p.getValue("id")).versions.sortedByDescending { it.version }) }
        route("POST", "/agents/{id}/conversation") { _, p ->
            val a = agent(p.getValue("id"))
            val existing = convs().filter { it.c.agentId == a.d.id && it.kind == "agent" }.maxByOrNull { it.c.updatedAt }
            j((existing ?: newConv(a.d.id, null, "Chat con ${a.d.name}", "agent")).c)
        }

        // proveedores y modelos
        route("GET", "/providers/kinds") { _, _ -> j(LocalKinds.list.map { (k, l, u) -> ProviderKindDto(k, l, u, LocalKinds.requiresKey(k)) }) }
        route("GET", "/providers") { _, _ -> j(providers().map { it.p }) }
        route("POST", "/providers") { r, _ ->
            val b = r.parse<ProviderCreate>()
            if (LocalKinds.list.none { it.first == b.kind }) throw bad("Tipo de proveedor no soportado: ${b.kind}")
            if (LocalKinds.requiresKey(b.kind) && b.apiKey.isNullOrBlank()) throw bad("Este proveedor requiere una API key")
            val rec = ProviderRec(ProviderDto(newId(), b.kind, b.name.ifBlank { b.kind }, b.baseUrl?.ifBlank { null } ?: LocalKinds.defaultUrl(b.kind),
                hint(b.apiKey)), b.apiKey?.takeIf { it.isNotBlank() }?.let { crypto.encrypt(it.trim()) })
            store.put(C.PROVIDERS, rec.p.id, ProviderRec.serializer(), rec); j(rec.p)
        }
        route("PATCH", "/providers/{id}") { r, p ->
            val cur = store.get(C.PROVIDERS, p.getValue("id"), ProviderRec.serializer()) ?: throw notFound("Proveedor no encontrado")
            val b = r.parse<ProviderPatch>()
            val rec = cur.copy(p = cur.p.copy(isEnabled = b.isEnabled ?: cur.p.isEnabled, name = b.name ?: cur.p.name, baseUrl = b.baseUrl ?: cur.p.baseUrl,
                apiKeyHint = if (b.apiKey != null) hint(b.apiKey) else cur.p.apiKeyHint),
                keyEnc = if (b.apiKey != null) crypto.encrypt(b.apiKey.trim()) else cur.keyEnc)
            store.put(C.PROVIDERS, rec.p.id, ProviderRec.serializer(), rec); j(rec.p)
        }
        route("DELETE", "/providers/{id}") { _, p ->
            store.delete(C.PROVIDERS, p.getValue("id"))
            store.all(C.MODELS, ModelDto.serializer()).filter { it.providerId == p["id"] }.forEach { store.delete(C.MODELS, it.id) }
            "{}"
        }
        route("POST", "/providers/{id}/test") { _, p ->
            val cur = store.get(C.PROVIDERS, p.getValue("id"), ProviderRec.serializer()) ?: throw notFound("Proveedor no encontrado")
            val started = System.currentTimeMillis()
            val result = try {
                val models = llm.listModels(cur.p.kind, cur.p.baseUrl, keyOf(cur))
                store.put(C.PROVIDERS, cur.p.id, ProviderRec.serializer(), cur.copy(p = cur.p.copy(status = "ok", lastCheckedAt = nowIso(), lastError = null)))
                ProviderTestResult(true, null, models, (System.currentTimeMillis() - started).toInt())
            } catch (e: LlmError) {
                store.put(C.PROVIDERS, cur.p.id, ProviderRec.serializer(), cur.copy(p = cur.p.copy(status = "error", lastCheckedAt = nowIso(), lastError = e.message)))
                ProviderTestResult(false, e.message, emptyList(), (System.currentTimeMillis() - started).toInt())
            }
            j(result)
        }
        route("GET", "/models") { _, _ -> j(store.all(C.MODELS, ModelDto.serializer())) }
        route("POST", "/models") { r, _ ->
            val b = r.parse<ModelCreate>()
            val prov = store.get(C.PROVIDERS, b.providerId, ProviderRec.serializer()) ?: throw notFound("Proveedor no encontrado")
            store.all(C.MODELS, ModelDto.serializer()).firstOrNull { it.providerId == b.providerId && it.modelName == b.modelName }?.let { return@route j(it) }
            val (caps, tier) = suggestCapabilities(b.modelName)
            val first = store.all(C.MODELS, ModelDto.serializer()).none { "chat" in it.capabilities && it.isEnabled }
            val m = ModelDto(newId(), b.providerId, b.modelName, b.modelName, caps, 128000, 8192, null, null, tier, first && "chat" in caps, true, false, prov.p.kind)
            store.put(C.MODELS, m.id, ModelDto.serializer(), m); j(m)
        }
        route("PATCH", "/models/{id}") { r, p ->
            val cur = store.get(C.MODELS, p.getValue("id"), ModelDto.serializer()) ?: throw notFound("Modelo no encontrado")
            val b = r.parse<ModelPatch>()
            if (b.isDefault == true) store.all(C.MODELS, ModelDto.serializer()).filter { it.isDefault }.forEach { store.put(C.MODELS, it.id, ModelDto.serializer(), it.copy(isDefault = false)) }
            val m = cur.copy(capabilities = b.capabilities ?: cur.capabilities, qualityTier = b.qualityTier ?: cur.qualityTier, inputPrice = b.inputPrice ?: cur.inputPrice,
                outputPrice = b.outputPrice ?: cur.outputPrice, contextWindow = b.contextWindow ?: cur.contextWindow, isDefault = b.isDefault ?: cur.isDefault,
                isEnabled = b.isEnabled ?: cur.isEnabled, isEmbeddingDefault = b.isEmbeddingDefault ?: cur.isEmbeddingDefault)
            store.put(C.MODELS, m.id, ModelDto.serializer(), m); j(m)
        }
        route("DELETE", "/models/{id}") { _, p -> store.delete(C.MODELS, p.getValue("id")); "{}" }
        route("GET", "/evals") { _, _ -> "[]" }
        route("POST", "/evals") { _, _ -> throw LocalError(400, "not_available", "La comparación de modelos no está disponible en el modo local.") }

        // memoria
        route("GET", "/memory") { r, _ ->
            val items = memories().filter { m -> (r.q("scope") == null || m.m.scope == r.q("scope")) && (r.q("project_id") == null || m.m.projectId == r.q("project_id")) &&
                (r.q("verification") == null || m.m.verificationStatus == r.q("verification")) }
            j(items.sortedByDescending { it.m.createdAt }.take(r.q("limit")?.toIntOrNull() ?: 100).map { it.m })
        }
        route("POST", "/memory/search") { r, _ ->
            val b = r.parse<MemorySearch>()
            j(searchMemory(b.query, b.scopes, b.projectId, b.limit).map { (m, s) -> MemoryHitDto(m.m, s, listOf("lexical")) })
        }
        route("POST", "/memory") { r, _ ->
            val b = r.parse<MemoryCreate>()
            if (b.content.isBlank()) throw bad("El recuerdo está vacío")
            j(createMemory(b.scope, b.content, b.title, b.kind, agentId = b.agentId, projectId = b.projectId, category = memoryCategory(normalize(b.content))).m)
        }
        route("PATCH", "/memory/{id}") { r, p ->
            val cur = store.get(C.MEMORY, p.getValue("id"), MemoryRec.serializer()) ?: throw notFound("Recuerdo no encontrado")
            val b = r.parse<MemoryPatch>()
            val rec = cur.copy(m = cur.m.copy(content = b.content ?: cur.m.content, verificationStatus = b.verificationStatus ?: cur.m.verificationStatus),
                lastVerifiedAt = if (b.verificationStatus == "verified") nowIso() else cur.lastVerifiedAt, updatedAt = nowIso())
            store.put(C.MEMORY, rec.m.id, MemoryRec.serializer(), rec); j(rec.m)
        }
        route("DELETE", "/memory/{id}") { _, p -> store.delete(C.MEMORY, p.getValue("id")); "{}" }
        route("GET", "/memory/stats") { _, _ ->
            val all = memories()
            j(buildJsonObject {
                put("total", all.size)
                put("by_scope", JsonObject(all.groupingBy { it.m.scope }.eachCount().mapValues { JsonPrimitive(it.value) }))
                put("by_verification", JsonObject(all.groupingBy { it.m.verificationStatus }.eachCount().mapValues { JsonPrimitive(it.value) }))
            })
        }
        route("GET", "/memory/privacy") { _, _ ->
            val all = memories()
            val disabled = disabledCategories()
            val cats = seed["memory_categories"]!!.jsonArray.map { it.jsonPrimitive.content }
            val stale = all.count { r -> runCatching { Instant.parse(r.lastVerifiedAt ?: r.m.createdAt).isBefore(Instant.now().minus(180, ChronoUnit.DAYS)) }.getOrDefault(false) }
            j(MemoryPrivacyDto(cats.map { c -> MemoryCategoryDto(c, all.count { it.category == c }, c in disabled) },
                all.groupingBy { it.m.source }.eachCount(), stale, 180,
                mapOf("stored_on" to JsonPrimitive("Este teléfono (modo local)"), "contacts_shared_with_models" to JsonPrimitive(false))))
        }

        // actividad y consumo
        route("GET", "/activity") { r, _ ->
            val all = store.all(C.ACTIVITY, ActivityDto.serializer()).filter { a ->
                (r.q("agent_id") == null || a.agentId == r.q("agent_id")) && (r.q("mission_id") == null || a.missionId == r.q("mission_id")) &&
                    (r.q("project_id") == null || a.projectId == r.q("project_id")) && (r.q("outcome") == null || a.outcome == r.q("outcome")) &&
                    (r.q("date_from") == null || a.createdAt >= r.q("date_from")!!) && (r.q("before") == null || a.createdAt < r.q("before")!!)
            }
            j(all.sortedByDescending { it.createdAt }.take(r.q("limit")?.toIntOrNull() ?: 50))
        }
        route("GET", "/usage/summary") { r, _ -> j(usageSummary(r.q("days")?.toIntOrNull() ?: 30)) }
        route("GET", "/usage/records") { _, _ -> j(store.all(C.USAGE, UsageRec.serializer()).sortedByDescending { it.at }.take(100)) }

        // notificaciones
        route("GET", "/notifications") { r, _ ->
            j(store.all(C.NOTIFS, NotificationDto.serializer()).filter { r.q("unread_only") != "true" || it.readAt == null }.sortedByDescending { it.createdAt }.take(100))
        }
        route("POST", "/notifications/read-all") { _, _ ->
            store.all(C.NOTIFS, NotificationDto.serializer()).filter { it.readAt == null }.forEach { store.put(C.NOTIFS, it.id, NotificationDto.serializer(), it.copy(readAt = nowIso())) }
            "{}"
        }
        route("POST", "/notifications/{id}/read") { _, p ->
            store.get(C.NOTIFS, p.getValue("id"), NotificationDto.serializer())?.let { store.put(C.NOTIFS, it.id, NotificationDto.serializer(), it.copy(readAt = nowIso())) }
            "{}"
        }
        route("POST", "/devices") { _, _ -> "{}" }
        route("DELETE", "/devices") { _, _ -> "{}" }

        // ajustes
        route("GET", "/settings") { _, _ -> j(settingsView()) }
        route("PATCH", "/settings") { r, _ -> j(patchSettings(r.obj())) }
        route("GET", "/export") { _, _ ->
            j(buildJsonObject {
                put("exported_at", nowIso()); put("mode", "local")
                store.dump().filterKeys { it != C.PROVIDERS }.forEach { (k, v) -> put(k, JsonArray(v.map { NexusJson.parseToJsonElement(it) })) }
            })
        }

        // proyectos
        route("GET", "/projects") { _, _ -> j(store.all(C.PROJECTS, ProjectDto.serializer()).map { withCounts(it) }) }
        route("GET", "/projects/{id}") { _, p -> j(withCounts(project(p.getValue("id")))) }
        route("POST", "/projects") { r, _ ->
            val b = r.parse<ProjectUpsert>()
            val now = nowIso()
            val pr = ProjectDto(newId(), b.name?.takeIf { it.isNotBlank() } ?: throw bad("Falta el nombre"), b.description ?: "", b.objective ?: "", b.status ?: "active",
                b.documentation ?: "", now, now, b.agents ?: emptyList())
            store.put(C.PROJECTS, pr.id, ProjectDto.serializer(), pr); j(pr)
        }
        route("PATCH", "/projects/{id}") { r, p ->
            val cur = project(p.getValue("id")); val b = r.parse<ProjectUpsert>()
            val pr = cur.copy(name = b.name ?: cur.name, description = b.description ?: cur.description, objective = b.objective ?: cur.objective,
                documentation = b.documentation ?: cur.documentation, status = b.status ?: cur.status, agents = b.agents ?: cur.agents, updatedAt = nowIso())
            store.put(C.PROJECTS, pr.id, ProjectDto.serializer(), pr); j(pr)
        }
        route("DELETE", "/projects/{id}") { _, p -> store.delete(C.PROJECTS, p.getValue("id")); "{}" }
        route("GET", "/projects/{id}/files") { r, p ->
            j(files(p.getValue("id")).filter { r.q("path") == null || it.f.path.startsWith(r.q("path")!!) }.map { it.f })
        }
        route("POST", "/projects/{id}/files") { r, p -> j(uploadFile(project(p.getValue("id")).id, r).f) }
        route("GET", "/projects/{id}/files/{fid}/content") { _, p ->
            val f = store.get(C.FILES, p.getValue("fid"), FileRec.serializer()) ?: throw notFound("Archivo no encontrado")
            File(f.localPath).readText()
        }

        // chat por agente
        route("GET", "/conversations") { _, _ -> j(convs().filter { it.kind != "jarvis" }.sortedByDescending { it.c.updatedAt }.take(100).map { it.c }) }
        route("POST", "/conversations") { r, _ ->
            val b = r.parse<ConversationCreate>()
            j(newConv(b.agentId ?: nexus().d.id, b.projectId, b.title ?: "Conversación", "chat").c)
        }
        route("DELETE", "/conversations/{id}") { _, p ->
            val c = conv(p.getValue("id")); messagesOf("chat", c.c.id).forEach { store.delete(C.MSGS, it.id) }; store.delete(C.CONVS, c.c.id); "{}"
        }
        route("GET", "/conversations/{id}/messages") { r, p ->
            val all = messagesOf("chat", conv(p.getValue("id")).c.id).filter { r.q("before") == null || it.createdAt < r.q("before")!! }
            j(all.sortedBy { it.createdAt }.takeLast(r.q("limit")?.toIntOrNull()?.coerceAtMost(200) ?: 60))
        }
        route("POST", "/conversations/{id}/messages") { r, p -> j(agentChat(conv(p.getValue("id")), r.parse<ChatMessageBody>())) }

        // herramientas y plugins: el modo local no tiene herramientas externas (búsqueda web, sandbox, webhooks)
        route("GET", "/tools") { _, _ -> "[]" }
        route("GET", "/plugins") { _, _ -> "[]" }

        // diagnóstico
        route("POST", "/diagnostics/crash") { r, _ ->
            val rec = CrashRec(newId(), nowIso(), r.parse()); store.put(C.CRASHES, rec.id, CrashRec.serializer(), rec)
            j(buildJsonObject { put("id", rec.id); put("stored", "local") })
        }
        route("GET", "/diagnostics/crash") { _, _ -> j(store.all(C.CRASHES, CrashRec.serializer()).map { it.body }) }
    }

    internal fun newConv(agentId: String?, projectId: String?, title: String, kind: String): ConvRec {
        val rec = ConvRec(ConversationDto(newId(), agentId, projectId, title.take(120), nowIso()), kind)
        store.put(C.CONVS, rec.c.id, ConvRec.serializer(), rec)
        return rec
    }

    private fun project(id: String) = store.get(C.PROJECTS, id, ProjectDto.serializer()) ?: throw notFound("Proyecto no encontrado")
    internal fun files(projectId: String) = store.all(C.FILES, FileRec.serializer()).filter { it.f.projectId == projectId }

    private fun withCounts(p: ProjectDto) = p.copy(counts = mapOf(
        "missions" to store.all(C.MISSIONS, MissionRec.serializer()).count { it.m.projectId == p.id },
        "files" to files(p.id).size,
        "memories" to memories().count { it.m.projectId == p.id },
    ))

    private fun uploadFile(projectId: String, r: Req): FileRec {
        val part = r.parts.firstOrNull { it.name == "file" } ?: throw bad("Falta el archivo")
        if (part.bytes.size > 20 * 1024 * 1024) throw bad("El archivo supera 20 MB")
        val name = (part.fileName ?: "archivo").replace(Regex("""[/\\]"""), "_").take(200)
        val version = files(projectId).filter { it.f.path == name }.maxOfOrNull { it.f.version }?.plus(1) ?: 1
        val dir = File(context.filesDir, "local_projects/$projectId").apply { mkdirs() }
        val file = File(dir, "${newId()}_$name")
        file.writeBytes(part.bytes)
        val text = extractText(name, part.contentType, part.bytes)
        val rec = FileRec(ProjectFileDto(newId(), projectId, name, version, part.contentType ?: "application/octet-stream", part.bytes.size.toLong(),
            null, null, text != null, if (text == null) "Solo se leen archivos de texto en el modo local" else null, nowIso()), file.absolutePath)
        store.put(C.FILES, rec.f.id, FileRec.serializer(), rec)
        if (text != null) createMemory("project", text.take(4000), title = name, kind = "document", source = "document", sourceRef = name,
            confidence = 0.8, verification = "unverified", category = "projects", projectId = projectId)
        return rec
    }

    internal fun extractText(name: String, mime: String?, bytes: ByteArray): String? {
        val textual = (mime?.startsWith("text/") == true) || mime in setOf("application/json", "application/xml", "application/javascript") ||
            Regex("""\.(txt|md|csv|json|xml|kt|java|py|js|ts|html|css|yml|yaml|sql|log)$""", RegexOption.IGNORE_CASE).containsMatchIn(name)
        return if (textual) bytes.toString(Charsets.UTF_8) else null
    }

    internal fun readFileText(fileId: String): Pair<String, String>? {
        val f = store.get(C.FILES, fileId, FileRec.serializer()) ?: return null
        val text = extractText(f.f.path, f.f.contentType, runCatching { File(f.localPath).readBytes() }.getOrNull() ?: return null) ?: return null
        return f.f.path to text
    }

    // ------------------------------------------------------------ ajustes

    private fun settingsView(): JsonObject {
        val s = settings()
        val base = NexusJson.encodeToJsonElement(SettingsDto.serializer(), s.settings).jsonObject
        return JsonObject(base + mapOf(
            "jarvis_settings" to JsonObject(s.jarvis),
            "privacy_settings" to JsonObject(s.privacy),
            "voice_settings" to NexusJson.encodeToJsonElement(VoicePrefs.serializer(), s.voice),
            "display_name" to JsonPrimitive(user().name),
            "mode" to JsonPrimitive("local"),
        ))
    }

    private fun patchSettings(o: JsonObject): JsonObject {
        var s = settings()
        val b = NexusJson.decodeFromJsonElement(SettingsPatch.serializer(), o)
        val cur = s.settings
        s = s.copy(settings = cur.copy(
            autonomyMode = b.autonomyMode ?: cur.autonomyMode,
            dailyBudgetUsd = if (b.clearDailyBudget == true) null else b.dailyBudgetUsd ?: cur.dailyBudgetUsd,
            monthlyBudgetUsd = if (b.clearMonthlyBudget == true) null else b.monthlyBudgetUsd ?: cur.monthlyBudgetUsd,
            defaultMissionBudgetUsd = if (b.clearDefaultMissionBudget == true) null else b.defaultMissionBudgetUsd ?: cur.defaultMissionBudgetUsd,
            maxTokensPerMission = b.maxTokensPerMission ?: cur.maxTokensPerMission, maxConcurrentTasks = b.maxConcurrentTasks ?: cur.maxConcurrentTasks,
            notificationPrefs = b.notificationPrefs ?: cur.notificationPrefs, appearance = b.appearance ?: cur.appearance,
            memorySettings = b.memorySettings ?: cur.memorySettings))
        b.displayName?.let { ensureUser(it) }
        (o["jarvis_settings"] as? JsonObject)?.let { s = s.copy(jarvis = mergeJarvis(s.jarvis, it)) }
        (o["privacy_settings"] as? JsonObject)?.let { patch ->
            if (patch["share_contacts_with_models"]?.jsonPrimitive?.booleanOrNull == true) throw bad("Los contactos nunca se comparten con modelos de IA")
            val cats = seed["memory_categories"]!!.jsonArray.map { it.jsonPrimitive.content }
            patch["disabled_memory_categories"]?.jsonArray?.forEach { if (it.jsonPrimitive.content !in cats) throw bad("Categorías válidas: ${cats.joinToString()}") }
            s = s.copy(privacy = JsonObject(s.privacy + patch.filterKeys { it in setOf("disabled_memory_categories", "crash_reports_consent") }))
        }
        saveSettings(s)
        return settingsView()
    }

    private fun mergeJarvis(stored: JsonObject, patch: JsonObject): JsonObject {
        val out = stored.toMutableMap()
        val quick = listOf("whatsapp", "reminder", "research", "project", "agenda", "document", "memory", "mission")
        for ((k, v) in patch) when (k) {
            "confirm_local_actions", "advanced_view" -> out[k] = JsonPrimitive(v.jsonPrimitive.booleanOrNull ?: false)
            "timezone" -> { runCatching { ZoneId.of(v.jsonPrimitive.content) }.getOrElse { throw bad("Zona horaria inválida: $v") }; out[k] = v }
            "quick_actions" -> {
                val seen = mutableListOf<String>()
                val clean = v.jsonArray.map { item ->
                    val key = item.jsonObject["key"]?.jsonPrimitive?.contentOrNull
                    if (key !in quick || key in seen) throw bad("Acción rápida inválida o repetida: $key")
                    seen += key!!
                    buildJsonObject { put("key", key); put("visible", item.jsonObject["visible"]?.jsonPrimitive?.booleanOrNull ?: true) }
                } + quick.filter { it !in seen }.map { buildJsonObject { put("key", it); put("visible", false) } }
                out[k] = JsonArray(clean)
            }
            "proactive" -> out[k] = JsonObject((stored["proactive"] as? JsonObject ?: JsonObject(emptyMap())) + v.jsonObject)
            else -> throw bad("Preferencia de JARVIS desconocida: $k")
        }
        return JsonObject(out)
    }

    // ------------------------------------------------------------ dashboard, sistema, consumo

    private fun dashboard(): DashboardDto {
        val ag = agents()
        val missions = store.all(C.MISSIONS, MissionRec.serializer())
        val tasks = store.all(C.TASKS, TaskDto.serializer())
        val today = ZonedDateTime.now(zone()).toLocalDate().atStartOfDay(zone()).toInstant().toString()
        val usage = store.all(C.USAGE, UsageRec.serializer())
        val todayUsage = usage.filter { it.at >= today }
        val notifs = store.all(C.NOTIFS, NotificationDto.serializer())
        val active = setOf("thinking", "working", "collaborating")
        return DashboardDto(
            user = DashUser(user().name), emergencyStop = settings().settings.emergencyStop, autonomyMode = settings().settings.autonomyMode,
            agents = DashAgents(ag.size, ag.count { it.d.status in active }, ag.map { a ->
                DashAgent(a.d.id, a.d.slug, a.d.name, a.d.role, a.d.status, a.d.statusDetail, a.d.profile.color, a.d.profile.appearance, a.d.lastActivityAt) }),
            missions = DashMissions(missions.count { it.m.status in RUNNING_MISSION }, missions.count { it.m.status in setOf("pending", "paused", "blocked") },
                missions.count { it.m.status == "completed" }, missions.count { it.m.status == "failed" }),
            tasks = DashTasks(tasks.count { it.status == "completed" && (it.completedAt ?: "") >= today }, tasks.count { it.status == "completed" }),
            meetingsActive = store.all(C.MEETINGS, MeetingRec.serializer()).count { it.d.status == "running" },
            pendingApprovals = 0, unreadNotifications = notifs.count { it.readAt == null }, memories = store.count(C.MEMORY),
            usage = DashUsage(todayUsage.sumOf { (it.tokensIn + it.tokensOut).toLong() }, "0", todayUsage.size, "0"),
            providers = providers().map { p -> DashProvider(p.p.id, p.p.kind, p.p.name, p.p.status, p.p.isEnabled,
                store.all(C.MODELS, ModelDto.serializer()).count { it.providerId == p.p.id }) },
            timeline = missions.sortedByDescending { it.updatedAt }.take(8).map { DashTimeline(it.m.id, it.m.title, it.m.status, it.updatedAt) },
            recentActivity = store.all(C.ACTIVITY, ActivityDto.serializer()).sortedByDescending { it.createdAt }.take(10),
            alerts = notifs.filter { it.readAt == null && it.eventType in setOf("mission_failed", "mission_blocked", "important_error") }
                .sortedByDescending { it.createdAt }.take(5).map { DashAlert(it.id, it.eventType, it.title, it.body, it.createdAt) },
        )
    }

    private var cpuSample: Pair<Long, Long>? = null

    private fun systemStatus(): SystemStatusDto {
        // Métricas reales del teléfono (en modo local el "servidor" es el propio teléfono).
        val am = context.getSystemService(ActivityManager::class.java)
        val mi = ActivityManager.MemoryInfo().also { am?.getMemoryInfo(it) }
        val mem = if (mi.totalMem > 0) (mi.totalMem - mi.availMem) * 100.0 / mi.totalMem else 0.0
        val stat = StatFs(context.filesDir.absolutePath)
        val disk = if (stat.totalBytes > 0) (stat.totalBytes - stat.availableBytes) * 100.0 / stat.totalBytes else 0.0
        val cpuNow = android.os.Process.getElapsedCpuTime() to System.currentTimeMillis()
        val cpu = cpuSample?.let { (c0, t0) ->
            val dt = (cpuNow.second - t0).coerceAtLeast(1)
            ((cpuNow.first - c0) * 100.0 / dt / Runtime.getRuntime().availableProcessors()).coerceIn(0.0, 100.0)
        } ?: 0.0
        cpuSample = cpuNow
        val queued = store.all(C.TASKS, TaskDto.serializer())
        return SystemStatusDto(ServerMetrics(cpu, mem, disk, nowIso()), QueueStatus(queued.count { it.status in setOf("pending", "ready") }, running.size), false)
    }

    private fun usageSummary(days: Int): JsonObject {
        val since = Instant.now().minus(days.toLong(), ChronoUnit.DAYS).toString()
        val rows = store.all(C.USAGE, UsageRec.serializer()).filter { it.at >= since }
        fun group(key: (UsageRec) -> String, label: String) = JsonArray(rows.groupBy(key).map { (k, v) ->
            buildJsonObject { put(label, k); put("tokens_in", v.sumOf { it.tokensIn }); put("tokens_out", v.sumOf { it.tokensOut }); put("cost_usd", "0") } })
        return buildJsonObject {
            put("totals", buildJsonObject {
                put("tokens_in", rows.sumOf { it.tokensIn }); put("tokens_out", rows.sumOf { it.tokensOut }); put("cost_usd", "0")
                put("calls", rows.size); put("failed_calls", 0); put("calls_without_price", rows.size)
            })
            put("budget", buildJsonObject { put("daily_spent", "0"); put("monthly_spent", "0") })
            put("by_model", group({ it.model }, "model"))
            put("by_provider", group({ it.model.substringBefore(':') }, "provider"))
            put("by_agent", JsonArray(emptyList()))
            put("daily", JsonArray(rows.groupBy { it.at.take(10) }.toSortedMap().map { (d, v) ->
                buildJsonObject { put("day", d); put("tokens", v.sumOf { it.tokensIn + it.tokensOut }); put("cost_usd", "0") } }))
            put("note", "Modo local: el costo no se calcula (planes gratuitos o tu propia cuenta). " +
                (if (rows.any { it.estimated }) "Algunos tokens son estimados porque el proveedor no los informó." else ""))
        }
    }

    internal fun recordUsage(model: String, purpose: String, r: LlmResult) {
        val u = UsageRec(newId(), nowIso(), model, purpose, r.tokensIn, r.tokensOut, r.estimated)
        store.put(C.USAGE, u.id, UsageRec.serializer(), u)
    }

    companion object {
        val RUNNING_MISSION = setOf("planning", "running", "reviewing", "consolidating")
    }
}

internal fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.contentOrNull
internal fun JsonObject.int(k: String): Int? = (this[k] as? JsonPrimitive)?.intOrNull
