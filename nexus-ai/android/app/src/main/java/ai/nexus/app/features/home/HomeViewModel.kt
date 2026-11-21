package ai.nexus.app.features.home

import ai.nexus.app.AppContainer
import ai.nexus.app.actions.ExecResult
import ai.nexus.app.core.realtime.ConnectionState
import ai.nexus.app.core.ui.userMessage
import ai.nexus.app.data.model.ActionDto
import ai.nexus.app.data.model.ActionExecuteBody
import ai.nexus.app.data.model.JarvisContextDto
import ai.nexus.app.data.model.JarvisMessageBody
import ai.nexus.app.data.model.JarvisStateDto
import ai.nexus.app.data.model.JarvisTraceDto
import ai.nexus.app.data.model.MessageDto
import ai.nexus.app.data.model.ProjectDto
import ai.nexus.app.data.model.QuickActionPref
import ai.nexus.app.data.model.VoiceSessionBody
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.time.ZoneId

val DEFAULT_QUICK = listOf("whatsapp", "reminder", "research", "project", "agenda", "document", "memory", "mission").map { QuickActionPref(it) }

data class HomeState(
    val context: JarvisContextDto? = null,
    val server: JarvisStateDto? = null,
    val conversationId: String? = null,
    val messages: List<MessageDto> = emptyList(),
    val streaming: String = "",
    val awaitingReply: Boolean = false,
    val sending: Boolean = false,
    val pending: List<ActionDto> = emptyList(),
    val executing: Boolean = false,
    val errorAt: Long = 0,
    val error: String? = null,
    val quick: List<QuickActionPref> = DEFAULT_QUICK,
    val advanced: Boolean = false,
    val projects: List<ProjectDto> = emptyList(),
    val lastTurnVoice: Boolean = false,
    val startNew: Boolean = false,
) {
    val recentError get() = error != null && System.currentTimeMillis() - errorAt < 8_000
}

sealed interface HomeEffect {
    data class ExecuteDevice(val action: ActionDto) : HomeEffect
    data class OpenWhatsApp(val action: ActionDto) : HomeEffect
    data class Navigate(val route: String) : HomeEffect
    data class Toast(val message: String) : HomeEffect
    data class Speak(val messageId: String, val text: String) : HomeEffect
    data class Prefill(val text: String) : HomeEffect
}

