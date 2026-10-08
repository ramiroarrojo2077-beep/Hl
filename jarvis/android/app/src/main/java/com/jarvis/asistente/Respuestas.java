package com.jarvis.asistente;

import android.app.Notification;
import android.app.PendingIntent;
import android.app.RemoteInput;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;

import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Responder desde la notificación, como hacen los relojes inteligentes: guarda la acción "Responder" (con RemoteInput)
 * de cada conversación y, cuando aprobás un borrador, completa el texto y la dispara. Funciona con WhatsApp, Telegram,
 * Messenger, Instagram, SMS y cualquier app que tenga "Responder" en la notificación.
 */
final class Respuestas {
    private Respuestas() {}

    private static final Map<String, Notification.Action> acciones = new ConcurrentHashMap<>();

    /** Guarda la acción de responder de una conversación y devuelve su clave (estable para la misma conversación). */
    static String recordar(String paquete, String conversacion, Notification.Action accion) {
        String clave = "r" + Integer.toHexString((paquete + "|" + conversacion).hashCode());
        acciones.put(clave, accion);
        return clave;
    }

    static boolean puedeResponder(String clave) {
        return clave != null && acciones.containsKey(clave);
    }

    /**
     * @return true si se envió directo; false si la app (por ejemplo Gmail) solo abre su pantalla de respuesta: en ese caso
     *     se abre con el texto copiado al portapapeles para pegarlo.
     * @throws Exception con un mensaje en español si la notificación ya no existe o la app rechazó la respuesta.
     */
    static boolean responder(Context c, String clave, String texto) throws Exception {
        Notification.Action accion = clave == null ? null : acciones.get(clave);
        if (accion == null) {
            throw new Exception("La notificación de esa conversación ya no está. Abrí el chat y respondé desde ahí.");
        }
        RemoteInput[] entradas = accion.getRemoteInputs();
        if (entradas == null || entradas.length == 0) {
            c.getSystemService(android.content.ClipboardManager.class)
                    .setPrimaryClip(android.content.ClipData.newPlainText("Jarvis", texto));
            try {
                accion.actionIntent.send();
            } catch (PendingIntent.CanceledException e) {
                acciones.remove(clave);
                throw new Exception("La notificación ya no está. Abrí la app y respondé desde ahí (el texto quedó copiado).");
            }
            return false;
        }
        Intent intent = new Intent();
        Bundle resultados = new Bundle();
        for (RemoteInput entrada : entradas) resultados.putCharSequence(entrada.getResultKey(), texto);
        RemoteInput.addResultsToIntent(entradas, intent, resultados);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) RemoteInput.setResultsSource(intent, RemoteInput.SOURCE_FREE_FORM_INPUT);
        try {
            accion.actionIntent.send(c, 0, intent);
        } catch (PendingIntent.CanceledException e) {
            acciones.remove(clave);
            throw new Exception("La notificación de esa conversación ya no está. Abrí el chat y respondé desde ahí.");
        }
        return true;
    }
}
