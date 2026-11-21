package ai.nexus.app.features.actions

import ai.nexus.app.AppContainer
import ai.nexus.app.actions.ActionExecutor
import ai.nexus.app.core.design.EmptyState
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
import ai.nexus.app.core.design.Tag
import ai.nexus.app.core.ui.LoadViewModel
import ai.nexus.app.core.ui.LocalNavigate
import ai.nexus.app.core.ui.LocalSnackbar
import ai.nexus.app.core.ui.Time
import ai.nexus.app.core.ui.nexusViewModel
import ai.nexus.app.data.model.ActionDto
import ai.nexus.app.data.model.AutomationCreate
import ai.nexus.app.data.model.AutomationDto
import ai.nexus.app.features.home.findActivity
import ai.nexus.app.features.home.riskColor
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

data class ActionsData(val pending: List<ActionDto>, val recent: List<ActionDto>, val automations: List<AutomationDto>,
                       val events: Map<String, String>, val approvals: Int)

class ActionsViewModel(val c: AppContainer) : LoadViewModel<ActionsData>() {
    init {
        reload()
        viewModelScope.launch { c.realtime.events.collect { if (it.type in setOf("action.updated", "automation.updated", "automation.run", "approval.created")) reload() } }
    }

    fun reload() = load {
        val all = c.api.actions()
        ActionsData(all.filter { it.status == "awaiting_confirmation" }, all.filter { it.status != "awaiting_confirmation" }.take(30),
            c.api.automations(), c.api.automationEvents().events, c.api.approvals().size)
    }
}

private val STATE_LABEL = mapOf(
    "WHATSAPP_OPENED" to "WhatsApp abierto · el envío lo hiciste vos en WhatsApp", "DIALER_OPENED" to "Marcador abierto",
    "APP_OPENED" to "App abierta", "APP_NOT_FOUND" to "App no encontrada", "SETTINGS_OPENED" to "Configuración abierta",
    "MAPS_OPENED" to "Mapa abierto", "ALARM_SET" to "Alarma enviada al reloj", "TIMER_SET" to "Temporizador enviado al reloj",
    "CALENDAR_OPENED" to "Calendario abierto", "CONTACTS_OPENED" to "Contactos abiertos", "SHARE_SHEET_OPENED" to "Menú de compartir abierto",
    "REMINDER_SCHEDULED" to "Recordatorio programado", "MEMORY_SAVED" to "Guardado en memoria", "MEMORY_DELETED" to "Recuerdos borrados",
    "MISSION_CREATED" to "Misión creada", "AUTOMATION_ACTIVE" to "Rutina activa", "ACCEPTED" to "Aceptado por WhatsApp Business",
    "SENT" to "Enviado (confirmado por WhatsApp Business)", "DELIVERED" to "Entregado (webhook)", "READ" to "Leído (webhook)",
    "CANCELLED" to "Cancelada", "EXPIRED" to "Venció sin confirmar", "READY_TO_OPEN" to "Lista para abrir",
)

private val STATUS_LABEL = mapOf("ready" to "Lista: se ejecuta en el teléfono", "executing" to "Ejecutándose", "completed" to "Completada",
    "failed" to "Falló", "cancelled" to "Cancelada", "expired" to "Venció sin confirmar", "blocked" to "Bloqueada por STOP ALL")

private val DOW = mapOf("*" to "todos los días", "1-5" to "de lunes a viernes", "0,6" to "los fines de semana", "0" to "los domingos", "1" to "los lunes",
    "2" to "los martes", "3" to "los miércoles", "4" to "los jueves", "5" to "los viernes", "6" to "los sábados")

/** Traduce las expresiones cron simples a lenguaje natural; si no puede, muestra la expresión. */
fun humanCron(cron: String?): String {
    val p = cron?.trim()?.split(Regex("\\s+")) ?: return "—"
    if (p.size != 5) return cron
    val (m, h, dom, mon, dow) = p
    if (h.startsWith("*/") && m == "0") return "cada ${h.removePrefix("*/")} horas"
    if (h == "*" && m == "0") return "cada hora"
    val hh = h.toIntOrNull(); val mm = m.toIntOrNull()
    if (hh == null || mm == null || mon != "*") return cron
    val time = "%02d:%02d".format(hh, mm)
    return when {
        dom != "*" && dow == "*" -> "el día $dom de cada mes a las $time"
        dom == "*" -> "${DOW[dow] ?: "días $dow"} a las $time"
        else -> cron
    }
}

