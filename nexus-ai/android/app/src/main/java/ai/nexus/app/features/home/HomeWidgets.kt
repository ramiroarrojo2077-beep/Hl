package ai.nexus.app.features.home

import ai.nexus.app.core.avatar.AgentAvatar
import ai.nexus.app.core.avatar.isActiveStatus
import ai.nexus.app.core.avatar.statusColor
import ai.nexus.app.core.design.HudPanel
import ai.nexus.app.core.design.LocalVisualPrefs
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.Orbitron
import ai.nexus.app.core.design.statusStyle
import ai.nexus.app.core.ui.Time
import ai.nexus.app.data.model.DashboardDto
import ai.nexus.app.data.model.JarvisContextDto
import ai.nexus.app.data.model.JarvisStateDto
import ai.nexus.app.data.model.QuickActionPref
import ai.nexus.app.data.model.VoicePrefs
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Hub
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.RocketLaunch
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import java.time.LocalDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.sin

/** Elemento del feed en vivo: todo sale de datos reales del backend. */
data class FeedItem(val title: String, val subtitle: String, val badge: String, val color: Color, val icon: ImageVector, val route: String?)

fun buildFeed(ctx: JarvisContextDto?, state: JarvisStateDto?, pending: Int): List<FeedItem> {
    val out = mutableListOf<FeedItem>()
    val c = ctx?.counts
    if (pending > 0) out += FeedItem("$pending ${if (pending == 1) "acción espera" else "acciones esperan"} tu confirmación", "Revisalas antes de ejecutar",
        "WARN", NexusColors.Amber, Icons.Outlined.Warning, "actions")
    if ((state?.pendingApprovals ?: 0) > 0) out += FeedItem("${state!!.pendingApprovals} aprobaciones de agentes", "Pedidos de permisos", "WARN",
        NexusColors.Amber, Icons.Outlined.PanTool, "approvals")
    if ((c?.missionsBlocked ?: 0) > 0) out += FeedItem("${c!!.missionsBlocked} ${if (c.missionsBlocked == 1) "misión bloqueada" else "misiones bloqueadas"}",
        "Necesita revisión", "ALERT", NexusColors.Red, Icons.Outlined.Shield, "missions")
    if ((c?.missionsRunning ?: 0) > 0 || (state?.runningTasks ?: 0) > 0) out += FeedItem("Trabajando en ${c?.missionsRunning ?: 0} misiones",
        "${state?.runningTasks ?: 0} tareas en ejecución", "LIVE", NexusColors.Green, Icons.Outlined.RocketLaunch, "missions")
    ctx?.finishedMissions?.take(2)?.forEach { m -> out += FeedItem(m.title, "Misión completada", "INFO", NexusColors.Cyan, Icons.Outlined.CheckCircle, "mission/${m.id}") }
    ctx?.remindersToday?.forEach { r -> out += FeedItem(r.title, "Recordatorio · hoy a las ${Time.clock(r.at)}", "TIP", NexusColors.Violet, Icons.Outlined.Schedule, null) }
    if ((c?.unreadNotifications ?: 0) > 0) out += FeedItem("${c!!.unreadNotifications} notificaciones sin leer", "Avisos de tus agentes", "INFO",
        NexusColors.Cyan, Icons.Outlined.NotificationsActive, "notifications")
    if ((c?.activeAutomations ?: 0) > 0) out += FeedItem("${c!!.activeAutomations} rutinas activas", "Automatizaciones en marcha", "TIP", NexusColors.Violet,
        Icons.Outlined.AutoAwesome, "actions")
    if (out.isEmpty()) out += FeedItem("Todo en orden", "Sin pendientes. ¿Qué hacemos hoy?", "INFO", NexusColors.Cyan, Icons.Outlined.Lightbulb, null)
    return out
}

@Composable
fun IconTile(icon: ImageVector, color: Color, size: Int = 30) {
    Box(
        Modifier.size(size.dp).clip(RoundedCornerShape(7.dp)).background(color.copy(alpha = 0.14f)).border(1.dp, color.copy(alpha = 0.45f), RoundedCornerShape(7.dp)),
        contentAlignment = Alignment.Center,
    ) { Icon(icon, null, tint = color, modifier = Modifier.size((size * 0.58f).dp)) }
}

@Composable
fun Badge(text: String, color: Color) {
    Text(text, style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp), color = color,
        modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(color.copy(alpha = 0.14f)).padding(horizontal = 6.dp, vertical = 1.dp))
}

