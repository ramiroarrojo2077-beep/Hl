package com.jarvis.asistente;

import android.content.Context;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;

import org.json.JSONArray;

/**
 * Lee las notificaciones de tus apps (con el permiso "Acceso a notificaciones"): WhatsApp, Gmail, Telegram, Instagram,
 * SMS, etc. Cada mensaje nuevo va a Asistente.entrante, con la acción de responder guardada en {@link Respuestas}.
 * Ignora: la propia app, notificaciones fijas/en curso, resúmenes de grupo, repetidas, sin texto, y apps que no son de
 * mensajes (solo procesa categorías msg/email/social o apps conocidas de mensajería/correo o con acción de responder).
 * Si hay cuentas de correo por IMAP configuradas, ignora las notificaciones de Gmail para no avisar dos veces.
 */
public class Escucha extends NotificationListenerService {
    /** ¿El usuario le dio "Acceso a notificaciones" a Jarvis? */
    static boolean permisoConcedido(Context c) {
        throw new UnsupportedOperationException("pendiente");
    }

    /** Últimos mensajes recibidos (máx. 100 en memoria): [{app, de, grupo, texto, fecha}], filtrando por app o persona. */
    static JSONArray recientes(String filtro, int cantidad) {
        throw new UnsupportedOperationException("pendiente");
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        throw new UnsupportedOperationException("pendiente");
    }
}
