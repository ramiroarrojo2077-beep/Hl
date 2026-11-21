package ai.nexus.app.features.memory

import ai.nexus.app.AppContainer
import ai.nexus.app.core.design.ConfirmDialog
import ai.nexus.app.core.design.EmptyState
import ai.nexus.app.core.design.ErrorState
import ai.nexus.app.core.design.HudPanel
import ai.nexus.app.core.design.HudProgress
import ai.nexus.app.core.design.LoadingState
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.NexusTextField
import ai.nexus.app.core.design.SectionLabel
import ai.nexus.app.core.design.SelectChips
import ai.nexus.app.core.design.StatusChip
import ai.nexus.app.core.design.Tag
import ai.nexus.app.core.ui.LoadViewModel
import ai.nexus.app.core.ui.LocalSnackbar
import ai.nexus.app.core.ui.Time
import ai.nexus.app.core.ui.nexusViewModel
import ai.nexus.app.data.model.AgentDto
import ai.nexus.app.data.model.MemoryCreate
import ai.nexus.app.data.model.MemoryDto
import ai.nexus.app.data.model.MemoryPatch
import ai.nexus.app.data.model.MemorySearch
import ai.nexus.app.data.model.ProjectDto
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

data class MemoryData(val items: List<MemoryDto>, val scores: Map<String, Pair<Double, List<String>>>, val agents: Map<String, AgentDto>,
                      val projects: List<ProjectDto>, val searching: String?)

class MemoryViewModel(private val c: AppContainer) : LoadViewModel<MemoryData>() {
    var scope = mutableStateOf("all")
    var query = mutableStateOf("")

    init { refresh() }

    fun refresh() = load {
        val scopeArg = when (scope.value) { "all", "document" -> null; else -> scope.value }
        val agents = c.api.agents().associateBy { it.id }
        val projects = c.api.projects()
        if (query.value.isNotBlank()) {
            val hits = c.api.searchMemory(MemorySearch(query.value.trim(), scopes = scopeArg?.let { listOf(it) }))
            MemoryData(hits.map { it.item }, hits.associate { it.item.id to (it.score to it.matchedBy) }, agents, projects, query.value)
        } else {
            var items = c.api.memories(scope = scopeArg)
            if (scope.value == "document") items = items.filter { it.kind == "document" }
            MemoryData(items, emptyMap(), agents, projects, null)
        }
    }

    fun verify(id: String, status: String, done: (String?) -> Unit) = action(done, if (status == "verified") "Marcado como verificado" else "Marcado como rechazado") {
        c.api.updateMemory(id, MemoryPatch(verificationStatus = status)); refresh()
    }
    fun edit(id: String, content: String, done: (String?) -> Unit) = action(done, "Recuerdo corregido") { c.api.updateMemory(id, MemoryPatch(content = content)); refresh() }
    fun delete(id: String, done: (String?) -> Unit) = action(done, "Recuerdo eliminado") { c.api.deleteMemory(id); refresh() }
    fun create(body: MemoryCreate, done: (String?) -> Unit) = action(done, "Recuerdo guardado") { c.api.createMemory(body); refresh() }
}

@Composable
fun MemoryScreen() {
    val vm = nexusViewModel { MemoryViewModel(it) }
    val state by vm.state.collectAsState()
    val snackbar = LocalSnackbar.current
    val scope = rememberCoroutineScope()
    val toast: (String?) -> Unit = { msg -> if (msg != null) scope.launch { snackbar.showSnackbar(msg) } }
    var editing by remember { mutableStateOf<MemoryDto?>(null) }
    var deleting by remember { mutableStateOf<MemoryDto?>(null) }
    var adding by rememberSaveable { mutableStateOf(false) }
    deleting?.let { m -> ConfirmDialog("Eliminar recuerdo", "Se elimina definitivamente de la memoria de NEXUS.", "Eliminar", { vm.delete(m.id, toast) }, { deleting = null }, danger = true) }
    editing?.let { m -> EditMemoryDialog(m, { vm.edit(m.id, it, toast); editing = null }) { editing = null } }
    if (adding) AddMemoryDialog(state.data?.agents.orEmpty(), state.data?.projects.orEmpty(), { vm.create(it, toast); adding = false }) { adding = false }
    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            Column(Modifier.padding(horizontal = 14.dp, vertical = 8.dp)) {
                Text("Memory Center", style = MaterialTheme.typography.headlineSmall, color = NexusColors.TextPrimary)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) { NexusTextField(vm.query.value, { vm.query.value = it }, "Búsqueda semántica en la memoria") }
                    IconButton(onClick = vm::refresh) { Icon(Icons.Outlined.Search, "Buscar", tint = NexusColors.Cyan) }
                }
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 6.dp)) {
                    SelectChips(listOf("all" to "Todos", "shared" to "Compartida", "agent" to "Individual", "user" to "Usuario", "project" to "Proyectos",
                        "document" to "Documentos indexados"), vm.scope.value, { vm.scope.value = it; vm.refresh() })
                }
            }
            val data = state.data
            when {
                state.isInitialLoading -> LoadingState()
                data == null -> ErrorState(state.error ?: "", vm::refresh)
                data.items.isEmpty() -> EmptyState(if (data.searching != null) "Sin coincidencias" else "Memoria vacía",
                    "Los agentes proponen recuerdos durante su trabajo (quedan sin verificar hasta que los revises). También podés agregarlos vos.", icon = Icons.Outlined.Memory)
                else -> LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp, 0.dp, 14.dp, 90.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(data.items, key = { it.id }) { m ->
                        MemoryCard(m, data, onVerify = { vm.verify(m.id, it, toast) }, onEdit = { editing = m }, onDelete = { deleting = m })
                    }
                }
            }
        }
        ExtendedFloatingActionButton(onClick = { adding = true }, containerColor = NexusColors.Cyan, contentColor = NexusColors.Background,
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp), icon = { Icon(Icons.Outlined.Add, null) }, text = { Text("Agregar") })
    }
}

