package ai.nexus.app.features.settings

import ai.nexus.app.AppContainer
import ai.nexus.app.core.avatar.AgentAvatar
import ai.nexus.app.core.design.ConfirmDialog
import ai.nexus.app.core.design.ErrorState
import ai.nexus.app.core.design.GhostButton
import ai.nexus.app.core.design.HudPanel
import ai.nexus.app.core.design.KeyValue
import ai.nexus.app.core.design.LoadingState
import ai.nexus.app.core.design.MultiSelectChips
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.NexusTextField
import ai.nexus.app.core.design.PrimaryButton
import ai.nexus.app.core.design.SectionLabel
import ai.nexus.app.core.design.SelectChips
import ai.nexus.app.core.design.StatusChip
import ai.nexus.app.core.design.Tag
import ai.nexus.app.core.realtime.ConnectionState
import ai.nexus.app.core.ui.LocalNavigate
import ai.nexus.app.core.ui.LocalSnackbar
import ai.nexus.app.core.ui.Time
import ai.nexus.app.core.ui.appContainer
import ai.nexus.app.core.ui.compact
import ai.nexus.app.core.ui.money
import ai.nexus.app.core.ui.nexusViewModel
import ai.nexus.app.core.ui.userMessage
import ai.nexus.app.data.model.AgentDto
import ai.nexus.app.data.model.EvalCreate
import ai.nexus.app.data.model.EvalRunDto
import ai.nexus.app.data.model.ModelCreate
import ai.nexus.app.data.model.ModelDto
import ai.nexus.app.data.model.ModelPatch
import ai.nexus.app.data.model.PluginDto
import ai.nexus.app.data.model.PluginPatch
import ai.nexus.app.data.model.ProviderCreate
import ai.nexus.app.data.model.ProviderDto
import ai.nexus.app.data.model.ProviderKindDto
import ai.nexus.app.data.model.ProviderPatch
import ai.nexus.app.data.model.ProviderTestResult
import ai.nexus.app.data.model.ScheduleCreate
import ai.nexus.app.data.model.ScheduleDto
import ai.nexus.app.data.model.SchedulePatch
import ai.nexus.app.data.model.SessionDto
import ai.nexus.app.data.model.SettingsDto
import ai.nexus.app.data.model.SettingsPatch
import ai.nexus.app.features.agents.ToggleRow
import ai.nexus.app.features.dashboard.modeLabel
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.ChevronRight
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.put

val SECTIONS = listOf(
    "voice" to "Voz",
    "jarvis" to "Asistente (JARVIS)",
    "privacy" to "Privacidad",
    "profile" to "Perfil y sesiones",
    "providers" to "Proveedores de IA",
    "models" to "Modelos",
    "compare" to "Comparación de modelos",
    "budgets" to "Presupuestos y consumo",
    "memory" to "Memoria",
    "autonomy" to "Autonomía y programación",
    "permissions" to "Permisos de agentes",
    "plugins" to "Plugins",
    "notifications" to "Notificaciones",
    "appearance" to "Apariencia",
    "connection" to "Conexión",
    "security" to "Seguridad",
    "export" to "Exportación de datos",
)

@Composable
fun SettingsScreen() {
    val navigate = LocalNavigate.current
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp)) {
        Text("Settings", style = MaterialTheme.typography.headlineSmall, color = NexusColors.TextPrimary)
        Spacer(Modifier.height(10.dp))
        HudPanel(Modifier.fillMaxWidth(), contentPadding = 6.dp) {
            SECTIONS.forEach { (key, label) ->
                Row(Modifier.fillMaxWidth().clickable { navigate("settings/$key") }.padding(horizontal = 10.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Text(label, style = MaterialTheme.typography.bodyLarge, color = NexusColors.TextPrimary, modifier = Modifier.weight(1f))
                    Icon(Icons.Outlined.ChevronRight, null, tint = NexusColors.TextMuted)
                }
            }
        }
    }
}

/** ViewModel compartido por las secciones de ajustes. */
class SettingsViewModel(val c: AppContainer) : ViewModel() {
    private val _settings = MutableStateFlow<SettingsDto?>(null)
    val settings: StateFlow<SettingsDto?> = _settings
    val error = MutableStateFlow<String?>(null)

    init { reload() }

    fun reload() {
        viewModelScope.launch {
            try { _settings.value = c.api.settings(); error.value = null } catch (e: Exception) { error.value = e.userMessage() }
        }
    }

    fun patch(body: SettingsPatch, done: (String?) -> Unit) {
        viewModelScope.launch {
            try { _settings.value = c.api.updateSettings(body); done("Guardado") } catch (e: Exception) { done(e.userMessage()) }
        }
    }

    fun run(done: (String?) -> Unit, success: String? = null, block: suspend () -> Unit) {
        viewModelScope.launch { try { block(); done(success) } catch (e: Exception) { done(e.userMessage()) } }
    }
}

