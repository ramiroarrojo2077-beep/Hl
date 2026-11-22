package ai.nexus.app.features.home

import ai.nexus.app.actions.ActionExecutor
import ai.nexus.app.actions.ExecResult
import ai.nexus.app.core.avatar.CoreSignals
import ai.nexus.app.core.avatar.CoreState
import ai.nexus.app.core.avatar.NexusCoreVisual
import ai.nexus.app.core.avatar.coreColor
import ai.nexus.app.core.avatar.coreStateOf
import ai.nexus.app.core.design.GhostButton
import ai.nexus.app.core.design.HudPanel
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.PrimaryButton
import ai.nexus.app.core.design.Tag
import ai.nexus.app.core.ui.LocalNavigate
import ai.nexus.app.core.ui.LocalSnackbar
import ai.nexus.app.core.ui.MarkdownText
import ai.nexus.app.core.ui.appContainer
import ai.nexus.app.core.ui.nexusViewModel
import ai.nexus.app.data.model.ActionDto
import ai.nexus.app.data.model.MessageDto
import ai.nexus.app.voice.WakeWordService
import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.offset
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.unit.Dp
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
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Send
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Alarm
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Hearing
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.MicOff
import androidx.compose.material.icons.outlined.RocketLaunch
import androidx.compose.material.icons.outlined.Sms
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.ThumbDown
import androidx.compose.material.icons.outlined.ThumbUp
import androidx.compose.material.icons.outlined.TravelExplore
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.withFrameNanos
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.launch

val QUICK_META: Map<String, Pair<String, ImageVector>> = mapOf(
    "whatsapp" to ("Enviar WhatsApp" to Icons.Outlined.Sms),
    "reminder" to ("Recordatorio" to Icons.Outlined.Alarm),
    "research" to ("Investigar" to Icons.Outlined.TravelExplore),
    "project" to ("Abrir proyecto" to Icons.Outlined.Folder),
    "agenda" to ("Agenda" to Icons.Outlined.CalendarMonth),
    "document" to ("Documento" to Icons.Outlined.Description),
    "memory" to ("Memoria" to Icons.Outlined.Memory),
    "mission" to ("Misión" to Icons.Outlined.RocketLaunch),
)

