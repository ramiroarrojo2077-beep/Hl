package ai.nexus.app.features.agents

import ai.nexus.app.AppContainer
import ai.nexus.app.core.avatar.AgentFigure
import ai.nexus.app.core.design.ConfirmDialog
import ai.nexus.app.core.design.ErrorState
import ai.nexus.app.core.design.GhostButton
import ai.nexus.app.core.design.HudPanel
import ai.nexus.app.core.design.KeyValue
import ai.nexus.app.core.design.LoadingState
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
import ai.nexus.app.data.model.AgentDetailDto
import ai.nexus.app.data.model.AgentUpsert
import ai.nexus.app.data.model.InstructionVersion
import ai.nexus.app.data.model.MemoryDto
import ai.nexus.app.data.model.ModelDto
import ai.nexus.app.data.model.PermissionDto
import ai.nexus.app.data.model.TaskDto
import ai.nexus.app.data.model.ToolDto
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Chat
import androidx.compose.material.icons.outlined.Face
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull

data class AgentBundle(
    val agent: AgentDetailDto,
    val tasks: List<TaskDto>,
    val memories: List<MemoryDto>,
    val tools: List<ToolDto>,
    val models: List<ModelDto>,
    val versions: List<InstructionVersion>,
)

class AgentDetailViewModel(private val c: AppContainer, private val id: String) : LoadViewModel<AgentBundle>() {
    init {
        refresh()
        viewModelScope.launch {
            c.realtime.events.collect { e ->
                if ((e.type == "agent.status" && e.str("agent_id") == id) || e.type == "agent.updated") refresh()
            }
        }
    }

    fun refresh() = load {
        val agent = c.api.agent(id)
        AgentBundle(
            agent, c.api.agentTasks(id), c.api.memories(scope = "agent").filter { it.agentId == id },
            c.api.tools(), c.api.models().filter { "chat" in it.capabilities }, c.api.instructionVersions(id),
        )
    }

    fun savePermissions(perms: List<PermissionDto>, done: (String?) -> Unit) = action(done, "Permisos actualizados") {
        c.api.setPermissions(id, perms); refresh()
    }

    fun saveModels(ids: List<String>, done: (String?) -> Unit) = action(done, "Modelos asignados") { c.api.setAgentModels(id, ids); refresh() }

    fun update(body: AgentUpsert, done: (String?) -> Unit) = action(done, "Configuración guardada") { c.api.updateAgent(id, body); refresh() }

    fun restoreInstructions(content: String, done: (String?) -> Unit) = action(done, "Versión restaurada como nueva versión") {
        c.api.updateAgent(id, AgentUpsert(instructions = content)); refresh()
    }

    fun delete(done: (String?) -> Unit) = action(done) { c.api.deleteAgent(id) }

    fun chat(onRoute: (String) -> Unit, onError: (String?) -> Unit) = action(onError) { onRoute("chat/${c.api.agentConversation(id).id}") }
}