private val SCOPE_LABEL = mapOf("agent" to "Individual", "shared" to "Compartida", "user" to "Usuario", "project" to "Proyecto")

@Composable
private fun MemoryCard(m: MemoryDto, data: MemoryData, onVerify: (String) -> Unit, onEdit: () -> Unit, onDelete: () -> Unit) {
    val owner = m.agentId?.let { data.agents[it]?.name } ?: m.projectId?.let { pid -> data.projects.firstOrNull { it.id == pid }?.name }
    val creator = m.createdByAgentId?.let { data.agents[it]?.name }
    HudPanel(Modifier.fillMaxWidth(), contentPadding = 12.dp) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Tag(SCOPE_LABEL[m.scope] ?: m.scope, NexusColors.Cyan)
            Tag(m.kind, NexusColors.Violet)
            owner?.let { Tag(it) }
            Spacer(Modifier.weight(1f))
            StatusChip(m.verificationStatus)
        }
        m.title?.let { Text(it, style = MaterialTheme.typography.titleSmall, color = NexusColors.TextPrimary, modifier = Modifier.padding(top = 6.dp)) }
        Text(m.content, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextPrimary, maxLines = 8, overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(vertical = 6.dp))
        Text("Fuente: ${m.source}${m.sourceRef?.let { " · $it" } ?: ""}${creator?.let { " · creado por $it" } ?: ""} · ${Time.short(m.sourceDate ?: m.createdAt)}",
            style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
        m.expiresAt?.let { Text("Caduca: ${Time.short(it)}", style = MaterialTheme.typography.labelSmall, color = NexusColors.Amber) }
        data.scores[m.id]?.let { (score, by) -> Text("Relevancia ${String.format("%.4f", score)} · coincidencia: ${by.joinToString()}", style = MaterialTheme.typography.labelSmall, color = NexusColors.Cyan) }
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 6.dp)) {
            Text("Confianza", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextSecondary)
            Spacer(Modifier.width(8.dp))
            HudProgress(m.confidence.toFloat(), Modifier.weight(1f))
            Text(" ${(m.confidence * 100).toInt()}%", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextSecondary)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp), modifier = Modifier.padding(top = 8.dp)) {
            if (m.verificationStatus != "verified") ActionText("VERIFICAR", NexusColors.Green) { onVerify("verified") }
            if (m.verificationStatus != "rejected") ActionText("RECHAZAR", NexusColors.Amber) { onVerify("rejected") }
            ActionText("CORREGIR", NexusColors.Cyan, onEdit)
            ActionText("ELIMINAR", NexusColors.Red, onDelete)
        }
    }
}

@Composable
fun ActionText(text: String, color: androidx.compose.ui.graphics.Color, onClick: () -> Unit) {
    Text(text, style = MaterialTheme.typography.labelSmall, color = color, modifier = Modifier.clickable(onClick = onClick).padding(vertical = 4.dp))
}

@Composable
private fun EditMemoryDialog(m: MemoryDto, onSave: (String) -> Unit, onDismiss: () -> Unit) {
    var text by remember { mutableStateOf(m.content) }
    AlertDialog(onDismissRequest = onDismiss, containerColor = NexusColors.Surface, title = { Text("Corregir recuerdo") },
        text = { NexusTextField(text, { text = it }, "Contenido", singleLine = false, minLines = 4) },
        confirmButton = { TextButton(onClick = { onSave(text) }) { Text("GUARDAR", color = NexusColors.Cyan) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("CANCELAR", color = NexusColors.TextSecondary) } })
}

@Composable
private fun AddMemoryDialog(agents: Map<String, AgentDto>, projects: List<ProjectDto>, onSave: (MemoryCreate) -> Unit, onDismiss: () -> Unit) {
    var content by remember { mutableStateOf("") }
    var scope by remember { mutableStateOf("user") }
    var kind by remember { mutableStateOf("preference") }
    var agent by remember { mutableStateOf(agents.keys.firstOrNull()) }
    var project by remember { mutableStateOf(projects.firstOrNull()?.id) }
    AlertDialog(onDismissRequest = onDismiss, containerColor = NexusColors.Surface, title = { Text("Nuevo recuerdo") },
        text = {
            Column {
                NexusTextField(content, { content = it }, "Contenido", singleLine = false, minLines = 3)
                SectionLabel("Ámbito")
                SelectChips(listOf("user" to "Usuario", "shared" to "Compartida", "agent" to "Agente", "project" to "Proyecto"), scope, { scope = it })
                if (scope == "agent") { SectionLabel("Agente"); SelectChips(agents.values.map { it.id to it.name }, agent, { agent = it }) }
                if (scope == "project") { SectionLabel("Proyecto"); SelectChips(projects.map { it.id to it.name }, project, { project = it }) }
                SectionLabel("Tipo")
                SelectChips(listOf("preference" to "Preferencia", "fact" to "Hecho", "decision" to "Decisión", "learning" to "Aprendizaje"), kind, { kind = it })
            }
        },
        confirmButton = {
            TextButton(onClick = {
                if (content.length >= 3) onSave(MemoryCreate(scope, content.trim(), kind = kind, agentId = agent.takeIf { scope == "agent" },
                    projectId = project.takeIf { scope == "project" }))
            }) { Text("GUARDAR", color = NexusColors.Cyan) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("CANCELAR", color = NexusColors.TextSecondary) } })
}
