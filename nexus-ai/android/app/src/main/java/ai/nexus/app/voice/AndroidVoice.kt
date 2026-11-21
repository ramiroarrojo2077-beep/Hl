package ai.nexus.app.voice

import ai.nexus.app.data.api.NexusApi
import ai.nexus.app.data.model.VoicePrefs
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import java.util.Locale

/** Reconocedor de Android dentro de la app (sin el diálogo del sistema): parciales, nivel y fin de frase. */
class AndroidRecognizer(private val context: Context) : Recognizer {
    private var sr: SpeechRecognizer? = null
    private var onDevice = false
    override var listener: RecognizerListener? = null

    override val available: Boolean get() = SpeechRecognizer.isRecognitionAvailable(context)

    /** Hay reconocimiento 100 % local (sin enviar audio a servidores)? Requiere Android 12+. */
    fun onDeviceAvailable(): Boolean = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(context)

    private fun create(preferOffline: Boolean): SpeechRecognizer {
        val wantDevice = preferOffline && onDeviceAvailable()
        if (sr == null || wantDevice != onDevice) {
            sr?.destroy()
            sr = if (wantDevice && Build.VERSION.SDK_INT >= 31) SpeechRecognizer.createOnDeviceSpeechRecognizer(context)
            else SpeechRecognizer.createSpeechRecognizer(context)
            onDevice = wantDevice
            sr!!.setRecognitionListener(bridge)
        }
        return sr!!
    }

    private val bridge = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) { listener?.onReady() }
        override fun onBeginningOfSpeech() { listener?.onSpeechStart() }
        override fun onRmsChanged(rmsdB: Float) { listener?.onLevel(((rmsdB + 2f) / 12f).coerceIn(0f, 1f)) }
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() = Unit
        override fun onError(error: Int) {
            val (code, msg) = when (error) {
                SpeechRecognizer.ERROR_NO_MATCH -> VoiceError.NO_MATCH to "No entendí. Probá de nuevo."
                SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> VoiceError.TIMEOUT to "No escuché nada."
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> VoiceError.NO_PERMISSION to "Falta el permiso de micrófono."
                SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> VoiceError.NETWORK to "El reconocimiento necesita conexión y no la hay."
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> VoiceError.BUSY to "El reconocedor está ocupado."
                SpeechRecognizer.ERROR_AUDIO -> VoiceError.AUDIO to "No se pudo usar el micrófono."
                else -> VoiceError.OTHER to "Error de reconocimiento ($error)."
            }
            listener?.onError(code, msg)
        }
        override fun onResults(results: Bundle?) {
            val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
            listener?.onFinal(text)
        }
        override fun onPartialResults(partialResults: Bundle?) {
            partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let { listener?.onPartial(it) }
        }
        override fun onEvent(eventType: Int, params: Bundle?) = Unit
    }

    override fun start(language: String, preferOffline: Boolean) {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, preferOffline)
            // Fin de instrucción: ~1,2 s de silencio (pista para el motor).
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 1200L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 900L)
        }
        create(preferOffline).startListening(intent)
    }

    override fun stop() { sr?.stopListening() }
    override fun cancel() { sr?.cancel() }
    override fun destroy() { sr?.destroy(); sr = null }
}

/**
 * STT remoto opcional (capacidad «stt» configurada en el servidor): graba mientras el usuario
 * habla (pulsar para hablar), sube el audio una vez y borra el archivo local de inmediato.
 */
class RemoteRecognizer(private val context: Context, private val api: NexusApi, private val scope: CoroutineScope) : Recognizer {
    override var listener: RecognizerListener? = null
    override val available = true
    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var language = "es-AR"
    private val main = Handler(Looper.getMainLooper())
    private val meter = object : Runnable {
        override fun run() {
            val r = recorder ?: return
            listener?.onLevel((r.maxAmplitude / 16000f).coerceIn(0f, 1f))
            main.postDelayed(this, 120)
        }
    }
    private val maxDuration = Runnable { stop() }

    override fun start(language: String, preferOffline: Boolean) {
        this.language = language
        val out = File.createTempFile("nexus-voice", ".m4a", context.cacheDir)
        file = out
        try {
            recorder = (if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()).apply {
                setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
                setAudioSamplingRate(16000)
                setOutputFile(out.absolutePath)
                prepare()
                start()
            }
            listener?.onReady()
            main.post(meter)
            main.postDelayed(maxDuration, 20_000)
        } catch (e: Exception) {
            out.delete()
            listener?.onError(VoiceError.AUDIO, "No se pudo grabar: ${e.message}")
        }
    }

