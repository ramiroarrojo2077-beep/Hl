package ai.nexus.app.features.agents

import ai.nexus.app.AppContainer
import ai.nexus.app.core.avatar.AgentFigure
import ai.nexus.app.core.design.ErrorState
import ai.nexus.app.core.design.GhostButton
import ai.nexus.app.core.design.HudPanel
import ai.nexus.app.core.design.LoadingState
import ai.nexus.app.core.design.Mono
import ai.nexus.app.core.design.MultiSelectChips
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.NexusTextField
import ai.nexus.app.core.design.PrimaryButton
import ai.nexus.app.core.design.SectionLabel
import ai.nexus.app.core.design.SelectChips
import ai.nexus.app.core.design.TraitSlider
import ai.nexus.app.core.design.parseHex
import ai.nexus.app.core.ui.LocalSnackbar
import ai.nexus.app.core.ui.appContainer
import ai.nexus.app.core.ui.nexusViewModel
import ai.nexus.app.core.ui.userMessage
import ai.nexus.app.data.model.AgentUpsert
import ai.nexus.app.data.model.Appearance
import ai.nexus.app.data.model.ModelDto
import ai.nexus.app.data.model.PersonaCatalog
import ai.nexus.app.data.model.ToolDto
import ai.nexus.app.data.model.Traits
import ai.nexus.app.data.model.VoiceSettings
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
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
import androidx.compose.material.icons.outlined.GraphicEq
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

data class AgentDraft(
    val name: String = "",
    val role: String = "",
    val description: String = "",
    val personality: String = "",
    val specialties: String = "",
    val communicationStyle: String = "",
    val workCriteria: String = "",
    val instructions: String = "",
    val reasoningLevel: String = "medium",
    val temperature: Double? = null,
    val memoryEnabled: Boolean = true,
    val meetings: Boolean = true,
    val tools: Set<String> = setOf("memory.search", "memory.propose", "drafts.create"),
    val modelIds: List<String> = emptyList(),
    val appearance: Appearance = Appearance(),
    val traits: Traits = Traits(),
    val voice: VoiceSettings = VoiceSettings(),
    val status: String = "idle",
)

data class EditorState(
    val loading: Boolean = true,
    val error: String? = null,
    val saving: Boolean = false,
    val catalog: PersonaCatalog = PersonaCatalog(),
    val tools: List<ToolDto> = emptyList(),
    val models: List<ModelDto> = emptyList(),
    val draft: AgentDraft = AgentDraft(),
    val original: AgentDraft = AgentDraft(),
    val isSystem: Boolean = false,
)

class AgentEditorViewModel(private val c: AppContainer, private val agentId: String?) : ViewModel() {
    private val _state = MutableStateFlow(EditorState())
    val state: StateFlow<EditorState> = _state

    init { load() }

    fun load() {
        viewModelScope.launch {
            _state.value = _state.value.copy(loading = true, error = null)
            try {
                val catalog = c.api.personaCatalog()
                val tools = c.api.tools()
                val models = c.api.models().filter { "chat" in it.capabilities }
                val draft = if (agentId != null) {
                    val a = c.api.agent(agentId)
                    AgentDraft(
                        name = a.name, role = a.role, description = a.profile.description, personality = a.profile.personality,
                        specialties = a.profile.specialties.joinToString(", "), communicationStyle = a.profile.communicationStyle,
                        workCriteria = a.profile.workCriteria, instructions = a.instructions, reasoningLevel = a.profile.reasoningLevel,
                        temperature = a.profile.temperature, memoryEnabled = a.memoryEnabled, meetings = a.participatesInMeetings,
                        tools = a.permissions.filter { it.allowed }.map { it.toolKey }.toSet(), modelIds = a.models.map { it.modelId },
                        appearance = a.profile.appearance, traits = a.profile.traits, voice = a.profile.voice, status = a.status,
                    ).also { _state.value = _state.value.copy(isSystem = a.isSystem) }
                } else {
                    AgentDraft(traits = Traits(catalog.personalityAxes.associate { it.key to 50 }, catalog.emotionalTraits.associate { it.key to 60 }))
                }
                _state.value = _state.value.copy(loading = false, catalog = catalog, tools = tools, models = models, draft = draft, original = draft)
            } catch (e: Exception) {
                _state.value = _state.value.copy(loading = false, error = e.userMessage())
            }
        }
    }

