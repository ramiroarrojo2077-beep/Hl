package ai.nexus.app.features.missions

import ai.nexus.app.AppContainer
import ai.nexus.app.core.avatar.AgentAvatar
import ai.nexus.app.core.design.ConfirmDialog
import ai.nexus.app.core.design.EmptyState
import ai.nexus.app.core.design.ErrorState
import ai.nexus.app.core.design.GhostButton
import ai.nexus.app.core.design.HudPanel
import ai.nexus.app.core.design.HudProgress
import ai.nexus.app.core.design.KeyValue
import ai.nexus.app.core.design.LoadingState
import ai.nexus.app.core.design.Mono
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.NexusTextField
import ai.nexus.app.core.design.PrimaryButton
import ai.nexus.app.core.design.SectionLabel
import ai.nexus.app.core.design.SelectChips
import ai.nexus.app.core.design.StatusChip
import ai.nexus.app.core.design.Tag
import ai.nexus.app.core.design.statusStyle
import ai.nexus.app.core.ui.LoadViewModel
import ai.nexus.app.core.ui.LocalNavigate
import ai.nexus.app.core.ui.LocalSnackbar
import ai.nexus.app.core.ui.MarkdownText
import ai.nexus.app.core.ui.Time
import ai.nexus.app.core.ui.money
import ai.nexus.app.core.ui.nexusViewModel
import ai.nexus.app.core.ui.userMessage
import ai.nexus.app.data.model.AgentDto
import ai.nexus.app.data.model.AttemptDto
import ai.nexus.app.data.model.MessageDto
import ai.nexus.app.data.model.MissionCreate
import ai.nexus.app.data.model.MissionDetailDto
import ai.nexus.app.data.model.MissionDto
import ai.nexus.app.data.model.MissionPatch
import ai.nexus.app.data.model.ProjectDto
import ai.nexus.app.data.model.TaskDto
import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.layout.offset
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
import androidx.compose.material.icons.outlined.Cancel
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.RocketLaunch
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject

// ============================================================ lista

data class MissionsData(val missions: List<MissionDto>, val agents: Map<String, AgentDto>)

class MissionsViewModel(private val c: AppContainer) : LoadViewModel<MissionsData>() {
    var filter = mutableStateOf("all")

    init {
        viewModelScope.launch {
            val cached = c.cached("missions", ListSerializer(MissionDto.serializer()))
            if (cached != null) seed(MissionsData(cached, emptyMap()))
        }
        refresh()
        viewModelScope.launch {
            c.realtime.events.collect { e -> if (e.type in setOf("mission.updated", "task.updated")) refresh() }
        }
    }

    fun refresh() = load {
        val status = when (filter.value) {
            "active" -> "planning,running,reviewing,consolidating"
            "pending" -> "awaiting_approval,paused,blocked"
            "done" -> "completed"
            "failed" -> "failed,cancelled"
            else -> null
        }
        val missions = c.api.missions(status)
        if (status == null) c.store("missions", ListSerializer(MissionDto.serializer()), missions)
        MissionsData(missions, c.api.agents().associateBy { it.id })
    }
}

@Composable
fun MissionsScreen() {
    val vm = nexusViewModel { MissionsViewModel(it) }
    val state by vm.state.collectAsState()
    val navigate = LocalNavigate.current
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Column(Modifier.padding(horizontal = 14.dp, vertical = 8.dp)) {
                Text("Mission Center", style = MaterialTheme.typography.headlineSmall, color = NexusColors.TextPrimary)
                Spacer(Modifier.height(8.dp))
                Row(Modifier.horizontalScroll(rememberScrollState())) {
                    SelectChips(listOf("all" to "Todas", "active" to "En curso", "pending" to "Pendientes", "done" to "Completadas", "failed" to "Fallidas/canceladas"),
                        vm.filter.value, { vm.filter.value = it; vm.refresh() })
                }
            }
            val data = state.data
            when {
                state.isInitialLoading -> LoadingState()
                data == null -> ErrorState(state.error ?: "", vm::refresh)
                data.missions.isEmpty() -> EmptyState("Sin misiones", "Creá una misión: NEXUS analizará el objetivo, armará el plan y coordinará al equipo.",
                    icon = Icons.Outlined.RocketLaunch, action = { PrimaryButton("Nueva misión", { navigate("mission/new") }) })
                else -> LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp, 0.dp, 14.dp, 90.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(data.missions, key = { it.id }) { m -> MissionCard(m, data.agents) { navigate("mission/${m.id}") } }
                }
            }
        }
        ExtendedFloatingActionButton(onClick = { navigate("mission/new") }, containerColor = NexusColors.Cyan, contentColor = NexusColors.Background,
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp), icon = { Icon(Icons.Outlined.Add, null) }, text = { Text("Nueva misión") })
    }
}

