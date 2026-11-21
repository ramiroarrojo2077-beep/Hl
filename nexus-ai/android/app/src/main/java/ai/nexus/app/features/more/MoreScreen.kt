package ai.nexus.app.features.more

import ai.nexus.app.core.design.HudPanel
import ai.nexus.app.core.design.KeyValue
import ai.nexus.app.core.design.LoadingState
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.SectionLabel
import ai.nexus.app.core.design.Tag
import ai.nexus.app.core.ui.LocalNavigate
import ai.nexus.app.core.ui.appContainer
import ai.nexus.app.core.ui.userMessage
import ai.nexus.app.data.model.WhatsAppStatusDto
import ai.nexus.app.actions.ActionExecutor
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Dashboard
import androidx.compose.material.icons.outlined.Extension
import androidx.compose.material.icons.outlined.Folder
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Memory
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.PanTool
import androidx.compose.material.icons.outlined.Policy
import androidx.compose.material.icons.outlined.Psychology
import androidx.compose.material.icons.outlined.RecordVoiceOver
import androidx.compose.material.icons.outlined.RocketLaunch
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.SmartToy
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

data class MoreItem(val route: String, val label: String, val hint: String, val icon: ImageVector)

val MORE_ITEMS = listOf(
    MoreItem("command", "Command Center", "Panel técnico del sistema", Icons.Outlined.Dashboard),
    MoreItem("agents", "Agentes", "Equipo y personajes", Icons.Outlined.Psychology),
    MoreItem("missions", "Misiones", "Trabajo planificado", Icons.Outlined.RocketLaunch),
    MoreItem("meetings", "Reuniones", "Debates entre agentes", Icons.Outlined.Groups),
    MoreItem("memory", "Memoria", "Lo que NEXUS recuerda", Icons.Outlined.Memory),
    MoreItem("settings/privacy", "Privacidad", "Categorías y datos", Icons.Outlined.Policy),
    MoreItem("projects", "Proyectos", "Archivos y contexto", Icons.Outlined.Folder),
    MoreItem("activity", "Actividad", "Auditoría completa", Icons.Outlined.History),
    MoreItem("integrations", "Integraciones", "WhatsApp y plugins", Icons.Outlined.Extension),
    MoreItem("approvals", "Aprobaciones", "Pedidos de agentes", Icons.Outlined.PanTool),
    MoreItem("notifications", "Notificaciones", "Avisos recibidos", Icons.Outlined.Notifications),
    MoreItem("settings/voice", "Voz", "Voz, modo y privacidad", Icons.Outlined.RecordVoiceOver),
    MoreItem("settings/jarvis", "Asistente", "Acciones rápidas y proactividad", Icons.Outlined.SmartToy),
    MoreItem("settings", "Configuración", "Modelos, presupuestos y más", Icons.Outlined.Settings),
)

/** MORE: las herramientas avanzadas, separadas de la experiencia cotidiana. */
@Composable
fun MoreScreen() {
    val navigate = LocalNavigate.current
    Column(Modifier.fillMaxSize().padding(14.dp)) {
        Text("Más", style = MaterialTheme.typography.headlineSmall, color = NexusColors.TextPrimary)
        Spacer(Modifier.height(10.dp))
        LazyVerticalGrid(GridCells.Adaptive(150.dp), modifier = Modifier.testTag("more_grid"), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            items(MORE_ITEMS, key = { it.route }) { item ->
                HudPanel(Modifier.fillMaxWidth(), accent = NexusColors.Accent, onClick = { navigate(item.route) }) {
                    Icon(item.icon, null, tint = NexusColors.Accent, modifier = Modifier.size(22.dp))
                    Spacer(Modifier.height(8.dp))
                    Text(item.label, style = MaterialTheme.typography.titleSmall, color = NexusColors.TextPrimary)
                    Text(item.hint, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
                }
            }
        }
    }
}

/** Integraciones: estado REAL de WhatsApp personal y Business (credenciales solo en el servidor). */
@Composable
fun IntegrationsScreen() {
    val c = appContainer()
    val navigate = LocalNavigate.current
    val context = LocalContext.current
    var status by remember { mutableStateOf<WhatsAppStatusDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { runCatching { c.api.whatsappStatus() }.onSuccess { status = it }.onFailure { error = it.userMessage() } }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp)) {
        Text("Integraciones", style = MaterialTheme.typography.headlineSmall, color = NexusColors.TextPrimary)
        error?.let { Text(it, color = NexusColors.Red) }
        val s = status ?: run { if (error == null) LoadingState(); return@Column }
        SectionLabel("WhatsApp personal")
        HudPanel(Modifier.fillMaxWidth()) {
            val installed = ActionExecutor.installedWhatsApps(context)
            KeyValue("Método", "Click to Chat oficial (wa.me)")
            KeyValue("En este teléfono", if (installed.isEmpty()) "WhatsApp no instalado" else installed.joinToString { if (it.endsWith("w4b")) "WhatsApp Business" else "WhatsApp" })
            Text(s.personal.note, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
        }
        SectionLabel("WhatsApp Business Platform")
        HudPanel(Modifier.fillMaxWidth(), accent = if (s.business.enabledForUser) NexusColors.Accent else NexusColors.TextMuted) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("API oficial de Meta", color = NexusColors.TextPrimary, modifier = Modifier.weight(1f))
                Tag(if (s.business.enabledForUser) "Configurada" else "No configurada", if (s.business.enabledForUser) NexusColors.Accent else NexusColors.TextMuted)
            }
            s.business.notes?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary) }
            KeyValue("Webhook verificado", if (s.business.webhookVerification) "Sí" else "No")
            KeyValue("Firma de webhooks", if (s.business.webhookSignature) "Sí" else "No")
            s.business.messagesByStatus.forEach { (k, v) -> KeyValue("Mensajes $k", "$v") }
            Text("Las credenciales se configuran solo en el servidor (ver docs/WHATSAPP.md).", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextMuted)
        }
        SectionLabel("Otras integraciones")
        Row(Modifier.fillMaxWidth().clickable { navigate("settings/plugins") }.padding(vertical = 12.dp)) {
            Text("Plugins (búsqueda web, webhook, sandbox de código)", color = NexusColors.Cyan)
        }
    }
}