fun Context.findActivity(): Activity? {
    var ctx: Context? = this
    while (ctx is ContextWrapper) {
        if (ctx is Activity) return ctx
        ctx = ctx.baseContext
    }
    return null
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun HomeScreen() {
    val vm = nexusViewModel { HomeViewModel(it) }
    val s by vm.state.collectAsState()
    val c = appContainer()
    val voice = remember { c.voice() }
    val v by voice.state.collectAsState()
    val prefs by c.voicePrefs.collectAsState()
    val connection by c.realtime.state.collectAsState()
    val context = LocalContext.current
    val snackbar = LocalSnackbar.current
    val navigate = LocalNavigate.current
    val scope = rememberCoroutineScope()
    var input by rememberSaveable { mutableStateOf("") }
    var waAction by remember { mutableStateOf<ActionDto?>(null) }
    var traceFor by remember { mutableStateOf<String?>(null) }
    var attachMenu by remember { mutableStateOf(false) }
    var pickProjectFor by remember { mutableStateOf<Pair<String, Uri>?>(null) }
    val attachments = remember { mutableStateListOf<Pair<String, String>>() } // id → nombre

    LaunchedEffect(prefs) { voice.reconfigure(prefs) }
    LaunchedEffect(v.listening, v.sessionActive) { WakeWordService.pausedByApp = v.listening || v.sessionActive }

    val micPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) voice.tapMic() else scope.launch { snackbar.showSnackbar("Sin permiso de micrófono no puedo escucharte. Podés escribir.") }
    }
    fun hasMic() = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
    fun onMic() = if (hasMic()) voice.tapMic() else micPermission.launch(Manifest.permission.RECORD_AUDIO)

    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) { vm.loadProjects(); pickProjectFor = "file" to uri }
    }

    LaunchedEffect(Unit) { c.wakeSignals.collect { if (hasMic()) voice.startListening() } }
    LaunchedEffect(Unit) {
        vm.effects.collect { e ->
            when (e) {
                is HomeEffect.ExecuteDevice -> {
                    val activity = context.findActivity()
                    val a = e.action
                    if (a.actionKey == "app.open_screen") {
                        val p = a.deviceParams ?: a.params
                        val screen = (p["screen"] as? kotlinx.serialization.json.JsonPrimitive)?.content ?: "projects"
                        val id = (p["entity_id"] as? kotlinx.serialization.json.JsonPrimitive)?.content
                        navigate(when { screen == "project" && id != null -> "project/$id"; screen == "mission" && id != null -> "mission/$id"
                            screen == "project" -> "projects"; else -> screen })
                        vm.reportExecution(a, ExecResult("SCREEN_OPENED"))
                    } else if (activity != null) {
                        vm.markExecuting()
                        val result = ActionExecutor.execute(activity, a.actionKey, a.deviceParams ?: a.params)
                        vm.reportExecution(a, result)
                    }
                }
                is HomeEffect.OpenWhatsApp -> waAction = e.action
                is HomeEffect.Navigate -> navigate(e.route)
                is HomeEffect.Toast -> if (e.message.isNotBlank()) snackbar.showSnackbar(e.message)
                is HomeEffect.Prefill -> input = e.text
                is HomeEffect.Speak -> if (prefs.autoSpeak || v.sessionActive) voice.speak(e.messageId, e.text)
            }
        }
    }

    val coreState = coreStateOf(CoreSignals(
        connection = connection, serverState = s.server?.state, listening = v.listening, speaking = v.speaking,
        awaitingReply = s.awaitingReply || s.sending, executingLocal = s.executing,
        pendingConfirmations = s.pending.size + (s.server?.pendingApprovals ?: 0), recentError = s.recentError,
    ))

    val connected = connection == ai.nexus.app.core.realtime.ConnectionState.Connected
    val feed = buildFeed(s.context, s.server, s.pending.size)
    val label = coreLabel(coreState, s)
    val longPressSession = { if (hasMic()) { voice.startSession(continuous = true); vm.voiceSession(true, true) } else micPermission.launch(Manifest.permission.RECORD_AUDIO) }

    // ZONA B — núcleo holográfico con estados reales (+ voz en curso)
    val coreBlock: @Composable (Dp) -> Unit = { coreSize ->
        Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.clickable(onClickLabel = if (v.speaking) "Interrumpir a NEXUS" else "Hablar con NEXUS") { onMic() }) {
                NexusCoreVisual(coreState, size = coreSize, audioLevel = v.level, speechPulse = v.speechPulse,
                    specialists = s.server?.collaboratingAgents?.size ?: 0)
            }
            Text(label, style = MaterialTheme.typography.labelLarge, color = coreColor(coreState),
                modifier = Modifier.offset(y = (-8).dp).semantics { liveRegion = LiveRegionMode.Polite })
            if (v.listening && v.partial.isNotBlank()) {
                Text("«${v.partial}»", style = MaterialTheme.typography.bodyLarge, color = NexusColors.TextPrimary, textAlign = TextAlign.Center,
                    modifier = Modifier.padding(horizontal = 16.dp))
            }
            if (v.sessionActive) VoiceSessionBar(v.continuous, v.muted, v.listening, v.turns, prefs.volume.toFloat(),
                onMute = { voice.setMuted(!v.muted) }, onEnd = { voice.endSession(); vm.voiceSession(false, v.continuous, v.turns) },
                onVolume = { vol -> c.voicePrefs.value = prefs.copy(volume = vol.toDouble()) })
            v.error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = NexusColors.Amber, modifier = Modifier.padding(top = 4.dp)) }
        }
    }
    // Posiciones medidas (en la ventana) del final de la conversación y del área visible con scroll.
    val phoneScroll = rememberScrollState()
    val centerScroll = rememberScrollState()
    var convEndY by remember { mutableFloatStateOf(0f) }
    var viewportBottomY by remember { mutableFloatStateOf(0f) }
    // ZONA C — mensaje contextual, conversación y confirmaciones
    val assistantBlock: @Composable () -> Unit = {
        AssistantZone(s, v.speakingMessageId, prefs.subtitles, onTrace = { traceFor = it }, onFeedback = vm::feedback)
        // Ancla de seguimiento: fin de la conversación + la confirmación más reciente (no toda la pila).
        val anchor = Modifier.height(1.dp).onGloballyPositioned { convEndY = it.positionInWindow().y }
        if (s.pending.isEmpty()) Spacer(anchor)
        s.pending.forEachIndexed { i, a ->
            ActionCard(a, onConfirm = { if (a.actionKey == "whatsapp.open_chat") waAction = a else vm.confirm(a) }, onCancel = { vm.cancel(a) })
            if (i == 0) Spacer(anchor)
        }
    }
    val gap = Modifier.height(12.dp)

    // Al abrir se ve el núcleo; cuando conversás, la vista sigue al último mensaje (y a las confirmaciones)
    // para que la respuesta nunca quede fuera de pantalla detrás de la barra de voz.
    val density = LocalDensity.current.density
    var follow by remember { mutableStateOf(false) }
    var wideLayout by remember { mutableStateOf(false) }
    LaunchedEffect(s.messages.lastOrNull()?.id, s.streaming.length / 40, s.sending, s.awaitingReply, v.listening, s.pending.size) {
        if (s.sending || s.awaitingReply || v.listening) follow = true
        if (!follow) return@LaunchedEffect
        withFrameNanos { }  // esperar a que el contenido nuevo esté medido
        val scroll = if (wideLayout) centerScroll else phoneScroll
        val hidden = convEndY + 12 * density - viewportBottomY
        if (hidden > 0f) scroll.animateScrollTo((scroll.value + hidden).toInt())
    }

    BoxWithConstraints(Modifier.fillMaxSize().imePadding()) {
        val screenWidth = maxWidth
        val wide = screenWidth >= 840.dp
        SideEffect { wideLayout = wide }
        Column(Modifier.fillMaxSize()) {
            if (wide) {
                // Tablet: tres columnas como el command center de la referencia.
                SystemHeader(s.server, connected)
                Row(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Column(Modifier.weight(0.28f).verticalScroll(rememberScrollState())) {
                        CoreOverviewPanel(s.server, s.dash, prefs, label, coreColor = coreColor(coreState)); Spacer(gap)
                        MissionTimelinePanel(s.dash, navigate)
                    }
                    Column(Modifier.weight(0.44f).onGloballyPositioned { viewportBottomY = it.boundsInWindow().bottom }.verticalScroll(centerScroll), horizontalAlignment = Alignment.CenterHorizontally) {
                        coreBlock(330.dp); Spacer(gap)
                        assistantBlock(); Spacer(gap)
                        ActiveAgentsPanel(s.dash, navigate)
                    }
                    Column(Modifier.weight(0.28f).verticalScroll(rememberScrollState())) {
                        LiveFeedPanel(feed, navigate); Spacer(gap)
                        QuickCommandsPanel(s.quick, vm::quick, onEdit = { navigate("settings/jarvis") })
                    }
                }
            } else {
                Column(Modifier.weight(1f).fillMaxWidth().onGloballyPositioned { viewportBottomY = it.boundsInWindow().bottom }.verticalScroll(phoneScroll)) {
                    SystemHeader(s.server, connected)
                    coreBlock(minOf(screenWidth, 360.dp))
                    Column(Modifier.padding(horizontal = 14.dp)) {
                        assistantBlock(); Spacer(gap)
                        LiveFeedPanel(feed, navigate); Spacer(gap)
                        QuickCommandsPanel(s.quick, vm::quick, onEdit = { navigate("settings/jarvis") }); Spacer(gap)
                        CoreOverviewPanel(s.server, s.dash, prefs, label, coreColor = coreColor(coreState)); Spacer(gap)
                        ActiveAgentsPanel(s.dash, navigate); Spacer(gap)
                        MissionTimelinePanel(s.dash, navigate); Spacer(gap)
                    }
                }
            }

            // ZONA D — entrada universal: barra de voz destacada + texto + adjuntos
            TalkBar(v.listening, v.speaking, v.level, onTap = { onMic() },
                modifier = Modifier.fillMaxWidth().padding(horizontal = if (wide) 160.dp else 14.dp, vertical = 4.dp)
                    .pointerInput(Unit) { detectTapGestures(onLongPress = { longPressSession() }) })
            if (attachments.isNotEmpty()) {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    attachments.forEach { (id, name) -> Tag("📎 $name", NexusColors.Cyan, Modifier.clickable { attachments.removeAll { it.first == id } }) }
                }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Box {
                    IconButton(onClick = { attachMenu = true }, modifier = Modifier.size(48.dp)) { Icon(Icons.Outlined.Add, "Adjuntar o abrir", tint = NexusColors.Cyan) }
                    DropdownMenu(expanded = attachMenu, onDismissRequest = { attachMenu = false }) {
                        DropdownMenuItem(text = { Text("Documento") }, onClick = { attachMenu = false; filePicker.launch(arrayOf("*/*")) })
                        DropdownMenuItem(text = { Text("Imagen") }, onClick = { attachMenu = false; filePicker.launch(arrayOf("image/*")) })
                        DropdownMenuItem(text = { Text("Consultar un proyecto") }, onClick = { attachMenu = false; navigate("projects") })
                        DropdownMenuItem(text = { Text("Nueva conversación") }, onClick = { attachMenu = false; vm.newConversation() })
                    }
                }
                OutlinedTextField(
                    value = input, onValueChange = { input = it }, modifier = Modifier.weight(1f),
                    placeholder = { Text("Escribile a NEXUS…", color = NexusColors.TextMuted) }, maxLines = 4,
                    shape = RoundedCornerShape(24.dp), textStyle = MaterialTheme.typography.bodyLarge,
                    trailingIcon = {
                        if (input.isNotBlank()) IconButton(onClick = {
                            vm.send(input, attachments = attachments.map { it.first }); input = ""; attachments.clear()
                        }) { Icon(Icons.AutoMirrored.Outlined.Send, "Enviar", tint = NexusColors.Cyan) }
                    },
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = NexusColors.Cyan, unfocusedBorderColor = NexusColors.Border,
                        focusedContainerColor = NexusColors.Surface.copy(alpha = 0.85f), unfocusedContainerColor = NexusColors.Surface.copy(alpha = 0.85f),
                        focusedTextColor = NexusColors.TextPrimary, unfocusedTextColor = NexusColors.TextPrimary, cursorColor = NexusColors.Cyan),
                )
                Spacer(Modifier.width(8.dp))
                MicButton(listening = v.listening, speaking = v.speaking, onClick = { onMic() }, onLongClick = { longPressSession() })
            }
        }
    }

    waAction?.let { a -> WhatsAppSheet(a, vm, onDismiss = { waAction = null }) }
    traceFor?.let { id -> TraceSheet(id, vm, onDismiss = { traceFor = null }) }
    pickProjectFor?.let { (_, uri) ->
        ProjectPickerDialog(s.projects, onDismiss = { pickProjectFor = null }) { projectId ->
            pickProjectFor = null
            val name = displayName(context, uri)
            val mime = context.contentResolver.getType(uri)
            val bytes = runCatching { context.contentResolver.openInputStream(uri)?.use { it.readBytes() } }.getOrNull()
            if (bytes == null) scope.launch { snackbar.showSnackbar("No pude leer el archivo") }
            else vm.attach(projectId, name, mime, bytes) { id -> if (id != null) attachments += id to name }
        }
    }
}

