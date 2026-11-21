package ai.nexus.app.features.approvals

import ai.nexus.app.AppContainer
import ai.nexus.app.core.design.EmptyState
import ai.nexus.app.core.design.ErrorState
import ai.nexus.app.core.design.GhostButton
import ai.nexus.app.core.design.HudPanel
import ai.nexus.app.core.design.KeyValue
import ai.nexus.app.core.design.LoadingState
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.PrimaryButton
import ai.nexus.app.core.design.SelectChips
import ai.nexus.app.core.design.StatusChip
import ai.nexus.app.core.design.Tag
import ai.nexus.app.core.ui.LoadViewModel
import ai.nexus.app.core.ui.LocalNavigate
import ai.nexus.app.core.ui.LocalSnackbar
import ai.nexus.app.core.ui.Time
import ai.nexus.app.core.ui.nexusViewModel
import ai.nexus.app.data.model.AgentDto
import ai.nexus.app.data.model.ApprovalDto
import ai.nexus.app.data.model.NotificationDto
import ai.nexus.app.push.NotificationHelper
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

data class ApprovalsData(val items: List<ApprovalDto>, val agents: Map<String, AgentDto>)

class ApprovalsViewModel(private val c: AppContainer) : LoadViewModel<ApprovalsData>() {
    val filter = mutableStateOf("pending")
    init {
        refresh()
        viewModelScope.launch { c.realtime.events.collect { if (it.type == "approval.created" || it.type == "task.updated") refresh() } }
    }
    fun refresh() = load { ApprovalsData(c.api.approvals(filter.value), c.api.agents().associateBy { it.id }) }
    fun decide(id: String, approve: Boolean, done: (String?) -> Unit) = action(done, if (approve) "Aprobado: el agente continúa" else "Rechazado: la operación no se ejecutará") {
        c.api.decide(id, approve); refresh()
    }
}

private val OP_LABELS = mapOf("modification" to "Modificación", "external_communication" to "Comunicación externa", "irreversible" to "Irreversible",
    "creation" to "Creación", "read" to "Lectura")

@Composable
fun ApprovalsScreen() {
    val vm = nexusViewModel { ApprovalsViewModel(it) }
    val state by vm.state.collectAsState()
    val snackbar = LocalSnackbar.current
    val navigate = LocalNavigate.current
    val scope = rememberCoroutineScope()
    val toast: (String?) -> Unit = { msg -> if (msg != null) scope.launch { snackbar.showSnackbar(msg) } }
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 8.dp)) {
            Text("Aprobaciones", style = MaterialTheme.typography.headlineSmall, color = NexusColors.TextPrimary)
            Text("Las operaciones sensibles esperan tu decisión. Nada se ejecuta sin ella.", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
            Spacer(Modifier.height(6.dp))
            SelectChips(listOf("pending" to "Pendientes", "all" to "Historial"), vm.filter.value, { vm.filter.value = it; vm.refresh() })
        }
        val data = state.data
        when {
            state.isInitialLoading -> LoadingState()
            data == null -> ErrorState(state.error ?: "", vm::refresh)
            data.items.isEmpty() -> EmptyState("Nada pendiente", "Cuando un agente necesite autorización para una acción sensible, aparecerá acá y recibirás una notificación.", icon = Icons.Outlined.PanTool)
            else -> LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp, 0.dp, 14.dp, 40.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(data.items, key = { it.id }) { a -> ApprovalCard(a, data.agents, vm, toast) { a.missionId?.let { navigate("mission/$it") } } }
            }
        }
    }
}