@Composable
fun AgentDetailScreen(id: String) {
    val vm = nexusViewModel(key = "agent-$id") { AgentDetailViewModel(it, id) }
    val state by vm.state.collectAsState()
    val navigate = LocalNavigate.current
    val snackbar = LocalSnackbar.current
    val scope = rememberCoroutineScope()
    val toast: (String?) -> Unit = { msg -> if (msg != null) scope.launch { snackbar.showSnackbar(msg) } }
    var tab by rememberSaveable { mutableStateOf("profile") }
    val bundle = state.data
    when {
        state.isInitialLoading -> LoadingState()
        bundle == null -> ErrorState(state.error ?: "", vm::refresh)
        else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp)) {
            val a = bundle.agent
            val accent = parseHex(a.profile.appearance.accent)
            HudPanel(Modifier.fillMaxWidth(), accent = accent) {
                Row {
                    Box(Modifier.width(130.dp).height(230.dp).clip(RoundedCornerShape(12.dp))
                        .background(Brush.radialGradient(listOf(accent.copy(alpha = 0.18f), NexusColors.Background.copy(alpha = 0.3f))))) {
                        AgentFigure(a.profile.appearance, a.status, Modifier.fillMaxSize())
                    }
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(a.name, style = MaterialTheme.typography.headlineMedium, color = NexusColors.TextPrimary)
                        Text(a.role, style = MaterialTheme.typography.titleSmall, color = accent)
                        Spacer(Modifier.height(6.dp)); StatusChip(a.status)
                        Text(a.statusDetail ?: "", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary, maxLines = 2)
                        Spacer(Modifier.height(6.dp))
                        Tag(a.models.firstOrNull()?.let { "${it.providerKind} · ${it.modelName}" } ?: "Modelo: router automático")
                        Spacer(Modifier.height(4.dp))
                        Text("Activo ${Time.relative(a.lastActivityAt)} · ${if (a.isSystem) "Equipo inicial" else "Personalizado"}",
                            style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
                        Spacer(Modifier.height(10.dp))
                        GhostButton("Conversar", { vm.chat(navigate, toast) }, Modifier.fillMaxWidth(), icon = Icons.Outlined.Chat)
                        Spacer(Modifier.height(6.dp))
                        GhostButton("Editar personaje", { navigate("agent/$id/edit") }, Modifier.fillMaxWidth(), color = accent, icon = Icons.Outlined.Face)
                    }
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(Modifier.horizontalScroll(rememberScrollState())) {
                SelectChips(
                    listOf("profile" to "Perfil", "permissions" to "Herramientas y permisos", "models" to "Modelos", "history" to "Historial",
                        "memory" to "Memoria", "stats" to "Estadísticas", "config" to "Configuración"),
                    tab, { tab = it }, color = accent,
                )
            }
            Spacer(Modifier.height(10.dp))
            when (tab) {
                "profile" -> ProfileTab(bundle, vm, toast)
                "permissions" -> PermissionsTab(bundle, vm, toast)
                "models" -> ModelsTab(bundle, vm, toast)
                "history" -> HistoryTab(bundle.tasks)
                "memory" -> MemoryTab(bundle.memories)
                "stats" -> StatsTab(a.stats)
                else -> ConfigTab(bundle, vm, toast) { navigate("agents") }
            }
        }
    }
}

@Composable
private fun ProfileTab(b: AgentBundle, vm: AgentDetailViewModel, toast: (String?) -> Unit) {
    val p = b.agent.profile
    HudPanel(Modifier.fillMaxWidth(), title = "Perfil") {
        Text(p.description, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextPrimary)
        SectionLabel("Personalidad"); Text(p.personality, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextSecondary)
        SectionLabel("Especialidades")
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) { p.specialties.forEach { Tag(it, NexusColors.Cyan) } }
        SectionLabel("Estilo de comunicación"); Text(p.communicationStyle, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextSecondary)
        SectionLabel("Criterios de trabajo"); Text(p.workCriteria, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextSecondary)
        SectionLabel("Rasgos")
        p.traits.personality.forEach { (k, v) -> KeyValue(k.replace('_', '/'), "$v/100") }
        p.traits.emotions.forEach { (k, v) -> KeyValue(k, "$v/100") }
    }
    Spacer(Modifier.height(10.dp))
    HudPanel(Modifier.fillMaxWidth(), title = "Instrucciones · v${b.agent.instructionsVersion}") {
        MarkdownText(b.agent.instructions)
        if (b.versions.size > 1) {
            SectionLabel("Versiones anteriores")
            b.versions.filter { !it.isActive }.take(5).forEach { v ->
                Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("v${v.version} · ${Time.short(v.createdAt)}", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary, modifier = Modifier.weight(1f))
                    Text("RESTAURAR", style = MaterialTheme.typography.labelSmall, color = NexusColors.Cyan,
                        modifier = Modifier.clickable { vm.restoreInstructions(v.content, toast) })
                }
            }
        }
    }
}

