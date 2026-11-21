package ai.nexus.app.features.dashboard

import ai.nexus.app.AppContainer
import ai.nexus.app.core.avatar.AgentAvatar
import ai.nexus.app.core.avatar.NexusCore
import ai.nexus.app.core.avatar.isActiveStatus
import ai.nexus.app.core.avatar.statusColor
import ai.nexus.app.core.design.ActivityWave
import ai.nexus.app.core.design.ErrorState
import ai.nexus.app.core.design.HudPanel
import ai.nexus.app.core.design.LoadingState
import ai.nexus.app.core.design.MetricRing
import ai.nexus.app.core.design.Mono
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.StatusChip
import ai.nexus.app.core.design.parseHex
import ai.nexus.app.core.design.statusStyle
import ai.nexus.app.core.realtime.ConnectionState
import ai.nexus.app.core.ui.LoadViewModel
import ai.nexus.app.core.ui.LocalNavigate
import ai.nexus.app.core.ui.LocalSnackbar
import ai.nexus.app.core.ui.Time
import ai.nexus.app.core.ui.appContainer
import ai.nexus.app.core.ui.compact
import ai.nexus.app.core.ui.money
import ai.nexus.app.core.ui.nexusViewModel
import ai.nexus.app.data.model.DashboardDto
import ai.nexus.app.data.model.SystemStatusDto
import ai.nexus.app.voice.speechIntent
import android.app.Activity
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AddTask
import androidx.compose.material.icons.outlined.Chat
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Hub
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.RocketLaunch
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.cos
import kotlin.math.sin

class DashboardViewModel(private val c: AppContainer) : LoadViewModel<DashboardDto>() {
    private val _system = MutableStateFlow<SystemStatusDto?>(null)
    val system: StateFlow<SystemStatusDto?> = _system

    init {
        viewModelScope.launch { seed(c.cached("dashboard", DashboardDto.serializer())) }
        refresh()
        viewModelScope.launch {
            c.realtime.events.collect { e ->
                if (e.type in setOf("agent.status", "mission.updated", "task.updated", "activity.created", "notification.created",
                        "meeting.updated", "system.emergency_stop")) refreshQuiet()
            }
        }
        viewModelScope.launch {
            while (true) {
                runCatching { c.api.systemStatus() }.onSuccess { _system.value = it }
                delay(15_000)
            }
        }
    }

    fun refresh() = load { c.api.dashboard().also { c.store("dashboard", DashboardDto.serializer(), it) } }

    private var pending = false
    private fun refreshQuiet() {
        if (pending) return
        pending = true
        viewModelScope.launch {
            delay(600) // agrupa ráfagas de eventos
            pending = false
            runCatching { c.api.dashboard() }.onSuccess { _state.value = _state.value.copy(data = it, error = null) }
        }
    }

    fun sendToNexus(text: String, onDone: (String) -> Unit) = action({ if (it != null) onDone(it) }) {
        val conv = c.api.conversations().firstOrNull { it.agentId == null } ?: c.api.createConversation(ai.nexus.app.data.model.ConversationCreate())
        c.api.sendMessage(conv.id, text)
        onDone("chat/${conv.id}")
    }
}

@Composable
fun DashboardScreen() {
    val vm = nexusViewModel { DashboardViewModel(it) }
    val state by vm.state.collectAsState()
    val system by vm.system.collectAsState()
    val connection by appContainer().realtime.state.collectAsState()
    val data = state.data
    when {
        state.isInitialLoading -> LoadingState()
        data == null -> ErrorState(state.error ?: "Sin datos", vm::refresh)
        else -> DashboardContent(data, system, connection, onVoice = vm::sendToNexus)
    }
}