@Composable
fun ActionsScreen() {
    val vm = nexusViewModel { ActionsViewModel(it) }
    val s by vm.state.collectAsState()
    val snackbar = LocalSnackbar.current
    val navigate = LocalNavigate.current
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    var creating by rememberSaveable { mutableStateOf(false) }
    fun toast(msg: String?) { if (msg != null) scope.launch { snackbar.showSnackbar(msg) } }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp)) {
        Text("Acciones", style = MaterialTheme.typography.headlineSmall, color = NexusColors.TextPrimary)
        Text("Confirmaciones, rutinas e historial de lo que hizo NEXUS", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
        Spacer(Modifier.height(10.dp))
        val data = s.data
        when {
            s.isInitialLoading -> LoadingState()
            data == null -> ErrorState(s.error ?: "Sin datos", onRetry = vm::reload)
            else -> {
                SectionLabel("Esperando tu confirmación")
                if (data.pending.isEmpty() && data.approvals == 0) Text("Nada pendiente.", color = NexusColors.TextSecondary)
                if (data.approvals > 0) HudPanel(Modifier.fillMaxWidth().padding(bottom = 8.dp), accent = NexusColors.Amber, onClick = { navigate("approvals") }) {
                    Text("${data.approvals} aprobaciones de agentes pendientes", color = NexusColors.TextPrimary)
                }
                data.pending.forEach { a ->
                    HudPanel(Modifier.fillMaxWidth().padding(bottom = 8.dp), accent = riskColor(a.risk)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(a.name, style = MaterialTheme.typography.titleSmall, color = NexusColors.TextPrimary, modifier = Modifier.weight(1f))
                            Tag(a.source, NexusColors.TextSecondary)
                        }
                        Text(a.summary, color = NexusColors.TextSecondary, style = MaterialTheme.typography.bodyMedium)
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                            if (a.actionKey == "whatsapp.open_chat") {
                                PrimaryButton("Revisar en el Home", { navigate("home") })
                            } else PrimaryButton("Confirmar", {
                                vm.action(::toast) {
                                    val done = vm.c.api.confirmAction(a.id)
                                    val activity = context.findActivity()
                                    if (done.executor == "device" && done.status == "ready" && activity != null) {
                                        val r = ActionExecutor.execute(activity, done.actionKey, done.deviceParams ?: done.params)
                                        vm.c.api.reportAction(done.id, r.state, JsonObject(r.info.mapValues { JsonPrimitive(it.value) }))
                                    }
                                    vm.reload()
                                }
                            })
                            GhostButton("Cancelar", { vm.action(::toast) { vm.c.api.cancelAction(a.id); vm.reload() } }, color = NexusColors.TextSecondary)
                        }
                    }
                }

                SectionLabel("Rutinas")
                if (data.automations.isEmpty()) EmptyState("Sin rutinas", "Pedile a NEXUS «todos los días a las 8 mandame un resumen» o creá una acá.")
                data.automations.forEach { a -> AutomationCard(a, data.events, vm, ::toast) }
                if (creating) AutomationForm(data.events, vm, onDone = { creating = false; vm.reload() }, toast = ::toast)
                else GhostButton("Nueva rutina", { creating = true })

                SectionLabel("Historial")
                if (data.recent.isEmpty()) Text("Todavía no hay acciones.", color = NexusColors.TextSecondary)
                data.recent.forEach { a ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(a.summary.ifBlank { a.name }, color = NexusColors.TextPrimary, style = MaterialTheme.typography.bodyMedium)
                            Text(STATE_LABEL[a.stateDetail] ?: a.error ?: STATUS_LABEL[a.status] ?: a.status, color = if (a.status == "failed") NexusColors.Red else NexusColors.TextSecondary,
                                style = MaterialTheme.typography.bodySmall)
                        }
                        Text(Time.relative(a.completedAt ?: a.createdAt), style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
                    }
                }
            }
        }
    }
}