private val OP_LABELS = mapOf("read" to "Lectura", "analysis" to "Análisis", "creation" to "Creación", "modification" to "Modificación",
    "external_communication" to "Comunicación externa", "irreversible" to "Irreversible", "account_admin" to "Administración")

@Composable
private fun PermissionsTab(b: AgentBundle, vm: AgentDetailViewModel, toast: (String?) -> Unit) {
    val perms = remember(b.agent.permissions) { mutableStateListOf<PermissionDto>().apply { addAll(b.agent.permissions) } }
    HudPanel(Modifier.fillMaxWidth(), title = "Herramientas autorizadas") {
        Text("Solo vos podés cambiar estos permisos: los agentes no tienen ninguna herramienta para modificarlos. " +
            "Las operaciones irreversibles siempre piden confirmación.", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
        b.tools.groupBy { it.category }.forEach { (cat, tools) ->
            SectionLabel(cat)
            tools.forEach { tool ->
                val current = perms.firstOrNull { it.toolKey == tool.key }
                Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(tool.name, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextPrimary)
                            Text("${OP_LABELS[tool.operationClass] ?: tool.operationClass}${tool.requiresPlugin?.let { " · plugin $it" } ?: ""}",
                                style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
                        }
                        ToggleRow("", current?.allowed == true) { on ->
                            perms.removeAll { it.toolKey == tool.key }
                            if (on) perms.add(PermissionDto(tool.key, true, current?.mode ?: "auto"))
                        }
                    }
                    if (current?.allowed == true) {
                        SelectChips(listOf("auto" to "Automático", "approval" to "Pedir aprobación"), current.mode, { m ->
                            val idx = perms.indexOfFirst { it.toolKey == tool.key }
                            if (idx >= 0) perms[idx] = perms[idx].copy(mode = m)
                        })
                    }
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        PrimaryButton("Guardar permisos", { vm.savePermissions(perms.toList(), toast) }, Modifier.fillMaxWidth())
    }
}

@Composable
private fun ModelsTab(b: AgentBundle, vm: AgentDetailViewModel, toast: (String?) -> Unit) {
    val selected = remember(b.agent.models) { mutableStateListOf<String>().apply { addAll(b.agent.models.map { it.modelId }) } }
    HudPanel(Modifier.fillMaxWidth(), title = "Modelos asignados") {
        Text("El primero es el principal; los siguientes se usan como fallback compatible. Sin asignación, el router elige según la tarea.",
            style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
        Spacer(Modifier.height(8.dp))
        if (b.models.isEmpty()) Text("No hay modelos configurados. Agregá un proveedor en Ajustes.", color = NexusColors.Amber, style = MaterialTheme.typography.bodySmall)
        b.models.forEach { m ->
            val pos = selected.indexOf(m.id)
            Row(
                Modifier.fillMaxWidth().padding(vertical = 3.dp).clip(RoundedCornerShape(10.dp))
                    .background(if (pos >= 0) NexusColors.Cyan.copy(alpha = 0.1f) else NexusColors.Background.copy(alpha = 0.4f))
                    .clickable { if (pos >= 0) selected.remove(m.id) else selected.add(m.id) }.padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(if (pos >= 0) "#${pos + 1}" else "—", style = MaterialTheme.typography.labelMedium, color = NexusColors.Cyan, modifier = Modifier.width(32.dp))
                Column(Modifier.weight(1f)) {
                    Text(m.displayName, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextPrimary)
                    Text("${m.providerKind} · calidad ${m.qualityTier}/5 · ${m.capabilities.joinToString()}", style = MaterialTheme.typography.labelSmall,
                        color = NexusColors.TextMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
        Spacer(Modifier.height(8.dp))
        PrimaryButton("Guardar asignación", { vm.saveModels(selected.toList(), toast) }, Modifier.fillMaxWidth())
    }
}

@Composable
private fun HistoryTab(tasks: List<TaskDto>) {
    val navigate = LocalNavigate.current
    HudPanel(Modifier.fillMaxWidth(), title = "Historial de tareas") {
        if (tasks.isEmpty()) Text("Todavía no trabajó en ninguna tarea.", color = NexusColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
        tasks.forEach { t ->
            Row(Modifier.fillMaxWidth().clickable { navigate("mission/${t.missionId}") }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(t.title, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${Time.short(t.createdAt)} · ${t.modelUsed ?: "—"} · ${money(t.actualCostUsd)}", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
                }
                StatusChip(t.status)
            }
        }
    }
}

@Composable
private fun MemoryTab(memories: List<MemoryDto>) {
    HudPanel(Modifier.fillMaxWidth(), title = "Memoria individual") {
        if (memories.isEmpty()) Text("Sin recuerdos individuales todavía.", color = NexusColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
        memories.forEach { m ->
            Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Text(m.content, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextPrimary, maxLines = 4, overflow = TextOverflow.Ellipsis)
                Text("${m.kind} · confianza ${(m.confidence * 100).toInt()}% · ${m.verificationStatus} · ${Time.short(m.createdAt)}",
                    style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
            }
        }
    }
}

@Composable
private fun StatsTab(stats: JsonObject) {
    fun v(k: String) = (stats[k] as? JsonPrimitive)?.contentOrNull ?: "0"
    HudPanel(Modifier.fillMaxWidth(), title = "Estadísticas") {
        KeyValue("Tareas completadas", v("tasks_completed"))
        KeyValue("Tareas fallidas", v("tasks_failed"))
        KeyValue("Llamadas a modelos", v("llm_calls"))
        KeyValue("Tokens consumidos", v("tokens"))
        KeyValue("Costo estimado", money(v("cost_usd")))
    }
}

@Composable
private fun ConfigTab(b: AgentBundle, vm: AgentDetailViewModel, toast: (String?) -> Unit, onDeleted: () -> Unit) {
    val a = b.agent
    var enabled by remember(a) { mutableStateOf(a.isEnabled) }
    var memory by remember(a) { mutableStateOf(a.memoryEnabled) }
    var meetings by remember(a) { mutableStateOf(a.participatesInMeetings) }
    var budget by remember(a) { mutableStateOf(a.dailyBudgetUsd ?: "") }
    var confirmDelete by remember { mutableStateOf(false) }
    if (confirmDelete) ConfirmDialog("Eliminar ${a.name}", "Se elimina el agente y su memoria individual. Esta acción no se puede deshacer.", "Eliminar",
        { vm.delete { msg -> if (msg == null) onDeleted() else toast(msg) } }, { confirmDelete = false }, danger = true)
    HudPanel(Modifier.fillMaxWidth(), title = "Configuración") {
        ToggleRow("Habilitado", enabled) { enabled = it }
        ToggleRow("Memoria persistente", memory) { memory = it }
        ToggleRow("Participa en reuniones", meetings) { meetings = it }
        NexusTextField(budget, { budget = it }, "Presupuesto diario (USD, vacío = sin límite)")
        Spacer(Modifier.height(10.dp))
        PrimaryButton("Guardar", {
            vm.update(AgentUpsert(isEnabled = enabled, memoryEnabled = memory, participatesInMeetings = meetings,
                dailyBudgetUsd = budget.trim().ifEmpty { null }, clearDailyBudget = budget.isBlank()), toast)
        }, Modifier.fillMaxWidth())
        if (!a.isSystem) {
            Spacer(Modifier.height(10.dp))
            GhostButton("Eliminar agente", { confirmDelete = true }, Modifier.fillMaxWidth(), color = NexusColors.Red)
        }
    }
}