class HomeViewModel(private val c: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(HomeState())
    val state: StateFlow<HomeState> = _state
    // Efectos de una sola vez en un canal con búfer: si la pantalla se recompone no se pierden.
    private val _effects = Channel<HomeEffect>(Channel.BUFFERED)
    val effects: Flow<HomeEffect> = _effects.receiveAsFlow()
    private var reloadJob: Job? = null
    private var voiceSessionId: String? = null
    private val tz: String get() = ZoneId.systemDefault().id

    private fun update(f: (HomeState) -> HomeState) { _state.value = f(_state.value) }

    init {
        refresh()
        viewModelScope.launch {
            c.realtime.events.collect { e ->
                val conv = _state.value.conversationId
                when (e.type) {
                    "chat.delta" -> if (e.str("conversation_id") == conv) update { it.copy(streaming = it.streaming + (e.str("delta") ?: ""), awaitingReply = true) }
                    "message.created" -> if (e.str("channel") == "chat" && e.str("channel_id") == conv && e.str("sender_type") != "user") scheduleReload()
                    "jarvis.state" -> update { it.copy(server = (it.server ?: JarvisStateDto()).copy(state = e.str("state") ?: "idle")) }
                    "action.updated" -> refreshPending()
                    "agent.status", "approval.created", "notification.created", "mission.updated", "system.emergency_stop" -> refreshServerState()
                }
            }
        }
        viewModelScope.launch {
            c.realtime.state.collect { if (it == ConnectionState.Connected) refresh() } // re-sincroniza tras reconectar (sin duplicar: reemplaza)
        }
        viewModelScope.launch { c.voiceUtterances.collect { u -> send(u.text, voice = true, interruptedId = u.interruptedMessageId, spokenChars = u.spokenChars) } }
    }

    fun refresh() {
        viewModelScope.launch {
            try {
                val ctx = c.api.jarvisContext(tz)
                update {
                    it.copy(context = ctx, conversationId = it.conversationId ?: ctx.conversationId,
                        quick = ctx.jarvisSettings.quickActions.ifEmpty { DEFAULT_QUICK }, advanced = ctx.jarvisSettings.advancedView)
                }
                refreshServerState()
                refreshPending()
                reloadMessages()
                runCatching { c.api.voicePrefs() }.onSuccess { p -> c.voicePrefs.value = p }
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                fail(e.userMessage())
            }
        }
    }

    private fun refreshServerState() {
        viewModelScope.launch { runCatching { c.api.jarvisState() }.onSuccess { s -> update { it.copy(server = s) } } }
    }

    private fun refreshPending() {
        viewModelScope.launch {
            runCatching { c.api.actions("awaiting_confirmation") }.onSuccess { list -> update { it.copy(pending = list) } }
        }
    }

    private fun scheduleReload() {
        reloadJob?.cancel()
        reloadJob = viewModelScope.launch { delay(120); reloadMessages(speakNew = true) }
    }

    private suspend fun reloadMessages(speakNew: Boolean = false) {
        val conv = _state.value.conversationId ?: return
        runCatching { c.api.conversationMessages(conv) }.onSuccess { msgs ->
            val previousIds = _state.value.messages.map { it.id }.toSet()
            val answered = msgs.lastOrNull()?.senderType != "user"
            update { it.copy(messages = msgs.takeLast(30), streaming = if (answered) "" else it.streaming, awaitingReply = !answered && it.awaitingReply) }
            if (speakNew && _state.value.lastTurnVoice) {
                msgs.lastOrNull { it.senderType == "agent" && it.id !in previousIds }?.let { _effects.trySend(HomeEffect.Speak(it.id, it.content)) }
            }
        }
    }

    private fun fail(message: String) = update { it.copy(error = message, errorAt = System.currentTimeMillis()) }

    fun send(text: String, voice: Boolean = false, attachments: List<String> = emptyList(), interruptedId: String? = null, spokenChars: Int? = null) {
        if (text.isBlank()) return
        viewModelScope.launch {
            update { it.copy(sending = true, streaming = "", lastTurnVoice = voice, error = null) }
            try {
                val fresh = _state.value.startNew
                val r = c.api.jarvisMessage(JarvisMessageBody(text.trim(), if (voice) "voice" else "text",
                    if (fresh) null else _state.value.conversationId, newConversation = fresh, timezone = tz,
                    attachmentFileIds = attachments, interruptedMessageId = interruptedId, spokenChars = spokenChars))
                update { it.copy(startNew = false) }
                update { s ->
                    val added = listOfNotNull(r.userMessage, r.reply).filter { m -> s.messages.none { it.id == m.id } }
                    s.copy(sending = false, conversationId = r.conversationId, messages = (s.messages + added).takeLast(30),
                        awaitingReply = r.handled == "model")
                }
                if (r.handled == "control") {
                    // Barge-in escrito o hablado: el servidor ya canceló la generación pendiente.
                    if (r.control == "stop") c.voice().interrupt()
                    return@launch
                }
                r.action?.let { a ->
                    when {
                        a.actionKey == "whatsapp.open_chat" && a.status == "awaiting_confirmation" -> _effects.trySend(HomeEffect.OpenWhatsApp(a))
                        a.executor == "device" && a.status == "ready" -> _effects.trySend(HomeEffect.ExecuteDevice(a))
                        a.status == "awaiting_confirmation" -> update { s -> s.copy(pending = (s.pending.filter { it.id != a.id } + a)) }
                    }
                }
                if (voice) r.reply?.let { _effects.trySend(HomeEffect.Speak(it.id, it.content)) }
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                update { it.copy(sending = false) }
                fail(e.userMessage())
                _effects.trySend(HomeEffect.Toast(e.userMessage()))
            }
        }
    }

    fun confirm(action: ActionDto, params: JsonObject? = null, onDone: (ActionDto?) -> Unit = {}) {
        viewModelScope.launch {
            try {
                val a = c.api.confirmAction(action.id, params)
                update { s -> s.copy(pending = s.pending.filter { it.id != a.id }) }
                if (a.executor == "device" && a.status == "ready") _effects.trySend(HomeEffect.ExecuteDevice(a))
                else { reloadMessages(); if (a.status == "failed") _effects.trySend(HomeEffect.Toast(a.error ?: "La acción falló")) }
                onDone(a)
            } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                _effects.trySend(HomeEffect.Toast(e.userMessage()))
                onDone(null)
            }
        }
    }

    fun cancel(action: ActionDto) {
        viewModelScope.launch {
            runCatching { c.api.cancelAction(action.id, "Cancelada desde la app") }
            update { s -> s.copy(pending = s.pending.filter { it.id != action.id }) }
            reloadMessages()
        }
    }

    /** El teléfono informa al backend lo que realmente pasó (verificación, etapa 8). */
    fun reportExecution(action: ActionDto, result: ExecResult) {
        viewModelScope.launch {
            update { it.copy(executing = false) }
            runCatching {
                c.api.reportAction(action.id, result.state, JsonObject(result.info.mapValues { JsonPrimitive(it.value) }))
            }.onFailure { _effects.trySend(HomeEffect.Toast(it.userMessage())) }
            if (!result.ok) _effects.trySend(HomeEffect.Toast(result.info["error"] ?: "No se pudo ejecutar"))
            reloadMessages()
        }
    }

    fun markExecuting() = update { it.copy(executing = true) }

    /** Acción rápida pedida por el usuario (sin pasar por el modelo). */
    fun quick(key: String) {
        when (key) {
            "whatsapp" -> _effects.trySend(HomeEffect.OpenWhatsApp(ActionDto(id = "", actionKey = "whatsapp.open_chat", status = "draft")))
            "reminder" -> _effects.trySend(HomeEffect.Prefill("Recordame "))
            "research" -> _effects.trySend(HomeEffect.Prefill("Investigá "))
            "document" -> _effects.trySend(HomeEffect.Prefill("Escribime un documento sobre "))
            "project" -> _effects.trySend(HomeEffect.Navigate("projects"))
            "memory" -> _effects.trySend(HomeEffect.Navigate("memory"))
            "mission" -> _effects.trySend(HomeEffect.Navigate("mission/new"))
            "agenda" -> viewModelScope.launch {
                runCatching {
                    c.api.executeAction(ActionExecuteBody("device.calendar_view", JsonObject(mapOf("date" to JsonPrimitive(java.time.LocalDate.now().toString())))))
                }.onSuccess { a -> if (a.status == "ready") _effects.trySend(HomeEffect.ExecuteDevice(a)) }
                    .onFailure { _effects.trySend(HomeEffect.Toast(it.userMessage())) }
            }
        }
    }

    suspend fun trace(messageId: String): JarvisTraceDto = c.api.jarvisTrace(messageId)

    fun feedback(messageId: String, rating: Int) {
        viewModelScope.launch { runCatching { c.api.jarvisFeedback(messageId, rating) }.onSuccess { _effects.trySend(HomeEffect.Toast("Gracias, lo tengo en cuenta.")) } }
    }

    fun loadProjects() {
        viewModelScope.launch { runCatching { c.api.projects() }.onSuccess { p -> update { it.copy(projects = p) } } }
    }

    fun attach(projectId: String, name: String, mime: String?, bytes: ByteArray, onResult: (String?) -> Unit) {
        viewModelScope.launch {
            try { onResult(c.api.uploadFile(projectId, name, mime, bytes).id) } catch (e: Exception) {
                if (e is kotlinx.coroutines.CancellationException) throw e
                _effects.trySend(HomeEffect.Toast(e.userMessage())); onResult(null)
            }
        }
    }

    fun voiceSession(start: Boolean, continuous: Boolean, turns: Int = 0) {
        viewModelScope.launch {
            runCatching {
                val r = c.api.voiceSession(VoiceSessionBody(if (start) "start" else "end", if (continuous) "continuous" else "push_to_talk", voiceSessionId, turns))
                voiceSessionId = if (start) (r["session_id"] as? JsonPrimitive)?.contentOrNull else null
            }
        }
    }

    fun newConversation() {
        update { it.copy(conversationId = null, messages = emptyList(), streaming = "", awaitingReply = false, startNew = true) }
    }
}