@Composable
fun SettingsSectionScreen(section: String) {
    val vm = nexusViewModel(key = "settings") { SettingsViewModel(it) }
    val snackbar = LocalSnackbar.current
    val scope = rememberCoroutineScope()
    val toast: (String?) -> Unit = { msg -> if (msg != null) scope.launch { snackbar.showSnackbar(msg) } }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(14.dp)) {
        Text(SECTIONS.firstOrNull { it.first == section }?.second ?: "Ajustes", style = MaterialTheme.typography.headlineSmall, color = NexusColors.TextPrimary)
        Spacer(Modifier.height(10.dp))
        when (section) {
            "voice" -> VoiceSection(vm, toast)
            "jarvis" -> JarvisSection(vm, toast)
            "privacy" -> PrivacySection(vm, toast)
            "profile" -> ProfileSection(vm, toast)
            "providers" -> ProvidersSection(vm, toast)
            "models" -> ModelsSection(vm, toast)
            "compare" -> CompareSection(vm, toast)
            "budgets" -> BudgetsSection(vm, toast)
            "memory" -> MemorySection(vm, toast)
            "autonomy" -> AutonomySection(vm, toast)
            "permissions" -> PermissionsSection(vm)
            "plugins" -> PluginsSection(vm, toast)
            "notifications" -> NotificationsSection(vm, toast)
            "appearance" -> AppearanceSection(vm)
            "connection" -> ConnectionSection(vm, toast)
            "security" -> SecuritySection(vm, toast)
            else -> ExportSection(vm, toast)
        }
        Spacer(Modifier.height(40.dp))
    }
}

// ------------------------------------------------------------ perfil

@Composable
private fun ProfileSection(vm: SettingsViewModel, toast: (String?) -> Unit) {
    val session by vm.c.session.session.collectAsState()
    var name by remember(session) { mutableStateOf(session?.displayName.orEmpty()) }
    var confirmLogout by remember { mutableStateOf(false) }
    if (confirmLogout) ConfirmDialog("Cerrar sesión", "Con servidor, los agentes siguen trabajando aunque cierres sesión. En modo local, tus datos quedan guardados en este teléfono.", "Cerrar sesión", {
        vm.run(toast) { runCatching { vm.c.api.logout() }; vm.c.session.clear(); vm.c.cacheDb.cache().clear() }
    }, { confirmLogout = false })
    HudPanel(Modifier.fillMaxWidth(), title = "Perfil") {
        KeyValue("Email", session?.email.orEmpty())
        Spacer(Modifier.height(6.dp))
        NexusTextField(name, { name = it }, "Nombre para mostrar")
        Spacer(Modifier.height(8.dp))
        PrimaryButton("Guardar", { vm.patch(SettingsPatch(displayName = name.trim())) { msg -> toast(msg); vm.c.scope.launch { vm.c.session.updateDisplayName(name.trim()) } } }, Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        GhostButton("Cerrar sesión", { confirmLogout = true }, Modifier.fillMaxWidth(), color = NexusColors.Red, icon = Icons.AutoMirrored.Outlined.Logout)
    }
    Spacer(Modifier.height(10.dp))
    SessionsPanel(vm, toast)
}

@Composable
private fun SessionsPanel(vm: SettingsViewModel, toast: (String?) -> Unit) {
    var sessions by remember { mutableStateOf<List<SessionDto>?>(null) }
    LaunchedEffect(Unit) { sessions = runCatching { vm.c.api.sessions() }.getOrNull() }
    HudPanel(Modifier.fillMaxWidth(), title = "Sesiones activas") {
        sessions?.forEach { s ->
            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text((s.userAgent ?: "Dispositivo").take(60), style = MaterialTheme.typography.bodySmall, color = NexusColors.TextPrimary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text("${s.ip ?: "—"} · desde ${Time.short(s.createdAt)}${if (s.current) " · esta sesión" else ""}", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
                }
                if (!s.current) Text("REVOCAR", style = MaterialTheme.typography.labelSmall, color = NexusColors.Red, modifier = Modifier.clickable {
                    vm.run(toast, "Sesión revocada") { vm.c.api.revokeSession(s.familyId); sessions = vm.c.api.sessions() }
                })
            }
        } ?: LoadingState()
    }
}

// ------------------------------------------------------------ proveedores

@Composable
private fun ProvidersSection(vm: SettingsViewModel, toast: (String?) -> Unit) {
    var providers by remember { mutableStateOf<List<ProviderDto>?>(null) }
    var kinds by remember { mutableStateOf<List<ProviderKindDto>>(emptyList()) }
    var models by remember { mutableStateOf<List<ModelDto>>(emptyList()) }
    var tests by remember { mutableStateOf<Map<String, ProviderTestResult>>(emptyMap()) }
    val reload: () -> Unit = {
        vm.run(toast) { providers = vm.c.api.providers(); kinds = vm.c.api.providerKinds(); models = vm.c.api.models() }
    }
    LaunchedEffect(Unit) { reload() }
    var kind by remember { mutableStateOf("") }
    var local by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { local = vm.c.isLocalMode() }
    LaunchedEffect(kinds) { if (kinds.isNotEmpty() && kinds.none { it.kind == kind }) kind = kinds.first().kind }
    var name by remember { mutableStateOf("") }
    var url by remember { mutableStateOf("") }
    var key by remember { mutableStateOf("") }
    HudPanel(Modifier.fillMaxWidth(), title = "Agregar proveedor") {
        Text(if (local) "Modo local: la clave se guarda cifrada en este teléfono (Android Keystore) y NEXUS llama directo al proveedor. " +
            "No se muestra de nuevo. Claves gratis: Google AI Studio (aistudio.google.com → Get API key) o Groq (console.groq.com → API Keys)."
            else "Las claves se envían cifradas al servidor y se guardan cifradas allí. Nunca quedan en el teléfono ni se muestran de nuevo.",
            style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
        SectionLabel("Tipo")
        SelectChips(kinds.map { it.kind to it.label }, kind, { kind = it })
        val selected = kinds.firstOrNull { it.kind == kind }
        Spacer(Modifier.height(6.dp))
        NexusTextField(name, { name = it }, "Nombre (opcional)")
        Spacer(Modifier.height(6.dp))
        NexusTextField(url, { url = it }, "URL base (opcional)", supporting = selected?.defaultBaseUrl?.let { "Por defecto: $it" })
        Spacer(Modifier.height(6.dp))
        NexusTextField(key, { key = it }, if (selected?.requiresApiKey == false) "API key (opcional)" else "API key", password = true)
        Spacer(Modifier.height(10.dp))
        PrimaryButton("Agregar", {
            vm.run(toast, "Proveedor agregado: probá la conexión y habilitá modelos") {
                vm.c.api.createProvider(ProviderCreate(kind, name.ifBlank { selected?.label ?: kind }, url.trim().ifEmpty { null }, key.trim().ifEmpty { null }))
                name = ""; url = ""; key = ""; reload()
            }
        }, Modifier.fillMaxWidth())
    }
    Spacer(Modifier.height(10.dp))
    providers?.forEach { p ->
        val result = tests[p.id]
        HudPanel(Modifier.fillMaxWidth().padding(bottom = 10.dp), title = p.name) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("${p.kind}${p.baseUrl?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
                    Text("Clave: ${p.apiKeyHint ?: "—"} · probado ${Time.relative(p.lastCheckedAt)}", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
                }
                StatusChip(if (!p.isEnabled) "paused" else if (p.status == "error") "error" else p.status)
            }
            p.lastError?.let { Text(it, style = MaterialTheme.typography.labelSmall, color = NexusColors.Red, maxLines = 3) }
            ToggleRow("Habilitado", p.isEnabled) { on -> vm.run(toast) { vm.c.api.updateProvider(p.id, ProviderPatch(isEnabled = on)); reload() } }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GhostButton("Probar conexión", { vm.run(toast) { tests = tests + (p.id to vm.c.api.testProvider(p.id)); reload() } }, Modifier.weight(1f))
                GhostButton("Eliminar", { vm.run(toast, "Proveedor eliminado") { vm.c.api.deleteProvider(p.id); reload() } }, Modifier.weight(1f), color = NexusColors.Red)
            }
            if (result != null) {
                Spacer(Modifier.height(8.dp))
                if (!result.ok) Text(result.error ?: "Error", color = NexusColors.Red, style = MaterialTheme.typography.bodySmall)
                else {
                    Text("Conexión OK (${result.latencyMs} ms). Modelos disponibles: tocá para habilitar.", style = MaterialTheme.typography.bodySmall, color = NexusColors.Green)
                    val enabled = models.filter { it.providerId == p.id }.map { it.modelName }.toSet()
                    MultiSelectChips(result.models.take(60).map { it to it }, enabled, { modelName ->
                        if (modelName !in enabled) vm.run(toast, "Modelo $modelName habilitado (revisá capacidades y precios en Modelos)") {
                            vm.c.api.createModel(ModelCreate(p.id, modelName)); reload()
                        }
                    })
                }
            }
        }
    } ?: LoadingState()
}