/** Contenido del dashboard: solo depende de datos reales recibidos del backend. */
@Composable
fun DashboardContent(
    data: DashboardDto,
    system: SystemStatusDto?,
    connection: ConnectionState,
    onVoice: (String, (String) -> Unit) -> Unit,
) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val columns = when {
            maxWidth >= 1100.dp -> 3
            maxWidth >= 700.dp -> 2
            else -> 1
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 14.dp, vertical = 8.dp)) {
            Header(data, connection)
            Spacer(Modifier.height(10.dp))
            val panels: List<@Composable (Modifier) -> Unit> = listOf(
                { m -> CorePanel(data, connection == ConnectionState.Connected, m) },
                { m -> OverviewPanel(data, m) },
                { m -> AgentsPanel(data, m) },
                { m -> TimelinePanel(data, m) },
                { m -> QuickCommands(m) },
                { m -> SystemMonitor(system, m) },
                { m -> MemoryInsights(data, m) },
                { m -> LlmStatus(data, m) },
                { m -> FeedPanel(data, m) },
                { m -> UsagePanel(data, m) },
            )
            if (columns == 1) {
                panels.forEach { it(Modifier.fillMaxWidth().padding(bottom = 12.dp)) }
            } else {
                panels.chunked(columns).forEach { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        row.forEach { it(Modifier.weight(1f).padding(bottom = 12.dp)) }
                        repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
            }
            TalkToNexus(onVoice)
            Spacer(Modifier.height(20.dp))
        }
    }
}

@Composable
private fun Header(data: DashboardDto, connection: ConnectionState) {
    var now by remember { mutableStateOf(LocalDateTime.now()) }
    LaunchedEffect(Unit) { while (true) { delay(1000); now = LocalDateTime.now() } }
    val hour = now.hour
    val greeting = when (hour) { in 5..11 -> "Buenos días"; in 12..19 -> "Buenas tardes"; else -> "Buenas noches" }
    val ok = !data.emergencyStop && connection == ConnectionState.Connected
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("$greeting, ${data.user.displayName}", style = MaterialTheme.typography.headlineSmall, color = NexusColors.TextPrimary)
            Text(now.format(DateTimeFormatter.ofPattern("EEEE d 'de' MMMM · HH:mm:ss", Locale.forLanguageTag("es"))),
                style = MaterialTheme.typography.bodySmall.copy(fontFamily = Mono), color = NexusColors.TextSecondary)
        }
        Row(
            Modifier.clip(RoundedCornerShape(20.dp)).border(1.dp, (if (ok) NexusColors.Green else NexusColors.Amber).copy(alpha = 0.5f), RoundedCornerShape(20.dp))
                .padding(horizontal = 10.dp, vertical = 5.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("SYSTEM STATUS ", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextSecondary)
            Text(
                when {
                    data.emergencyStop -> "DETENIDO"
                    connection != ConnectionState.Connected -> "SIN TIEMPO REAL"
                    else -> "ÓPTIMO"
                },
                style = MaterialTheme.typography.labelSmall,
                color = if (data.emergencyStop) NexusColors.Red else if (ok) NexusColors.Green else NexusColors.Amber,
            )
        }
    }
}

@Composable
private fun CorePanel(data: DashboardDto, connected: Boolean, modifier: Modifier) {
    HudPanel(modifier, contentPadding = 6.dp) {
        val sub = when {
            data.emergencyStop -> "STOP ALL ACTIVO"
            data.agents.active > 0 -> "${data.agents.active} agente(s) trabajando"
            else -> "En espera · modo ${modeLabel(data.autonomyMode)}"
        }
        NexusCore(data.agents.active, data.emergencyStop, connected, sub, Modifier.fillMaxWidth().height(280.dp))
    }
}

fun modeLabel(mode: String) = when (mode) {
    "manual" -> "manual"
    "scheduled" -> "autonomía programada"
    else -> "autónomo supervisado"
}