    fun edit(f: (AgentDraft) -> AgentDraft) { _state.value = _state.value.copy(draft = f(_state.value.draft)) }
    fun reset() { _state.value = _state.value.copy(draft = _state.value.original) }
    fun applyPreset(appearance: Appearance) = edit { it.copy(appearance = appearance) }

    fun save(onDone: (String?, Boolean) -> Unit) {
        val d = _state.value.draft
        if (d.name.isBlank() || d.role.isBlank() || d.instructions.isBlank()) {
            onDone("Nombre, rol e instrucciones son obligatorios (pestaña Identidad)", false); return
        }
        viewModelScope.launch {
            _state.value = _state.value.copy(saving = true)
            try {
                val body = AgentUpsert(
                    name = d.name.trim(), role = d.role.trim(), description = d.description, personality = d.personality,
                    specialties = d.specialties.split(",").map { it.trim() }.filter { it.isNotEmpty() },
                    communicationStyle = d.communicationStyle, workCriteria = d.workCriteria, instructions = d.instructions,
                    color = d.appearance.accent, temperature = d.temperature, reasoningLevel = d.reasoningLevel,
                    memoryEnabled = d.memoryEnabled, participatesInMeetings = d.meetings,
                    tools = if (agentId == null) d.tools.toList() else null,
                    modelIds = if (agentId == null) d.modelIds else null,
                    traits = d.traits, appearance = d.appearance, voice = d.voice,
                )
                if (agentId == null) c.api.createAgent(body) else {
                    c.api.updateAgent(agentId, body)
                    if (d.modelIds != _state.value.original.modelIds) c.api.setAgentModels(agentId, d.modelIds)
                }
                _state.value = _state.value.copy(saving = false, original = d)
                onDone(if (agentId == null) "Agente creado" else "Cambios guardados", true)
            } catch (e: Exception) {
                _state.value = _state.value.copy(saving = false)
                onDone(e.userMessage(), false)
            }
        }
    }
}

private val HAIR_COLORS = listOf("#1B1B1F", "#3B2A20", "#6B4226", "#C9A26B", "#E9E4D8", "#C9D6E8", "#5FB6D9", "#8A5CFF", "#FF6FB5", "#38D99B", "#B3261E", "#2A2F3A")
private val EYE_COLORS = listOf("#00D9FF", "#4B3BBF", "#38D99B", "#FFC24B", "#FF5C5C", "#B69CFF", "#6B4226", "#2E7D32", "#90CAF9", "#FF6FB5")
private val SKIN_TONES = listOf("#F6DCC8", "#F3D5C3", "#F1D3BC", "#E8C4A8", "#E0B899", "#D9A982", "#C68E65", "#A8714A", "#8D5A3B", "#6A4029")
private val OUTFIT_COLORS = listOf("#16324A", "#1A2230", "#221A3D", "#1E3B32", "#2E2614", "#2B1518", "#101820", "#3A3F4B", "#0E2A3A", "#2D1B3D")
private val ACCENTS = listOf("#00D9FF", "#8A5CFF", "#38D99B", "#FF6FB5", "#FFC24B", "#FF5C5C", "#FF8800", "#7CFFCB", "#F4F6FC", "#4FC3F7")
private val LOCALES = listOf("es-AR" to "Español (AR)", "es-ES" to "Español (ES)", "es-MX" to "Español (MX)", "en-US" to "English (US)", "en-GB" to "English (UK)", "pt-BR" to "Português (BR)")

