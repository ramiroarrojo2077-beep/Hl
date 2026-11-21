package ai.nexus.app.features.agents

import ai.nexus.app.AppContainer
import ai.nexus.app.core.avatar.AgentFigure
import ai.nexus.app.core.avatar.isActiveStatus
import ai.nexus.app.core.design.ActivityWave
import ai.nexus.app.core.design.ErrorState
import ai.nexus.app.core.design.GhostButton
import ai.nexus.app.core.design.HudPanel
import ai.nexus.app.core.design.LoadingState
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.StatusChip
import ai.nexus.app.core.design.Tag
import ai.nexus.app.core.design.parseHex
import ai.nexus.app.core.ui.LoadViewModel
import ai.nexus.app.core.ui.LocalNavigate
import ai.nexus.app.core.ui.LocalSnackbar
import ai.nexus.app.core.ui.Time
import ai.nexus.app.core.ui.nexusViewModel
import ai.nexus.app.data.model.AgentDto
import androidx.compose.foundation.background
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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Chat
import androidx.compose.material.icons.outlined.Face
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer

class AgentsViewModel(private val c: AppContainer) : LoadViewModel<List<AgentDto>>() {
    init {
        viewModelScope.launch { seed(c.cached("agents", ListSerializer(AgentDto.serializer()))) }
        refresh()
        viewModelScope.launch {
            c.realtime.events.collect { e ->
                when (e.type) {
                    "agent.status" -> {
                        val id = e.str("agent_id")
                        _state.value = _state.value.copy(data = _state.value.data?.map {
                            if (it.id == id) it.copy(status = e.str("status") ?: it.status, statusDetail = e.str("detail")) else it
                        })
                    }
                    "agent.updated" -> refresh()
                }
            }
        }
    }

    fun refresh() = load { c.api.agents().also { c.store("agents", ListSerializer(AgentDto.serializer()), it) } }

    fun openConversation(agentId: String, onRoute: (String) -> Unit, onError: (String) -> Unit) = action({ if (it != null) onError(it) }) {
        onRoute("chat/${c.api.agentConversation(agentId).id}")
    }
}

@Composable
fun AgentsScreen() {
    val vm = nexusViewModel { AgentsViewModel(it) }
    val state by vm.state.collectAsState()
    val navigate = LocalNavigate.current
    val snackbar = LocalSnackbar.current
    val scope = rememberCoroutineScope()
    Box(Modifier.fillMaxSize()) {
        when {
            state.isInitialLoading -> LoadingState()
            state.data == null -> ErrorState(state.error ?: "", vm::refresh)
            else -> LazyVerticalGrid(
                columns = GridCells.Adaptive(300.dp),
                modifier = Modifier.fillMaxSize(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(14.dp, 8.dp, 14.dp, 90.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Column {
                        Text("Agent Center", style = MaterialTheme.typography.headlineSmall, color = NexusColors.TextPrimary)
                        Text("${state.data!!.size} agentes · ${state.data!!.count { isActiveStatus(it.status) }} trabajando ahora",
                            style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
                    }
                }
                items(state.data!!, key = { it.id }) { agent ->
                    AgentCard(
                        agent,
                        onOpen = { navigate("agent/${agent.id}") },
                        onChat = { vm.openConversation(agent.id, navigate) { msg -> scope.launch { snackbar.showSnackbar(msg) } } },
                        onEdit = { navigate("agent/${agent.id}/edit") },
                    )
                }
            }
        }
        ExtendedFloatingActionButton(
            onClick = { navigate("agent/new") },
            containerColor = NexusColors.Cyan, contentColor = NexusColors.Background,
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
            icon = { Icon(Icons.Outlined.Add, null) }, text = { Text("Nuevo agente") },
        )
    }
}

@Composable
private fun AgentCard(agent: AgentDto, onOpen: () -> Unit, onChat: () -> Unit, onEdit: () -> Unit) {
    val accent = parseHex(agent.profile.appearance.accent)
    HudPanel(Modifier.fillMaxWidth(), accent = accent, onClick = onOpen) {
        Row {
            Box(
                Modifier.width(110.dp).height(190.dp).clip(RoundedCornerShape(12.dp))
                    .background(Brush.verticalGradient(listOf(accent.copy(alpha = 0.10f), NexusColors.Background.copy(alpha = 0.6f)))),
            ) {
                AgentFigure(agent.profile.appearance, agent.status, Modifier.fillMaxSize())
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(agent.name, style = MaterialTheme.typography.titleLarge, color = NexusColors.TextPrimary)
                Text(agent.role, style = MaterialTheme.typography.bodySmall, color = accent)
                Spacer(Modifier.height(6.dp))
                StatusChip(agent.status)
                Spacer(Modifier.height(6.dp))
                Text(agent.statusDetail ?: "Sin tarea en curso", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary,
                    maxLines = 2, overflow = TextOverflow.Ellipsis)
                ActivityWave(isActiveStatus(agent.status), accent, Modifier.fillMaxWidth().padding(vertical = 4.dp))
                Tag(agent.primaryModel ?: "Sin modelo configurado", if (agent.primaryModel == null) NexusColors.Amber else NexusColors.TextSecondary)
                Spacer(Modifier.height(4.dp))
                Text("Última actividad: ${Time.relative(agent.lastActivityAt)}", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
                if (!agent.isEnabled) Text("DESHABILITADO", style = MaterialTheme.typography.labelSmall, color = NexusColors.Red)
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            GhostButton("Conversar", onChat, Modifier.weight(1f), icon = Icons.Outlined.Chat)
            GhostButton("Personaje", onEdit, Modifier.weight(1f), color = accent, icon = Icons.Outlined.Face)
        }
    }
}