    override fun stop() {
        val r = recorder ?: return
        recorder = null
        main.removeCallbacks(meter)
        main.removeCallbacks(maxDuration)
        val f = file
        runCatching { r.stop() }
        r.release()
        if (f == null) return
        scope.launch {
            try {
                val text = api.transcribe("voz.m4a", "audio/mp4", f.readBytes(), language).text
                withContext(Dispatchers.Main) { if (text.isBlank()) listener?.onError(VoiceError.NO_MATCH, "No entendí.") else listener?.onFinal(text) }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) { listener?.onError(VoiceError.NETWORK, e.message ?: "Falló la transcripción remota") }
            } finally {
                f.delete() // el audio nunca se conserva
            }
        }
    }

    override fun cancel() {
        main.removeCallbacks(meter)
        main.removeCallbacks(maxDuration)
        recorder?.let { runCatching { it.stop() }; it.release() }
        recorder = null
        file?.delete()
    }

    override fun destroy() = cancel()
}

/** TTS del teléfono con progreso por palabra, pausas entre oraciones y voz/tono configurables. */
class AndroidSpeaker(context: Context) : Speaker {
    override var listener: SpeakerListener? = null
    private var isReady = false
    override val ready get() = isReady
    private val main = Handler(Looper.getMainLooper())
    private var offsets: Map<String, Int> = emptyMap()
    private var ends: Map<String, Int> = emptyMap()
    private var lastId: String? = null
    private val tts = TextToSpeech(context.applicationContext) { status -> isReady = status == TextToSpeech.SUCCESS }

    init {
        tts.setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String) {
                val base = utteranceId.substringBefore('#')
                if (utteranceId.endsWith("#0")) main.post { listener?.onStart(base) }
            }
            override fun onRangeStart(utteranceId: String, start: Int, end: Int, frame: Int) {
                val global = (offsets[utteranceId] ?: 0) + end
                main.post { listener?.onProgress(utteranceId.substringBefore('#'), global) }
            }
            override fun onDone(utteranceId: String) {
                when {
                    utteranceId == lastId -> main.post { listener?.onDone(utteranceId.substringBefore('#')) }
                    ends.containsKey(utteranceId) -> main.post { listener?.onProgress(utteranceId.substringBefore('#'), ends[utteranceId] ?: 0) }
                }
            }
            @Deprecated("API antigua") override fun onError(utteranceId: String) { main.post { listener?.onError(utteranceId.substringBefore('#')) } }
            override fun onStop(utteranceId: String, interrupted: Boolean) = Unit
        })
    }

    fun voices(language: String): List<Voice> = runCatching {
        val lang = language.substringBefore('-')
        tts.voices?.filter { it.locale.language == lang && !it.isNetworkConnectionRequired }?.sortedBy { it.name } ?: emptyList()
    }.getOrDefault(emptyList())

    override fun speak(id: String, sentences: List<String>, prefs: VoicePrefs) {
        if (!isReady) return
        val locale = Locale.forLanguageTag(prefs.language)
        if (tts.isLanguageAvailable(locale) >= TextToSpeech.LANG_AVAILABLE) tts.language = locale else tts.language = Locale.forLanguageTag("es")
        prefs.voiceName?.let { name -> tts.voices?.firstOrNull { it.name == name }?.let { tts.voice = it } }
        tts.setSpeechRate(prefs.speechRate.toFloat().coerceIn(0.5f, 2f))
        tts.setPitch(prefs.pitch.toFloat().coerceIn(0.5f, 2f))
        val params = Bundle().apply { putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, prefs.volume.toFloat().coerceIn(0f, 1f)) }
        var offset = 0
        val map = mutableMapOf<String, Int>()
        val endMap = mutableMapOf<String, Int>()
        sentences.forEachIndexed { i, s ->
            val uid = "$id#$i"
            map[uid] = offset
            endMap[uid] = offset + s.length
            offset += s.length + 1
            tts.speak(s, if (i == 0) TextToSpeech.QUEUE_FLUSH else TextToSpeech.QUEUE_ADD, params, uid)
            if (i < sentences.lastIndex) tts.playSilentUtterance(220, TextToSpeech.QUEUE_ADD, "$id#pause$i")
        }
        offsets = map
        ends = endMap
        lastId = "$id#${sentences.lastIndex}"
    }

    override fun stop() { if (isReady) tts.stop() }
    override fun shutdown() { tts.shutdown() }
}