@Composable
private fun MissionCard(m: MissionDto, agents: Map<String, AgentDto>, onClick: () -> Unit) {
    val color = statusStyle(m.status).color
    HudPanel(Modifier.fillMaxWidth(), accent = color, onClick = onClick) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(m.title, style = MaterialTheme.typography.titleMedium, color = NexusColors.TextPrimary, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            StatusChip(m.status)
        }
        Text(m.objective, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(8.dp))
        HudProgress(m.progress.toFloat(), color = color)
        Spacer(Modifier.height(8.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(horizontalArrangement = Arrangement.spacedBy((-8).dp), modifier = Modifier.weight(1f)) {
                m.agentIds.mapNotNull { agents[it] }.take(6).forEach { AgentAvatar(it.profile.appearance, it.status, 26.dp) }
            }
            val total = m.taskCounts.values.sum()
            val done = (m.taskCounts["completed"] ?: 0) + (m.taskCounts["skipped"] ?: 0)
            Text("$done/$total tareas · ${Time.elapsed(m.startedAt ?: m.createdAt, m.completedAt)} · ${money(m.spentUsd)}",
                style = MaterialTheme.typography.labelSmall.copy(fontFamily = Mono), color = NexusColors.TextSecondary)
        }
        if (m.statusReason != null && m.status !in setOf("completed", "running")) {
            Text(m.statusReason, style = MaterialTheme.typography.labelSmall, color = color, maxLines = 2)
        }
    }
}

// ============================================================ crear

class CreateMissionViewModel(private val c: AppContainer) : ViewModel() {
    val projects = MutableStateFlow<List<ProjectDto>>(emptyList())
    init { viewModelScope.launch { runCatching { c.api.projects() }.onSuccess { projects.value = it } } }

    fun create(body: MissionCreate, onDone: (String?, String?) -> Unit) {
        viewModelScope.launch {
            try { onDone(c.api.createMission(body).id, null) } catch (e: Exception) { onDone(null, e.userMessage()) }
        }
    }
}