fun displayName(context: Context, uri: Uri): String = runCatching {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { if (it.moveToFirst()) it.getString(0) else null }
}.getOrNull() ?: "archivo"

private fun coreLabel(state: CoreState, s: HomeState): String = when (state) {
    CoreState.COLLABORATING -> s.server?.collaboratingAgents?.takeIf { it.isNotEmpty() }?.let { "Consultando a ${it.joinToString { a -> a.uppercase() }}" } ?: state.label
    CoreState.WAITING_CONFIRMATION -> "Esperando tu confirmación (${s.pending.size + (s.server?.pendingApprovals ?: 0)})"
    CoreState.ERROR -> s.error ?: state.label
    else -> state.label
}.uppercase()

@Composable
private fun AssistantZone(s: HomeState, speakingId: String?, subtitles: Boolean, onTrace: (String) -> Unit, onFeedback: (String, Int) -> Unit) {
    val tail = s.messages.filter { it.messageType != "question" && it.messageType != "answer" }.takeLast(4)
    HudPanel(Modifier.fillMaxWidth()) {
        // Mensaje contextual: sale de datos reales del backend (/jarvis/context), nunca inventado.
        val ctx = s.context
        Text(ctx?.headline ?: "Hola.", style = MaterialTheme.typography.titleMedium, color = NexusColors.TextPrimary)
        val lines = ctx?.lines.orEmpty()
        if (lines.isEmpty() && tail.isEmpty()) Text("¿Qué hacemos hoy?", style = MaterialTheme.typography.bodyLarge, color = NexusColors.TextSecondary)
        lines.take(3).forEach { Text("• $it", style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextSecondary) }
        if (tail.isNotEmpty() || s.streaming.isNotBlank()) {
            Spacer(Modifier.height(10.dp))
            tail.forEach { m -> MessageLine(m, speaking = m.id == speakingId, subtitles = subtitles, advanced = s.advanced, onTrace = onTrace, onFeedback = onFeedback) }
            if (s.streaming.isNotBlank()) {
                Text("NEXUS", style = MaterialTheme.typography.labelSmall, color = NexusColors.Accent)
                MarkdownText(s.streaming)
            }
        }
        if (s.awaitingReply && s.streaming.isBlank()) {
            Text("NEXUS está pensando…", style = MaterialTheme.typography.bodySmall, color = NexusColors.Violet)
        }
    }
}

