package ai.nexus.app.features.meetings

import ai.nexus.app.AppContainer
import ai.nexus.app.core.avatar.AgentAvatar
import ai.nexus.app.core.avatar.AgentFigure
import ai.nexus.app.core.design.EmptyState
import ai.nexus.app.core.design.ErrorState
import ai.nexus.app.core.design.GhostButton
import ai.nexus.app.core.design.HudPanel
import ai.nexus.app.core.design.LoadingState
import ai.nexus.app.core.design.MultiSelectChips
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.NexusTextField
import ai.nexus.app.core.design.PrimaryButton
import ai.nexus.app.core.design.SectionLabel
import ai.nexus.app.core.design.SelectChips
import ai.nexus.app.core.design.StatusChip
import ai.nexus.app.core.design.Tag
import ai.nexus.app.core.design.parseHex
import ai.nexus.app.core.ui.LoadViewModel
import ai.nexus.app.core.ui.LocalNavigate
import ai.nexus.app.core.ui.LocalSnackbar
import ai.nexus.app.core.ui.MarkdownText
import ai.nexus.app.core.ui.Time
import ai.nexus.app.core.ui.money
import ai.nexus.app.core.ui.nexusViewModel
import ai.nexus.app.core.ui.userMessage
import ai.nexus.app.data.model.AgentDto
import ai.nexus.app.data.model.MeetingCreate
import ai.nexus.app.data.model.MeetingDetailDto
import ai.nexus.app.data.model.MeetingDto
import ai.nexus.app.data.model.ProjectDto
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

val MEETING_TYPES = listOf("planning" to "Planificación", "research" to "Investigación", "technical" to "Técnica", "review" to "Revisión",
    "problem_solving" to "Resolución de problemas", "evaluation" to "Evaluación")

class MeetingsViewModel(private val c: AppContainer) : LoadViewModel<List<MeetingDto>>() {
    init {
        refresh()
        viewModelScope.launch { c.realtime.events.collect { if (it.type == "meeting.updated") refresh() } }
    }
    fun refresh() = load { c.api.meetings() }
}

@Composable
fun MeetingsScreen() {
    val vm = nexusViewModel { MeetingsViewModel(it) }
    val state by vm.state.collectAsState()
    val navigate = LocalNavigate.current
    Box(Modifier.fillMaxSize()) {
        val data = state.data
        when {
            state.isInitialLoading -> LoadingState()
            data == null -> ErrorState(state.error ?: "", vm::refresh)
            else -> LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp, 8.dp, 14.dp, 90.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item {
                    Text("Meetings", style = MaterialTheme.typography.headlineSmall, color = NexusColors.TextPrimary)
                    Row(Modifier.horizontalScroll(rememberScrollState()).padding(vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("memory" to "Memory", "activity" to "Activity", "projects" to "Projects", "settings" to "Settings").forEach { (r, l) ->
                            GhostButton(l, { navigate(r) }, color = NexusColors.TextSecondary)
                        }
                    }
                }
                if (data.isEmpty()) item {
                    EmptyState("Sin reuniones", "Convocá a los agentes para planificar, investigar o revisar un tema. Cada intervención es una ejecución real de su modelo.",
                        icon = Icons.Outlined.Groups)
                }
                val active = data.filter { it.status in setOf("scheduled", "running", "summarizing") }
                if (active.isNotEmpty()) item { SectionLabel("Activas") }
                items(active, key = { it.id }) { MeetingCard(it) { navigate("meeting/${it.id}") } }
                val past = data - active.toSet()
                if (past.isNotEmpty()) item { SectionLabel("Anteriores") }
                items(past, key = { it.id }) { MeetingCard(it) { navigate("meeting/${it.id}") } }
            }
        }
        ExtendedFloatingActionButton(onClick = { navigate("meeting/new") }, containerColor = NexusColors.Cyan, contentColor = NexusColors.Background,
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp), icon = { Icon(Icons.Outlined.Add, null) }, text = { Text("Convocar") })
    }
}

