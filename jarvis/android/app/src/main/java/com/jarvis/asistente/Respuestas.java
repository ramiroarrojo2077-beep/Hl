package com.jarvis.asistente;

import android.app.Notification;
import android.content.Context;

/**
 * Responder desde la notificación, como hacen los relojes inteligentes: guarda la acción "Responder" (con RemoteInput)
 * de cada conversación y, cuando aprobás un borrador, completa el texto y la dispara. Funciona con WhatsApp, Telegram,
 * Messenger, Instagram, SMS y cualquier app que tenga "Responder" en la notificación.
 */
final class Respuestas {
    private Respuestas() {}

    /** Guarda la acción de responder de una conversación y devuelve su clave (estable para la misma conversación). */
    static String recordar(String paquete, String conversacion, Notification.Action accion) {
        throw new UnsupportedOperationException("pendiente");
    }

    static boolean puedeResponder(String clave) {
        throw new UnsupportedOperationException("pendiente");
    }

    /** @throws Exception con un mensaje en español si la notificación ya no existe o la app rechazó la respuesta. */
    static void responder(Context c, String clave, String texto) throws Exception {
        throw new UnsupportedOperationException("pendiente");
    }
}