@Composable
private fun MessageLine(m: MessageDto, speaking: Boolean, subtitles: Boolean, advanced: Boolean, onTrace: (String) -> Unit, onFeedback: (String, Int) -> Unit) {
    val user = m.senderType == "user"
    val system = m.senderType == "system"
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalAlignment = if (user) Alignment.End else Alignment.Start) {
        Text(if (user) "VOS" else if (system) "SISTEMA" else "NEXUS", style = MaterialTheme.typography.labelSmall,
            color = if (user) NexusColors.TextMuted else if (system) NexusColors.Amber else NexusColors.Accent)
        if (user) Text(m.content, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextSecondary, textAlign = TextAlign.End)
        else Box(Modifier.then(if (speaking && subtitles) Modifier.border(1.dp, NexusColors.Accent.copy(alpha = 0.5f), RoundedCornerShape(8.dp)).padding(6.dp) else Modifier)) {
            MarkdownText(m.content)
        }
        if (!user && !system) Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { onFeedback(m.id, 1) }, modifier = Modifier.size(32.dp)) { Icon(Icons.Outlined.ThumbUp, "Respuesta útil", tint = NexusColors.TextMuted, modifier = Modifier.size(15.dp)) }
            IconButton(onClick = { onFeedback(m.id, -1) }, modifier = Modifier.size(32.dp)) { Icon(Icons.Outlined.ThumbDown, "Respuesta no útil", tint = NexusColors.TextMuted, modifier = Modifier.size(15.dp)) }
            if (advanced) Text("Detalle", style = MaterialTheme.typography.labelSmall, color = NexusColors.Cyan,
                modifier = Modifier.clickable { onTrace(m.id) }.padding(8.dp))
            m.modelUsed?.let { if (advanced) Text(it.substringAfter(':'), style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted) }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MicButton(listening: Boolean, speaking: Boolean, onClick: () -> Unit, onLongClick: () -> Unit) {
    val color = when { listening -> androidx.compose.ui.graphics.Color(0xFF39F5D2); speaking -> NexusColors.Amber; else -> NexusColors.Cyan }
    val label = when { speaking -> "Interrumpir a NEXUS"; listening -> "Terminar de hablar"; else -> "Hablar con NEXUS (mantené para conversación continua)" }
    Box(
        Modifier.size(60.dp).clip(CircleShape)
            .background(androidx.compose.ui.graphics.Brush.radialGradient(listOf(color.copy(alpha = 0.55f), color.copy(alpha = 0.18f), NexusColors.Background)))
            .border(2.dp, color, CircleShape).combinedClickable(onClick = onClick, onLongClick = onLongClick)
            .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(44.dp).border(1.dp, color.copy(alpha = 0.6f), CircleShape))
        Icon(when { speaking -> Icons.Outlined.Stop; listening -> Icons.Outlined.Hearing; else -> Icons.Outlined.Mic }, null,
            tint = androidx.compose.ui.graphics.Color.White, modifier = Modifier.size(26.dp))
    }
}