/** Barra de estado del sistema + fecha y hora (como el encabezado de la referencia). */
@Composable
fun SystemHeader(state: JarvisStateDto?, connected: Boolean) {
    val (label, color) = when {
        !connected -> "OFFLINE" to NexusColors.TextMuted
        state == null -> "SINCRONIZANDO" to NexusColors.TextSecondary
        state.emergencyStop -> "STOP ALL" to NexusColors.Red
        state.systemState == "ERROR" -> "WORKER CAÍDO" to NexusColors.Red
        state.systemState == "WAITING_USER" -> "ESPERA TU OK" to NexusColors.Amber
        state.systemState in setOf("PROCESSING", "EXECUTING") -> "PROCESANDO" to NexusColors.Cyan
        else -> "ÓPTIMO" to NexusColors.Green
    }
    val animate = LocalVisualPrefs.current.animations
    var now by remember { mutableStateOf(LocalDateTime.now()) }
    if (animate) LaunchedEffect(Unit) { while (true) { delay(1000); now = LocalDateTime.now() } }
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(
            Modifier.clip(RoundedCornerShape(20.dp)).background(NexusColors.Surface.copy(alpha = 0.8f)).border(1.dp, NexusColors.Border, RoundedCornerShape(20.dp))
                .padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("SYSTEM STATUS", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextPrimary)
            Spacer(Modifier.width(8.dp))
            Box(Modifier.size(7.dp).clip(CircleShape).background(color))
            Spacer(Modifier.width(5.dp))
            Text(label, style = MaterialTheme.typography.labelSmall, color = color)
        }
        Spacer(Modifier.weight(1f))
        Column(horizontalAlignment = Alignment.End) {
            Text(now.format(DateTimeFormatter.ofPattern("EEEE d 'de' MMMM", Locale.forLanguageTag("es-AR"))).replaceFirstChar { it.uppercase() },
                style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
            Text(now.format(DateTimeFormatter.ofPattern(if (animate) "HH:mm:ss" else "HH:mm")), style = MaterialTheme.typography.titleLarge.copy(
                fontFamily = Orbitron, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, letterSpacing = 2.sp,
                shadow = Shadow(NexusColors.Cyan.copy(alpha = 0.8f), Offset.Zero, 14f)), color = NexusColors.Cyan)
        }
    }
}

