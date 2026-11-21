package ai.nexus.app.features.projects

import ai.nexus.app.AppContainer
import ai.nexus.app.core.avatar.AgentAvatar
import ai.nexus.app.core.design.EmptyState
import ai.nexus.app.core.design.ErrorState
import ai.nexus.app.core.design.GhostButton
import ai.nexus.app.core.design.HudPanel
import ai.nexus.app.core.design.LoadingState
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.NexusTextField
import ai.nexus.app.core.design.PrimaryButton
import ai.nexus.app.core.design.SectionLabel
import ai.nexus.app.core.design.SelectChips
import ai.nexus.app.core.design.StatusChip
import ai.nexus.app.core.design.Tag
import ai.nexus.app.core.ui.LoadViewModel
import ai.nexus.app.core.ui.LocalNavigate
import ai.nexus.app.core.ui.LocalSnackbar
import ai.nexus.app.core.ui.Time
import ai.nexus.app.core.ui.nexusViewModel
import ai.nexus.app.data.model.AgentDto
import ai.nexus.app.data.model.ConversationCreate
import ai.nexus.app.data.model.MemoryDto
import ai.nexus.app.data.model.MissionDto
import ai.nexus.app.data.model.ProjectAgentDto
import ai.nexus.app.data.model.ProjectDto
import ai.nexus.app.data.model.ProjectFileDto
import ai.nexus.app.data.model.ProjectUpsert
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.UploadFile
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch

class ProjectsViewModel(private val c: AppContainer) : LoadViewModel<List<ProjectDto>>() {
    init { refresh() }
    fun refresh() = load { c.api.projects() }
    fun create(name: String, description: String, objective: String, done: (String?) -> Unit) = action(done, "Proyecto creado") {
        c.api.createProject(ProjectUpsert(name, description, objective)); refresh()
    }
}

@Composable
fun ProjectsScreen() {
    val vm = nexusViewModel { ProjectsViewModel(it) }
    val state by vm.state.collectAsState()
    val navigate = LocalNavigate.current
    val snackbar = LocalSnackbar.current
    val scope = rememberCoroutineScope()
    var creating by rememberSaveable { mutableStateOf(false) }
    if (creating) {
        var name by remember { mutableStateOf("") }
        var description by remember { mutableStateOf("") }
        var objective by remember { mutableStateOf("") }
        AlertDialog(onDismissRequest = { creating = false }, containerColor = NexusColors.Surface, title = { Text("Nuevo proyecto") },
            text = {
                Column {
                    NexusTextField(name, { name = it }, "Nombre (p. ej. APEX F1)")
                    Spacer(Modifier.height(6.dp)); NexusTextField(objective, { objective = it }, "Objetivo", singleLine = false)
                    Spacer(Modifier.height(6.dp)); NexusTextField(description, { description = it }, "Descripción", singleLine = false)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    if (name.isNotBlank()) { vm.create(name.trim(), description, objective) { m -> m?.let { scope.launch { snackbar.showSnackbar(it) } } }; creating = false }
                }) { Text("CREAR", color = NexusColors.Cyan) }
            },
            dismissButton = { TextButton(onClick = { creating = false }) { Text("CANCELAR", color = NexusColors.TextSecondary) } })
    }
    Box(Modifier.fillMaxSize()) {
        val data = state.data
        when {
            state.isInitialLoading -> LoadingState()
            data == null -> ErrorState(state.error ?: "", vm::refresh)
            data.isEmpty() -> EmptyState("Sin proyectos", "Los proyectos son espacios permanentes con su propia memoria, archivos, misiones y agentes asignados.",
                icon = Icons.Outlined.Folder, action = { PrimaryButton("Crear proyecto", { creating = true }) })
            else -> LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp, 8.dp, 14.dp, 90.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item { Text("Projects", style = MaterialTheme.typography.headlineSmall, color = NexusColors.TextPrimary) }
                items(data, key = { it.id }) { p ->
                    HudPanel(Modifier.fillMaxWidth(), onClick = { navigate("project/${p.id}") }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(p.name, style = MaterialTheme.typography.titleMedium, color = NexusColors.TextPrimary, modifier = Modifier.weight(1f))
                            StatusChip(if (p.status == "active") "running" else "paused", label = p.status)
                        }
                        if (p.objective.isNotBlank()) Text(p.objective, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 6.dp)) {
                            Tag("${p.counts["missions"] ?: 0} misiones"); Tag("${p.counts["files"] ?: 0} archivos"); Tag("${p.counts["memories"] ?: 0} recuerdos")
                            Tag("${p.agents.size} agentes", NexusColors.Cyan)
                        }
                    }
                }
            }
        }
        ExtendedFloatingActionButton(onClick = { creating = true }, containerColor = NexusColors.Cyan, contentColor = NexusColors.Background,
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp), icon = { Icon(Icons.Outlined.Add, null) }, text = { Text("Proyecto") })
    }
}