@Composable
private fun QuickChip(label: String, icon: ImageVector, onClick: () -> Unit) {
    Row(
        Modifier.clip(RoundedCornerShape(18.dp)).background(NexusColors.Surface).border(1.dp, NexusColors.Border, RoundedCornerShape(18.dp))
            .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = NexusColors.Accent, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(6.dp))
        Text(label, style = MaterialTheme.typography.labelMedium, color = NexusColors.TextPrimary)
    }
}

@Composable
private fun VoiceSessionBar(continuous: Boolean, muted: Boolean, listening: Boolean, turns: Int, volume: Float,
                            onMute: () -> Unit, onEnd: () -> Unit, onVolume: (Float) -> Unit) {
    HudPanel(Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(10.dp).clip(CircleShape).background(if (listening) NexusColors.Red else NexusColors.TextMuted))
            Spacer(Modifier.width(8.dp))
            Text(if (continuous) "Conversación por voz · $turns turnos" else "Sesión de voz", style = MaterialTheme.typography.labelMedium,
                color = NexusColors.TextPrimary, modifier = Modifier.weight(1f))
            Text(if (listening) "MIC ACTIVO" else if (muted) "SILENCIADO" else "EN ESPERA", style = MaterialTheme.typography.labelSmall,
                color = if (listening) NexusColors.Red else NexusColors.TextMuted)
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onMute) { Icon(if (muted) Icons.Outlined.MicOff else Icons.Outlined.Mic, if (muted) "Activar micrófono" else "Silenciar micrófono", tint = NexusColors.TextSecondary) }
            Slider(volume, onValueChange = onVolume, modifier = Modifier.weight(1f).semantics { contentDescription = "Volumen de NEXUS" },
                colors = SliderDefaults.colors(thumbColor = NexusColors.Accent, activeTrackColor = NexusColors.Accent))
            IconButton(onClick = onEnd) { Icon(Icons.Outlined.Close, "Finalizar sesión de voz", tint = NexusColors.Red) }
        }
    }
}

