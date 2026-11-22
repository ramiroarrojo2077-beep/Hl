package ai.nexus.app.local

import ai.nexus.app.data.model.*
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedDeque

/*
 * Envío automático y modo comunidad (WhatsApp), con las condiciones que lo hacen seguro:
 *  1. Solo en los chats que el usuario autorizó a mano («activá el envío automático para el grupo X», con confirmación única).
 *  2. Tope por hora (12) para no spamear ni arriesgar la cuenta. STOP ALL lo frena de inmediato.
 *  3. Solo responde cuando lo mencionan («nexus …») o usan un comando («!juego», «!trivia», «!resumen»).
 * El historial reciente de esos chats vive solo en la memoria del teléfono (se pierde al cerrar la app) y nunca se envía a otros chats.
 */
private const val MAX_PER_HOUR = 12
private val sentAt = ConcurrentLinkedDeque<Long>()
private val buffers = ConcurrentHashMap<String, ConcurrentLinkedDeque<String>>()
private val handled = ConcurrentLinkedDeque<String>()

private fun fold(s: String) = normalize(s).trim()

internal fun LocalBackend.autoChats(): List<String> =
    (settings().jarvis["auto_send_chats"] as? JsonArray)?.map { it.jsonPrimitive.content }.orEmpty()

private fun LocalBackend.matchesAuto(chat: String): Boolean {
    val q = fold(chat)
    return q.isNotEmpty() && autoChats().any { val a = fold(it); a == q || q.contains(a) || a.contains(q) }
}

internal fun LocalBackend.setAutoChat(chat: String, on: Boolean) {
    val cur = autoChats().filter { fold(it) != fold(chat) }
    val next = if (on) cur + chat.trim() else if (chat.isBlank()) emptyList() else cur
    val s = settings()
    saveSettings(s.copy(jarvis = JsonObject(s.jarvis + ("auto_send_chats" to JsonArray(next.map { JsonPrimitive(it) })))))
}

private fun underRateLimit(): Boolean {
    val cut = System.currentTimeMillis() - 3_600_000
    while (sentAt.peekFirst()?.let { it < cut } == true) sentAt.pollFirst()
    return sentAt.size < MAX_PER_HOUR
}

internal fun LocalBackend.canAutoSend(chat: String): Boolean =
    !settings().settings.emergencyStop && matchesAuto(chat) && underRateLimit()

/** Envío directo (sin confirmar) de una acción whatsapp.reply ya validada. */
internal fun LocalBackend.autoRun(r: ActionRec, params: JsonObject): ActionRec {
    val err = waSender(params.str("chat") ?: "", params.str("text") ?: "")
    if (err == null) sentAt.addLast(System.currentTimeMillis())
    return r.copy(a = r.a.copy(status = if (err == null) "completed" else "failed", stateDetail = if (err == null) "WHATSAPP_REPLY_HANDED" else "ERROR",
        error = err, requiresConfirmation = false, completedAt = nowIso(), expiresAt = null,
        result = JsonObject(r.a.result + ("auto_sent" to JsonPrimitive(true)))))
}

/** Mensaje entrante de un chat (lo llama el servicio de notificaciones). Se ignora todo lo que no sea de un chat autorizado. */
fun LocalBackend.communityIncoming(chat: String, text: String) {
    if (!matchesAuto(chat) || settings().settings.emergencyStop) return
    val key = fold(chat) + "|" + text.hashCode()
    synchronized(handled) { if (handled.contains(key)) return; handled.addLast(key); while (handled.size > 80) handled.pollFirst() }
    val buf = buffers.getOrPut(fold(chat)) { ConcurrentLinkedDeque() }
    buf.addLast(text.take(400)); while (buf.size > 40) buf.pollFirst()
    val t = normalize(text)
    val summoned = Regex("""\bnexus\b""").containsMatchIn(t) || t.trimStart().let { it.startsWith("!") || it.substringAfter(": ", "").trimStart().startsWith("!") }
    if (!summoned || !modelsAvailable()) return
    val job = scope.launch {
        try {
            val history = buf.toList().takeLast(25).joinToString("\n")
            val system = "Sos NEXUS, el animador de una comunidad de amigos en un grupo de WhatsApp. Español rioplatense, cálido y con humor, breve " +
                "(máximo 3 frases, sin markdown). Si piden un juego, trivia, adivinanza o desafío, proponelo y explicá cómo participar. " +
                "Si piden un resumen o qué pasó en el grupo, resumí SOLO en base al historial que te paso. No inventes datos, no reveles información personal " +
                "de nadie y no menciones que sos una IA a menos que te pregunten."
            val (r, _) = complete(system, listOf(ChatMsg("user", "Historial reciente del grupo «$chat»:\n$history\n\nÚltimo mensaje (te lo dirigen a vos): $text\n\nEscribí tu respuesta para el grupo.")),
                400, "community", nexus())
            val reply = r.text.trim().trim('"').take(600)
            if (reply.isBlank() || !canAutoSend(chat)) return@launch
            val a = propose("whatsapp.reply", buildJsonObject { put("chat", chat); put("text", reply) }, "Respuesta automática en $chat", "automation")
            activity("community.reply", "Respondí en «${chat.take(40)}»: ${a.a.status}", if (a.a.status == "completed") "success" else "error")
        } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (_: Exception) { /* sin ruido: no se responde */ }
    }
    running["community:${System.nanoTime()}"] = job
}

internal fun LocalBackend.executeAutosend(key: String, params: JsonObject): JsonObject {
    val chat = params.str("chat") ?: ""
    return if (key == "autosend.enable") {
        if (chat.trim().length < 2) throw bad("Decime el nombre exacto del grupo o chat")
        setAutoChat(chat, true)
        buildJsonObject { put("verified", autoChats().any { fold(it) == fold(chat) }); put("state", "AUTOSEND_ENABLED"); put("chat", chat.trim()) }
    } else {
        setAutoChat(chat, false)
        buildJsonObject { put("verified", chat.isBlank() && autoChats().isEmpty() || autoChats().none { fold(it) == fold(chat) }); put("state", "AUTOSEND_DISABLED") }
    }
}
