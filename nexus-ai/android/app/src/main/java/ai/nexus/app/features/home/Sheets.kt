package ai.nexus.app.features.home

import ai.nexus.app.actions.ActionExecutor
import ai.nexus.app.actions.ExecResult
import ai.nexus.app.actions.str
import ai.nexus.app.core.design.GhostButton
import ai.nexus.app.core.design.HudPanel
import ai.nexus.app.core.design.KeyValue
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.PrimaryButton
import ai.nexus.app.core.design.SectionLabel
import ai.nexus.app.core.design.SelectChips
import ai.nexus.app.core.design.Tag
import ai.nexus.app.core.ui.appContainer
import ai.nexus.app.core.ui.userMessage
import ai.nexus.app.data.model.ActionDto
import ai.nexus.app.data.model.ActionExecuteBody
import ai.nexus.app.data.model.DraftBody
import ai.nexus.app.data.model.JarvisTraceDto
import ai.nexus.app.whatsapp.ContactBook
import ai.nexus.app.whatsapp.WaState
import ai.nexus.app.whatsapp.WhatsAppFlow
import android.provider.ContactsContract
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** Selector nativo de un número de teléfono (sin permiso de contactos). */
class PickPhone : androidx.activity.result.contract.ActivityResultContract<Unit, android.net.Uri?>() {
    override fun createIntent(context: android.content.Context, input: Unit) =
        android.content.Intent(android.content.Intent.ACTION_PICK).setType(ContactsContract.CommonDataKinds.Phone.CONTENT_TYPE)
    override fun parseResult(resultCode: Int, intent: android.content.Intent?) =
        if (resultCode == android.app.Activity.RESULT_OK) intent?.data else null
}

private val TONES = listOf("original" to "Original", "informal" to "Informal", "amistoso" to "Amistoso", "formal" to "Formal",
    "breve" to "Breve", "profesional" to "Profesional", "explicativo" to "Explicativo")

@Composable
private fun fieldColors() = OutlinedTextFieldDefaults.colors(
    focusedBorderColor = NexusColors.Accent, unfocusedBorderColor = NexusColors.Border, focusedTextColor = NexusColors.TextPrimary,
    unfocusedTextColor = NexusColors.TextPrimary, cursorColor = NexusColors.Accent, focusedLabelColor = NexusColors.Accent,
    unfocusedLabelColor = NexusColors.TextSecondary,
)