// ------------------------------------------------------------ modelos

private val CAPS = listOf("chat", "tools", "reasoning", "code", "vision", "long_context", "embedding", "web_search")

@Composable
private fun ModelsSection(vm: SettingsViewModel, toast: (String?) -> Unit) {
    var models by remember { mutableStateOf<List<ModelDto>?>(null) }
    val reload: () -> Unit = { vm.run(toast) { models = vm.c.api.models() } }
    LaunchedEffect(Unit) { reload() }
    Text("El router elige el modelo por capacidades, calidad mínima según la tarea y, solo como desempate, por costo. " +
        "Sin precio configurado no se puede estimar el gasto de ese modelo.", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
    Spacer(Modifier.height(10.dp))
    if (models?.isEmpty() == true) Text("No hay modelos. Agregalos desde Proveedores de IA › Probar conexión.", color = NexusColors.Amber, style = MaterialTheme.typography.bodySmall)
    models?.forEach { m -> ModelEditor(m, vm, toast, reload) } ?: LoadingState()
}

@Composable
private fun ModelEditor(m: ModelDto, vm: SettingsViewModel, toast: (String?) -> Unit, reload: () -> Unit) {
    var caps by remember(m) { mutableStateOf(m.capabilities.toSet()) }
    var tier by remember(m) { mutableStateOf("${m.qualityTier}") }
    var pin by remember(m) { mutableStateOf(m.inputPrice ?: "") }
    var pout by remember(m) { mutableStateOf(m.outputPrice ?: "") }
    var ctx by remember(m) { mutableStateOf("${m.contextWindow}") }
    HudPanel(Modifier.fillMaxWidth().padding(bottom = 10.dp), title = m.displayName) {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Tag(m.providerKind ?: "")
            if (m.isDefault) Tag("Predeterminado", NexusColors.Cyan)
            if (m.isEmbeddingDefault) Tag("Embeddings", NexusColors.Green)
            if (!m.isEnabled) Tag("Deshabilitado", NexusColors.Red)
        }
        SectionLabel("Capacidades")
        MultiSelectChips(CAPS.map { it to it }, caps, { c -> caps = if (c in caps) caps - c else caps + c })
        SectionLabel("Calidad (1-5)")
        SelectChips((1..5).map { "$it" to "$it" }, tier, { tier = it })
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            NexusTextField(pin, { pin = it }, "USD / M tokens entrada", modifier = Modifier.weight(1f))
            NexusTextField(pout, { pout = it }, "USD / M tokens salida", modifier = Modifier.weight(1f))
        }
        Spacer(Modifier.height(6.dp))
        NexusTextField(ctx, { ctx = it }, "Ventana de contexto (tokens)")
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PrimaryButton("Guardar", {
                vm.run(toast, "Modelo actualizado") {
                    vm.c.api.updateModel(m.id, ModelPatch(capabilities = caps.toList(), qualityTier = tier.toInt(), inputPrice = pin.trim().ifEmpty { null },
                        outputPrice = pout.trim().ifEmpty { null }, contextWindow = ctx.toIntOrNull())); reload()
                }
            }, Modifier.weight(1f))
            GhostButton(if (m.isDefault) "Es predeterminado" else "Predeterminado", { vm.run(toast) { vm.c.api.updateModel(m.id, ModelPatch(isDefault = true)); reload() } },
                Modifier.weight(1f), enabled = !m.isDefault)
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 6.dp)) {
            GhostButton(if (m.isEnabled) "Deshabilitar" else "Habilitar", { vm.run(toast) { vm.c.api.updateModel(m.id, ModelPatch(isEnabled = !m.isEnabled)); reload() } },
                Modifier.weight(1f), color = NexusColors.Amber)
            GhostButton("Eliminar", { vm.run(toast) { vm.c.api.deleteModel(m.id); reload() } }, Modifier.weight(1f), color = NexusColors.Red)
        }
        if ("embedding" in caps && !m.isEmbeddingDefault) {
            GhostButton("Usar para embeddings de memoria", { vm.run(toast) { vm.c.api.updateModel(m.id, ModelPatch(isEmbeddingDefault = true)); reload() } },
                Modifier.fillMaxWidth().padding(top = 6.dp), color = NexusColors.Green)
        }
    }
}