private val LABELS = mapOf(
    "short" to "Corto", "long" to "Largo", "asymmetric" to "Asimétrico", "buzz" to "Rapado", "ponytail" to "Coleta", "mohawk" to "Cresta",
    "helmet" to "Casco", "suit" to "Traje", "armor" to "Armadura", "coat" to "Gabardina", "jacket" to "Chaqueta", "robe" to "Túnica",
    "none" to "Ninguno", "visor" to "Visor", "headset" to "Auriculares", "glasses" to "Lentes", "halo" to "Halo", "a" to "Atlética", "b" to "Estilizada",
    "warm" to "Cálido", "neutral" to "Neutro", "bright" to "Brillante", "deep" to "Grave", "low" to "Bajo", "medium" to "Medio", "high" to "Alto",
)
private fun label(k: String) = LABELS[k] ?: k

@Composable
fun AgentEditorScreen(agentId: String?, onDone: () -> Unit) {
    val vm = nexusViewModel(key = "editor-$agentId") { AgentEditorViewModel(it, agentId) }
    val s by vm.state.collectAsState()
    val snackbar = LocalSnackbar.current
    val scope = rememberCoroutineScope()
    var tab by rememberSaveable { mutableStateOf(if (agentId == null) "identity" else "appearance") }
    var showPresets by rememberSaveable { mutableStateOf(false) }
    when {
        s.loading -> LoadingState()
        s.error != null -> ErrorState(s.error!!, vm::load)
        else -> {
            if (showPresets) PresetGallery(s.catalog, s.draft.status, { vm.applyPreset(it); showPresets = false }, { showPresets = false })
            val save = { vm.save { msg, ok -> scope.launch { msg?.let { snackbar.showSnackbar(it) } }; if (ok && agentId == null) onDone() } }
            BoxWithConstraints(Modifier.fillMaxSize()) {
                val wide = maxWidth >= 840.dp
                Column(Modifier.fillMaxSize()) {
                    EditorTabs(tab) { tab = it }
                    if (wide) {
                        Row(Modifier.weight(1f).padding(12.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            HudPanel(Modifier.weight(1f).fillMaxHeight(), title = tabTitle(tab)) {
                                Column(Modifier.verticalScroll(rememberScrollState())) { TabContent(tab, s, vm) }
                            }
                            CharacterStage(s.draft, Modifier.weight(1.1f).fillMaxHeight())
                            HudPanel(Modifier.weight(0.9f).fillMaxHeight(), title = "Apariencia y voz") {
                                Column(Modifier.verticalScroll(rememberScrollState())) { QuickAppearance(s, vm); VoiceTone(s, vm) }
                            }
                        }
                    } else {
                        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(12.dp)) {
                            CharacterStage(s.draft, Modifier.fillMaxWidth().height(330.dp))
                            Spacer(Modifier.height(12.dp))
                            HudPanel(Modifier.fillMaxWidth(), title = tabTitle(tab)) { TabContent(tab, s, vm) }
                        }
                    }
                    Row(
                        Modifier.fillMaxWidth().background(NexusColors.Background.copy(alpha = 0.95f)).padding(10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically,
                    ) {
                        PrimaryButton("Guardar", save, Modifier.weight(1f), loading = s.saving)
                        GhostButton("Reset", vm::reset, Modifier.weight(0.8f), color = NexusColors.TextSecondary)
                        GhostButton("Presets", { showPresets = true }, Modifier.weight(0.9f))
                    }
                }
            }
        }
    }
}

private fun tabTitle(tab: String) = when (tab) {
    "identity" -> "Identidad"; "appearance" -> "Apariencia"; "personality" -> "Avatar y personalidad"; "emotions" -> "Rasgos emocionales"
    else -> "Voz"
}

@Composable
private fun EditorTabs(tab: String, onSelect: (String) -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp).clip(RoundedCornerShape(10.dp))
            .border(1.dp, NexusColors.Border, RoundedCornerShape(10.dp)).horizontalScroll(rememberScrollState()).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        listOf("identity" to "IDENTIDAD", "appearance" to "APARIENCIA", "personality" to "PERSONALIDAD", "emotions" to "EMOCIONES", "voice" to "VOZ").forEach { (k, l) ->
            val active = k == tab
            Text(
                "[$l]",
                Modifier.clip(RoundedCornerShape(8.dp)).background(if (active) NexusColors.Cyan.copy(alpha = 0.15f) else Color.Transparent)
                    .clickable { onSelect(k) }.padding(horizontal = 8.dp, vertical = 8.dp),
                style = MaterialTheme.typography.labelSmall.copy(fontSize = 10.sp),
                maxLines = 1,
                color = if (active) NexusColors.Cyan else NexusColors.TextSecondary,
            )
        }
    }
}