/**
 * Vista previa obligatoria de WhatsApp: destinatario (número parcialmente oculto), app, texto
 * completo y botones Editar / Cancelar / Confirmar y abrir WhatsApp. El envío lo hace el
 * usuario en WhatsApp; NEXUS solo informa WHATSAPP_OPENED.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WhatsAppSheet(initial: ActionDto, vm: HomeViewModel, onDismiss: () -> Unit) {
    val c = appContainer()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val flow = remember { WhatsAppFlow(c.contacts) }
    val d by flow.draft.collectAsState()
    var actionId by remember { mutableStateOf(initial.id.ifBlank { null }) }
    var areaCode by remember { mutableStateOf("") }
    var manual by remember { mutableStateOf("") }
    var saveAlias by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var info by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf(false) }
    val sheet = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val apps = remember { ActionExecutor.installedWhatsApps(context) }

    LaunchedEffect(initial.id) {
        val p = initial.deviceParams ?: initial.params
        val detail = if (initial.id.isNotBlank() && initial.deviceParams == null) runCatching { c.api.action(initial.id) }.getOrNull() else null
        val params = detail?.deviceParams ?: p
        flow.start(actionId, params.str("recipient_query"), params.str("phone"), params.str("text") ?: "", params.str("tone"), params.str("contact_label"))
    }
    LaunchedEffect(d.state) {
        // Informa el progreso real (sin número ni texto) para que la acción quede trazada.
        val id = actionId ?: return@LaunchedEffect
        if (d.state == WaState.CONTACT_RESOLVED || (d.state == WaState.AWAITING_CONFIRMATION && d.contact != null)) {
            runCatching { c.api.reportAction(id, "CONTACT_RESOLVED", JsonObject(mapOf("recipient_masked" to JsonPrimitive(d.phone?.masked ?: "")))) }
        }
    }

    // Selector nativo de números (ACTION_PICK sobre teléfonos): da acceso temporal SOLO al contacto elegido,
    // sin pedir READ_CONTACTS ni leer la agenda completa.
    val phonePicker = rememberLauncherForActivityResult(PickPhone()) { uri -> uri?.let { u -> ContactBook.readPicked(context, u)?.let { (n, num) -> flow.picked(n, num, if (saveAlias) d.recipientQuery else null) }
        ?: run { info = "No pude leer el número de ese contacto." } } }

    fun openWhatsApp(confirmedAction: ActionDto?) {
        val activity = context.findActivity() ?: return
        val phone = d.phone?.e164
        if (phone == null || !flow.confirmed()) {
            confirmedAction?.let { vm.reportExecution(it, ExecResult("ERROR", mapOf("error" to "El número no quedó validado"))) }
            return
        }
        val result = ActionExecutor.execute(activity, "whatsapp.open_chat", JsonObject(mapOf("phone" to JsonPrimitive(phone),
            "text" to JsonPrimitive(d.text), "prefer_business" to JsonPrimitive(d.preferBusiness))))
        if (result.ok) flow.opened() else flow.failed(result.info["error"] ?: "No se pudo abrir WhatsApp")
        confirmedAction?.let { vm.reportExecution(it, result) }
    }

    fun confirmAndOpen() {
        busy = true
        scope.launch {
            try {
                val textParam = JsonObject(mapOf("text" to JsonPrimitive(d.text)) + (d.tone?.let { mapOf("tone" to JsonPrimitive(it)) } ?: emptyMap()))
                val confirmed = if (actionId != null) c.api.confirmAction(actionId!!, textParam) else {
                    // Acción rápida: se registra sin enviar el número al servidor (solo el nombre elegido).
                    val created = c.api.executeAction(ActionExecuteBody("whatsapp.open_chat", JsonObject(mapOf(
                        "recipient_query" to JsonPrimitive(d.recipientName ?: d.phone?.masked ?: "contacto"),
                        "text" to JsonPrimitive(d.text))), summary = "WhatsApp para ${d.recipientName ?: d.phone?.masked}"))
                    actionId = created.id
                    c.api.confirmAction(created.id, textParam)
                }
                if (confirmed.status == "ready") openWhatsApp(confirmed) else flow.failed(confirmed.error ?: "La acción no quedó lista (${confirmed.status})")
            } catch (e: Exception) {
                flow.failed(e.userMessage())
            } finally {
                busy = false
            }
        }
    }

    ModalBottomSheet(onDismissRequest = onDismiss, sheetState = sheet, containerColor = NexusColors.BackgroundAlt) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp).navigationBarsPadding()) {
            Text("WhatsApp", style = MaterialTheme.typography.titleLarge, color = NexusColors.TextPrimary)
            Text(flow.statusMessage(), style = MaterialTheme.typography.bodyMedium,
                color = if (d.state == WaState.ERROR) NexusColors.Red else NexusColors.TextSecondary, modifier = Modifier.padding(bottom = 10.dp))

            // Destinatario
            SectionLabel("Destinatario")
            when {
                d.contact != null -> HudPanel(Modifier.fillMaxWidth()) {
                    KeyValue("Contacto", d.contact!!.label)
                    KeyValue("Número", d.phone?.masked ?: "—")
                    d.phone?.assumptions?.forEach { Text("⚠ $it", style = MaterialTheme.typography.bodySmall, color = NexusColors.Amber) }
                    if (d.phone?.status == "needs_confirmation" && !d.assumptionsAccepted) {
                        GhostButton("El número es correcto", { flow.acceptAssumptions() }, color = NexusColors.Amber)
                    }
                    if (d.phone?.status == "needs_area_code") Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(areaCode, { areaCode = it.filter(Char::isDigit).take(4) }, label = { Text("Código de área (ej. 11, 351)") },
                            modifier = Modifier.weight(1f), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), colors = fieldColors())
                        GhostButton("Usar", { flow.withAreaCode(areaCode) })
                    }
                    if (d.state !in setOf(WaState.WHATSAPP_OPENED, WaState.READY_TO_OPEN)) Text("Cambiar destinatario", color = NexusColors.Cyan,
                        style = MaterialTheme.typography.labelMedium, modifier = Modifier.clickable { phonePicker.launch(Unit) }.padding(vertical = 8.dp))
                }
                d.candidates.isNotEmpty() -> HudPanel(Modifier.fillMaxWidth()) {
                    Text("Hay varios contactos posibles para «${d.recipientQuery}». ¿Cuál es?", color = NexusColors.TextSecondary)
                    d.candidates.forEach { cand ->
                        Text("${cand.label}${if (cand.aliases.isNotEmpty()) " (${cand.aliases.joinToString()})" else ""}", color = NexusColors.TextPrimary,
                            modifier = Modifier.fillMaxWidth().clickable { flow.choose(cand) }.padding(vertical = 10.dp))
                    }
                }
                else -> HudPanel(Modifier.fillMaxWidth()) {
                    Text(if (d.recipientQuery != null) "No tengo a «${d.recipientQuery}» guardado en NEXUS. Elegilo de tu agenda o escribí el número."
                        else "Elegí un contacto de tu agenda o escribí el número.", color = NexusColors.TextSecondary)
                    if (d.recipientQuery != null) Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(saveAlias, { saveAlias = it }, colors = CheckboxDefaults.colors(checkedColor = NexusColors.Accent))
                        Text("Recordar este contacto como «${d.recipientQuery}» (se guarda cifrado solo en este teléfono)",
                            style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        PrimaryButton("Elegir contacto", { phonePicker.launch(Unit) })
                    }
                    Spacer(Modifier.height(8.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        OutlinedTextField(manual, { manual = it.take(20) }, label = { Text("Número (ej. 11 2345-6789)") }, modifier = Modifier.weight(1f),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), colors = fieldColors())
                        GhostButton("Usar", { flow.setPhone(manual, d.recipientQuery) }, enabled = manual.length >= 6)
                    }
                }
            }
            info?.let { Text(it, color = NexusColors.Amber, style = MaterialTheme.typography.bodySmall) }

            // Aplicación
            if (apps.size > 1) {
                SectionLabel("Aplicación")
                SelectChips(listOf("personal" to "WhatsApp", "business" to "WhatsApp Business"), if (d.preferBusiness) "business" else "personal",
                    { flow.setBusiness(it == "business") })
            } else if (apps.isEmpty()) {
                Text("WhatsApp no está instalado: se abrirá wa.me en el navegador.", style = MaterialTheme.typography.bodySmall, color = NexusColors.Amber)
            }

            // Mensaje
            SectionLabel("Mensaje")
            OutlinedTextField(d.text, { flow.setText(it) }, modifier = Modifier.fillMaxWidth(), minLines = 3, readOnly = !editing && d.text.isNotBlank(),
                label = { Text(if (editing || d.text.isBlank()) "Escribí el mensaje" else "Texto completo") }, colors = fieldColors())
            Text("Tono", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted, modifier = Modifier.padding(top = 8.dp))
            SelectChips(TONES, d.tone ?: "original", { tone ->
                flow.setTone(tone)
                if (tone != "original" && d.text.isNotBlank()) scope.launch {
                    busy = true
                    runCatching { c.api.whatsappDraft(DraftBody(d.text, "tone", tone, recipientFirstName = d.contact?.label?.substringBefore(' '))) }
                        .onSuccess { flow.setText(it.text); info = "Redacción sugerida por IA: revisala antes de confirmar." }
                        .onFailure { info = "No pude mejorar el texto: ${it.userMessage()}" }
                    busy = false
                }
            })
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
                Tag("Corregir", NexusColors.Cyan, Modifier.clickable {
                    scope.launch { runCatching { c.api.whatsappDraft(DraftBody(d.text, "correct")) }.onSuccess { flow.setText(it.text) }
                        .onFailure { info = it.userMessage() } }
                })
                Tag("Traducir al inglés", NexusColors.Cyan, Modifier.clickable {
                    scope.launch { runCatching { c.api.whatsappDraft(DraftBody(d.text, "translate", targetLanguage = "inglés")) }.onSuccess { flow.setText(it.text) }
                        .onFailure { info = it.userMessage() } }
                })
            }

            Spacer(Modifier.height(14.dp))
            when (d.state) {
                WaState.WHATSAPP_OPENED -> PrimaryButton("Listo", onDismiss, modifier = Modifier.fillMaxWidth())
                WaState.CANCELLED -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    PrimaryButton("Volver a preparar", { flow.reprepare(); actionId = null })
                    GhostButton("Cerrar", onDismiss, color = NexusColors.TextSecondary)
                }
                else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        GhostButton(if (editing) "Listo" else "Editar", { editing = !editing }, Modifier.weight(1f))
                        GhostButton("Cancelar", {
                            flow.cancel()
                            actionId?.let { id -> scope.launch { runCatching { c.api.cancelAction(id, "Cancelado en la vista previa") } } }
                        }, Modifier.weight(1f), color = NexusColors.Red)
                    }
                    PrimaryButton("Confirmar y abrir WhatsApp", { confirmAndOpen() }, Modifier.fillMaxWidth(),
                        enabled = d.readyToConfirm && d.text.isNotBlank() && !busy, loading = busy)
                }
            }
            Spacer(Modifier.height(18.dp))
        }
    }
}

/** Vista avanzada: datos reales del backend sobre cómo se resolvió una respuesta. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TraceSheet(messageId: String, vm: HomeViewModel, onDismiss: () -> Unit) {
    var trace by remember { mutableStateOf<JarvisTraceDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(messageId) { runCatching { vm.trace(messageId) }.onSuccess { trace = it }.onFailure { error = it.userMessage() } }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = NexusColors.BackgroundAlt) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(18.dp).navigationBarsPadding()) {
            Text("Cómo lo resolví", style = MaterialTheme.typography.titleLarge, color = NexusColors.TextPrimary)
            error?.let { Text(it, color = NexusColors.Red) }
            val t = trace ?: return@Column
            t.route?.let { KeyValue("Tipo de tarea", it.taskType); if (it.specialists.isNotEmpty()) KeyValue("Especialistas sugeridos", it.specialists.joinToString { s -> s.uppercase() }) }
            t.reply?.let { r ->
                KeyValue("Modelo", r.model ?: "—")
                r.models?.filterNotNull()?.distinct()?.takeIf { it.size > 1 }?.let { KeyValue("Modelos usados", it.joinToString()) }
                KeyValue("Herramientas", r.toolsUsed.filterNotNull().ifEmpty { listOf("ninguna") }.joinToString())
                KeyValue("Agentes consultados", r.consultedAgents.ifEmpty { listOf("ninguno") }.joinToString { it.uppercase() })
                r.tokens?.let { KeyValue("Tokens", it.toString()) }
                r.costUsd?.let { KeyValue("Costo", "US$ $it") }
                if (r.degradedQuality == true) Text("Se usó un modelo de respaldo de menor calidad.", color = NexusColors.Amber)
                if ((r.toolErrors ?: 0) > 0) Text("Errores de herramientas: ${r.toolErrors}", color = NexusColors.Red)
                if (r.interrupted) Text("La respuesta fue interrumpida.", color = NexusColors.Amber)
            }
            t.pipeline?.let { stages ->
                SectionLabel("Etapas de JARVIS CORE")
                stages.forEach { st -> Text("${st.stage} · ${st.status} · ${"%.1f".format(st.ms)} ms", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary) }
            }
            if (t.collaboration.isNotEmpty()) {
                SectionLabel("Colaboración entre agentes")
                t.collaboration.forEach { m ->
                    HudPanel(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                        Text("${m.from?.uppercase()} → ${m.to?.uppercase()} (${if (m.type == "question") "pregunta" else "respuesta"})",
                            style = MaterialTheme.typography.labelMedium, color = NexusColors.Cyan)
                        Text(m.content, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
                        m.model?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted) }
                    }
                }
            }
        }
    }
}
