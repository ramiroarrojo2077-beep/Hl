package ai.nexus.app.voice

import ai.nexus.app.data.model.VoiceSettings
import android.content.Context
import android.content.Intent
import android.speech.RecognizerIntent
import android.speech.tts.TextToSpeech
import java.util.Locale

/** Voz de los agentes con el motor TTS del dispositivo (tono, velocidad y acento por agente). */
class TtsManager(context: Context) {
    private var ready = false
    private val tts: TextToSpeech = TextToSpeech(context.applicationContext) { status -> ready = status == TextToSpeech.SUCCESS }

    val isReady get() = ready

    fun speak(text: String, voice: VoiceSettings): Boolean {
        if (!ready || !voice.enabled) return false
        val (pitchAdj, rateAdj) = when (voice.tone) {
            "warm" -> 0.95f to 0.95f
            "bright" -> 1.08f to 1.05f
            "deep" -> 0.85f to 0.92f
            else -> 1f to 1f
        }
        tts.language = Locale.forLanguageTag(voice.locale)
        tts.setPitch((voice.pitch.toFloat() * pitchAdj).coerceIn(0.5f, 2f))
        tts.setSpeechRate((voice.rate.toFloat() * rateAdj).coerceIn(0.5f, 2f))
        val clean = text.replace(Regex("[#*`>_]"), " ").take(3500)
        return tts.speak(clean, TextToSpeech.QUEUE_FLUSH, null, "nexus-${System.nanoTime()}") == TextToSpeech.SUCCESS
    }

    fun stop() {
        if (ready) tts.stop()
    }
}

/** Intent del reconocedor de voz del sistema (el permiso de micrófono lo gestiona el propio sistema). */
fun speechIntent(prompt: String = "Hablale a NEXUS"): Intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
    putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
    putExtra(RecognizerIntent.EXTRA_PROMPT, prompt)
}