/** Escenario central: el personaje sobre su plataforma holográfica. */
@Composable
private fun CharacterStage(d: AgentDraft, modifier: Modifier) {
    val accent = parseHex(d.appearance.accent)
    HudPanel(modifier, accent = accent, contentPadding = 10.dp) {
        Box(
            Modifier.fillMaxSize().clip(RoundedCornerShape(12.dp))
                .background(Brush.radialGradient(listOf(accent.copy(alpha = 0.16f), NexusColors.Background.copy(alpha = 0.2f)))),
        ) {
            AgentFigure(d.appearance, d.status, Modifier.fillMaxSize().padding(top = 26.dp))
            Column(Modifier.padding(6.dp)) {
                Text(d.name.ifBlank { "NUEVO AGENTE" }.uppercase(), style = MaterialTheme.typography.headlineMedium, color = NexusColors.TextPrimary)
                Text(d.role.ifBlank { "Definí su rol" }, style = MaterialTheme.typography.bodySmall, color = accent)
            }
            Column(Modifier.align(Alignment.BottomStart).padding(8.dp)) {
                Text("Razonamiento: ${label(d.reasoningLevel)}", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextSecondary)
                Text("Estado: ${ai.nexus.app.core.design.statusStyle(d.status).label}", style = MaterialTheme.typography.labelSmall, color = NexusColors.TextSecondary)
            }
        }
    }
}