@Composable
private fun ApprovalCard(a: ApprovalDto, agents: Map<String, AgentDto>, vm: ApprovalsViewModel, toast: (String?) -> Unit, onOpenMission: () -> Unit) {
    fun d(k: String) = (a.details[k] as? JsonPrimitive)?.contentOrNull
    HudPanel(Modifier.fillMaxWidth(), accent = NexusColors.Amber) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(a.title, style = MaterialTheme.typography.titleSmall, color = NexusColors.TextPrimary, modifier = Modifier.weight(1f))
            StatusChip(a.status)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(vertical = 6.dp)) {
            Tag(when (a.kind) { "tool" -> "Operación"; "task" -> "Tarea"; "mission_plan" -> "Plan de misión"; else -> a.kind }, NexusColors.Cyan)
            a.operationClass?.let { Tag(OP_LABELS[it] ?: it, NexusColors.Amber) }
            a.agentId?.let { agents[it]?.name }?.let { Tag(it) }
        }
        d("reason")?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary) }
        d("tool")?.let { KeyValue("Herramienta", it) }
        (a.details["arguments"] as? JsonObject)?.forEach { (k, v) ->
            val text = (v as? JsonPrimitive)?.contentOrNull ?: v.toString()
            KeyValue(k, text.take(160))
        }
        d("description")?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextPrimary) }
        Text("Solicitado ${Time.relative(a.createdAt)}${a.expiresAt?.let { " · vence ${Time.short(it)}" } ?: ""}", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
        if (a.status == "pending") {
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                PrimaryButton("Aprobar", { vm.decide(a.id, true, toast) }, Modifier.weight(1f))
                GhostButton("Rechazar", { vm.decide(a.id, false, toast) }, Modifier.weight(1f), color = NexusColors.Red)
            }
        }
        if (a.missionId != null) Text("VER MISIÓN ›", style = MaterialTheme.typography.labelSmall, color = NexusColors.Cyan,
            modifier = Modifier.padding(top = 8.dp).clickable(onClick = onOpenMission))
    }
}

class NotificationsViewModel(private val c: AppContainer) : LoadViewModel<List<NotificationDto>>() {
    init {
        refresh()
        viewModelScope.launch { c.realtime.events.collect { if (it.type == "notification.created") refresh() } }
    }
    fun refresh() = load {
        c.api.notifications().also { list -> list.maxByOrNull { it.createdAt }?.let { c.session.setLastNotificationSeen(it.createdAt) } }
    }
    fun read(id: String) = action { c.api.markRead(id); refresh() }
    fun readAll() = action { c.api.markAllRead(); refresh() }
}

@Composable
fun NotificationsScreen() {
    val vm = nexusViewModel { NotificationsViewModel(it) }
    val state by vm.state.collectAsState()
    val navigate = LocalNavigate.current
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Notificaciones", style = MaterialTheme.typography.headlineSmall, color = NexusColors.TextPrimary, modifier = Modifier.weight(1f))
            Text("MARCAR TODO LEÍDO", style = MaterialTheme.typography.labelSmall, color = NexusColors.Cyan, modifier = Modifier.clickable { vm.readAll() })
        }
        val data = state.data
        when {
            state.isInitialLoading -> LoadingState()
            data == null -> ErrorState(state.error ?: "", vm::refresh)
            data.isEmpty() -> EmptyState("Sin notificaciones", "Te avisaremos cuando una misión termine, se bloquee, haya un error o un agente necesite tu aprobación.",
                icon = Icons.Outlined.Notifications)
            else -> LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp, 0.dp, 14.dp, 40.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(data, key = { it.id }) { n ->
                    val unread = n.readAt == null
                    HudPanel(Modifier.fillMaxWidth(), contentPadding = 12.dp, accent = if (unread) NexusColors.Cyan else NexusColors.TextMuted, onClick = {
                        vm.read(n.id)
                        val dataMap = n.data.mapValues { (it.value as? JsonPrimitive)?.contentOrNull.orEmpty() }
                        navigate(NotificationHelper.routeFor(n.eventType, dataMap))
                    }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            if (unread) Box(Modifier.size(8.dp).clip(CircleShape).background(NexusColors.Cyan))
                            if (unread) Spacer(Modifier.width(8.dp))
                            Text(n.title, style = MaterialTheme.typography.titleSmall, color = NexusColors.TextPrimary, modifier = Modifier.weight(1f))
                            Text(Time.relative(n.createdAt), style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
                        }
                        Text(n.body, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary, maxLines = 4)
                    }
                }
            }
        }
    }
}
