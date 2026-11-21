package ai.nexus.app.features.chat

import ai.nexus.app.AppContainer
import ai.nexus.app.core.avatar.AgentAvatar
import ai.nexus.app.core.design.ErrorState
import ai.nexus.app.core.design.HudPanel
import ai.nexus.app.core.design.LoadingState
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.Tag
import ai.nexus.app.core.design.parseHex
import ai.nexus.app.core.ui.LocalNavigate
import ai.nexus.app.core.ui.LocalSnackbar
import ai.nexus.app.core.ui.MarkdownText
import ai.nexus.app.core.ui.Time
import ai.nexus.app.core.ui.nexusViewModel
import ai.nexus.app.core.ui.userMessage
import ai.nexus.app.data.model.AgentDto
import ai.nexus.app.data.model.ConversationCreate
import ai.nexus.app.data.model.ConversationDto
import ai.nexus.app.data.model.MessageDto
import ai.nexus.app.data.model.ProjectDto
import ai.nexus.app.data.model.VoiceSettings
import ai.nexus.app.voice.speechIntent
import android.app.Activity
import android.net.Uri
import android.provider.OpenableColumns
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.AttachFile
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.VolumeUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

data class ChatState(
    val loading: Boolean = true,
    val error: String? = null,
    val conversations: List<ConversationDto> = emptyList(),
    val current: ConversationDto? = null,
    val messages: List<MessageDto> = emptyList(),
    val agents: Map<String, AgentDto> = emptyMap(),
    val projects: List<ProjectDto> = emptyList(),
    val streaming: String = "",
    val waiting: Boolean = false,
    val sending: Boolean = false,
)

class ChatViewModel(private val c: AppContainer, private val initialId: String?) : ViewModel() {
    private val _state = MutableStateFlow(ChatState())
    val state: StateFlow<ChatState> = _state

    init {
        load()
        viewModelScope.launch {
            c.realtime.events.collect { e ->
                val conv = _state.value.current ?: return@collect
                when (e.type) {
                    "chat.delta" -> if (e.str("conversation_id") == conv.id) {
                        _state.value = _state.value.copy(streaming = _state.value.streaming + (e.str("delta") ?: ""), waiting = true)
                    }
                    "message.created" -> if (e.str("channel") == "chat" && e.str("channel_id") == conv.id) reloadMessages(clearStream = e.str("sender_type") != "user")
                }
            }
        }
    }

    fun load() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            try {
                val convs = c.api.conversations()
                val agents = c.api.agents().associateBy { it.id }
                val current = convs.firstOrNull { it.id == initialId } ?: convs.firstOrNull { it.agentId == null }
                    ?: c.api.createConversation(ConversationCreate(title = "Chat con NEXUS"))
                _state.value = _state.value.copy(loading = false, conversations = (convs + current).distinctBy { it.id }, current = current,
                    agents = agents, projects = c.api.projects())
                reloadMessages(clearStream = true)
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = e.userMessage())
            }
        }
    }

    fun select(conv: ConversationDto) {
        _state.value = _state.value.copy(current = conv, messages = emptyList(), streaming = "", waiting = false)
        viewModelScope.launch { reloadMessages(true) }
    }

    fun newConversation(projectId: String?) {
        viewModelScope.launch {
            runCatching { c.api.createConversation(ConversationCreate(title = "Chat con NEXUS", projectId = projectId)) }.onSuccess { conv ->
                _state.value = _state.value.copy(conversations = listOf(conv) + _state.value.conversations)
                select(conv)
            }
        }
    }

    fun deleteCurrent() {
        val conv = _state.value.current ?: return
        viewModelScope.launch {
            runCatching { c.api.deleteConversation(conv.id) }
            _state.value = _state.value.copy(conversations = _state.value.conversations.filter { it.id != conv.id }, current = null)
            load()
        }
    }

    private suspend fun reloadMessages(clearStream: Boolean) {
        val conv = _state.value.current ?: return
        runCatching { c.api.conversationMessages(conv.id) }.onSuccess { msgs ->
            val answered = msgs.lastOrNull()?.senderType != "user"
            _state.value = _state.value.copy(
                messages = msgs,
                streaming = if (clearStream && answered) "" else _state.value.streaming,
                waiting = !answered,
            )
        }
    }

    fun send(text: String, attachmentIds: List<String> = emptyList(), onError: (String) -> Unit) {
        val conv = _state.value.current ?: return
        if (text.isBlank()) return
        viewModelScope.launch {
            _state.value = _state.value.copy(sending = true, streaming = "")
            try {
                val msg = c.api.sendMessage(conv.id, text.trim(), attachmentIds)
                _state.value = _state.value.copy(messages = _state.value.messages + msg, waiting = true, sending = false)
            } catch (e: Exception) {
                _state.value = _state.value.copy(sending = false)
                onError(e.userMessage())
            }
        }
    }

    fun attach(projectId: String, name: String, mime: String?, bytes: ByteArray, onResult: (String?, String?) -> Unit) {
        viewModelScope.launch {
            try {
                val f = c.api.uploadFile(projectId, name, mime, bytes)
                onResult(f.id, null)
            } catch (e: Exception) {
                onResult(null, e.userMessage())
            }
        }
    }

    fun speak(text: String, voice: VoiceSettings): Boolean = c.tts.speak(text, voice)
}