@Composable
fun CreateMissionScreen(projectId: String?, onCreated: (String) -> Unit) {
    val vm = nexusViewModel { CreateMissionViewModel(it) }
    val projects by vm.projects.collectAsState()
    val snackbar = LocalSnackbar.current
    val scope = rememberCoroutineScope()
    var title by rememberSaveable { mutableStateOf("") }
    var objective by rememberSaveable { mutableStateOf("") }
    var description by rememberSaveable { mutableStateOf("") }
    var project by rememberSaveable { mutableStateOf(projectId) }
    var priority by rememberSaveable { mutableStateOf("3") }
    var budget by rememberSaveable { mutableStateOf("") }
    var mode by rememberSaveable { mutableStateOf("default") }
    var sending by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp)) {
        HudPanel(Modifier.fillMaxWidth(), title = "Nueva misión") {
            Text("NEXUS analiza el objetivo, decide si investigar, arma un plan de tareas con dependencias, asigna agentes y supervisa. " +
                "ORACLE revisa la calidad y GUARDIAN audita la seguridad antes de entregarte el resultado.",
                style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
            Spacer(Modifier.height(10.dp))
            NexusTextField(title, { title = it }, "Nombre")
            Spacer(Modifier.height(6.dp))
            NexusTextField(objective, { objective = it }, "Objetivo", singleLine = false, minLines = 3)
            Spacer(Modifier.height(6.dp))
            NexusTextField(description, { description = it }, "Detalle / contexto (opcional)", singleLine = false, minLines = 2)
            SectionLabel("Proyecto")
            SelectChips(listOf("" to "Ninguno") + projects.map { it.id to it.name }, project ?: "", { project = it.ifEmpty { null } })
            SectionLabel("Prioridad")
            SelectChips((1..5).map { "$it" to if (it == 1) "1 · máxima" else "$it" }, priority, { priority = it })
            SectionLabel("Autonomía")
            SelectChips(listOf("default" to "Según ajustes", "manual" to "Manual (aprobar plan)", "supervised" to "Supervisada", "scheduled" to "Programada"), mode, { mode = it })
            Spacer(Modifier.height(6.dp))
            NexusTextField(budget, { budget = it }, "Presupuesto USD (opcional)")
            Spacer(Modifier.height(14.dp))
            PrimaryButton("Lanzar misión", {
                if (title.isBlank() || objective.length < 3) { scope.launch { snackbar.showSnackbar("Completá nombre y objetivo") }; return@PrimaryButton }
                sending = true
                vm.create(MissionCreate(title.trim(), objective.trim(), description.trim().ifEmpty { null }, project, priority.toInt(),
                    budget.trim().ifEmpty { null }, mode.takeIf { it != "default" })) { id, err ->
                    sending = false
                    if (id != null) onCreated(id) else scope.launch { snackbar.showSnackbar(err ?: "Error") }
                }
            }, Modifier.fillMaxWidth(), loading = sending, icon = Icons.Outlined.RocketLaunch)
        }
    }
}

// ============================================================ detalle

data class MissionBundle(val mission: MissionDetailDto, val messages: List<MessageDto>, val agents: Map<String, AgentDto>)

class MissionDetailViewModel(private val c: AppContainer, private val id: String) : LoadViewModel<MissionBundle>() {
    private val _attempts = MutableStateFlow<List<AttemptDto>>(emptyList())
    val attempts: StateFlow<List<AttemptDto>> = _attempts

    init {
        refresh()
        viewModelScope.launch {
            c.realtime.events.collect { e ->
                val related = e.str("mission_id") == id || e.str("id") == id || (e.type == "message.created" && e.str("channel_id") == id)
                if (related || e.type == "agent.status") refresh()
            }
        }
    }

    fun refresh() = load { MissionBundle(c.api.mission(id), c.api.missionMessages(id), c.api.agents().associateBy { it.id }) }
    fun missionAction(action: String, done: (String?) -> Unit) = action(done) { c.api.missionAction(id, action); refresh() }
    fun taskAction(taskId: String, action: String, done: (String?) -> Unit) = action(done) { c.api.taskAction(id, taskId, action); refresh() }
    fun setPriority(p: Int, done: (String?) -> Unit) = action(done, "Prioridad actualizada") { c.api.updateMission(id, MissionPatch(priority = p)); refresh() }
    fun loadAttempts(taskId: String) { viewModelScope.launch { runCatching { c.api.taskAttempts(id, taskId) }.onSuccess { _attempts.value = it } } }
}

