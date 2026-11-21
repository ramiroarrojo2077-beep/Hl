package ai.nexus.app.features.settings

import ai.nexus.app.core.design.ConfirmDialog
import ai.nexus.app.core.design.GhostButton
import ai.nexus.app.core.design.HudPanel
import ai.nexus.app.core.design.KeyValue
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.PrimaryButton
import ai.nexus.app.core.design.SectionLabel
import ai.nexus.app.core.design.SelectChips
import ai.nexus.app.core.ui.userMessage
import ai.nexus.app.data.model.JarvisSettingsDto
import ai.nexus.app.data.model.MemoryPrivacyDto
import ai.nexus.app.data.model.QuickActionPref
import ai.nexus.app.data.model.SettingsV2Patch
import ai.nexus.app.data.model.VoicePrefs
import ai.nexus.app.data.model.VoicePrefsPatch
import ai.nexus.app.features.agents.ToggleRow
import ai.nexus.app.features.home.DEFAULT_QUICK
import ai.nexus.app.features.home.QUICK_META
import ai.nexus.app.voice.AndroidSpeaker
import ai.nexus.app.voice.WakeWordService
import android.Manifest
import android.content.pm.PackageManager
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** Ajustes de voz (capítulo 3.7). El audio nunca se guarda; la palabra de activación exige consentimiento. */
@Composable
fun VoiceSection(vm: SettingsViewModel, toast: (String?) -> Unit) {
    val context = LocalContext.current
    var p by remember { mutableStateOf<VoicePrefs?>(null) }
    var consent by remember { mutableStateOf(false) }
    val wakeRunning by WakeWordService.running.collectAsState()
    val wakeError by WakeWordService.lastError.collectAsState()
    val voices = remember { mutableStateOf<List<String>>(emptyList()) }
    LaunchedEffect(Unit) {
        vm.run(toast) { p = vm.c.api.voicePrefs().also { vm.c.voicePrefs.value = it } }
        voices.value = runCatching { AndroidSpeaker(context).let { sp -> kotlinx.coroutines.delay(600); sp.voices("es").map { it.name }.also { sp.shutdown() } } }
            .getOrDefault(emptyList())
    }
    fun save(patch: VoicePrefsPatch) = vm.run(toast) { p = vm.c.api.updateVoicePrefs(patch).also { vm.c.voicePrefs.value = it } }
    val prefs = p ?: return

    SectionLabel("Voz e idioma")
    SelectChips(listOf("es-AR" to "Español (Argentina)", "es-US" to "Español (Latinoamérica)", "es-ES" to "Español (España)"), prefs.language,
        { save(VoicePrefsPatch(language = it)) })
    if (voices.value.isNotEmpty()) {
        Text("Voz del teléfono", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted, modifier = Modifier.padding(top = 8.dp))
        SelectChips(listOf("" to "Predeterminada") + voices.value.take(8).map { it to it.substringAfterLast('#').take(18) }, prefs.voiceName ?: "",
            { save(VoicePrefsPatch(voiceName = it.ifBlank { null })) })
    }
    LabeledSlider("Velocidad", prefs.speechRate.toFloat(), 0.5f..2f) { save(VoicePrefsPatch(speechRate = it.toDouble())) }
    LabeledSlider("Tono", prefs.pitch.toFloat(), 0.5f..2f) { save(VoicePrefsPatch(pitch = it.toDouble())) }
    LabeledSlider("Volumen", prefs.volume.toFloat(), 0f..1f) { save(VoicePrefsPatch(volume = it.toDouble())) }

    SectionLabel("Modo de conversación")
    SelectChips(listOf("push_to_talk" to "Pulsar para hablar", "continuous" to "Conversación continua"), prefs.mode, { save(VoicePrefsPatch(mode = it)) })
    ToggleRow("Responder en voz alta", prefs.autoSpeak) { save(VoicePrefsPatch(autoSpeak = it)) }
    ToggleRow("Permitir interrumpir a NEXUS hablando (barge-in)", prefs.bargeIn) { save(VoicePrefsPatch(bargeIn = it)) }
    ToggleRow("Subtítulos de las respuestas habladas", prefs.subtitles) { save(VoicePrefsPatch(subtitles = it)) }

    SectionLabel("Procesamiento")
    SelectChips(listOf("local" to "Local (en el teléfono)", "remote" to "Servidor NEXUS"), prefs.processing, { save(VoicePrefsPatch(processing = it)) })
    Text(
        if (prefs.processing == "remote") (if (prefs.remote.stt.available) "Transcripción remota con ${prefs.remote.stt.model}. El audio se procesa y se descarta: no se guarda."
            else "No hay un modelo de transcripción configurado en el servidor: se usará el reconocimiento del teléfono.")
        else if (vm.c.onDeviceRecognition()) "Tu teléfono reconoce la voz sin enviar audio a internet."
        else "Tu teléfono no ofrece reconocimiento 100 % local: el reconocedor del sistema puede usar sus servidores.",
        style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary,
    )

    SectionLabel("Palabra de activación (opcional)")
    HudPanel(Modifier.fillMaxWidth()) {
        Text("Si la activás, NEXUS escucha la palabra «${prefs.wakeWord.uppercase()}» con detección local mientras haya una notificación visible. " +
            "Nunca se graba audio. Podés desactivarla cuando quieras; se apaga sola a los 30 minutos.",
            style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
        if (!WakeWordService.supported(context)) {
            Text("Este teléfono no tiene reconocimiento local: la función no está disponible.", color = NexusColors.Amber, style = MaterialTheme.typography.bodySmall)
        } else {
            ToggleRow("Entiendo y acepto que el micrófono quede activo con indicador visible", consent || prefs.wakeWordEnabled) { consent = it }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (wakeRunning) "Escuchando «${prefs.wakeWord.uppercase()}»" else "Desactivada", color = if (wakeRunning) NexusColors.Accent else NexusColors.TextMuted,
                    modifier = Modifier.weight(1f))
                Switch(wakeRunning, onCheckedChange = { on ->
                    if (on) {
                        if (!(consent || prefs.wakeWordEnabled)) { toast("Primero aceptá el uso del micrófono."); return@Switch }
                        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                            toast("Activá el permiso de micrófono tocando el micrófono en el Home."); return@Switch
                        }
                        vm.run(toast) {
                            p = vm.c.api.updateVoicePrefs(VoicePrefsPatch(wakeWordEnabled = true, wakeWordConsent = true))
                            WakeWordService.start(context, prefs.wakeWord)
                        }
                    } else {
                        WakeWordService.stop(context)
                        save(VoicePrefsPatch(wakeWordEnabled = false))
                    }
                }, modifier = Modifier.semantics { contentDescription = "Palabra de activación" })
            }
            wakeError?.let { Text(it, color = NexusColors.Amber, style = MaterialTheme.typography.bodySmall) }
        }
    }

    SectionLabel("Privacidad de voz")
    KeyValue("Audio guardado", "Nunca")
    ToggleRow("Guardar transcripciones en el historial", prefs.saveTranscripts) { save(VoicePrefsPatch(saveTranscripts = it)) }
    SelectChips(listOf("1" to "1 día", "7" to "7 días", "30" to "30 días", "90" to "90 días"), prefs.transcriptRetentionDays.toString(),
        { save(VoicePrefsPatch(transcriptRetentionDays = it.toInt())) })
}

