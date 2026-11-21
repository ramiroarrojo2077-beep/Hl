package ai.nexus.app.features.activity

import ai.nexus.app.AppContainer
import ai.nexus.app.core.avatar.AgentAvatar
import ai.nexus.app.core.design.EmptyState
import ai.nexus.app.core.design.ErrorState
import ai.nexus.app.core.design.HudPanel
import ai.nexus.app.core.design.LoadingState
import ai.nexus.app.core.design.Mono
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.SelectChips
import ai.nexus.app.core.design.Tag
import ai.nexus.app.core.design.statusStyle
import ai.nexus.app.core.ui.LoadViewModel
import ai.nexus.app.core.ui.LocalNavigate
import ai.nexus.app.core.ui.Time
import ai.nexus.app.core.ui.money
import ai.nexus.app.core.ui.nexusViewModel
import ai.nexus.app.data.model.ActivityDto
import ai.nexus.app.data.model.AgentDto
import ai.nexus.app.data.model.MissionDto
import ai.nexus.app.data.model.ProjectDto
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.History
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import java.time.OffsetDateTime

data class ActivityData(
    val items: List<ActivityDto>, val agents: Map<String, AgentDto>, val missions: List<MissionDto>, val projects: List<ProjectDto>,
    val hasMore: Boolean,
)

class ActivityViewModel(private val c: AppContainer) : LoadViewModel<ActivityData>() {
    val agent = mutableStateOf<String?>(null)
    val mission = mutableStateOf<String?>(null)
    val project = mutableStateOf<String?>(null)
    val outcome = mutableStateOf<String?>(null)
    val range = mutableStateOf("7d")

    init {
        refresh()
        viewModelScope.launch { c.realtime.events.collect { if (it.type == "activity.created") refresh() } }
    }

    private fun from(): String? = when (range.value) {
        "today" -> OffsetDateTime.now().withHour(0).withMinute(0).withSecond(0).toString()
        "7d" -> OffsetDateTime.now().minusDays(7).toString()
        "30d" -> OffsetDateTime.now().minusDays(30).toString()
        else -> null
    }

    fun refresh() = load {
        val items = c.api.activity(agent.value, mission.value, project.value, outcome.value, from())
        ActivityData(items, c.api.agents().associateBy { it.id }, c.api.missions(), c.api.projects(), items.size >= 50)
    }

    fun loadMore() {
        val current = state.value.data ?: return
        viewModelScope.launch {
            runCatching { c.api.activity(agent.value, mission.value, project.value, outcome.value, from(), before = current.items.last().createdAt) }
                .onSuccess { more -> _state.value = _state.value.copy(data = current.copy(items = current.items + more, hasMore = more.size >= 50)) }
        }
    }
}

@Composable
fun ActivityScreen() {
    val vm = nexusViewModel { ActivityViewModel(it) }
    val state by vm.state.collectAsState()
    val navigate = LocalNavigate.current
    val data = state.data
    Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(horizontal = 14.dp, vertical = 8.dp)) {
            Text("Activity Center", style = MaterialTheme.typography.headlineSmall, color = NexusColors.TextPrimary)
            Text("Registro de auditoría: cada entrada corresponde a una acción real.", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
            Spacer(Modifier.height(6.dp))
            Row(Modifier.horizontalScroll(rememberScrollState())) {
                SelectChips(listOf("today" to "Hoy", "7d" to "7 días", "30d" to "30 días", "all" to "Todo"), vm.range.value, { vm.range.value = it; vm.refresh() })
            }
            Spacer(Modifier.height(6.dp))
            Row(Modifier.horizontalScroll(rememberScrollState())) {
                SelectChips(listOf("" to "Todos los resultados", "success" to "OK", "failure" to "Errores", "blocked" to "Bloqueadas", "info" to "Info"),
                    vm.outcome.value ?: "", { vm.outcome.value = it.ifEmpty { null }; vm.refresh() })
            }
            if (data != null) {
                Spacer(Modifier.height(6.dp))
                Row(Modifier.horizontalScroll(rememberScrollState())) {
                    SelectChips(listOf("" to "Todos los agentes") + data.agents.values.map { it.id to it.name }, vm.agent.value ?: "",
                        { vm.agent.value = it.ifEmpty { null }; vm.refresh() })
                }
                if (data.missions.isNotEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    Row(Modifier.horizontalScroll(rememberScrollState())) {
                        SelectChips(listOf("" to "Todas las misiones") + data.missions.take(15).map { it.id to it.title.take(24) }, vm.mission.value ?: "",
                            { vm.mission.value = it.ifEmpty { null }; vm.refresh() })
                    }
                }
                if (data.projects.isNotEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    Row(Modifier.horizontalScroll(rememberScrollState())) {
                        SelectChips(listOf("" to "Todos los proyectos") + data.projects.map { it.id to it.name }, vm.project.value ?: "",
                            { vm.project.value = it.ifEmpty { null }; vm.refresh() })
                    }
                }
            }
        }
        when {
            state.isInitialLoading -> LoadingState()
            data == null -> ErrorState(state.error ?: "", vm::refresh)
            data.items.isEmpty() -> EmptyState("Sin actividad", "No hay registros con estos filtros.", icon = Icons.Outlined.History)
            else -> LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp, 0.dp, 14.dp, 40.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(data.items, key = { it.id }) { a ->
                    val agent = a.agentId?.let { data.agents[it] }
                    HudPanel(Modifier.fillMaxWidth().clickable(enabled = a.missionId != null) { navigate("mission/${a.missionId}") }, contentPadding = 12.dp,
                        accent = statusStyle(a.outcome).color) {
                        Row(verticalAlignment = Alignment.Top) {
                            if (agent != null) AgentAvatar(agent.profile.appearance, "idle", 32.dp)
                            else Box(Modifier.size(32.dp).clip(CircleShape).background(NexusColors.TextMuted.copy(alpha = 0.2f)), contentAlignment = Alignment.Center) {
                                Text(if (a.actorType == "user") "TÚ" else "SYS", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextSecondary)
                            }
                            Spacer(Modifier.width(10.dp))
                            Column(Modifier.weight(1f)) {
                                Text(a.summary, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextPrimary)
                                Row(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.padding(top = 4.dp)) {
                                    Tag(a.action)
                                    Tag(statusStyle(a.outcome).label, statusStyle(a.outcome).color)
                                    a.modelUsed?.let { Tag(it) }
                                }
                                Text(
                                    "${Time.short(a.createdAt)}${a.tokens?.let { " · $it tokens" } ?: ""}${a.costUsd?.let { " · ${money(it)}" } ?: ""}",
                                    style = MaterialTheme.typography.labelSmall.copy(fontFamily = Mono), color = NexusColors.TextMuted,
                                )
                            }
                        }
                    }
                }
                if (data.hasMore) item {
                    Text("CARGAR MÁS", style = MaterialTheme.typography.labelMedium, color = NexusColors.Cyan,
                        modifier = Modifier.fillMaxWidth().clickable { vm.loadMore() }.padding(16.dp))
                }
            }
        }
    }
}