@Composable
fun LiveFeedPanel(items: List<FeedItem>, onOpen: (String) -> Unit, modifier: Modifier = Modifier) {
    HudPanel(modifier.fillMaxWidth(), title = "Live intelligence feed", action = { Badge("LIVE", NexusColors.Green) }) {
        items.take(6).forEachIndexed { i, item ->
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(NexusColors.SurfaceHigh.copy(alpha = 0.45f))
                    .border(1.dp, item.color.copy(alpha = 0.18f), RoundedCornerShape(8.dp))
                    .then(if (item.route != null) Modifier.clickable { onOpen(item.route) } else Modifier)
                    .padding(horizontal = 8.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconTile(item.icon, item.color)
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(item.title, style = MaterialTheme.typography.titleSmall, color = NexusColors.TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(item.subtitle, style = MaterialTheme.typography.bodySmall, color = item.color.copy(alpha = 0.9f), maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Badge(item.badge, item.color)
            }
            if (i < items.size - 1) Spacer(Modifier.height(6.dp))
        }
    }
}

@Composable
fun QuickCommandsPanel(quick: List<QuickActionPref>, onQuick: (String) -> Unit, onEdit: () -> Unit, modifier: Modifier = Modifier) {
    HudPanel(modifier.fillMaxWidth(), title = "Quick commands", action = {
        Text("Editar", style = MaterialTheme.typography.labelSmall, color = NexusColors.Cyan, modifier = Modifier.clickable(onClick = onEdit).padding(4.dp))
    }) {
        val visible = quick.filter { it.visible && it.key in QUICK_META }
        androidx.compose.foundation.layout.BoxWithConstraints { val cols = if (maxWidth < 380.dp) 1 else 2
        Column { visible.chunked(cols).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 6.dp)) {
                row.forEach { q ->
                    val (label, icon) = QUICK_META.getValue(q.key)
                    Row(
                        Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).background(NexusColors.SurfaceHigh.copy(alpha = 0.5f))
                            .border(1.dp, NexusColors.Border.copy(alpha = 0.35f), RoundedCornerShape(8.dp)).clickable { onQuick(q.key) }
                            .padding(horizontal = 8.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        IconTile(icon, NexusColors.Cyan, 26)
                        Spacer(Modifier.width(8.dp))
                        Text(label, style = MaterialTheme.typography.titleSmall, color = NexusColors.TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                }
                if (row.size < cols) Spacer(Modifier.weight(1f))
            }
        } } }
    }
}

/** Resumen del núcleo (AI CORE OVERVIEW): solo datos medidos. */
@Composable
fun systemStateLabel(s: String?): String = when (s) {
    "IDLE" -> "En reposo"; "PROCESSING" -> "Procesando"; "EXECUTING" -> "Ejecutando"; "WAITING_USER" -> "Esperando tu confirmación"
    "ERROR" -> "Worker sin respuesta"; "STOPPED" -> "Detenido (STOP ALL)"; null -> "—"; else -> s.lowercase()
}

fun CoreOverviewPanelColors(state: JarvisStateDto?) = if (state?.systemState == "ERROR" || state?.emergencyStop == true) NexusColors.Red else NexusColors.Green

@Composable
fun CoreOverviewPanel(state: JarvisStateDto?, dash: DashboardDto?, voice: VoicePrefs, coreLabel: String, modifier: Modifier = Modifier,
                      coreColor: Color = NexusColors.Green) {
    val connectedProviders = dash?.providers?.count { it.isEnabled && it.status != "error" } ?: 0
    val rows = listOf(
        Triple(Icons.Outlined.Hub, "AI Core", coreLabel.lowercase().replaceFirstChar { it.uppercase() } to coreColor),
        Triple(Icons.Outlined.Memory, "Memoria", "${dash?.memories ?: 0} recuerdos" to NexusColors.Cyan),
        Triple(Icons.Outlined.Mic, "Voz", (if (voice.processing == "remote") "Remota" else "Local") + " · " +
            (if (voice.mode == "continuous") "continua" else "pulsar para hablar") to NexusColors.Cyan),
        Triple(Icons.Outlined.Psychology, "Agentes", "${dash?.agents?.active ?: 0} activos de ${dash?.agents?.total ?: 0}" to NexusColors.Violet),
        Triple(Icons.Outlined.AutoAwesome, "LLMs", "$connectedProviders proveedores" to if (connectedProviders > 0) NexusColors.Amber else NexusColors.Red),
        Triple(Icons.Outlined.Shield, "Sistema", systemStateLabel(state?.systemState) to CoreOverviewPanelColors(state)),
    )
    HudPanel(modifier.fillMaxWidth(), title = "AI core overview") {
        rows.forEach { (icon, name, value) ->
            Row(
                Modifier.fillMaxWidth().padding(vertical = 3.dp).clip(RoundedCornerShape(8.dp)).background(NexusColors.SurfaceHigh.copy(alpha = 0.4f))
                    .border(1.dp, NexusColors.Border.copy(alpha = 0.25f), RoundedCornerShape(8.dp)).padding(horizontal = 8.dp, vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconTile(icon, value.second, 26)
                Spacer(Modifier.width(10.dp))
                Column {
                    Text(name, style = MaterialTheme.typography.titleSmall, color = NexusColors.TextPrimary)
                    Text(value.first, style = MaterialTheme.typography.bodySmall, color = value.second)
                }
            }
        }
    }
}

/** Agentes con su busto 3D, estado real y actividad (la onda solo se mueve si trabajan). */
@Composable
fun ActiveAgentsPanel(dash: DashboardDto?, onOpen: (String) -> Unit, modifier: Modifier = Modifier) {
    val agents = dash?.agents?.items.orEmpty()
    HudPanel(modifier.fillMaxWidth(), title = "Active agents", action = {
        Text("Ver todos ›", style = MaterialTheme.typography.labelSmall, color = NexusColors.Cyan, modifier = Modifier.clickable { onOpen("agents") }.padding(4.dp))
    }) {
        if (agents.isEmpty()) Text("Sincronizando agentes…", color = NexusColors.TextSecondary, style = MaterialTheme.typography.bodySmall)
        agents.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 8.dp)) {
                row.forEach { a ->
                    val active = isActiveStatus(a.status)
                    Row(
                        Modifier.weight(1f).clip(RoundedCornerShape(8.dp)).background(NexusColors.SurfaceHigh.copy(alpha = 0.45f))
                            .border(1.dp, statusColor(a.status).copy(alpha = if (active) 0.5f else 0.18f), RoundedCornerShape(8.dp))
                            .clickable { onOpen("agent/${a.id}") }.padding(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        AgentAvatar(a.appearance, a.status, 40.dp)
                        Spacer(Modifier.width(8.dp))
                        Column(Modifier.weight(1f)) {
                            Text(a.name, style = MaterialTheme.typography.titleSmall, color = NexusColors.TextPrimary, maxLines = 1)
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(6.dp).clip(CircleShape).background(statusColor(a.status)))
                                Spacer(Modifier.width(4.dp))
                                Text(statusStyle(a.status).label, style = MaterialTheme.typography.bodySmall, color = statusColor(a.status), maxLines = 1)
                            }
                            ActivityBars(active, statusColor(a.status))
                        }
                    }
                }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
fun ActivityBars(active: Boolean, color: Color, modifier: Modifier = Modifier, bars: Int = 18, level: Float = 0f) {
    val animate = LocalVisualPrefs.current.animations && (active || level > 0.02f)
    val t = if (animate) rememberInfiniteTransition(label = "bars").animateFloat(0f, 1f, infiniteRepeatable(tween(1400, easing = LinearEasing)), label = "b").value else 0f
    Canvas(modifier.fillMaxWidth().height(14.dp)) {
        val w = size.width / bars
        for (i in 0 until bars) {
            val base = if (active || level > 0.02f) 0.25f + 0.75f * ((sin(t * 6.283f * 2 + i * 0.9f) + 1f) / 2f) * (if (level > 0f) (0.4f + level) else 1f)
            else 0.12f + 0.06f * ((i * 7) % 3)
            val h = size.height * base.coerceIn(0.08f, 1f)
            val x = i * w + w / 2
            drawLine(color.copy(alpha = if (active || level > 0.02f) 0.9f else 0.35f), Offset(x, size.height / 2 - h / 2), Offset(x, size.height / 2 + h / 2),
                w * 0.5f, StrokeCap.Round)
        }
    }
}

/** Barra «TALK TO NEXUS» (referencia): estado de voz real con onda según el nivel del micrófono. */
@Composable
fun TalkBar(listening: Boolean, speaking: Boolean, level: Float, onTap: () -> Unit, modifier: Modifier = Modifier) {
    val color = when { listening -> Color(0xFF39F5D2); speaking -> NexusColors.Cyan; else -> NexusColors.Cyan }
    Row(
        modifier.clip(RoundedCornerShape(30.dp))
            .background(Brush.horizontalGradient(listOf(color.copy(alpha = 0.08f), color.copy(alpha = 0.22f), color.copy(alpha = 0.08f))))
            .border(1.5.dp, Brush.horizontalGradient(listOf(color.copy(alpha = 0.4f), color, color.copy(alpha = 0.4f))), RoundedCornerShape(30.dp))
            .clickable(onClick = onTap).padding(horizontal = 14.dp, vertical = 8.dp)
            .semantics { contentDescription = if (speaking) "Interrumpir a NEXUS" else if (listening) "Terminar de hablar" else "Hablar con NEXUS" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        ActivityBars(listening || speaking, color, Modifier.weight(1f), bars = 12, level = level)
        Column(Modifier.padding(horizontal = 10.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Text("TALK TO NEXUS", style = MaterialTheme.typography.labelLarge.copy(fontFamily = Orbitron, fontSize = 13.sp, letterSpacing = 2.sp,
                shadow = Shadow(color, Offset.Zero, 12f)), color = Color.White)
            Text(when { listening -> "Te escucho…"; speaking -> "Hablando · tocá para interrumpir"; else -> "Tocá para hablar" },
                style = MaterialTheme.typography.bodySmall, color = color)
        }
        ActivityBars(listening || speaking, color, Modifier.weight(1f), bars = 12, level = level)
    }
}

/** Línea de tiempo de misiones (MISSION TIMELINE) con los datos del dashboard. */
@Composable
fun MissionTimelinePanel(dash: DashboardDto?, onOpen: (String) -> Unit, modifier: Modifier = Modifier) {
    val items = dash?.timeline.orEmpty()
    if (items.isEmpty()) return
    HudPanel(modifier.fillMaxWidth(), title = "Mission timeline") {
        items.take(4).forEach { m ->
            val st = statusStyle(m.status)
            Row(Modifier.fillMaxWidth().clickable { onOpen("mission/${m.id}") }.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(Time.clock(m.updatedAt), style = MaterialTheme.typography.bodySmall, color = NexusColors.TextMuted, modifier = Modifier.width(44.dp))
                Box(Modifier.size(8.dp).clip(CircleShape).background(st.color))
                Spacer(Modifier.width(8.dp))
                Text(m.title, style = MaterialTheme.typography.titleSmall, color = NexusColors.TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f))
                Text(st.label, style = MaterialTheme.typography.bodySmall, color = st.color)
            }
        }
    }
}