@Composable
fun MissionDetailScreen(id: String) {
    val vm = nexusViewModel(key = "mission-$id") { MissionDetailViewModel(it, id) }
    val state by vm.state.collectAsState()
    val snackbar = LocalSnackbar.current
    val scope = rememberCoroutineScope()
    val toast: (String?) -> Unit = { msg -> if (msg != null) scope.launch { snackbar.showSnackbar(msg) } }
    var tab by rememberSaveable { mutableStateOf("tasks") }
    var selectedTask by remember { mutableStateOf<TaskDto?>(null) }
    var confirmCancel by remember { mutableStateOf(false) }
    val b = state.data
    when {
        state.isInitialLoading -> LoadingState()
        b == null -> ErrorState(state.error ?: "", vm::refresh)
        else -> {
            val m = b.mission
            if (confirmCancel) ConfirmDialog("Cancelar misión", "Las tareas en curso se detienen en su siguiente punto seguro. No se puede deshacer.", "Cancelar misión",
                { vm.missionAction("cancel", toast) }, { confirmCancel = false }, danger = true)
            selectedTask?.let { t -> TaskSheet(t, b, vm, toast) { selectedTask = null } }
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp)) {
                HudPanel(Modifier.fillMaxWidth(), accent = statusStyle(m.status).color) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(m.title, style = MaterialTheme.typography.headlineSmall, color = NexusColors.TextPrimary, modifier = Modifier.weight(1f))
                        StatusChip(m.status)
                    }
                    if (m.statusReason != null) Text(m.statusReason, style = MaterialTheme.typography.bodySmall, color = statusStyle(m.status).color)
                    Spacer(Modifier.height(6.dp))
                    Text(m.objective, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextSecondary)
                    Spacer(Modifier.height(10.dp))
                    HudProgress(m.progress.toFloat(), color = statusStyle(m.status).color)
                    Spacer(Modifier.height(8.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        KeyValueSmall("Tiempo", Time.elapsed(m.startedAt ?: m.createdAt, m.completedAt))
                        KeyValueSmall("Gasto", money(m.spentUsd) + (m.budgetUsd?.let { " / ${money(it)}" } ?: ""))
                        KeyValueSmall("Tokens", "${m.tokensUsed}")
                        KeyValueSmall("Modo", ai.nexus.app.features.dashboard.modeLabel(m.autonomyMode))
                    }
                    Spacer(Modifier.height(10.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (m.status in setOf("planning", "running", "reviewing", "consolidating", "awaiting_approval"))
                            GhostButton("Pausar", { vm.missionAction("pause", toast) }, Modifier.weight(1f), icon = Icons.Outlined.Pause, color = NexusColors.Amber)
                        if (m.status in setOf("paused", "blocked"))
                            GhostButton("Reanudar", { vm.missionAction("resume", toast) }, Modifier.weight(1f), icon = Icons.Outlined.PlayArrow, color = NexusColors.Green)
                        if (m.status !in setOf("completed", "cancelled", "failed"))
                            GhostButton("Cancelar", { confirmCancel = true }, Modifier.weight(1f), icon = Icons.Outlined.Cancel, color = NexusColors.Red)
                    }
                    if (m.status !in setOf("completed", "cancelled", "failed")) {
                        SectionLabel("Prioridad")
                        SelectChips((1..5).map { "$it" to "$it" }, "${m.priority}", { vm.setPriority(it.toInt(), toast) })
                    }
                }
                Spacer(Modifier.height(10.dp))
                Row(Modifier.horizontalScroll(rememberScrollState())) {
                    SelectChips(listOf("tasks" to "Tareas", "flow" to "Flujo", "result" to "Resultado", "talk" to "Conversación",
                        "review" to "Revisión y seguridad", "plan" to "Plan"), tab, { tab = it })
                }
                Spacer(Modifier.height(10.dp))
                when (tab) {
                    "tasks" -> m.tasks.forEach { t -> TaskRow(t, b.agents, Modifier.padding(bottom = 8.dp)) { selectedTask = t; vm.loadAttempts(t.id) } }
                    "flow" -> FlowGraph(m.tasks, b.agents) { t -> selectedTask = t; vm.loadAttempts(t.id) }
                    "result" -> HudPanel(Modifier.fillMaxWidth(), title = "Resultado consolidado") {
                        if (m.result != null) MarkdownText(m.result) else Text("Todavía no hay resultado: NEXUS lo consolida al final, después de la revisión y la auditoría.",
                            style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
                    }
                    "talk" -> b.messages.forEach { msg -> MissionMessage(msg, b.agents) }
                    "review" -> ReviewPanel(m)
                    else -> PlanPanel(m.plan)
                }
                Spacer(Modifier.height(30.dp))
            }
        }
    }
}

