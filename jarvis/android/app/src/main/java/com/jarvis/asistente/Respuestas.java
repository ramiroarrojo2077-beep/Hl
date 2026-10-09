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

    /** Una conversación a la que se le puede responder (persona o grupo), con el nombre que muestra la app. */
    static final class Chat {
        String clave, paquete, app, nombre;
        boolean grupo;
        long fecha;
    }

    private static final Map<String, Chat> chats = new ConcurrentHashMap<>();

    /** Igual que {@link #recordar(String, String, Notification.Action)}, guardando de qué app y si es un grupo. */
    static String recordar(String paquete, String app, String conversacion, boolean grupo, Notification.Action accion) {
        String clave = recordar(paquete, conversacion, accion);
        Chat chat = new Chat();
        chat.clave = clave;
        chat.paquete = paquete;
        chat.app = app;
        chat.nombre = conversacion;
        chat.grupo = grupo;
        chat.fecha = System.currentTimeMillis();
        chats.put(clave, chat);
        return clave;
    }

    private static String normal(String t) {
        return java.text.Normalizer.normalize(t == null ? "" : t, java.text.Normalizer.Form.NFD).replaceAll("\\p{M}", "")
                .toLowerCase(java.util.Locale.ROOT).replaceAll("[^a-z0-9 ]", " ").replaceAll("\\s+", " ").trim();
    }

    /**
     * La conversación (persona o grupo) que mejor coincide con el nombre, de una app ("whatsapp", "telegram"…, o vacío
     * para cualquiera). Exacta primero, después la que contiene el nombre; si hay varias, la más reciente.
     */
    static Chat buscar(String nombre, String app) {
        String buscado = normal(nombre).replaceFirst("^(el|la|los|las) (grupo|chat) (de |del )?", "").replaceFirst("^grupo (de |del )?", "");
        if (buscado.length() < 2) return null;
        String filtroApp = normal(app);
        Chat exacto = null;
        Chat parecido = null;
        for (Chat chat : chats.values()) {
            if (!acciones.containsKey(chat.clave)) continue;
            if (!filtroApp.isEmpty() && !normal(chat.app + " " + chat.paquete).contains(filtroApp)) continue;
            String n = normal(chat.nombre);
            if (n.equals(buscado)) {
                if (exacto == null || chat.fecha > exacto.fecha) exacto = chat;
            } else if (n.contains(buscado) || buscado.contains(n) && n.length() >= 3) {
                if (parecido == null || chat.fecha > parecido.fecha) parecido = chat;
            }
        }
        return exacto != null ? exacto : parecido;
    }

    /** [{clave, app, nombre, grupo, fecha}] de las conversaciones a las que se puede responder, más recientes primero. */
    static org.json.JSONArray conversaciones() {
        java.util.List<Chat> lista = new java.util.ArrayList<>(chats.values());
        lista.sort((a, b) -> Long.compare(b.fecha, a.fecha));
        org.json.JSONArray salida = new org.json.JSONArray();
        for (Chat chat : lista) {
            if (!acciones.containsKey(chat.clave)) continue;
            try {
                salida.put(new org.json.JSONObject().put("clave", chat.clave).put("app", chat.app).put("nombre", chat.nombre)
                        .put("grupo", chat.grupo).put("fecha", Almacen.iso(chat.fecha)));
            } catch (org.json.JSONException ignorada) {
            }
        }
        return salida;
    }

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