@Composable
private fun OverviewPanel(data: DashboardDto, modifier: Modifier) {
    val navigate = LocalNavigate.current
    HudPanel(modifier, title = "AI Core Overview") {
        OverviewRow(Icons.Outlined.Psychology, "Agentes", "${data.agents.active} activos de ${data.agents.total}", NexusColors.Cyan) { navigate("agents") }
        OverviewRow(Icons.Outlined.RocketLaunch, "Misiones", "${data.missions.running} en ejecución · ${data.missions.pending} pendientes", NexusColors.Violet) { navigate("missions") }
        OverviewRow(Icons.Outlined.Memory, "Memoria", "${data.memories} recuerdos", NexusColors.Green) { navigate("memory") }
        OverviewRow(Icons.Outlined.Hub, "LLMs", "${data.providers.count { it.status == "ok" && it.isEnabled }} conectados de ${data.providers.size}", NexusColors.Pink) { navigate("settings/providers") }
        OverviewRow(Icons.Outlined.PanTool, "Aprobaciones", if (data.pendingApprovals > 0) "${data.pendingApprovals} esperando tu decisión" else "Ninguna pendiente",
            if (data.pendingApprovals > 0) NexusColors.Amber else NexusColors.TextSecondary) { navigate("approvals") }
        OverviewRow(Icons.Outlined.Shield, "Sistema", if (data.emergencyStop) "STOP ALL activo" else "Operativo · ${data.tasks.completedToday} tareas hoy",
            if (data.emergencyStop) NexusColors.Red else NexusColors.Green) { navigate("activity") }
    }
}

@Composable
private fun OverviewRow(icon: ImageVector, title: String, value: String, color: Color, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 3.dp).clip(RoundedCornerShape(10.dp)).background(NexusColors.Background.copy(alpha = 0.5f))
            .border(1.dp, color.copy(alpha = 0.18f), RoundedCornerShape(10.dp)).clickable(onClick = onClick).padding(10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(30.dp).clip(CircleShape).background(color.copy(alpha = 0.12f)), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = color, modifier = Modifier.size(17.dp))
        }
        Spacer(Modifier.width(10.dp))
        Column {
            Text(title, style = MaterialTheme.typography.titleSmall, color = NexusColors.TextPrimary)
            Text(value, style = MaterialTheme.typography.bodySmall, color = color)
        }
    }
}

@Composable
private fun AgentsPanel(data: DashboardDto, modifier: Modifier) {
    val navigate = LocalNavigate.current
    HudPanel(modifier, title = "Active Agents", action = {
        Text("VER TODOS ›", style = MaterialTheme.typography.labelSmall, color = NexusColors.Cyan, modifier = Modifier.clickable { navigate("agents") })
    }) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), maxItemsInEachRow = 2) {
            data.agents.items.forEach { a ->
                val color = statusColor(a.status)
                Column(
                    Modifier.weight(1f).clip(RoundedCornerShape(12.dp)).background(NexusColors.Background.copy(alpha = 0.55f))
                        .border(1.dp, parseHex(a.color).copy(alpha = 0.3f), RoundedCornerShape(12.dp)).clickable { navigate("agent/${a.id}") }.padding(10.dp),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        AgentAvatar(a.appearance, a.status, 36.dp)
                        Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f)) {
                            Text(a.name, style = MaterialTheme.typography.titleSmall, color = NexusColors.TextPrimary)
                            Text("● " + statusStyle(a.status).label, style = MaterialTheme.typography.labelSmall, color = color)
                        }
                    }
                    Spacer(Modifier.height(6.dp))
                    ActivityWave(isActiveStatus(a.status), parseHex(a.color), Modifier.fillMaxWidth())
                    Text(a.statusDetail ?: a.role, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

@Composable
private fun TimelinePanel(data: DashboardDto, modifier: Modifier) {
    val navigate = LocalNavigate.current
    HudPanel(modifier, title = "Mission Timeline", action = {
        Text("VER MISIONES ›", style = MaterialTheme.typography.labelSmall, color = NexusColors.Cyan, modifier = Modifier.clickable { navigate("missions") })
    }) {
        if (data.timeline.isEmpty()) {
            Text("Todavía no hay misiones. Creá la primera desde Quick Commands.", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
        }
        data.timeline.forEach { m ->
            Row(Modifier.fillMaxWidth().clickable { navigate("mission/${m.id}") }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(Time.clock(m.updatedAt), style = MaterialTheme.typography.labelSmall.copy(fontFamily = Mono), color = NexusColors.TextSecondary, modifier = Modifier.width(44.dp))
                Box(Modifier.size(8.dp).clip(CircleShape).background(statusStyle(m.status).color))
                Spacer(Modifier.width(10.dp))
                Text(m.title, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextPrimary, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                StatusChip(m.status)
            }
        }
    }
}

@Composable
private fun QuickCommands(modifier: Modifier) {
    val navigate = LocalNavigate.current
    HudPanel(modifier, title = "Quick Commands") {
        QuickCommand(Icons.Outlined.AddTask, "Nueva misión") { navigate("mission/new") }
        QuickCommand(Icons.Outlined.Chat, "Hablar con NEXUS") { navigate("chat") }
        QuickCommand(Icons.Outlined.Groups, "Convocar reunión") { navigate("meeting/new") }
        QuickCommand(Icons.Outlined.Psychology, "Crear agente") { navigate("agent/new") }
    }
}

@Composable
private fun QuickCommand(icon: ImageVector, label: String, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 3.dp).clip(RoundedCornerShape(10.dp)).border(1.dp, NexusColors.Border, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = NexusColors.Cyan, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(10.dp))
        Text(label, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextPrimary)
    }
}

@Composable
private fun SystemMonitor(system: SystemStatusDto?, modifier: Modifier) {
    HudPanel(modifier, title = "System Monitor (servidor)") {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
            MetricRing("CPU", system?.server?.cpu?.toFloat(), color = NexusColors.Cyan)
            MetricRing("RAM", system?.server?.memory?.toFloat(), color = NexusColors.Violet)
            MetricRing("Disco", system?.server?.disk?.toFloat(), color = NexusColors.Green)
        }
        Spacer(Modifier.height(8.dp))
        Text(
            if (system == null) "Esperando métricas del servidor…"
            else "Cola: ${system.queue.queued} en espera · ${system.queue.running} en ejecución · Push ${if (system.pushConfigured) "activo" else "no configurado"}",
            style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary,
        )
    }
}