@Composable
fun ChatScreen(conversationId: String?) {
    val vm = nexusViewModel(key = "chat-$conversationId") { ChatViewModel(it, conversationId) }
    val s by vm.state.collectAsState()
    when {
        s.loading -> LoadingState()
        s.error != null -> ErrorState(s.error!!, vm::load)
        else -> ChatContent(s, vm)
    }
}

@Composable
private fun ChatContent(s: ChatState, vm: ChatViewModel) {
    val snackbar = LocalSnackbar.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val navigate = LocalNavigate.current
    var input by remember { mutableStateOf("") }
    var pendingAttachments by remember { mutableStateOf(listOf<Pair<String, String>>()) }
    val listState = rememberLazyListState()
    val conv = s.current
    val agent = conv?.agentId?.let { s.agents[it] } ?: s.agents.values.firstOrNull { it.slug == "nexus" }

    LaunchedEffect(s.messages.size, s.streaming.length) {
        val count = s.messages.size + if (s.streaming.isNotEmpty() || s.waiting) 1 else 0
        if (count > 0) listState.animateScrollToItem(count - 1)
    }
    val voiceLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        val text = r.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (r.resultCode == Activity.RESULT_OK && !text.isNullOrBlank()) input = if (input.isBlank()) text else "$input $text"
    }
    val fileLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        val projectId = conv?.projectId ?: s.projects.firstOrNull()?.id
        if (projectId == null) {
            scope.launch { snackbar.showSnackbar("Para adjuntar archivos creá primero un proyecto: los archivos se guardan en su espacio.") }
            return@rememberLauncherForActivityResult
        }
        val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        } ?: "archivo"
        val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return@rememberLauncherForActivityResult
        vm.attach(projectId, name, context.contentResolver.getType(uri), bytes) { id, err ->
            if (id != null) pendingAttachments = pendingAttachments + (id to name) else scope.launch { snackbar.showSnackbar(err ?: "Error") }
        }
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp, vertical = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
            s.conversations.forEach { c ->
                val active = c.id == conv?.id
                val who = c.agentId?.let { s.agents[it]?.name } ?: "NEXUS"
                Text(
                    "$who · ${c.title.take(22)}",
                    Modifier.clip(RoundedCornerShape(10.dp)).background(if (active) NexusColors.Cyan.copy(alpha = 0.15f) else NexusColors.BackgroundAlt)
                        .border(1.dp, if (active) NexusColors.Cyan else Color(0x22FFFFFF), RoundedCornerShape(10.dp))
                        .clickable { vm.select(c) }.padding(horizontal = 10.dp, vertical = 6.dp),
                    style = MaterialTheme.typography.labelSmall, color = if (active) NexusColors.Cyan else NexusColors.TextSecondary,
                )
            }
            IconButton(onClick = { vm.newConversation(conv?.projectId) }) { Icon(Icons.Outlined.Add, "Nueva conversación", tint = NexusColors.Cyan) }
            IconButton(onClick = vm::deleteCurrent) { Icon(Icons.Outlined.Delete, "Borrar conversación", tint = NexusColors.TextMuted) }
        }
        LazyColumn(Modifier.weight(1f).fillMaxWidth(), state = listState, contentPadding = androidx.compose.foundation.layout.PaddingValues(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (s.messages.isEmpty() && !s.waiting) item {
                HudPanel(Modifier.fillMaxWidth(), title = "Chat con ${agent?.name ?: "NEXUS"}") {
                    Text("Pedile a NEXUS un objetivo: puede responder directamente, consultar a otros agentes, crear una misión, " +
                        "convocar una reunión o buscar en la memoria. Todo lo que ves acá es generado por los modelos configurados.",
                        style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
                }
            }
            items(s.messages, key = { it.id }) { m -> MessageBubble(m, s.agents, vm, navigate) }
            if (s.streaming.isNotEmpty() || s.waiting) item {
                Row(verticalAlignment = Alignment.Top) {
                    agent?.let { AgentAvatar(it.profile.appearance, "thinking", 34.dp) }
                    Spacer(Modifier.width(8.dp))
                    Column(Modifier.clip(RoundedCornerShape(14.dp)).background(NexusColors.Surface).padding(12.dp)) {
                        if (s.streaming.isEmpty()) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp, color = NexusColors.Violet)
                                Spacer(Modifier.width(8.dp))
                                Text("${agent?.name ?: "NEXUS"} está pensando…", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
                            }
                        } else MarkdownText(s.streaming + " ▍")
                    }
                }
            }
        }
        if (pendingAttachments.isNotEmpty()) {
            Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                pendingAttachments.forEach { (_, name) -> Tag("📎 $name", NexusColors.Cyan) }
            }
        }
        Row(Modifier.fillMaxWidth().padding(10.dp), verticalAlignment = Alignment.Bottom) {
            IconButton(onClick = { fileLauncher.launch(arrayOf("*/*")) }) { Icon(Icons.Outlined.AttachFile, "Adjuntar", tint = NexusColors.TextSecondary) }
            OutlinedTextField(
                input, { input = it }, Modifier.weight(1f), placeholder = { Text("Escribile a ${agent?.name ?: "NEXUS"}…") },
                maxLines = 5, shape = RoundedCornerShape(16.dp),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = NexusColors.Cyan, unfocusedBorderColor = NexusColors.Border, cursorColor = NexusColors.Cyan),
            )
            IconButton(onClick = {
                try { voiceLauncher.launch(speechIntent()) } catch (_: Exception) {
                    scope.launch { snackbar.showSnackbar("Reconocimiento de voz no disponible en este dispositivo") }
                }
            }) { Icon(Icons.Outlined.Mic, "Dictar", tint = NexusColors.TextSecondary) }
            IconButton(enabled = input.isNotBlank() && !s.sending, onClick = {
                vm.send(input, pendingAttachments.map { it.first }) { err -> scope.launch { snackbar.showSnackbar(err) } }
                input = ""; pendingAttachments = emptyList()
            }) { Icon(Icons.AutoMirrored.Outlined.Send, "Enviar", tint = if (input.isNotBlank()) NexusColors.Cyan else NexusColors.TextMuted) }
        }
    }
}