@Composable
private fun TabContent(tab: String, s: EditorState, vm: AgentEditorViewModel) {
    val d = s.draft
    when (tab) {
        "identity" -> IdentityTab(s, vm)
        "appearance" -> AppearanceTab(s, vm)
        "personality" -> {
            Text("Los rasgos se traducen en indicaciones de tono y enfoque dentro del prompt del agente.",
                style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
            s.catalog.personalityAxes.forEach { axis ->
                TraitSlider(axis.left, axis.right, d.traits.personality[axis.key] ?: 50, { v ->
                    vm.edit { it.copy(traits = it.traits.copy(personality = it.traits.personality + (axis.key to v))) }
                })
            }
        }
        "emotions" -> {
            s.catalog.emotionalTraits.forEach { t ->
                TraitSlider(t.label, null, d.traits.emotions[t.key] ?: 50, { v ->
                    vm.edit { it.copy(traits = it.traits.copy(emotions = it.traits.emotions + (t.key to v))) }
                }, color = NexusColors.Violet)
            }
        }
        else -> VoiceTone(s, vm, full = true)
    }
}

@Composable
private fun IdentityTab(s: EditorState, vm: AgentEditorViewModel) {
    val d = s.draft
    NexusTextField(d.name, { v -> vm.edit { it.copy(name = v) } }, "Nombre")
    Spacer(Modifier.height(6.dp))
    NexusTextField(d.role, { v -> vm.edit { it.copy(role = v) } }, "Rol (p. ej. Arquitecto de videojuegos)")
    Spacer(Modifier.height(6.dp))
    NexusTextField(d.description, { v -> vm.edit { it.copy(description = v) } }, "Descripción", singleLine = false, minLines = 2)
    Spacer(Modifier.height(6.dp))
    NexusTextField(d.personality, { v -> vm.edit { it.copy(personality = v) } }, "Personalidad (texto libre)", singleLine = false)
    Spacer(Modifier.height(6.dp))
    NexusTextField(d.specialties, { v -> vm.edit { it.copy(specialties = v) } }, "Especialidades (separadas por coma)", singleLine = false)
    Spacer(Modifier.height(6.dp))
    NexusTextField(d.communicationStyle, { v -> vm.edit { it.copy(communicationStyle = v) } }, "Estilo de comunicación", singleLine = false)
    Spacer(Modifier.height(6.dp))
    NexusTextField(d.workCriteria, { v -> vm.edit { it.copy(workCriteria = v) } }, "Criterios de trabajo", singleLine = false)
    Spacer(Modifier.height(6.dp))
    NexusTextField(d.instructions, { v -> vm.edit { it.copy(instructions = v) } }, "Instrucciones del sistema", singleLine = false, minLines = 5,
        supporting = "Se versionan: cada cambio crea una versión nueva")
    SectionLabel("Nivel de razonamiento")
    SelectChips(listOf("low", "medium", "high").map { it to label(it) }, d.reasoningLevel, { v -> vm.edit { it.copy(reasoningLevel = v) } })
    SectionLabel("Temperatura " + (d.temperature?.let { String.format("%.1f", it) } ?: "(predeterminada del modelo)"))
    Row(verticalAlignment = Alignment.CenterVertically) {
        Slider(value = (d.temperature ?: 0.7).toFloat(), onValueChange = { v -> vm.edit { it.copy(temperature = (v * 10).toInt() / 10.0) } },
            valueRange = 0f..1.5f, modifier = Modifier.weight(1f),
            colors = SliderDefaults.colors(thumbColor = NexusColors.Cyan, activeTrackColor = NexusColors.Cyan))
        TextButton(onClick = { vm.edit { it.copy(temperature = null) } }) { Text("AUTO", color = NexusColors.TextSecondary) }
    }
    ToggleRow("Memoria persistente", d.memoryEnabled) { v -> vm.edit { it.copy(memoryEnabled = v) } }
    ToggleRow("Participa en reuniones", d.meetings) { v -> vm.edit { it.copy(meetings = v) } }
    SectionLabel("Modelos (en orden de preferencia)")
    if (s.models.isEmpty()) Text("No hay modelos configurados todavía: el agente usará el router automático cuando agregues uno.",
        style = MaterialTheme.typography.bodySmall, color = NexusColors.Amber)
    MultiSelectChips(s.models.map { it.id to it.displayName }, d.modelIds.toSet(), { id ->
        vm.edit { it.copy(modelIds = if (id in it.modelIds) it.modelIds - id else it.modelIds + id) }
    })
    if (s.original.name.isBlank()) {
        SectionLabel("Herramientas autorizadas")
        Text("Los permisos detallados (con aprobación o automáticos) se ajustan luego en el perfil del agente.",
            style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
        Spacer(Modifier.height(6.dp))
        MultiSelectChips(s.tools.map { it.key to it.name }, d.tools, { key ->
            vm.edit { it.copy(tools = if (key in it.tools) it.tools - key else it.tools + key) }
        })
    }
}

@Composable
fun ToggleRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextPrimary, modifier = Modifier.weight(1f))
        Switch(checked, onChange, colors = SwitchDefaults.colors(checkedThumbColor = NexusColors.Background, checkedTrackColor = NexusColors.Cyan))
    }
}