@Composable
private fun MemoryInsights(data: DashboardDto, modifier: Modifier) {
    val navigate = LocalNavigate.current
    HudPanel(modifier, title = "Memory Insights", onClick = { navigate("memory") }) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            // Constelación: un nodo por cada 10 recuerdos reales (máx. 18).
            val nodes = (data.memories / 10 + if (data.memories % 10 > 0) 1 else 0).coerceAtMost(18)
            Canvas(Modifier.weight(1f).height(90.dp)) {
                val pts = List(nodes) { i ->
                    val a = i * 2.4f
                    val r = (0.15f + 0.8f * ((i * 37) % 100) / 100f)
                    Offset(size.width / 2 + cos(a) * r * size.width / 2.2f, size.height / 2 + sin(a) * r * size.height / 2.2f)
                }
                pts.zipWithNext().forEach { (p, q) -> drawLine(NexusColors.Cyan.copy(alpha = 0.3f), p, q, 1f) }
                pts.forEach { drawCircle(NexusColors.Cyan, 3f, it); drawCircle(NexusColors.Cyan.copy(alpha = 0.2f), 7f, it) }
            }
            Column(Modifier.padding(start = 10.dp)) {
                Text("Recuerdos", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextSecondary)
                Text("${data.memories}", style = MaterialTheme.typography.titleLarge.copy(fontFamily = Mono), color = NexusColors.TextPrimary)
                Text("Reuniones activas", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextSecondary)
                Text("${data.meetingsActive}", style = MaterialTheme.typography.titleMedium.copy(fontFamily = Mono), color = NexusColors.TextPrimary)
            }
        }
    }
}

@Composable
private fun LlmStatus(data: DashboardDto, modifier: Modifier) {
    val navigate = LocalNavigate.current
    HudPanel(modifier, title = "LLM Status", action = {
        Text("GESTIONAR ›", style = MaterialTheme.typography.labelSmall, color = NexusColors.Cyan, modifier = Modifier.clickable { navigate("settings/providers") })
    }) {
        if (data.providers.isEmpty()) {
            Text("Ningún proveedor configurado. Los agentes necesitan al menos un modelo para trabajar.", style = MaterialTheme.typography.bodySmall, color = NexusColors.Amber)
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), maxItemsInEachRow = 2) {
            data.providers.forEach { p ->
                val style = statusStyle(if (!p.isEnabled) "paused" else if (p.status == "error") "error" else p.status)
                Column(Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).border(1.dp, style.color.copy(alpha = 0.3f), RoundedCornerShape(10.dp)).padding(10.dp)) {
                    Text(p.name, style = MaterialTheme.typography.titleSmall, color = NexusColors.TextPrimary, maxLines = 1)
                    Text("${if (p.isEnabled) style.label else "Desactivado"} · ${p.models} modelo(s)", style = MaterialTheme.typography.labelSmall, color = style.color)
                }
            }
        }
    }
}