@Composable
private fun MeetingCard(m: MeetingDto, onClick: () -> Unit) {
    HudPanel(Modifier.fillMaxWidth(), onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(m.topic, style = MaterialTheme.typography.titleMedium, color = NexusColors.TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${MEETING_TYPES.firstOrNull { it.first == m.meetingType }?.second ?: m.meetingType} · ronda ${m.currentRound}/${m.maxRounds} · ${Time.relative(m.createdAt)}",
                    style = MaterialTheme.typography.labelSmall, color = NexusColors.TextSecondary)
            }
            StatusChip(m.status)
        }
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { m.participants.forEach { Tag(it.name, if (it.role == "moderator") NexusColors.Cyan else NexusColors.TextSecondary) } }
        m.summary?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis) }
    }
}

class CreateMeetingViewModel(private val c: AppContainer) : ViewModel() {
    val agents = MutableStateFlow<List<AgentDto>>(emptyList())
    val projects = MutableStateFlow<List<ProjectDto>>(emptyList())
    init {
        viewModelScope.launch {
            runCatching { agents.value = c.api.agents().filter { it.slug != "nexus" && it.isEnabled && it.participatesInMeetings } }
            runCatching { projects.value = c.api.projects() }
        }
    }
    fun create(body: MeetingCreate, done: (String?, String?) -> Unit) {
        viewModelScope.launch { try { done(c.api.createMeeting(body).id, null) } catch (e: Exception) { done(null, e.userMessage()) } }
    }
}

@Composable
fun CreateMeetingScreen(onCreated: (String) -> Unit) {
    val vm = nexusViewModel { CreateMeetingViewModel(it) }
    val agents by vm.agents.collectAsState()
    val projects by vm.projects.collectAsState()
    val snackbar = LocalSnackbar.current
    val scope = rememberCoroutineScope()
    var topic by rememberSaveable { mutableStateOf("") }
    var objective by rememberSaveable { mutableStateOf("") }
    var context by rememberSaveable { mutableStateOf("") }
    var expected by rememberSaveable { mutableStateOf("") }
    var type by rememberSaveable { mutableStateOf("planning") }
    var rounds by rememberSaveable { mutableStateOf("2") }
    var minutes by rememberSaveable { mutableStateOf("15") }
    var budget by rememberSaveable { mutableStateOf("") }
    var project by rememberSaveable { mutableStateOf<String?>(null) }
    var participants by remember { mutableStateOf(setOf<String>()) }
    var sending by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp)) {
        HudPanel(Modifier.fillMaxWidth(), title = "Convocar reunión") {
            Text("NEXUS modera: abre la reunión, cada participante interviene y al final se redacta el acta con decisiones, desacuerdos y tareas derivadas. " +
                "La reunión respeta el máximo de rondas, de tiempo y de presupuesto.", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
            Spacer(Modifier.height(10.dp))
            NexusTextField(topic, { topic = it }, "Tema")
            Spacer(Modifier.height(6.dp))
            NexusTextField(objective, { objective = it }, "Objetivo de la reunión", singleLine = false, minLines = 2)
            Spacer(Modifier.height(6.dp))
            NexusTextField(context, { context = it }, "Información disponible (opcional)", singleLine = false, minLines = 2)
            Spacer(Modifier.height(6.dp))
            NexusTextField(expected, { expected = it }, "Resultados esperados (opcional)", singleLine = false)
            SectionLabel("Tipo")
            SelectChips(MEETING_TYPES, type, { type = it })
            SectionLabel("Participantes (además de NEXUS)")
            MultiSelectChips(agents.map { it.slug to it.name }, participants, { s -> participants = if (s in participants) participants - s else participants + s })
            SectionLabel("Límites")
            SelectChips((1..6).map { "$it" to "$it rondas" }, rounds, { rounds = it })
            Spacer(Modifier.height(6.dp))
            SelectChips(listOf("5", "15", "30", "60").map { it to "$it min" }, minutes, { minutes = it })
            Spacer(Modifier.height(6.dp))
            NexusTextField(budget, { budget = it }, "Presupuesto USD (opcional)")
            if (projects.isNotEmpty()) {
                SectionLabel("Proyecto")
                SelectChips(listOf("" to "Ninguno") + projects.map { it.id to it.name }, project ?: "", { project = it.ifEmpty { null } })
            }
            Spacer(Modifier.height(14.dp))
            PrimaryButton("Iniciar reunión", {
                if (topic.isBlank() || objective.length < 3 || participants.isEmpty()) {
                    scope.launch { snackbar.showSnackbar("Indicá tema, objetivo y al menos un participante") }; return@PrimaryButton
                }
                sending = true
                vm.create(MeetingCreate(topic.trim(), objective.trim(), type, participants.toList(), rounds.toInt(), minutes.toInt() * 60,
                    budget.trim().ifEmpty { null }, project, context.trim().ifEmpty { null }, expected.trim().ifEmpty { null })) { id, err ->
                    sending = false
                    if (id != null) onCreated(id) else scope.launch { snackbar.showSnackbar(err ?: "Error") }
                }
            }, Modifier.fillMaxWidth(), loading = sending, icon = Icons.Outlined.Groups)
        }
    }
}