@Composable
private fun KeyValueSmall(label: String, value: String) {
    Column {
        Text(label, style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
        Text(value, style = MaterialTheme.typography.bodySmall.copy(fontFamily = Mono), color = NexusColors.TextPrimary)
    }
}

@Composable
private fun TaskRow(t: TaskDto, agents: Map<String, AgentDto>, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val agent = t.agentId?.let { agents[it] }
    HudPanel(modifier.fillMaxWidth(), accent = statusStyle(t.status).color, onClick = onClick, contentPadding = 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            agent?.let { AgentAvatar(it.profile.appearance, if (t.status == "running") it.status else "idle", 32.dp) }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text("${t.key} · ${t.title}", style = MaterialTheme.typography.titleSmall, color = NexusColors.TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text("${agent?.name ?: "—"} · ${t.taskType}${if (t.dependsOn.isNotEmpty()) " · depende de ${t.dependsOn.size}" else ""}",
                    style = MaterialTheme.typography.labelSmall, color = NexusColors.TextSecondary)
            }
            StatusChip(t.status)
        }
        if (t.error != null && t.status in setOf("failed", "ready")) Text(t.error, style = MaterialTheme.typography.labelSmall, color = NexusColors.Red, maxLines = 2)
    }
}

/** Vista de flujo: grafo de tareas por niveles topológicos, coloreado por estado real. */
@Composable
internal fun FlowGraph(tasks: List<TaskDto>, agents: Map<String, AgentDto>, onClick: (TaskDto) -> Unit) {
    val levels = remember(tasks) { topoLevels(tasks) }
    val nodeW = 150.dp
    val nodeH = 64.dp
    val gapX = 46.dp
    val gapY = 18.dp
    val maxRows = levels.maxOfOrNull { it.size } ?: 1
    HudPanel(Modifier.fillMaxWidth(), title = "Flujo de ejecución") {
        Box(Modifier.horizontalScroll(rememberScrollState())) {
            val width = (nodeW + gapX) * levels.size
            val height = (nodeH + gapY) * maxRows
            val pos = HashMap<String, Pair<Int, Int>>()
            levels.forEachIndexed { col, level -> level.forEachIndexed { row, t -> pos[t.id] = col to row } }
            Box(Modifier.width(width).height(height)) {
                Canvas(Modifier.width(width).height(height)) {
                    tasks.forEach { t ->
                        val (c2, r2) = pos[t.id] ?: return@forEach
                        t.dependsOn.forEach { dep ->
                            val (c1, r1) = pos[dep] ?: return@forEach
                            val start = Offset(((nodeW + gapX) * c1 + nodeW).toPx(), ((nodeH + gapY) * r1 + nodeH / 2).toPx())
                            val end = Offset(((nodeW + gapX) * c2).toPx(), ((nodeH + gapY) * r2 + nodeH / 2).toPx())
                            val path = Path().apply {
                                moveTo(start.x, start.y)
                                cubicTo(start.x + 30f, start.y, end.x - 30f, end.y, end.x, end.y)
                            }
                            val color = statusStyle(tasks.firstOrNull { it.id == dep }?.status).color
                            drawPath(path, color.copy(alpha = 0.7f), style = Stroke(2f))
                            drawCircle(color, 4f, end)
                        }
                    }
                }
                tasks.forEach { t ->
                    val (col, row) = pos[t.id] ?: return@forEach
                    val style = statusStyle(t.status)
                    Column(
                        Modifier.offset(x = (nodeW + gapX) * col, y = (nodeH + gapY) * row).width(nodeW).height(nodeH)
                            .clip(RoundedCornerShape(10.dp)).background(style.color.copy(alpha = 0.1f)).border(1.dp, style.color.copy(alpha = 0.7f), RoundedCornerShape(10.dp))
                            .clickable { onClick(t) }.padding(8.dp),
                    ) {
                        Text("${t.key} · ${t.title}", style = MaterialTheme.typography.labelMedium, color = NexusColors.TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Text(t.agentId?.let { agents[it]?.name } ?: "—", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextSecondary)
                        Text(style.label, style = MaterialTheme.typography.labelSmall, color = style.color)
                    }
                }
            }
        }
    }
}

fun topoLevels(tasks: List<TaskDto>): List<List<TaskDto>> {
    val byId = tasks.associateBy { it.id }
    val level = HashMap<String, Int>()
    fun depth(t: TaskDto, seen: Set<String> = emptySet()): Int = level.getOrPut(t.id) {
        if (t.id in seen) 0 else (t.dependsOn.mapNotNull { byId[it] }.maxOfOrNull { depth(it, seen + t.id) + 1 } ?: 0)
    }
    tasks.forEach { depth(it) }
    return tasks.groupBy { level[it.id] ?: 0 }.toSortedMap().values.toList()
}

@Composable
private fun TaskSheet(t: TaskDto, b: MissionBundle, vm: MissionDetailViewModel, toast: (String?) -> Unit, onDismiss: () -> Unit) {
    val attempts by vm.attempts.collectAsState()
    val current = b.mission.tasks.firstOrNull { it.id == t.id } ?: t
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = NexusColors.Surface,
        title = { Text("${current.key} · ${current.title}") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                StatusChip(current.status)
                Spacer(Modifier.height(6.dp))
                Text(current.description, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
                KeyValue("Agente", current.agentId?.let { b.agents[it]?.name } ?: "—")
                KeyValue("Modelo", current.modelUsed ?: "—")
                KeyValue("Intentos", "${current.attempts}/${current.maxAttempts}")
                KeyValue("Duración", current.durationMs?.let { "${it / 1000} s" } ?: "—")
                KeyValue("Costo", money(current.actualCostUsd))
                current.error?.let { Text(it, color = NexusColors.Red, style = MaterialTheme.typography.bodySmall) }
                if (current.result != null) { SectionLabel("Resultado"); MarkdownText(current.result) }
                if (current.citations.isNotEmpty()) {
                    SectionLabel("Fuentes")
                    current.citations.forEach { c -> Text((c["url"] as? JsonPrimitive)?.contentOrNull ?: "", style = MaterialTheme.typography.labelSmall, color = NexusColors.Cyan) }
                }
                if (current.drafts.isNotEmpty()) {
                    SectionLabel("Borradores")
                    current.drafts.forEach { d -> Tag((d["title"] as? JsonPrimitive)?.contentOrNull ?: "borrador", NexusColors.Violet) }
                }
                if (attempts.isNotEmpty()) {
                    SectionLabel("Intentos y pasos")
                    attempts.forEach { a ->
                        Text("#${a.attemptNumber} · ${a.status} · ${a.workerId.substringBefore(":")} · ${a.modelUsed ?: "—"}", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextPrimary)
                        a.steps.forEach { step ->
                            val o = step as? JsonObject ?: return@forEach
                            val type = (o["type"] as? JsonPrimitive)?.contentOrNull
                            val label = when (type) {
                                "tool" -> "🔧 ${(o["tool"] as? JsonPrimitive)?.contentOrNull} ${if ((o["is_error"] as? JsonPrimitive)?.contentOrNull == "true") "(error)" else ""}"
                                "llm" -> "🧠 ${(o["model"] as? JsonPrimitive)?.contentOrNull} · ${(o["tokens"] as? JsonPrimitive)?.contentOrNull} tokens"
                                "memory" -> "💾 ${(o["retrieved"] as? JsonArray)?.size ?: 0} recuerdos recuperados"
                                else -> type ?: ""
                            }
                            Text("   $label", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextSecondary)
                        }
                        a.error?.let { Text("   $it", style = MaterialTheme.typography.labelSmall, color = NexusColors.Red) }
                    }
                }
            }
        },
        confirmButton = {
            Row {
                if (current.status in setOf("failed", "cancelled")) TextButton(onClick = { vm.taskAction(current.id, "retry", toast); onDismiss() }) { Text("REINTENTAR", color = NexusColors.Cyan) }
                if (current.status in setOf("pending", "ready", "running", "awaiting_approval")) TextButton(onClick = { vm.taskAction(current.id, "cancel", toast); onDismiss() }) { Text("CANCELAR", color = NexusColors.Red) }
                if (current.status in setOf("failed", "cancelled")) TextButton(onClick = { vm.taskAction(current.id, "skip", toast); onDismiss() }) { Text("OMITIR", color = NexusColors.Amber) }
                TextButton(onClick = onDismiss) { Text("CERRAR", color = NexusColors.TextSecondary) }
            }
        },
    )
}