@Composable
private fun FeedPanel(data: DashboardDto, modifier: Modifier) {
    val navigate = LocalNavigate.current
    HudPanel(modifier, title = "Live Intelligence Feed", action = {
        Text("VER ACTIVIDAD ›", style = MaterialTheme.typography.labelSmall, color = NexusColors.Cyan, modifier = Modifier.clickable { navigate("activity") })
    }) {
        data.alerts.forEach { a ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp).clip(RoundedCornerShape(8.dp)).background(NexusColors.Amber.copy(alpha = 0.08f)).padding(8.dp)) {
                Column(Modifier.weight(1f)) {
                    Text(a.title, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(a.body, style = MaterialTheme.typography.labelSmall, color = NexusColors.TextSecondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Text(if (a.eventType == "approval_requested") "ACCIÓN" else "ALERTA", style = MaterialTheme.typography.labelSmall, color = NexusColors.Amber)
            }
        }
        if (data.recentActivity.isEmpty() && data.alerts.isEmpty()) {
            Text("Sin actividad todavía.", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
        }
        data.recentActivity.take(6).forEach { a ->
            Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(6.dp).clip(CircleShape).background(statusStyle(a.outcome).color))
                Spacer(Modifier.width(8.dp))
                Text(a.summary, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextPrimary, modifier = Modifier.weight(1f), maxLines = 2, overflow = TextOverflow.Ellipsis)
                Text(Time.relative(a.createdAt), style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
            }
        }
    }
}

@Composable
private fun UsagePanel(data: DashboardDto, modifier: Modifier) {
    val navigate = LocalNavigate.current
    HudPanel(modifier, title = "Consumo de modelos", onClick = { navigate("settings/budgets") }) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            UsageStat("Tokens hoy", compact(data.usage.tokensToday))
            UsageStat("Costo hoy", money(data.usage.costTodayUsd))
            UsageStat("Llamadas", "${data.usage.callsToday}")
            UsageStat("Mes", money(data.usage.costMonthUsd))
        }
    }
}

@Composable
private fun UsageStat(label: String, value: String) {
    Column {
        Text(label, style = MaterialTheme.typography.labelSmall, color = NexusColors.TextSecondary)
        Text(value, style = MaterialTheme.typography.titleSmall.copy(fontFamily = Mono), color = NexusColors.TextPrimary)
    }
}

@Composable
private fun TalkToNexus(onVoice: (String, (String) -> Unit) -> Unit) {
    val navigate = LocalNavigate.current
    val snackbar = LocalSnackbar.current
    val scope = rememberCoroutineScope()
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val text = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)?.firstOrNull()
        if (result.resultCode == Activity.RESULT_OK && !text.isNullOrBlank()) {
            onVoice(text) { route -> if (route.startsWith("chat/")) navigate(route) else scope.launch { snackbar.showSnackbar(route) } }
        }
    }
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp))
            .background(Brush.horizontalGradient(listOf(NexusColors.Cyan.copy(alpha = 0.05f), NexusColors.Cyan.copy(alpha = 0.18f), NexusColors.Cyan.copy(alpha = 0.05f))))
            .border(1.dp, NexusColors.Cyan.copy(alpha = 0.6f), RoundedCornerShape(28.dp))
            .clickable {
                try { launcher.launch(speechIntent()) } catch (_: Exception) {
                    scope.launch { snackbar.showSnackbar("Este dispositivo no tiene reconocimiento de voz; abrí el chat para escribir.") }
                }
            }
            .padding(vertical = 14.dp, horizontal = 18.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        Icon(Icons.Outlined.Mic, null, tint = NexusColors.Cyan)
        Spacer(Modifier.width(10.dp))
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("TALK TO NEXUS", style = MaterialTheme.typography.labelLarge, color = NexusColors.Cyan)
            Text("Tocá para dictar una instrucción", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextSecondary)
        }
    }
}
