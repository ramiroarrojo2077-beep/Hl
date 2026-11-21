package ai.nexus.app.voice

import ai.nexus.app.whatsapp.ContactResolver

/**
 * Interrupt Manager: decide qué hacer con lo que el micrófono escucha mientras NEXUS habla.
 *
 * El mayor riesgo del barge-in por voz es el eco (el micrófono capta el propio TTS). Por eso
 * se ignora todo parcial que coincide con el texto que se está pronunciando, y solo se
 * interrumpe ante una orden de control o una frase propia del usuario.
 */
sealed interface BargeIn {
    data object None : BargeIn
    data object Stop : BargeIn
    data object Resume : BargeIn
    data object Repeat : BargeIn
    data class NewInstruction(val text: String) : BargeIn
}

object BargeInDetector {
    private val STOP = Regex("^(?:para|pare|stop|basta|callate|silencio|frena|espera|un momento|un segundo|alto|cortala|eso no(?: es lo que queria)?)(?: nexus)?$")
    private val RESUME = Regex("^(?:segui|continua|dale segui|segui hablando|retoma)(?: nexus)?$")
    private val REPEAT = Regex("^(?:repeti|repetilo|repetime|de nuevo|otra vez)(?: nexus)?$")

    fun classify(heard: String, speaking: String?, final: Boolean): BargeIn {
        val h = ContactResolver.fold(heard).replace(Regex("[¿?¡!.,]"), "").trim()
        if (h.isEmpty()) return BargeIn.None
        if (STOP.matches(h) || h.startsWith("para nexus") || h.startsWith("espera nexus")) return BargeIn.Stop
        if (RESUME.matches(h)) return BargeIn.Resume
        if (REPEAT.matches(h)) return BargeIn.Repeat
        if (speaking != null && isEcho(h, ContactResolver.fold(speaking))) return BargeIn.None
        if (h.startsWith("eso no") || h.startsWith("no es eso") || h.startsWith("no nexus")) return BargeIn.NewInstruction(heard.trim())
        // Una frase completa del usuario (no eco) mientras NEXUS habla también lo interrumpe.
        return if (final && h.split(' ').size >= 2) BargeIn.NewInstruction(heard.trim()) else BargeIn.None
    }

    /** Es eco si casi todas las palabras escuchadas están en lo que NEXUS está diciendo. */
    fun isEcho(heard: String, speaking: String): Boolean {
        val words = heard.split(' ').filter { it.length > 2 }
        if (words.isEmpty()) return speaking.contains(heard)
        val hits = words.count { speaking.contains(it) }
        return hits.toDouble() / words.size >= 0.7
    }
}

/** Texto para TTS: sin markdown, con pausas naturales entre oraciones. */
object SpeechText {
    fun clean(text: String): String = text
        .replace(Regex("```[\\s\\S]*?```"), " (te dejo el código en pantalla) ")
        .replace(Regex("https?://\\S+"), " (enlace en pantalla) ")
        .replace(Regex("\\[([^]]+)]\\([^)]+\\)"), "$1")
        .replace(Regex("[#*`>_|]"), " ")
        .replace(Regex("^\\s*[-•]\\s+", RegexOption.MULTILINE), "")
        .replace(Regex("\\s+"), " ")
        .replace(Regex("\\s+([.,;:!?…])"), "$1")
        .trim()

    fun sentences(text: String, max: Int = 3500): List<String> =
        clean(text).take(max).split(Regex("(?<=[.!?…:;])\\s+")).map { it.trim() }.filter { it.isNotEmpty() }
}