@Composable
private fun AppearanceTab(s: EditorState, vm: AgentEditorViewModel) {
    val a = s.draft.appearance
    val opts = s.catalog.appearanceOptions
    SectionLabel("Complexión")
    OptionPreviews(opts["body"].orEmpty(), a.body, { a.copy(body = it) }, s.draft.status, bust = false) { v -> vm.edit { it.copy(appearance = it.appearance.copy(body = v)) } }
    SectionLabel("Peinado")
    OptionPreviews(opts["hair"].orEmpty(), a.hair, { a.copy(hair = it) }, s.draft.status, bust = true) { v -> vm.edit { it.copy(appearance = it.appearance.copy(hair = v)) } }
    SectionLabel("Color de pelo")
    Swatches(HAIR_COLORS, a.hairColor) { v -> vm.edit { it.copy(appearance = it.appearance.copy(hairColor = v)) } }
    SectionLabel("Ojos")
    Swatches(EYE_COLORS, a.eyes) { v -> vm.edit { it.copy(appearance = it.appearance.copy(eyes = v)) } }
    SectionLabel("Tono de piel")
    Swatches(SKIN_TONES, a.skin) { v -> vm.edit { it.copy(appearance = it.appearance.copy(skin = v)) } }
    SectionLabel("Vestimenta")
    OptionPreviews(opts["outfit"].orEmpty(), a.outfit, { a.copy(outfit = it) }, s.draft.status, bust = false) { v -> vm.edit { it.copy(appearance = it.appearance.copy(outfit = v)) } }
    SectionLabel("Color de vestimenta")
    Swatches(OUTFIT_COLORS, a.outfitColor) { v -> vm.edit { it.copy(appearance = it.appearance.copy(outfitColor = v)) } }
    SectionLabel("Color de acento (luces y holograma)")
    Swatches(ACCENTS, a.accent) { v -> vm.edit { it.copy(appearance = it.appearance.copy(accent = v)) } }
    SectionLabel("Accesorio")
    OptionPreviews(opts["accessory"].orEmpty(), a.accessory, { a.copy(accessory = it) }, s.draft.status, bust = true) { v -> vm.edit { it.copy(appearance = it.appearance.copy(accessory = v)) } }
}

/** Panel lateral compacto (pantallas anchas): lo esencial de la apariencia. */
@Composable
private fun QuickAppearance(s: EditorState, vm: AgentEditorViewModel) {
    val a = s.draft.appearance
    SectionLabel("[Apariencia]")
    Text("Peinado", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
    OptionPreviews(s.catalog.appearanceOptions["hair"].orEmpty().take(4), a.hair, { a.copy(hair = it) }, s.draft.status, bust = true) { v ->
        vm.edit { it.copy(appearance = it.appearance.copy(hair = v)) }
    }
    Text("Ojos", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
    Swatches(EYE_COLORS.take(6), a.eyes) { v -> vm.edit { it.copy(appearance = it.appearance.copy(eyes = v)) } }
    Text("Vestimenta", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
    OptionPreviews(s.catalog.appearanceOptions["outfit"].orEmpty().take(3), a.outfit, { a.copy(outfit = it) }, s.draft.status, bust = false) { v ->
        vm.edit { it.copy(appearance = it.appearance.copy(outfit = v)) }
    }
}

@Composable
private fun VoiceTone(s: EditorState, vm: AgentEditorViewModel, full: Boolean = false) {
    val v = s.draft.voice
    val tts = appContainer().tts
    val snackbar = LocalSnackbar.current
    val scope = rememberCoroutineScope()
    SectionLabel("Tono de voz")
    LabeledValueSlider("[Altura]", v.pitch, 0.5f..2f) { p -> vm.edit { it.copy(voice = it.voice.copy(pitch = p)) } }
    LabeledValueSlider("[Velocidad]", v.rate, 0.5f..2f) { r -> vm.edit { it.copy(voice = it.voice.copy(rate = r)) } }
    Text("[Timbre]", style = MaterialTheme.typography.bodySmall, color = NexusColors.TextPrimary)
    SelectChips(s.catalog.voiceTones.map { it to label(it) }, v.tone, { t -> vm.edit { it.copy(voice = it.voice.copy(tone = t)) } })
    if (full) {
        SectionLabel("[Acento]")
        SelectChips(LOCALES, v.locale, { l -> vm.edit { it.copy(voice = it.voice.copy(locale = l)) } })
        ToggleRow("Leer respuestas en voz alta", v.enabled) { e -> vm.edit { it.copy(voice = it.voice.copy(enabled = e)) } }
    }
    Spacer(Modifier.height(10.dp))
    GhostButton("Voice preview", {
        val name = s.draft.name.ifBlank { "tu nuevo agente" }
        val ok = tts.speak("Hola, soy $name. ${s.draft.role.ifBlank { "Estoy listo para trabajar con el equipo" }}.", v.copy(enabled = true))
        if (!ok) scope.launch { snackbar.showSnackbar("El motor de voz del dispositivo no está disponible") }
    }, Modifier.fillMaxWidth(), icon = Icons.Outlined.GraphicEq)
}

@Composable
private fun LabeledValueSlider(label: String, value: Double, range: ClosedFloatingPointRange<Float>, onChange: (Double) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextPrimary, modifier = Modifier.weight(1f))
        Text(String.format("%.2f", value), style = MaterialTheme.typography.labelMedium.copy(fontFamily = Mono), color = NexusColors.Cyan)
    }
    Slider(value.toFloat(), { onChange((it * 100).toInt() / 100.0) }, valueRange = range,
        colors = SliderDefaults.colors(thumbColor = NexusColors.Cyan, activeTrackColor = NexusColors.Cyan, inactiveTrackColor = NexusColors.Cyan.copy(alpha = 0.18f)))
}

@Composable
private fun Swatches(colors: List<String>, selected: String, onSelect: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        colors.forEach { hex ->
            val active = hex.equals(selected, ignoreCase = true)
            Box(
                Modifier.size(30.dp).clip(CircleShape).background(parseHex(hex))
                    .border(if (active) 3.dp else 1.dp, if (active) NexusColors.Cyan else Color(0x44FFFFFF), CircleShape)
                    .clickable { onSelect(hex) },
            )
        }
    }
}