@Composable
private fun LabeledSlider(label: String, value: Float, range: ClosedFloatingPointRange<Float>, onDone: (Float) -> Unit) {
    var v by remember(value) { mutableStateOf(value) }
    Text("$label: ${"%.2f".format(v)}", style = MaterialTheme.typography.labelMedium, color = NexusColors.TextSecondary, modifier = Modifier.padding(top = 8.dp))
    Slider(v, { v = it }, valueRange = range, onValueChangeFinished = { onDone(v) },
        modifier = Modifier.semantics { contentDescription = label },
        colors = SliderDefaults.colors(thumbColor = NexusColors.Accent, activeTrackColor = NexusColors.Accent))
}

/** Preferencias de JARVIS: acciones rápidas (ocultar/reordenar), confirmaciones, asistente proactivo, vista avanzada. */
@Composable
fun JarvisSection(vm: SettingsViewModel, toast: (String?) -> Unit) {
    var s by remember { mutableStateOf<JarvisSettingsDto?>(null) }
    LaunchedEffect(Unit) { vm.run(toast) { s = vm.c.api.jarvisSettings() } }
    val cur = s ?: return
    fun save(body: JsonObject) = vm.run(toast, "Guardado") { vm.c.api.updateSettingsV2(SettingsV2Patch(jarvisSettings = body)); s = vm.c.api.jarvisSettings() }
    val quick = cur.jarvis.quickActions.ifEmpty { DEFAULT_QUICK }
    fun saveQuick(list: List<QuickActionPref>) = save(buildJsonObject {
        put("quick_actions", JsonArray(list.map { JsonObject(mapOf("key" to JsonPrimitive(it.key), "visible" to JsonPrimitive(it.visible))) }))
    })

    SectionLabel("Acciones rápidas del Home")
    HudPanel(Modifier.fillMaxWidth(), contentPadding = 6.dp) {
        quick.forEachIndexed { i, q ->
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text(QUICK_META[q.key]?.first ?: q.key, color = if (q.visible) NexusColors.TextPrimary else NexusColors.TextMuted, modifier = Modifier.weight(1f).padding(start = 8.dp))
                IconButton(onClick = { if (i > 0) saveQuick(quick.toMutableList().apply { add(i - 1, removeAt(i)) }) }, enabled = i > 0) {
                    Icon(Icons.Outlined.KeyboardArrowUp, "Subir ${QUICK_META[q.key]?.first}", tint = NexusColors.TextSecondary)
                }
                IconButton(onClick = { if (i < quick.lastIndex) saveQuick(quick.toMutableList().apply { add(i + 1, removeAt(i)) }) }, enabled = i < quick.lastIndex) {
                    Icon(Icons.Outlined.KeyboardArrowDown, "Bajar ${QUICK_META[q.key]?.first}", tint = NexusColors.TextSecondary)
                }
                Switch(q.visible, { on -> saveQuick(quick.map { if (it.key == q.key) it.copy(visible = on) else it }) },
                    modifier = Modifier.semantics { contentDescription = "Mostrar ${QUICK_META[q.key]?.first}" })
            }
        }
    }
    SectionLabel("Confirmaciones")
    ToggleRow("Pedir confirmación también para acciones locales reversibles (abrir apps, alarmas)", cur.jarvis.confirmLocalActions) {
        save(buildJsonObject { put("confirm_local_actions", it) })
    }
    Text("Las comunicaciones externas, los datos sensibles y lo irreversible SIEMPRE piden confirmación.", style = MaterialTheme.typography.bodySmall,
        color = NexusColors.TextSecondary)

    SectionLabel("Asistente proactivo")
    SelectChips(listOf("off" to "Apagado", "low" to "Bajo", "normal" to "Normal", "high" to "Alto"), cur.jarvis.proactive.level,
        { save(buildJsonObject { put("proactive", buildJsonObject { put("level", it) }) }) })
    val q = cur.jarvis.proactive.quietHours
    SelectChips(listOf("22:00-08:00" to "Silencio 22 a 8", "23:00-08:00" to "Silencio 23 a 8", "00:00-07:00" to "Silencio 0 a 7", "none" to "Sin horario de silencio"),
        if (q.start != null) "${q.start}-${q.end}" else "none", { sel ->
            save(buildJsonObject { put("proactive", buildJsonObject {
                if (sel == "none") put("quiet_hours", JsonObject(emptyMap()))
                else put("quiet_hours", buildJsonObject { put("start", sel.substringBefore('-')); put("end", sel.substringAfter('-')) })
            }) })
        })
    SectionLabel("Vista avanzada")
    ToggleRow("Mostrar cómo resolvió NEXUS cada respuesta (agentes, modelos, herramientas)", cur.jarvis.advancedView) {
        save(buildJsonObject { put("advanced_view", it) })
    }
}