data class ProjectBundle(val project: ProjectDto, val files: List<ProjectFileDto>, val missions: List<MissionDto>, val memories: List<MemoryDto>,
                         val agents: Map<String, AgentDto>)

class ProjectDetailViewModel(private val c: AppContainer, private val id: String) : LoadViewModel<ProjectBundle>() {
    init {
        refresh()
        viewModelScope.launch { c.realtime.events.collect { if (it.type == "mission.updated") refresh() } }
    }
    fun refresh() = load {
        ProjectBundle(c.api.project(id), c.api.projectFiles(id), c.api.missions(projectId = id), c.api.memories(scope = "project", projectId = id),
            c.api.agents().associateBy { it.id })
    }
    fun update(body: ProjectUpsert, done: (String?) -> Unit) = action(done, "Proyecto actualizado") { c.api.updateProject(id, body); refresh() }
    fun upload(name: String, mime: String?, bytes: ByteArray, done: (String?) -> Unit) = action(done, "Archivo subido: se indexará en la memoria del proyecto") {
        c.api.uploadFile(id, name, mime, bytes); refresh()
    }
    fun history(path: String, onResult: (List<ProjectFileDto>) -> Unit) { viewModelScope.launch { runCatching { c.api.projectFiles(id, path) }.onSuccess(onResult) } }
    fun chat(onRoute: (String) -> Unit, done: (String?) -> Unit) = action(done) {
        onRoute("chat/${c.api.createConversation(ConversationCreate(title = "Proyecto", projectId = id)).id}")
    }
}