@Composable
private fun AutomationCard(a: AutomationDto, events: Map<String, String>, vm: ActionsViewModel, toast: (String?) -> Unit) {
    val trigger = when (a.triggerType) {
        "schedule" -> "Programada: ${humanCron(a.cron)} (${a.timezone.substringAfterLast('/').replace('_', ' ')})"
        "date" -> "Una vez: ${Time.short(a.runAt)}"
        else -> "Cuando: ${events[a.eventType] ?: a.eventType}"
    }
    val color = when (a.status) { "active" -> NexusColors.Accent; "paused" -> NexusColors.Amber; "awaiting_approval" -> NexusColors.Cyan; else -> NexusColors.TextMuted }
    HudPanel(Modifier.fillMaxWidth().padding(bottom = 8.dp), accent = color) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(a.name, style = MaterialTheme.typography.titleSmall, color = NexusColors.TextPrimary, modifier = Modifier.weight(1f))
            Tag(when (a.status) { "active" -> "Activa"; "paused" -> if (a.pausedByStop) "Pausada por STOP ALL" else "Pausada"; "exhausted" -> "Terminada"; else -> a.status }, color)
        }
        Text(trigger, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
        a.nextRunAt?.let { KeyValue("Próxima", Time.short(it)) }
        KeyValue("Ejecuciones", "${a.runCount} · máx. ${a.maxRunsPerDay}/día${a.lastStatus?.let { " · última: $it" } ?: ""}")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
            if (a.status == "active") {
                GhostButton("Pausar", { vm.action(toast) { vm.c.api.automationAction(a.id, "pause"); vm.reload() } }, color = NexusColors.Amber)
                GhostButton("Ejecutar ahora", { vm.action(toast, "En cola") { vm.c.api.runAutomation(a.id) } })
            } else if (a.status == "paused") {
                GhostButton("Reanudar", { vm.action(toast) { vm.c.api.automationAction(a.id, "resume"); vm.reload() } })
            }
            GhostButton("Eliminar", { vm.action(toast) { vm.c.api.deleteAutomation(a.id); vm.reload() } }, color = NexusColors.Red)
        }
    }
}

@Composable
private fun AutomationForm(events: Map<String, String>, vm: ActionsViewModel, onDone: () -> Unit, toast: (String?) -> Unit) {
    var name by remember { mutableStateOf("") }
    var trigger by remember { mutableStateOf("schedule") }
    var time by remember { mutableStateOf("08:00") }
    var days by remember { mutableStateOf("*") }
    var event by remember { mutableStateOf(events.keys.firstOrNull() ?: "mission.completed") }
    var kind by remember { mutableStateOf("notify") }
    var text by remember { mutableStateOf("") }
    HudPanel(Modifier.fillMaxWidth(), title = "Nueva rutina") {
        NexusTextField(name, { name = it }, "Nombre")
        SelectChips(listOf("schedule" to "Horario", "event" to "Evento"), trigger, { trigger = it })
        if (trigger == "schedule") {
            NexusTextField(time, { time = it.take(5) }, "Hora (HH:MM)")
            SelectChips(listOf("*" to "Todos los días", "1-5" to "Lunes a viernes", "1" to "Lunes", "0,6" to "Fines de semana"), days, { days = it })
        } else {
            SelectChips(events.entries.map { it.key to it.value }, event, { event = it })
        }
        SelectChips(listOf("notify" to "Avisarme", "jarvis_prompt" to "Pedirle algo a NEXUS"), kind, { kind = it })
        NexusTextField(text, { text = it }, if (kind == "notify") "Texto del aviso" else "Instrucción para NEXUS")
        PrimaryButton("Crear", {
            val hhmm = Regex("^([01]?\\d|2[0-3]):([0-5]\\d)$").find(time)
            if (trigger == "schedule" && hhmm == null) { toast("Hora inválida"); return@PrimaryButton }
            val action = if (kind == "notify") JsonObject(mapOf("type" to JsonPrimitive("notify"), "title" to JsonPrimitive(text.ifBlank { name })))
            else JsonObject(mapOf("type" to JsonPrimitive("jarvis_prompt"), "prompt" to JsonPrimitive(text)))
            vm.action(toast, "Rutina creada") {
                vm.c.api.createAutomation(AutomationCreate(
                    name = name.ifBlank { text.take(60) }, triggerType = trigger,
                    cron = hhmm?.let { "${it.groupValues[2].toInt()} ${it.groupValues[1].toInt()} * * $days" },
                    timezone = java.time.ZoneId.systemDefault().id, eventType = if (trigger == "event") event else null, actions = listOf(action)))
                onDone()
            }
        }, enabled = text.isNotBlank())
    }
}