/** Opciones con vista previa real del personaje con esa variante aplicada. */
@Composable
private fun OptionPreviews(options: List<String>, selected: String, preview: (String) -> Appearance, status: String, bust: Boolean, onSelect: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { opt ->
            val active = opt == selected
            Column(
                Modifier.width(72.dp).clip(RoundedCornerShape(10.dp)).background(if (active) NexusColors.Cyan.copy(alpha = 0.12f) else NexusColors.Background.copy(alpha = 0.5f))
                    .border(1.dp, if (active) NexusColors.Cyan else Color(0x22FFFFFF), RoundedCornerShape(10.dp)).clickable { onSelect(opt) }.padding(4.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                AgentFigure(preview(opt), status, Modifier.size(width = 64.dp, height = if (bust) 64.dp else 96.dp), bustOnly = bust, showPlatform = false)
                Text(label(opt), style = MaterialTheme.typography.labelSmall, color = if (active) NexusColors.Cyan else NexusColors.TextSecondary, textAlign = TextAlign.Center)
            }
        }
    }
}

/** Galería de personajes: elegir una base y luego personalizarla. */
@Composable
private fun PresetGallery(catalog: PersonaCatalog, status: String, onPick: (Appearance) -> Unit, onDismiss: () -> Unit) {
    val extras = mapOf(
        "explorer" to Appearance("b", "long", "#C9A26B", "#38D99B", "#F1D3BC", "coat", "#0E2A3A", "#7CFFCB", "glasses"),
        "sentinel" to Appearance("a", "buzz", "#1B1B1F", "#FF8800", "#6A4029", "armor", "#101820", "#FF8800", "visor"),
        "muse" to Appearance("b", "ponytail", "#FF6FB5", "#B69CFF", "#F6DCC8", "robe", "#2D1B3D", "#FF6FB5", "halo"),
    )
    val presets = catalog.presets + extras
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = NexusColors.Surface,
        title = { Text("Galería de personajes") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    presets.forEach { (name, appearance) ->
                        Column(
                            Modifier.width(96.dp).clip(RoundedCornerShape(12.dp)).border(1.dp, parseHex(appearance.accent).copy(alpha = 0.5f), RoundedCornerShape(12.dp))
                                .clickable { onPick(appearance) }.padding(6.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            AgentFigure(appearance, status, Modifier.size(84.dp, 130.dp))
                            Text(name.uppercase(), style = MaterialTheme.typography.labelSmall, color = parseHex(appearance.accent))
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text("CERRAR", color = NexusColors.TextSecondary) } },
    )
}
