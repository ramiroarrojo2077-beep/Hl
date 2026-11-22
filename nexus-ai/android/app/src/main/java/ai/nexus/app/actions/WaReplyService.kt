package ai.nexus.app.actions

import android.app.Notification
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import ai.nexus.app.whatsapp.ContactResolver
import java.util.concurrent.ConcurrentHashMap

/**
 * Respuestas de WhatsApp desde la notificación (la «respuesta rápida» oficial de Android), sin accesibilidad ni simular toques.
 *
 * - Requiere que el usuario active «Acceso a notificaciones» para NEXUS en los ajustes de Android (consentimiento explícito).
 * - Solo recuerda, en memoria, el NOMBRE del chat y la acción de respuesta de las notificaciones activas de WhatsApp.
 *   No lee ni guarda el contenido de los mensajes.
 * - Solo puede responder a chats que tienen una notificación activa: no puede iniciar mensajes nuevos a un grupo.
 * - Pasarle el texto a WhatsApp no confirma que se haya entregado: NEXUS nunca lo informa como enviado.
 */
class WaReplyService : NotificationListenerService() {
    override fun onListenerConnected() { activeNotifications?.forEach { WaReplyBridge.remember(it) } }
    override fun onNotificationPosted(sbn: StatusBarNotification) = WaReplyBridge.remember(sbn)
    override fun onNotificationRemoved(sbn: StatusBarNotification) = WaReplyBridge.forget(sbn)
}

object WaReplyBridge {
    private class Slot(val key: String, val chat: String, val pending: PendingIntent, val input: RemoteInput, val isGroup: Boolean, val at: Long)
    @Volatile var onMessage: ((chat: String, text: String) -> Unit)? = null
    private val slots = ConcurrentHashMap<String, Slot>()
    private val PACKAGES = setOf(ActionExecutor.WHATSAPP, ActionExecutor.WHATSAPP_BUSINESS)

    private fun fold(s: String) = ContactResolver.fold(s)

    internal fun remember(sbn: StatusBarNotification) {
        if (sbn.packageName !in PACKAGES) return
        val n = sbn.notification
        val title = n.extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)?.toString()
            ?: n.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: return
        val isGroup = n.extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE) != null || n.extras.getBoolean(Notification.EXTRA_IS_GROUP_CONVERSATION)
        val reply = n.actions?.firstOrNull { a -> a.remoteInputs?.any { it.allowFreeFormInput } == true } ?: return
        val input = reply.remoteInputs.first { it.allowFreeFormInput }
        // Se descartan los resúmenes agrupados de WhatsApp («3 mensajes de 2 chats»).
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        slots[fold(title)] = Slot(sbn.key, title, reply.actionIntent, input, isGroup, sbn.postTime)
        // El texto solo se entrega si el chat está en la lista que el usuario autorizó (el backend lo filtra); nunca se guarda en disco.
        n.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.let { onMessage?.invoke(title, it) }
    }

    internal fun forget(sbn: StatusBarNotification) { slots.entries.removeIf { it.value.key == sbn.key } }

    fun isEnabled(context: Context): Boolean =
        Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners").orEmpty()
            .contains(ComponentName(context, WaReplyService::class.java).flattenToString())

    /** Chats a los que hoy se puede responder (para mostrarlos en la vista previa). */
    fun availableChats(): List<String> = slots.values.sortedByDescending { it.at }.map { it.chat }

    /** Devuelve null si se pasó a WhatsApp, o el motivo si no se pudo. */
    fun reply(context: Context, chat: String, text: String): String? {
        if (!isEnabled(context)) return "Falta activar el acceso a notificaciones para NEXUS (Ajustes de Android → Notificaciones → Acceso a notificaciones)."
        if (text.isBlank()) return "El mensaje está vacío."
        val q = fold(chat)
        val slot = slots[q] ?: slots.values.filter { fold(it.chat).contains(q) || q.contains(fold(it.chat)) }.maxByOrNull { it.at }
            ?: return "WhatsApp no tiene una notificación activa de «$chat». Solo puedo responder a chats que acaban de escribir. " +
                (availableChats().take(5).takeIf { it.isNotEmpty() }?.let { "Ahora puedo responder a: ${it.joinToString()}." } ?: "Ahora no hay ninguno.")
        val results = Bundle().apply { putCharSequence(slot.input.resultKey, text) }
        val intent = Intent().addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
        RemoteInput.addResultsToIntent(arrayOf(slot.input), intent, results)
        return try { slot.pending.send(context, 0, intent); null } catch (e: PendingIntent.CanceledException) {
            slots.remove(fold(slot.chat)); "WhatsApp ya no acepta respuestas a ese chat (la notificación venció)."
        }
    }
}