@Composable
private fun MissionMessage(m: MessageDto, agents: Map<String, AgentDto>) {
    val agent = m.senderAgentId?.let { agents[it] }
    HudPanel(Modifier.fillMaxWidth().padding(bottom = 8.dp), contentPadding = 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            agent?.let { AgentAvatar(it.profile.appearance, "idle", 28.dp) }
            Spacer(Modifier.width(8.dp))
            Text(agent?.name ?: "Sistema", style = MaterialTheme.typography.labelMedium, color = NexusColors.Cyan)
            Spacer(Modifier.width(6.dp))
            Tag(m.messageType)
            Spacer(Modifier.weight(1f))
            Text(Time.clock(m.createdAt), style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
        }
        Spacer(Modifier.height(6.dp))
        MarkdownText(m.content.take(4000))
    }
}

@Composable
private fun ReviewPanel(m: MissionDetailDto) {
    fun str(o: JsonObject, k: String) = (o[k] as? JsonPrimitive)?.contentOrNull
    HudPanel(Modifier.fillMaxWidth(), title = "Revisión de ORACLE", accent = NexusColors.Amber) {
        if (m.review.isEmpty()) Text("Pendiente.", color = NexusColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
        else {
            KeyValue("Veredicto", str(m.review, "verdict") ?: "—")
            KeyValue("Puntaje", str(m.review, "score") ?: "—")
            Text(str(m.review, "summary") ?: "", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextPrimary)
            (m.review["issues"] as? JsonArray)?.forEach { issue ->
                val o = issue as? JsonObject ?: return@forEach
                Text("• [${str(o, "severity")}] ${str(o, "task_key")}: ${str(o, "problem")} → ${str(o, "fix")}", style = MaterialTheme.typography.bodySmall, color = NexusColors.Amber)
            }
        }
    }
    Spacer(Modifier.height(10.dp))
    HudPanel(Modifier.fillMaxWidth(), title = "Auditoría de GUARDIAN", accent = NexusColors.Red) {
        val assessment = m.securityReview["assessment"] as? JsonObject
        val evidence = m.securityReview["evidence"] as? JsonObject
        if (assessment == null) Text("Pendiente.", color = NexusColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
        else {
            KeyValue("Estado", str(assessment, "status") ?: "—")
            Text(str(assessment, "summary") ?: "", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextPrimary)
            evidence?.let {
                KeyValue("Herramientas ejecutadas", str(it, "tool_executions") ?: "0")
                KeyValue("Operaciones bloqueadas", "${(it["blocked"] as? JsonArray)?.size ?: 0}")
                KeyValue("Comunicaciones externas", "${(it["external_communications"] as? JsonArray)?.size ?: 0}")
            }
            (assessment["findings"] as? JsonArray)?.forEach { f ->
                val o = f.jsonObject
                Text("• [${str(o, "severity")}] ${str(o, "finding")} — ${str(o, "recommendation")}", style = MaterialTheme.typography.bodySmall, color = NexusColors.Red)
            }
        }
    }
}

@Composable
private fun PlanPanel(plan: JsonObject) {
    fun str(k: String) = (plan[k] as? JsonPrimitive)?.contentOrNull
    HudPanel(Modifier.fillMaxWidth(), title = "Plan de NEXUS") {
        if (plan.isEmpty()) { Text("NEXUS todavía está analizando el objetivo.", color = NexusColors.TextSecondary, style = MaterialTheme.typography.bodySmall); return@HudPanel }
        KeyValue("Complejidad", str("complexity") ?: "—")
        KeyValue("Requiere investigación", if (str("needs_research") == "true") "Sí" else "No")
        KeyValue("Modelo", str("model") ?: "—")
        SectionLabel("Análisis"); Text(str("analysis") ?: "", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextPrimary)
        SectionLabel("Estrategia"); Text(str("strategy") ?: "", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextPrimary)
        (plan["risks"] as? JsonArray)?.takeIf { it.isNotEmpty() }?.let { risks ->
            SectionLabel("Riesgos")
            risks.forEach { Text("• ${(it as? JsonPrimitive)?.contentOrNull}", style = MaterialTheme.typography.bodySmall, color = NexusColors.Amber) }
        }
    }
}