@Composable
fun ProjectDetailScreen(id: String) {
    val vm = nexusViewModel(key = "project-$id") { ProjectDetailViewModel(it, id) }
    val state by vm.state.collectAsState()
    val navigate = LocalNavigate.current
    val snackbar = LocalSnackbar.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val toast: (String?) -> Unit = { msg -> if (msg != null) scope.launch { snackbar.showSnackbar(msg) } }
    var tab by rememberSaveable { mutableStateOf("overview") }
    var history by remember { mutableStateOf<List<ProjectFileDto>?>(null) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        val name = context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: "archivo"
        val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return@rememberLauncherForActivityResult
        vm.upload(name, context.contentResolver.getType(uri), bytes, toast)
    }
    history?.let { h ->
        AlertDialog(onDismissRequest = { history = null }, containerColor = NexusColors.Surface, title = { Text("Versiones de ${h.firstOrNull()?.path}") },
            text = { Column { h.forEach { f -> Text("v${f.version} · ${Time.short(f.createdAt)} · ${f.changeNote ?: ""}", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextPrimary) } } },
            confirmButton = { TextButton(onClick = { history = null }) { Text("CERRAR", color = NexusColors.TextSecondary) } })
    }
    val b = state.data
    when {
        state.isInitialLoading -> LoadingState()
        b == null -> ErrorState(state.error ?: "", vm::refresh)
        else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp)) {
            val p = b.project
            HudPanel(Modifier.fillMaxWidth()) {
                Text(p.name, style = MaterialTheme.typography.headlineSmall, color = NexusColors.TextPrimary)
                Text(p.objective.ifBlank { "Sin objetivo definido" }, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextSecondary)
                Spacer(Modifier.height(10.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PrimaryButton("Nueva misión", { navigate("mission/new/$id") }, Modifier.weight(1f))
                    GhostButton("Chat del proyecto", { vm.chat(navigate, toast) }, Modifier.weight(1f))
                }
            }
            Spacer(Modifier.height(10.dp))
            Row(Modifier.horizontalScroll(rememberScrollState())) {
                SelectChips(listOf("overview" to "Resumen", "agents" to "Agentes", "files" to "Archivos", "missions" to "Misiones", "memory" to "Memoria",
                    "docs" to "Documentación"), tab, { tab = it })
            }
            Spacer(Modifier.height(10.dp))
            when (tab) {
                "overview" -> OverviewTab(b, vm, toast)
                "agents" -> AgentsTab(b, vm, toast)
                "files" -> HudPanel(Modifier.fillMaxWidth(), title = "Archivos (versionados)", action = {
                    Icon(Icons.Outlined.UploadFile, "Subir", tint = NexusColors.Cyan, modifier = Modifier.clickable { picker.launch(arrayOf("*/*")) })
                }) {
                    if (b.files.isEmpty()) Text("Sin archivos. Subí PDF, DOCX, TXT, Markdown o código: se indexan en la memoria del proyecto.",
                        style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
                    b.files.forEach { f ->
                        Row(Modifier.fillMaxWidth().clickable { vm.history(f.path) { history = it } }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(f.path, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextPrimary)
                                Text("v${f.version} · ${f.sizeBytes / 1024} KB · ${f.createdByAgentId?.let { b.agents[it]?.name } ?: "usuario"} · ${Time.relative(f.createdAt)}",
                                    style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
                            }
                            Tag(if (f.indexed) "indexado" else f.indexError?.let { "no indexable" } ?: "indexando…", if (f.indexed) NexusColors.Green else NexusColors.Amber)
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    GhostButton("Subir archivo", { picker.launch(arrayOf("*/*")) }, Modifier.fillMaxWidth(), icon = Icons.Outlined.UploadFile)
                }
                "missions" -> HudPanel(Modifier.fillMaxWidth(), title = "Misiones") {
                    if (b.missions.isEmpty()) Text("Sin misiones en este proyecto.", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
                    b.missions.forEach { m ->
                        Row(Modifier.fillMaxWidth().clickable { navigate("mission/${m.id}") }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(m.title, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextPrimary, modifier = Modifier.weight(1f))
                            StatusChip(m.status)
                        }
                    }
                }
                "memory" -> HudPanel(Modifier.fillMaxWidth(), title = "Memoria del proyecto") {
                    if (b.memories.isEmpty()) Text("Sin recuerdos de proyecto todavía.", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
                    b.memories.take(50).forEach { m ->
                        Column(Modifier.padding(vertical = 5.dp)) {
                            Text(m.title ?: m.kind, style = MaterialTheme.typography.labelMedium, color = NexusColors.Cyan)
                            Text(m.content, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextPrimary, maxLines = 3, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
                else -> DocsTab(b, vm, toast)
            }
            Spacer(Modifier.height(30.dp))
        }
    }
}

@Composable
private fun OverviewTab(b: ProjectBundle, vm: ProjectDetailViewModel, toast: (String?) -> Unit) {
    var name by remember(b.project) { mutableStateOf(b.project.name) }
    var objective by remember(b.project) { mutableStateOf(b.project.objective) }
    var description by remember(b.project) { mutableStateOf(b.project.description) }
    var status by remember(b.project) { mutableStateOf(b.project.status) }
    HudPanel(Modifier.fillMaxWidth(), title = "Datos del proyecto") {
        NexusTextField(name, { name = it }, "Nombre")
        Spacer(Modifier.height(6.dp)); NexusTextField(objective, { objective = it }, "Objetivo", singleLine = false)
        Spacer(Modifier.height(6.dp)); NexusTextField(description, { description = it }, "Descripción", singleLine = false, minLines = 3)
        SectionLabel("Estado")
        SelectChips(listOf("active" to "Activo", "paused" to "Pausado", "archived" to "Archivado"), status, { status = it })
        Spacer(Modifier.height(10.dp))
        PrimaryButton("Guardar", { vm.update(ProjectUpsert(name = name, objective = objective, description = description, status = status), toast) }, Modifier.fillMaxWidth())
        SectionLabel("Historial")
        Text("Creado ${Time.short(b.project.createdAt)} · actualizado ${Time.relative(b.project.updatedAt)}", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
    }
}

@Composable
private fun AgentsTab(b: ProjectBundle, vm: ProjectDetailViewModel, toast: (String?) -> Unit) {
    var assigned by remember(b.project) { mutableStateOf(b.project.agents.associate { it.agentId to it.responsibility }) }
    HudPanel(Modifier.fillMaxWidth(), title = "Agentes asignados") {
        b.agents.values.forEach { a ->
            val on = a.id in assigned
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                AgentAvatar(a.profile.appearance, a.status, 32.dp)
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    Text(a.name, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextPrimary)
                    if (on) NexusTextField(assigned[a.id].orEmpty(), { v -> assigned = assigned + (a.id to v) }, "Responsabilidad en el proyecto")
                }
                ai.nexus.app.features.agents.ToggleRow("", on) { v -> assigned = if (v) assigned + (a.id to a.role) else assigned - a.id }
            }
        }
        Spacer(Modifier.height(8.dp))
        PrimaryButton("Guardar asignaciones", { vm.update(ProjectUpsert(agents = assigned.map { (k, v) -> ProjectAgentDto(k, v) }), toast) }, Modifier.fillMaxWidth())
    }
}

@Composable
private fun DocsTab(b: ProjectBundle, vm: ProjectDetailViewModel, toast: (String?) -> Unit) {
    var docs by remember(b.project) { mutableStateOf(b.project.documentation) }
    HudPanel(Modifier.fillMaxWidth(), title = "Documentación") {
        NexusTextField(docs, { docs = it }, "Documentación del proyecto (Markdown)", singleLine = false, minLines = 10)
        Spacer(Modifier.height(8.dp))
        PrimaryButton("Guardar documentación", { vm.update(ProjectUpsert(documentation = docs), toast) }, Modifier.fillMaxWidth())
    }
}