data class MeetingBundle(val meeting: MeetingDetailDto, val agents: Map<String, AgentDto>)

class MeetingDetailViewModel(private val c: AppContainer, private val id: String) : LoadViewModel<MeetingBundle>() {
    init {
        refresh()
        viewModelScope.launch {
            c.realtime.events.collect { e ->
                if ((e.type == "message.created" && e.str("channel_id") == id) || (e.type == "meeting.updated" && e.str("id") == id) || e.type == "agent.status") refresh()
            }
        }
    }
    fun refresh() = load { MeetingBundle(c.api.meeting(id), c.api.agents().associateBy { it.id }) }
    fun cancel(done: (String?) -> Unit) = action(done, "Reunión cancelada") { c.api.cancelMeeting(id); refresh() }
    fun toMission(onRoute: (String) -> Unit, done: (String?) -> Unit) = action(done) { onRoute("mission/${c.api.missionFromMeeting(id).id}") }
}

private val TYPE_TAGS = mapOf("proposal" to ("PROPUESTA" to NexusColors.Cyan), "question" to ("PREGUNTA" to NexusColors.Violet),
    "objection" to ("OBJECIÓN" to NexusColors.Red), "agreement" to ("ACUERDO" to NexusColors.Green), "result" to ("DATO" to NexusColors.Amber),
    "clarification" to ("ACLARACIÓN" to NexusColors.Pink), "moderation" to ("MODERACIÓN" to NexusColors.TextSecondary), "summary" to ("ACTA" to NexusColors.Green))