// ------------------------------------------------------------ comparación de modelos

@Composable
private fun CompareSection(vm: SettingsViewModel, toast: (String?) -> Unit) {
    var models by remember { mutableStateOf<List<ModelDto>>(emptyList()) }
    var runs by remember { mutableStateOf<List<EvalRunDto>>(emptyList()) }
    var selected by remember { mutableStateOf(setOf<String>()) }
    var judge by remember { mutableStateOf<String?>(null) }
    var cases by remember { mutableStateOf("Explicá qué es un índice HNSW en 3 oraciones.\nEscribí una función Python que invierta una lista enlazada.") }
    var detail by remember { mutableStateOf<JsonObject?>(null) }
    val reload: () -> Unit = { vm.run(toast) { models = vm.c.api.models().filter { "chat" in it.capabilities }; runs = vm.c.api.evals() } }
    LaunchedEffect(Unit) { reload() }
    HudPanel(Modifier.fillMaxWidth(), title = "Nueva comparación") {
        Text("Se mide latencia, tokens, costo y errores. Calidad, precisión y cumplimiento de instrucciones los puntúa un modelo juez a ciegas, sin premiar la longitud.",
            style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
        SectionLabel("Modelos a comparar")
        MultiSelectChips(models.map { it.id to it.displayName }, selected, { id -> selected = if (id in selected) selected - id else selected + id })
        SectionLabel("Juez (opcional)")
        SelectChips(listOf("" to "Sin juez") + models.map { it.id to it.displayName }, judge ?: "", { judge = it.ifEmpty { null } })
        Spacer(Modifier.height(6.dp))
        NexusTextField(cases, { cases = it }, "Casos de prueba (uno por línea)", singleLine = false, minLines = 4)
        Spacer(Modifier.height(8.dp))
        PrimaryButton("Ejecutar comparación", {
            val list = cases.lines().filter { it.isNotBlank() }.map { buildJsonObject { put("prompt", it.trim()) } }
            vm.run(toast, "Comparación en cola: el worker la ejecuta en segundo plano") {
                vm.c.api.createEval(EvalCreate("Comparación ${Time.short(java.time.OffsetDateTime.now().toString())}", selected.toList(), judge, list)); reload()
            }
        }, Modifier.fillMaxWidth(), enabled = selected.isNotEmpty())
    }
    Spacer(Modifier.height(10.dp))
    runs.forEach { r ->
        HudPanel(Modifier.fillMaxWidth().padding(bottom = 10.dp), title = r.name, onClick = { vm.run(toast) { detail = vm.c.api.evalDetail(r.id) } }) {
            StatusChip(if (r.status == "completed") "completed" else "running", label = r.status)
            (r.summary["models"] as? JsonArray)?.forEach { row ->
                val o = row as? JsonObject ?: return@forEach
                fun f(k: String) = (o[k] as? JsonPrimitive)?.contentOrNull ?: "—"
                Spacer(Modifier.height(6.dp))
                Text(f("model"), style = MaterialTheme.typography.titleSmall, color = NexusColors.TextPrimary)
                Text("Global ${f("overall")} · calidad ${f("quality")} · precisión ${f("accuracy")} · instrucciones ${f("instruction_following")}",
                    style = MaterialTheme.typography.labelSmall, color = NexusColors.Cyan)
                Text("Latencia ${f("avg_latency_ms")} ms · tokens ${f("total_tokens")} · ${money(f("total_cost_usd"))} · errores ${f("error_rate")}",
                    style = MaterialTheme.typography.labelSmall, color = NexusColors.TextSecondary)
            }
        }
    }
    detail?.let { d ->
        HudPanel(Modifier.fillMaxWidth(), title = "Detalle") {
            (d["results"] as? JsonArray)?.forEach { row ->
                val o = row as? JsonObject ?: return@forEach
                fun f(k: String) = (o[k] as? JsonPrimitive)?.contentOrNull
                Text("Caso ${f("case_index")} · ${models.firstOrNull { it.id == f("model_id") }?.displayName ?: f("model_id")} · ${f("overall") ?: "—"}",
                    style = MaterialTheme.typography.labelMedium, color = NexusColors.Cyan)
                Text((f("output") ?: f("error") ?: "").take(600), style = MaterialTheme.typography.bodySmall, color = NexusColors.TextPrimary)
                f("judge_notes")?.let { Text("Juez: $it", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextSecondary) }
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}

// ------------------------------------------------------------ presupuestos

@Composable
private fun BudgetsSection(vm: SettingsViewModel, toast: (String?) -> Unit) {
    val s by vm.settings.collectAsState()
    var usage by remember { mutableStateOf<JsonObject?>(null) }
    LaunchedEffect(Unit) { usage = runCatching { vm.c.api.usageSummary() }.getOrNull() }
    val settings = s ?: run { LoadingState(); return }
    var daily by remember(settings) { mutableStateOf(settings.dailyBudgetUsd ?: "") }
    var monthly by remember(settings) { mutableStateOf(settings.monthlyBudgetUsd ?: "") }
    var mission by remember(settings) { mutableStateOf(settings.defaultMissionBudgetUsd ?: "") }
    var tokens by remember(settings) { mutableStateOf("${settings.maxTokensPerMission}") }
    var concurrency by remember(settings) { mutableStateOf("${settings.maxConcurrentTasks}") }
    HudPanel(Modifier.fillMaxWidth(), title = "Límites") {
        Text("Al alcanzar un límite, NEXUS avisa y detiene nuevas operaciones que lo excedan. Podés cancelar misiones, cambiar de modelo o subir el límite.",
            style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
        Spacer(Modifier.height(8.dp))
        NexusTextField(daily, { daily = it }, "Límite diario USD (vacío = sin límite)")
        Spacer(Modifier.height(6.dp)); NexusTextField(monthly, { monthly = it }, "Límite mensual USD")
        Spacer(Modifier.height(6.dp)); NexusTextField(mission, { mission = it }, "Presupuesto por defecto por misión USD")
        Spacer(Modifier.height(6.dp)); NexusTextField(tokens, { tokens = it }, "Tope de tokens por misión (aplica aunque no haya precio)")
        Spacer(Modifier.height(6.dp)); NexusTextField(concurrency, { concurrency = it }, "Tareas simultáneas máximas")
        Spacer(Modifier.height(10.dp))
        PrimaryButton("Guardar límites", {
            vm.patch(SettingsPatch(
                dailyBudgetUsd = daily.trim().ifEmpty { null }, clearDailyBudget = daily.isBlank(),
                monthlyBudgetUsd = monthly.trim().ifEmpty { null }, clearMonthlyBudget = monthly.isBlank(),
                defaultMissionBudgetUsd = mission.trim().ifEmpty { null }, clearDefaultMissionBudget = mission.isBlank(),
                maxTokensPerMission = tokens.toIntOrNull(), maxConcurrentTasks = concurrency.toIntOrNull(),
            ), toast)
        }, Modifier.fillMaxWidth())
    }
    Spacer(Modifier.height(10.dp))
    usage?.let { u ->
        val totals = u["totals"] as? JsonObject
        val budget = u["budget"] as? JsonObject
        fun t(o: JsonObject?, k: String) = (o?.get(k) as? JsonPrimitive)?.contentOrNull ?: "0"
        HudPanel(Modifier.fillMaxWidth(), title = "Consumo (30 días)") {
            KeyValue("Tokens de entrada", compact(t(totals, "tokens_in").toLong()))
            KeyValue("Tokens de salida", compact(t(totals, "tokens_out").toLong()))
            KeyValue("Costo estimado", money(t(totals, "cost_usd")))
            KeyValue("Llamadas / fallidas", "${t(totals, "calls")} / ${t(totals, "failed_calls")}")
            KeyValue("Llamadas sin precio configurado", t(totals, "calls_without_price"))
            KeyValue("Gasto hoy", "${money(t(budget, "daily_spent"))}${(budget?.get("daily_limit") as? JsonPrimitive)?.contentOrNull?.let { " / ${money(it)}" } ?: ""}")
            KeyValue("Gasto del mes", "${money(t(budget, "monthly_spent"))}${(budget?.get("monthly_limit") as? JsonPrimitive)?.contentOrNull?.let { " / ${money(it)}" } ?: ""}")
            listOf("by_agent" to "Por agente", "by_model" to "Por modelo", "by_provider" to "Por proveedor").forEach { (key, label) ->
                SectionLabel(label)
                (u[key] as? JsonArray)?.forEach { row ->
                    val o = row as? JsonObject ?: return@forEach
                    val name = t(o, "agent_name").takeIf { it != "0" } ?: t(o, "model").takeIf { it != "0" } ?: t(o, "provider")
                    KeyValue(name, "${compact(t(o, "tokens_in").toLong() + t(o, "tokens_out").toLong())} tok · ${money(t(o, "cost_usd"))}")
                }
            }
            SectionLabel("Por día")
            (u["daily"] as? JsonArray)?.forEach { row ->
                val o = row as? JsonObject ?: return@forEach
                KeyValue(t(o, "day"), "${compact(t(o, "tokens").toLong())} tok · ${money(t(o, "cost_usd"))}")
            }
            Text((u["note"] as? JsonPrimitive)?.contentOrNull ?: "", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
        }
    }
}

// ------------------------------------------------------------ memoria

@Composable
private fun MemorySection(vm: SettingsViewModel, toast: (String?) -> Unit) {
    val s by vm.settings.collectAsState()
    val settings = s ?: run { LoadingState(); return }
    val archive = (settings.memorySettings["archive_learnings"] as? JsonPrimitive)?.contentOrNull != "false"
    var stats by remember { mutableStateOf<JsonObject?>(null) }
    LaunchedEffect(Unit) { stats = runCatching { vm.c.api.memoryStats() }.getOrNull() }
    HudPanel(Modifier.fillMaxWidth(), title = "Memoria") {
        ToggleRow("Archivar aprendizajes de misiones (quedan sin verificar)", archive) { on ->
            vm.patch(SettingsPatch(memorySettings = buildJsonObject { put("archive_learnings", on) }), toast)
        }
        Text("Ningún recuerdo generado por un agente se considera verificado hasta que lo revises en Memory Center. " +
            "La memoria de cada proyecto está aislada de los demás.", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
        stats?.let {
            SectionLabel("Estado")
            KeyValue("Total de recuerdos", (it["total"] as? JsonPrimitive)?.contentOrNull ?: "0")
            (it["by_scope"] as? JsonObject)?.forEach { (k, v) -> KeyValue(k, (v as? JsonPrimitive)?.contentOrNull ?: "") }
            (it["by_verification"] as? JsonObject)?.forEach { (k, v) -> KeyValue(k, (v as? JsonPrimitive)?.contentOrNull ?: "") }
        }
    }
}

// ------------------------------------------------------------ autonomía y programación

@Composable
private fun AutonomySection(vm: SettingsViewModel, toast: (String?) -> Unit) {
    val s by vm.settings.collectAsState()
    val settings = s ?: run { LoadingState(); return }
    HudPanel(Modifier.fillMaxWidth(), title = "Nivel de autonomía") {
        listOf(
            "manual" to "Manual: los agentes analizan y proponen; vos aprobás el plan y toda modificación o comunicación externa.",
            "supervised" to "Autónomo supervisado: investigan, planifican y ejecutan lo de bajo riesgo; lo sensible requiere autorización.",
            "scheduled" to "Autonomía programada: ejecutan misiones recurrentes dentro de los límites y permisos preautorizados.",
        ).forEach { (mode, text) ->
            val active = settings.autonomyMode == mode
            Column(Modifier.fillMaxWidth().clickable { vm.patch(SettingsPatch(autonomyMode = mode), toast) }.padding(vertical = 8.dp)) {
                Text((if (active) "● " else "○ ") + modeLabel(mode).replaceFirstChar { it.uppercase() }, style = MaterialTheme.typography.titleSmall,
                    color = if (active) NexusColors.Cyan else NexusColors.TextPrimary)
                Text(text, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
            }
        }
        Text("Las operaciones irreversibles siempre piden confirmación y los agentes nunca administran la cuenta ni realizan pagos.",
            style = MaterialTheme.typography.labelSmall, color = NexusColors.Amber)
    }
    Spacer(Modifier.height(10.dp))
    SchedulesPanel(vm, toast)
}

@Composable
private fun SchedulesPanel(vm: SettingsViewModel, toast: (String?) -> Unit) {
    var schedules by remember { mutableStateOf<List<ScheduleDto>?>(null) }
    val reload: () -> Unit = { vm.run(toast) { schedules = vm.c.api.schedules() } }
    LaunchedEffect(Unit) { reload() }
    var kind by remember { mutableStateOf("meeting") }
    var name by remember { mutableStateOf("Revisión diaria de proyectos") }
    var objective by remember { mutableStateOf("Revisar el avance de las misiones activas, detectar bloqueos y proponer próximos pasos") }
    var cron by remember { mutableStateOf("0 9 * * 1-5") }
    val tz = remember { java.util.TimeZone.getDefault().id }
    HudPanel(Modifier.fillMaxWidth(), title = "Programaciones") {
        SelectChips(listOf("meeting" to "Reunión", "mission" to "Misión", "reminder" to "Recordatorio"), kind, { kind = it })
        Spacer(Modifier.height(6.dp)); NexusTextField(name, { name = it }, "Nombre")
        Spacer(Modifier.height(6.dp)); NexusTextField(objective, { objective = it }, if (kind == "reminder") "Texto del recordatorio" else "Objetivo", singleLine = false)
        Spacer(Modifier.height(6.dp)); NexusTextField(cron, { cron = it }, "Cron (min hora día mes díaSemana)", supporting = "Zona horaria: $tz · ej. 0 9 * * 1-5 = días hábiles 9:00")
        Spacer(Modifier.height(8.dp))
        PrimaryButton("Programar", {
            val payload = buildJsonObject {
                if (kind == "reminder") { put("title", name); put("body", objective) } else { put("title", name); put("topic", name); put("objective", objective) }
            }
            vm.run(toast, "Programación creada") { vm.c.api.createSchedule(ScheduleCreate(kind, name, cron, tz, payload)); reload() }
        }, Modifier.fillMaxWidth())
        Spacer(Modifier.height(10.dp))
        schedules?.forEach { sch ->
            Row(Modifier.fillMaxWidth().padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("${sch.name} · ${sch.kind}", style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextPrimary)
                    Text("${sch.cron ?: "una vez"} · próxima ${Time.short(sch.nextRunAt)} · ${sch.runCount} ejecuciones", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
                }
                ToggleRow("", sch.isEnabled) { on -> vm.run(toast) { vm.c.api.updateSchedule(sch.id, SchedulePatch(isEnabled = on)); reload() } }
                Text("BORRAR", style = MaterialTheme.typography.labelSmall, color = NexusColors.Red, modifier = Modifier.clickable { vm.run(toast) { vm.c.api.deleteSchedule(sch.id); reload() } })
            }
        }
    }
}

// ------------------------------------------------------------ permisos

@Composable
private fun PermissionsSection(vm: SettingsViewModel) {
    val navigate = LocalNavigate.current
    var agents by remember { mutableStateOf<List<AgentDto>?>(null) }
    LaunchedEffect(Unit) { agents = runCatching { vm.c.api.agents() }.getOrNull() }
    HudPanel(Modifier.fillMaxWidth(), title = "Permisos por agente") {
        Text("Cada agente solo puede usar las herramientas que le concedas, en modo automático o con aprobación. Los agentes no pueden modificar sus propios permisos.",
            style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
        agents?.forEach { a ->
            Row(Modifier.fillMaxWidth().clickable { navigate("agent/${a.id}") }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                AgentAvatar(a.profile.appearance, a.status, 32.dp)
                Spacer(Modifier.width(10.dp))
                Text(a.name, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextPrimary, modifier = Modifier.weight(1f))
                Text("EDITAR ›", style = MaterialTheme.typography.labelSmall, color = NexusColors.Cyan)
            }
        } ?: LoadingState()
    }
}

// ------------------------------------------------------------ plugins

@Composable
private fun PluginsSection(vm: SettingsViewModel, toast: (String?) -> Unit) {
    var plugins by remember { mutableStateOf<List<PluginDto>?>(null) }
    val reload: () -> Unit = { vm.run(toast) { plugins = vm.c.api.plugins() } }
    LaunchedEffect(Unit) { reload() }
    plugins?.forEach { p ->
        val fields = p.configFields
        val values = remember(p) { mutableStateOf(fields.keys.associateWith { k -> (p.configPublic[k] as? JsonPrimitive)?.contentOrNull ?: "" }) }
        HudPanel(Modifier.fillMaxWidth().padding(bottom = 10.dp), title = p.name) {
            Text(p.description, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
            ToggleRow("Activado", p.isEnabled) { on -> vm.run(toast) { vm.c.api.updatePlugin(p.key, PluginPatch(isEnabled = on)); reload() } }
            fields.forEach { (k, spec) ->
                when (spec) {
                    is JsonArray -> {
                        SectionLabel(k)
                        SelectChips(spec.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.map { it to it }, values.value[k], { v -> values.value = values.value + (k to v) })
                    }
                    else -> {
                        val secret = (spec as? JsonPrimitive)?.contentOrNull == "secret"
                        NexusTextField(values.value[k].orEmpty(), { v -> values.value = values.value + (k to v) }, k, password = secret,
                            supporting = if (secret && p.hasSecret) "Ya hay un valor guardado (cifrado); escribí uno nuevo para reemplazarlo" else null)
                    }
                }
            }
            if (fields.isNotEmpty()) {
                Spacer(Modifier.height(6.dp))
                GhostButton("Guardar configuración", {
                    vm.run(toast, "Configuración guardada") { vm.c.api.updatePlugin(p.key, PluginPatch(config = values.value.filterValues { it.isNotBlank() })); reload() }
                }, Modifier.fillMaxWidth())
            }
            SectionLabel("Permisos del plugin")
            p.permissions.forEach { perm ->
                ToggleRow(perm.permission, perm.granted) { on -> vm.run(toast) { vm.c.api.setPluginPermission(p.key, perm.permission, on); reload() } }
            }
        }
    } ?: LoadingState()
}

// ------------------------------------------------------------ notificaciones

private val NOTIFY_LABELS = listOf(
    "mission_completed" to "Misión completada", "mission_blocked" to "Misión bloqueada", "important_error" to "Error importante",
    "approval_requested" to "Solicitud de aprobación", "agent_needs_info" to "Un agente necesita información", "meeting_finished" to "Reunión finalizada",
    "report_ready" to "Informe disponible", "budget_reached" to "Presupuesto alcanzado", "reminder" to "Recordatorios",
)

@Composable
private fun NotificationsSection(vm: SettingsViewModel, toast: (String?) -> Unit) {
    val s by vm.settings.collectAsState()
    val settings = s ?: run { LoadingState(); return }
    HudPanel(Modifier.fillMaxWidth(), title = "Qué notificar") {
        NOTIFY_LABELS.forEach { (key, label) ->
            ToggleRow(label, settings.notificationPrefs[key] != false) { on -> vm.patch(SettingsPatch(notificationPrefs = mapOf(key to on)), toast) }
        }
        Text(if (ai.nexus.app.push.PushSetup.isConfigured()) "Push (FCM) activo en esta app." else
            "Este APK se compiló sin Firebase: las notificaciones llegan en tiempo real con la app abierta y, en segundo plano, por sincronización periódica (cada ~15 min).",
            style = MaterialTheme.typography.labelSmall, color = NexusColors.TextMuted)
    }
}

// ------------------------------------------------------------ apariencia

@Composable
private fun AppearanceSection(vm: SettingsViewModel) {
    val prefs by vm.c.session.prefs.collectAsState()
    HudPanel(Modifier.fillMaxWidth(), title = "Apariencia") {
        ToggleRow("Animaciones (avatares, núcleo, ondas)", prefs.animations) { on -> vm.c.scope.launch { vm.c.session.setAnimations(on) } }
        ToggleRow("Brillos y bordes luminosos", prefs.glow) { on -> vm.c.scope.launch { vm.c.session.setGlow(on) } }
        Text("Sin animaciones la app funciona igual: los estados reales se muestran con colores y etiquetas.", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
    }
}

// ------------------------------------------------------------ conexión

@Composable
private fun ConnectionSection(vm: SettingsViewModel, toast: (String?) -> Unit) {
    val prefs by vm.c.session.prefs.collectAsState()
    val connection by appContainer().realtime.state.collectAsState()
    var url by remember(prefs.serverUrl) { mutableStateOf(prefs.serverUrl) }
    var health by remember { mutableStateOf<String?>(null) }
    HudPanel(Modifier.fillMaxWidth(), title = "Servidor") {
        KeyValue("Tiempo real", when (connection) {
            ConnectionState.Connected -> "Conectado"
            is ConnectionState.Reconnecting -> "Reconectando"
            ConnectionState.Connecting -> "Conectando"
            ConnectionState.Unauthorized -> "Sesión expirada"
            ConnectionState.Disconnected -> "Desconectado"
        })
        Spacer(Modifier.height(6.dp))
        NexusTextField(url, { url = it }, "URL del servidor", supporting = health)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            GhostButton("Probar", { vm.run({}) { val (ok, ms) = vm.c.apiClient.health(url); health = if (ok) "OK · $ms ms" else "No responde" } }, Modifier.weight(1f))
            PrimaryButton("Guardar", { vm.run(toast, "Servidor actualizado") { vm.c.session.setServerUrl(url.trim()); vm.c.realtime.restart() } }, Modifier.weight(1f))
        }
        GhostButton("Reconectar tiempo real", { vm.c.realtime.restart() }, Modifier.fillMaxWidth().padding(top = 8.dp))
    }
}

// ------------------------------------------------------------ seguridad

@Composable
private fun SecuritySection(vm: SettingsViewModel, toast: (String?) -> Unit) {
    val s by vm.settings.collectAsState()
    val navigate = LocalNavigate.current
    HudPanel(Modifier.fillMaxWidth(), title = "Seguridad") {
        KeyValue("STOP ALL AGENTS", if (s?.emergencyStop == true) "ACTIVO" else "inactivo", valueColor = if (s?.emergencyStop == true) NexusColors.Red else NexusColors.Green)
        s?.emergencyStopReason?.let { KeyValue("Motivo", it) }
        Text("Niveles de detención: cancelar una tarea (en la misión), STOP ALL (barra superior: detiene a todos tus agentes) y apagar workers/servidor (infraestructura).",
            style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
        Spacer(Modifier.height(8.dp))
        GhostButton("Ver operaciones bloqueadas", { navigate("activity") }, Modifier.fillMaxWidth(), color = NexusColors.Amber)
        GhostButton("Revisar aprobaciones", { navigate("approvals") }, Modifier.fillMaxWidth().padding(top = 6.dp))
    }
    Spacer(Modifier.height(10.dp))
    SessionsPanel(vm, toast)
}

// ------------------------------------------------------------ exportación

@Composable
private fun ExportSection(vm: SettingsViewModel, toast: (String?) -> Unit) {
    val context = LocalContext.current
    var exporting by remember { mutableStateOf(false) }
    val saver = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri: Uri? ->
        if (uri == null) return@rememberLauncherForActivityResult
        exporting = true
        vm.run({ msg -> exporting = false; toast(msg) }, "Exportación guardada") {
            val json = vm.c.api.exportData()
            context.contentResolver.openOutputStream(uri)?.use { it.write(json.toByteArray()) }
        }
    }
    HudPanel(Modifier.fillMaxWidth(), title = "Exportar mis datos") {
        Text("Descarga un JSON con agentes, proyectos, misiones, tareas, memoria, conversaciones, ejecuciones de herramientas, consumo y auditoría. " +
            "Las API keys nunca se incluyen.", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
        Spacer(Modifier.height(10.dp))
        PrimaryButton("Exportar", { saver.launch("nexus-export.json") }, Modifier.fillMaxWidth(), loading = exporting)
    }
    ErrorPlaceholder(vm)
}

@Composable
private fun ErrorPlaceholder(vm: SettingsViewModel) {
    val error by vm.error.collectAsState()
    error?.let { ErrorState(it, vm::reload) }
}