private val RISK_LABEL = mapOf("READ_ONLY" to "Lectura", "LOCAL_REVERSIBLE" to "Local · reversible", "EXTERNAL_COMMUNICATION" to "Comunicación externa",
    "SENSITIVE" to "Dato sensible", "IRREVERSIBLE" to "Irreversible")

fun riskColor(risk: String?): Color = when (risk) {
    "IRREVERSIBLE" -> NexusColors.Red
    "EXTERNAL_COMMUNICATION", "SENSITIVE" -> NexusColors.Amber
    else -> NexusColors.Cyan
}

@Composable
fun ActionCard(a: ActionDto, onConfirm: () -> Unit, onCancel: () -> Unit) {
    HudPanel(Modifier.fillMaxWidth().padding(top = 8.dp), accent = riskColor(a.risk)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(a.name.ifBlank { a.actionKey }, style = MaterialTheme.typography.titleSmall, color = NexusColors.TextPrimary, modifier = Modifier.weight(1f))
            Tag(RISK_LABEL[a.risk] ?: (a.risk ?: ""), riskColor(a.risk))
        }
        Text(a.summary, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextSecondary, modifier = Modifier.padding(vertical = 6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryButton(if (a.actionKey == "whatsapp.open_chat") "Revisar" else "Confirmar", onConfirm)
            GhostButton("Cancelar", onCancel, color = NexusColors.TextSecondary)
        }
    }
}

@Composable
private fun ProjectPickerDialog(projects: List<ai.nexus.app.data.model.ProjectDto>, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss, containerColor = NexusColors.Surface,
        title = { Text("¿A qué proyecto lo adjunto?") },
        text = {
            Column {
                if (projects.isEmpty()) Text("No tenés proyectos. Creá uno en Más → Proyectos para adjuntar archivos.", color = NexusColors.TextSecondary)
                projects.forEach { p ->
                    Text(p.name, color = NexusColors.TextPrimary, modifier = Modifier.fillMaxWidth().clickable { onPick(p.id) }.padding(vertical = 12.dp))
                }
            }
        },
        confirmButton = {}, dismissButton = { androidx.compose.material3.TextButton(onClick = onDismiss) { Text("Cancelar") } },
    )
}