/** Panel de privacidad: categorías de memoria, procedencia, vigencia, reportes de fallos e historial. */
@Composable
fun PrivacySection(vm: SettingsViewModel, toast: (String?) -> Unit) {
    var s by remember { mutableStateOf<JarvisSettingsDto?>(null) }
    var mem by remember { mutableStateOf<MemoryPrivacyDto?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    val reload: () -> Unit = { vm.run(toast) { s = vm.c.api.jarvisSettings(); mem = vm.c.api.memoryPrivacy() } }
    LaunchedEffect(Unit) { reload() }
    if (confirmDelete) ConfirmDialog("Borrar historial", "Se borran todas las conversaciones con NEXUS. No se puede deshacer.", "Borrar",
        onConfirm = { vm.run(toast) { val r = vm.c.api.deleteJarvisHistory(); toast("Historial borrado (${r["messages_deleted"]} mensajes)") } },
        onDismiss = { confirmDelete = false }, danger = true)
    val cur = s ?: return
    val disabled = cur.privacy.disabledMemoryCategories.toSet()
    fun savePrivacy(body: JsonObject) = vm.run(toast, "Guardado") { vm.c.api.updateSettingsV2(SettingsV2Patch(privacySettings = body)); reload() }

    SectionLabel("Qué recuerda NEXUS")
    val labels = mapOf("personal" to "Personal", "preferences" to "Preferencias", "work" to "Trabajo", "projects" to "Proyectos", "health" to "Salud",
        "contacts" to "Contactos", "general" to "General")
    mem?.categories?.forEach { cat ->
        ToggleRow("${labels[cat.key] ?: cat.key} (${cat.count})", cat.key !in disabled) { on ->
            val next = if (on) disabled - cat.key else disabled + cat.key
            savePrivacy(buildJsonObject { put("disabled_memory_categories", JsonArray(next.map { JsonPrimitive(it) })) })
        }
    }
    mem?.let { m ->
        KeyValue("Recuerdos posiblemente desactualizados", "${m.stale} (más de ${m.staleAfterDays} días sin verificar)")
        m.bySource.forEach { (k, v) -> KeyValue("Origen: $k", "$v") }
    }
    Text("Las categorías desactivadas no se usan en ninguna respuesta ni se envían a modelos. Para ver, corregir o borrar recuerdos uno por uno, entrá a Memoria.",
        style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
    SectionLabel("Lo que NUNCA sale del teléfono")
    KeyValue("Agenda de contactos", "No se sube ni se envía a modelos")
    KeyValue("Audio", "No se guarda")
    SectionLabel("Diagnóstico")
    ToggleRow("Enviar reportes de fallos a mi servidor NEXUS (sin números ni emails)", cur.privacy.crashReportsConsent) {
        savePrivacy(buildJsonObject { put("crash_reports_consent", it) })
    }
    SectionLabel("Historial")
    Row { GhostButton("Borrar historial con NEXUS", { confirmDelete = true }, color = NexusColors.Red) }
    Spacer(Modifier.height(8.dp))
    Text("Para exportar todos tus datos usá Ajustes → Exportación de datos.", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
}
