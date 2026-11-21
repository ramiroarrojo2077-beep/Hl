package ai.nexus.app.voice

import ai.nexus.app.data.model.VoicePrefs
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Entrada de audio (Audio Input Manager): reconocedor local de Android o grabación para STT remoto. */
interface Recognizer {
    val available: Boolean
    var listener: RecognizerListener?
    fun start(language: String, preferOffline: Boolean)
    fun stop()
    fun cancel()
    fun destroy()
}

interface RecognizerListener {
    fun onReady() {}
    fun onSpeechStart() {}
    fun onLevel(level: Float) {}
    fun onPartial(text: String) {}
    fun onFinal(text: String)
    fun onError(code: VoiceError, message: String)
}

/** Salida de audio (Audio Output Manager). */
interface Speaker {
    val ready: Boolean
    var listener: SpeakerListener?
    fun speak(id: String, sentences: List<String>, prefs: VoicePrefs)
    fun stop()
    fun shutdown()
}

interface SpeakerListener {
    fun onStart(id: String) {}
    /** Avance real de la locución (carácter global ya pronunciado); sincroniza el núcleo visual. */
    fun onProgress(id: String, spokenChars: Int) {}
    fun onDone(id: String)
    fun onError(id: String) {}
}

enum class VoiceError { NO_MATCH, TIMEOUT, NO_PERMISSION, NETWORK, BUSY, UNAVAILABLE, AUDIO, OTHER }

data class VoiceState(
    val available: Boolean = true,
    val sessionActive: Boolean = false,
    val continuous: Boolean = false,
    val listening: Boolean = false,
    val speaking: Boolean = false,
    val muted: Boolean = false,
    val partial: String = "",
    val level: Float = 0f,
    val speakingText: String? = null,
    val speakingMessageId: String? = null,
    val spokenChars: Int = 0,
    val speechPulse: Int = 0,
    val error: String? = null,
    val turns: Int = 0,
)

/**
 * Voice Session Manager + Interrupt Manager. Por defecto: pulsar para hablar. El micrófono solo
 * se abre por una acción del usuario (o, en modo continuo que el usuario activó, después de que
 * NEXUS termina de hablar) y nunca graba en segundo plano.
 */