@Composable
private fun MessageBubble(m: MessageDto, agents: Map<String, AgentDto>, vm: ChatViewModel, navigate: (String) -> Unit) {
    val snackbar = LocalSnackbar.current
    val scope = rememberCoroutineScope()
    if (m.senderType == "user") {
        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.CenterEnd) {
            Column(Modifier.widthIn(max = 520.dp).clip(RoundedCornerShape(16.dp, 4.dp, 16.dp, 16.dp)).background(NexusColors.Cyan.copy(alpha = 0.16f))
                .border(1.dp, NexusColors.Cyan.copy(alpha = 0.3f), RoundedCornerShape(16.dp, 4.dp, 16.dp, 16.dp)).padding(12.dp)) {
                Text(m.content, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextPrimary)
                Text(Time.clock(m.createdAt), style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted, modifier = Modifier.align(Alignment.End))
            }
        }
        return
    }
    val agent = m.senderAgentId?.let { agents[it] }
    val isError = m.senderType == "system"
    val internal = m.messageType == "question" || m.messageType == "answer"
    val accent = if (isError) NexusColors.Red else parseHex(agent?.profile?.appearance?.accent)
    Row(verticalAlignment = Alignment.Top, modifier = Modifier.padding(start = if (internal) 24.dp else 0.dp)) {
        if (agent != null) AgentAvatar(agent.profile.appearance, "idle", if (internal) 28.dp else 34.dp)
        Spacer(Modifier.width(8.dp))
        Column(Modifier.widthIn(max = 620.dp).clip(RoundedCornerShape(4.dp, 16.dp, 16.dp, 16.dp)).background(NexusColors.Surface)
            .border(1.dp, accent.copy(alpha = 0.3f), RoundedCornerShape(4.dp, 16.dp, 16.dp, 16.dp)).padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (isError) "SISTEMA" else agent?.name ?: "Agente", style = MaterialTheme.typography.labelMedium, color = accent)
                if (internal) {
                    val to = m.recipientAgentId?.let { agents[it]?.name }
                    Text(if (m.messageType == "question") "  → consulta a $to" else "  → responde a $to", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
                }
                Spacer(Modifier.weight(1f))
                if (!isError && agent != null) {
                    Icon(Icons.Outlined.VolumeUp, "Leer en voz alta", tint = NexusColors.TextMuted, modifier = Modifier.size(18.dp).clickable {
                        if (!vm.speak(m.content, agent.profile.voice)) scope.launch { snackbar.showSnackbar("Voz desactivada o motor TTS no disponible") }
                    })
                }
            }
            Spacer(Modifier.height(4.dp))
            MarkdownText(m.content, color = if (isError) NexusColors.Red else NexusColors.TextPrimary)
            val consulted = (m.meta["consulted_agents"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()
            val tools = (m.meta["tools_used"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()
            if (consulted.isNotEmpty() || tools.isNotEmpty() || m.modelUsed != null) {
                Spacer(Modifier.height(6.dp))
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    consulted.forEach { Tag("Incorporó información de ${it.uppercase()}", NexusColors.Pink) }
                    tools.distinct().forEach { t ->
                        if (t == "missions.create") Tag("Creó una misión ›", NexusColors.Violet, Modifier.clickable { navigate("missions") }) else Tag(t)
                    }
                    m.modelUsed?.let { Tag(it) }
                }
            }
            Text(Time.clock(m.createdAt), style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted, modifier = Modifier.align(Alignment.End))
        }
    }
}