@Composable
fun MeetingDetailScreen(id: String) {
    val vm = nexusViewModel(key = "meeting-$id") { MeetingDetailViewModel(it, id) }
    val state by vm.state.collectAsState()
    val snackbar = LocalSnackbar.current
    val navigate = LocalNavigate.current
    val scope = rememberCoroutineScope()
    val toast: (String?) -> Unit = { msg -> if (msg != null) scope.launch { snackbar.showSnackbar(msg) } }
    val b = state.data
    when {
        state.isInitialLoading -> LoadingState()
        b == null -> ErrorState(state.error ?: "", vm::refresh)
        else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp)) {
            val m = b.meeting
            HudPanel(Modifier.fillMaxWidth()) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(m.topic, style = MaterialTheme.typography.headlineSmall, color = NexusColors.TextPrimary, modifier = Modifier.weight(1f))
                    StatusChip(m.status)
                }
                Text(m.objective, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextSecondary)
                Text("Ronda ${m.currentRound}/${m.maxRounds} · ${money(m.spentUsd)}${m.stopReason?.let { " · $it" } ?: ""}",
                    style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
                Spacer(Modifier.height(10.dp))
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    m.participants.forEach { p ->
                        val agent = b.agents[p.agentId]
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            if (agent != null) AgentFigure(agent.profile.appearance, agent.status, Modifier.size(64.dp, 100.dp))
                            Text(p.name, style = MaterialTheme.typography.labelSmall, color = if (p.role == "moderator") NexusColors.Cyan else NexusColors.TextPrimary)
                            Text("${p.turnsTaken} interv.", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
                        }
                    }
                }
                if (m.status in setOf("scheduled", "running")) {
                    Spacer(Modifier.height(8.dp))
                    GhostButton("Cancelar reunión", { vm.cancel(toast) }, Modifier.fillMaxWidth(), color = NexusColors.Red)
                }
            }
            Spacer(Modifier.height(10.dp))
            HudPanel(Modifier.fillMaxWidth(), title = "Conversación") {
                if (m.messages.isEmpty()) Text("Esperando la primera intervención…", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
                var lastRound = -1
                m.messages.forEach { msg ->
                    if (msg.turn != null && msg.turn != lastRound) {
                        lastRound = msg.turn
                        Text("— RONDA ${msg.turn} —", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted, modifier = Modifier.padding(vertical = 6.dp))
                    }
                    val agent = msg.senderAgentId?.let { b.agents[it] }
                    val (tag, color) = TYPE_TAGS[msg.messageType] ?: ("MENSAJE" to NexusColors.TextSecondary)
                    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
                        agent?.let { AgentAvatar(it.profile.appearance, "idle", 32.dp) }
                        Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(NexusColors.Background.copy(alpha = 0.5f))
                            .border(1.dp, parseHex(agent?.profile?.appearance?.accent).copy(alpha = 0.3f), RoundedCornerShape(12.dp)).padding(10.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(agent?.name ?: "NEXUS", style = MaterialTheme.typography.labelMedium, color = parseHex(agent?.profile?.appearance?.accent))
                                Spacer(Modifier.width(6.dp)); Tag(tag, color)
                                Spacer(Modifier.weight(1f))
                                Text(Time.clock(msg.createdAt), style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
                            }
                            MarkdownText(msg.content.replace(Regex("^\\s*\\[[A-ZÁÉÍÓÚ]+\\]\\s*"), ""))
                        }
                    }
                }
            }
            if (m.status == "completed") {
                Spacer(Modifier.height(10.dp))
                Outcome(m.outcome, onMission = { vm.toMission(navigate, toast) })
            }
            Spacer(Modifier.height(30.dp))
        }
    }
}

@Composable
private fun Outcome(o: JsonObject, onMission: () -> Unit) {
    fun list(k: String) = (o[k] as? JsonArray).orEmpty()
    HudPanel(Modifier.fillMaxWidth(), title = "Conclusiones", accent = NexusColors.Green) {
        Text((o["summary"] as? JsonPrimitive)?.contentOrNull ?: "", style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextPrimary)
        SectionLabel("Decisiones")
        list("decisions").forEach { Text("✓ ${(it as? JsonPrimitive)?.contentOrNull}", style = MaterialTheme.typography.bodySmall, color = NexusColors.Green) }
        if (list("arguments").isNotEmpty()) {
            SectionLabel("Argumentos")
            list("arguments").forEach { a ->
                val obj = a as? JsonObject ?: return@forEach
                Text("• ${(obj["agent"] as? JsonPrimitive)?.contentOrNull?.uppercase()}: ${(obj["point"] as? JsonPrimitive)?.contentOrNull}", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
            }
        }
        if (list("disagreements").isNotEmpty()) {
            SectionLabel("Desacuerdos")
            list("disagreements").forEach { Text("≠ ${(it as? JsonPrimitive)?.contentOrNull}", style = MaterialTheme.typography.bodySmall, color = NexusColors.Amber) }
        }
        SectionLabel("Tareas derivadas y responsables")
        val tasks = list("derived_tasks")
        if (tasks.isEmpty()) Text("Ninguna.", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
        tasks.forEach { t ->
            val obj = t as? JsonObject ?: return@forEach
            Text("→ ${(obj["title"] as? JsonPrimitive)?.contentOrNull} (${(obj["agent"] as? JsonPrimitive)?.contentOrNull?.uppercase()})",
                style = MaterialTheme.typography.bodySmall, color = NexusColors.Cyan)
        }
        SectionLabel("Próximos pasos")
        list("next_steps").forEach { Text("• ${(it as? JsonPrimitive)?.contentOrNull}", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextPrimary) }
        if (tasks.isNotEmpty()) {
            Spacer(Modifier.height(10.dp))
            PrimaryButton("Convertir en misión", onMission, Modifier.fillMaxWidth())
        }
    }
}