class VoiceEngine(
    private val recognizer: () -> Recognizer,
    private val speaker: Speaker,
    private val onUtterance: (text: String, interruptedMessageId: String?, spokenChars: Int?) -> Unit,
    private val onControl: (BargeIn) -> Unit = {},
) {
    private val _state = MutableStateFlow(VoiceState())
    val state: StateFlow<VoiceState> = _state
    var prefs: VoicePrefs = VoicePrefs()
    private var rec: Recognizer? = null
    private var bargeListening = false
    private var consecutiveMisses = 0
    private var lastSpoken: Pair<String, String>? = null // id → texto completo

    private fun update(f: (VoiceState) -> VoiceState) { _state.value = f(_state.value) }

    init {
        speaker.listener = object : SpeakerListener {
            override fun onStart(id: String) = update { it.copy(speaking = true, speakingMessageId = id) }
            override fun onProgress(id: String, spokenChars: Int) = update { it.copy(spokenChars = spokenChars, speechPulse = it.speechPulse + 1) }
            override fun onDone(id: String) {
                update { it.copy(speaking = false, speakingText = null, spokenChars = 0) }
                stopBargeListening()
                if (_state.value.sessionActive && _state.value.continuous && !_state.value.muted) startListening()
            }
            override fun onError(id: String) = update { it.copy(speaking = false, error = "No se pudo reproducir la voz") }
        }
    }

    private fun ensureRecognizer(): Recognizer? {
        val r = rec ?: recognizer().also { rec = it }
        if (!r.available) {
            update { it.copy(available = false, error = "El reconocimiento de voz no está disponible en este dispositivo") }
            return null
        }
        r.listener = listener
        return r
    }

    private val listener = object : RecognizerListener {
        override fun onReady() = update { it.copy(listening = true, error = null) }
        override fun onLevel(level: Float) = update { it.copy(level = level.coerceIn(0f, 1f)) }
        override fun onPartial(text: String) {
            if (bargeListening) handleBarge(text, final = false) else update { it.copy(partial = text) }
        }
        override fun onFinal(text: String) {
            if (bargeListening) {
                bargeListening = false
                handleBarge(text, final = true)
                return
            }
            update { it.copy(listening = false, partial = "", level = 0f) }
            if (text.isBlank()) return
            consecutiveMisses = 0
            val control = BargeInDetector.classify(text, null, final = true)
            if (control is BargeIn.Resume || control is BargeIn.Repeat) {
                applyControl(control)
                return
            }
            update { it.copy(turns = it.turns + 1) }
            onUtterance(text.trim(), null, null)
        }
        override fun onError(code: VoiceError, message: String) {
            if (bargeListening) { bargeListening = false; return }
            update { it.copy(listening = false, level = 0f, partial = "") }
            val s = _state.value
            if ((code == VoiceError.NO_MATCH || code == VoiceError.TIMEOUT) && s.sessionActive && s.continuous && !s.muted) {
                consecutiveMisses++
                // Tope de reintentos: el modo continuo no deja el micrófono abierto indefinidamente.
                if (consecutiveMisses <= 2) { startListening(); return }
                consecutiveMisses = 0
                update { it.copy(sessionActive = false, error = "No te escuché. La sesión de voz quedó en pausa: tocá el micrófono para seguir.") }
                return
            }
            if (code != VoiceError.NO_MATCH && code != VoiceError.TIMEOUT) update { it.copy(error = message) }
        }
    }

    fun startListening() {
        if (_state.value.muted) return
        if (_state.value.speaking) interrupt()
        val r = ensureRecognizer() ?: return
        update { it.copy(listening = true, partial = "", error = null) }
        r.start(prefs.language, preferOffline = prefs.processing == "local")
    }

    fun stopListening() {
        rec?.stop()
        update { it.copy(listening = false, level = 0f) }
    }

    /** Un único toque: si NEXUS habla, se calla y escucha; si escucha, termina; si no, empieza. */
    fun tapMic() {
        val s = _state.value
        when {
            s.speaking -> { interrupt(); startListening() }
            s.listening -> stopListening()
            else -> startListening()
        }
    }

    fun startSession(continuous: Boolean) {
        consecutiveMisses = 0
        update { it.copy(sessionActive = true, continuous = continuous, muted = false, turns = 0, error = null) }
        startListening()
    }

    fun endSession() {
        rec?.cancel()
        speaker.stop()
        bargeListening = false
        update { it.copy(sessionActive = false, continuous = false, listening = false, speaking = false, partial = "", level = 0f) }
    }

    fun setMuted(muted: Boolean) {
        if (muted) { rec?.cancel(); bargeListening = false }
        update { it.copy(muted = muted, listening = if (muted) false else it.listening) }
        if (!muted && _state.value.sessionActive && !_state.value.speaking) startListening()
    }

    /** Respuesta hablada. Devuelve false si el motor TTS no está listo. */
    fun speak(messageId: String, text: String): Boolean {
        if (!speaker.ready) return false
        val sentences = SpeechText.sentences(text)
        if (sentences.isEmpty()) return false
        lastSpoken = messageId to sentences.joinToString(" ")
        update { it.copy(speakingText = sentences.joinToString(" "), speakingMessageId = messageId, spokenChars = 0) }
        speaker.speak(messageId, sentences, prefs)
        val s = _state.value
        if (s.sessionActive && s.continuous && prefs.bargeIn && !s.muted) startBargeListening()
        return true
    }

    /** Barge-in: detener la reproducción conservando cuánto se llegó a decir. */
    fun interrupt(): Pair<String?, Int> {
        val s = _state.value
        speaker.stop()
        stopBargeListening()
        update { it.copy(speaking = false) }
        return s.speakingMessageId to s.spokenChars
    }

    private fun startBargeListening() {
        val r = ensureRecognizer() ?: return
        bargeListening = true
        r.start(prefs.language, preferOffline = prefs.processing == "local")
    }

    private fun stopBargeListening() {
        if (bargeListening) { bargeListening = false; rec?.cancel() }
    }

    private fun handleBarge(text: String, final: Boolean) {
        val result = BargeInDetector.classify(text, _state.value.speakingText, final)
        when (result) {
            BargeIn.None -> if (final && _state.value.speaking) startBargeListening()
            is BargeIn.NewInstruction -> {
                val (id, chars) = interrupt()
                update { it.copy(turns = it.turns + 1) }
                onUtterance(result.text, id, chars)
            }
            else -> applyControl(result)
        }
    }

    private fun applyControl(control: BargeIn) {
        when (control) {
            BargeIn.Stop -> {
                interrupt()
                if (_state.value.sessionActive && _state.value.continuous) startListening()
            }
            BargeIn.Resume -> {
                val (id, full) = lastSpoken ?: return
                val from = _state.value.spokenChars.coerceIn(0, full.length)
                val rest = full.substring(from).trim()
                if (rest.isNotEmpty()) speak(id, rest)
            }
            BargeIn.Repeat -> lastSpoken?.let { (id, full) -> speak(id, full) }
            else -> Unit
        }
        onControl(control)
    }

    /** Nuevas preferencias (p. ej. procesamiento local/remoto): el próximo uso crea el reconocedor adecuado. */
    fun reconfigure(newPrefs: VoicePrefs) {
        val changedEngine = newPrefs.processing != prefs.processing || newPrefs.remote.stt.available != prefs.remote.stt.available
        prefs = newPrefs
        if (changedEngine && !_state.value.listening) { rec?.destroy(); rec = null }
    }

    fun release() {
        rec?.destroy()
        rec = null
        speaker.shutdown()
    }
}
