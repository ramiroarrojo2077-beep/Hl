package com.jarvis.asistente;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.Person;
import android.app.RemoteInput;
import android.content.ComponentName;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Parcelable;
import android.provider.Settings;
import android.provider.Telephony;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Lee las notificaciones de tus apps (con el permiso "Acceso a notificaciones"): WhatsApp, Gmail, Telegram, Instagram,
 * SMS, etc. Cada mensaje nuevo va a Asistente.entrante, con la acción de responder guardada en {@link Respuestas}.
 * Ignora: la propia app, notificaciones fijas/en curso, resúmenes de grupo, repetidas, sin texto, y apps que no son de
 * mensajes (solo procesa categorías msg/email/social o apps conocidas de mensajería/correo o con acción de responder).
 * Si hay cuentas de correo por IMAP configuradas, ignora las notificaciones de Gmail para no avisar dos veces.
 */
public class Escucha extends NotificationListenerService {
    private static final String TAG = "JarvisEscucha";
    private static final int MAX_RECIENTES = 100;
    private static final Set<String> CONOCIDAS = new HashSet<>(Arrays.asList(
            "com.whatsapp", "com.whatsapp.w4b", "org.telegram.messenger", "org.thunderdog.challegram",
            "com.google.android.gm", "com.microsoft.office.outlook", "com.instagram.android", "com.facebook.orca",
            "com.facebook.katana", "com.discord", "com.Slack", "org.thoughtcrime.securesms"));

    private static final ExecutorService hilo = Executors.newSingleThreadExecutor();
    private static final ArrayDeque<JSONObject> recientes = new ArrayDeque<>();
    // Último mensaje visto por conversación, para no repetir el historial cuando la app reemite la notificación.
    private static final Map<String, Long> ultimoVisto = new ConcurrentHashMap<>();
    private static final Map<String, Boolean> vistos = new LinkedHashMap<String, Boolean>(64, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Boolean> mas) {
            return size() > 300;
        }
    };

    /** ¿El usuario le dio "Acceso a notificaciones" a Jarvis? */
    static boolean permisoConcedido(Context c) {
        ComponentName componente = new ComponentName(c, Escucha.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            return c.getSystemService(NotificationManager.class).isNotificationListenerAccessGranted(componente);
        }
        String habilitados = Settings.Secure.getString(c.getContentResolver(), "enabled_notification_listeners");
        return habilitados != null && habilitados.contains(componente.flattenToString());
    }

    /** Últimos mensajes recibidos (máx. 100 en memoria): [{app, de, grupo, texto, fecha}], filtrando por app o persona. */
    static JSONArray recientes(String filtro, int cantidad) {
        String buscado = filtro == null ? "" : sinAcentos(filtro);
        JSONArray salida = new JSONArray();
        synchronized (recientes) {
            Iterator<JSONObject> it = recientes.descendingIterator();
            while (it.hasNext() && salida.length() < cantidad) {
                JSONObject m = it.next();
                String donde = sinAcentos(m.optString("app") + " " + m.optString("de") + " " + m.optString("grupo"));
                if (buscado.isEmpty() || donde.contains(buscado)) salida.put(m);
            }
        }
        return salida;
    }

    private static String sinAcentos(String texto) {
        return java.text.Normalizer.normalize(texto, java.text.Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT).trim();
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || getPackageName().equals(sbn.getPackageName())) return;
        Notification n = sbn.getNotification();
        if (n == null || (n.flags & (Notification.FLAG_ONGOING_EVENT | Notification.FLAG_GROUP_SUMMARY | Notification.FLAG_FOREGROUND_SERVICE)) != 0) return;
        final String paquete = sbn.getPackageName();
        final Context contexto = getApplicationContext();
        hilo.execute(() -> {
            try {
                procesar(contexto, paquete, n);
            } catch (Exception e) {
                Log.w(TAG, "No pude leer una notificación: " + e.getMessage());
            }
        });
    }

    private static Notification.Action accionResponder(Notification n) {
        if (n.actions == null) return null;
        Notification.Action primera = null;
        for (Notification.Action a : n.actions) {
            RemoteInput[] entradas = a.getRemoteInputs();
            if (entradas == null || entradas.length == 0) continue;
            boolean libre = false;
            for (RemoteInput r : entradas) libre |= r.getAllowFreeFormInput();
            if (!libre) continue;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && a.getSemanticAction() == Notification.Action.SEMANTIC_ACTION_REPLY) return a;
            if (primera == null) primera = a;
        }
        if (primera != null) return primera;
        // Gmail y otras: "Responder" abre su pantalla de respuesta (sin texto libre).
        for (Notification.Action a : n.actions) {
            String titulo = a.title == null ? "" : a.title.toString().toLowerCase(Locale.ROOT);
            if (a.actionIntent != null && (titulo.startsWith("respond") || titulo.startsWith("reply"))) return a;
        }
        return null;
    }

    private static String canal(Context c, String paquete) {
        switch (paquete) {
            case "com.whatsapp": case "com.whatsapp.w4b": return "whatsapp";
            case "org.telegram.messenger": case "org.thunderdog.challegram": return "telegram";
            case "com.google.android.gm": case "com.microsoft.office.outlook": return "email";
            case "com.instagram.android": return "instagram";
            case "com.facebook.orca": return "messenger";
            default:
                return paquete.equals(Telephony.Sms.getDefaultSmsPackage(c)) ? "sms" : "app";
        }
    }

    private static String texto(CharSequence cs) {
        return cs == null ? "" : cs.toString().trim();
    }

    private static void procesar(Context c, String paquete, Notification n) {
        Notification.Action responder = accionResponder(n);
        String categoria = n.category == null ? "" : n.category;
        boolean esMensaje = Notification.CATEGORY_MESSAGE.equals(categoria) || Notification.CATEGORY_EMAIL.equals(categoria)
                || Notification.CATEGORY_SOCIAL.equals(categoria);
        boolean esSms = paquete.equals(Telephony.Sms.getDefaultSmsPackage(c));
        if (!esMensaje && !esSms && !CONOCIDAS.contains(paquete) && responder == null) return;
        String canal = canal(c, paquete);
        if ("com.google.android.gm".equals(paquete) && Correo.configurado(c)) return;

        Bundle extras = n.extras;
        String titulo = texto(extras.getCharSequence(Notification.EXTRA_TITLE));
        String conversacion = texto(extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE));
        boolean grupo = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? extras.getBoolean(Notification.EXTRA_IS_GROUP_CONVERSATION) : !conversacion.isEmpty();
        String claveConversacion = conversacion.isEmpty() ? titulo : conversacion;
        if (claveConversacion.isEmpty()) return;

        // Mensajes nuevos de esta conversación (MessagingStyle trae el historial: solo lo que no vimos).
        StringBuilder cuerpo = new StringBuilder();
        String de = titulo;
        Parcelable[] mensajes = extras.getParcelableArray(Notification.EXTRA_MESSAGES);
        String claveVisto = paquete + "|" + claveConversacion;
        if (mensajes != null && mensajes.length > 0) {
            long ultimo = ultimoVisto.getOrDefault(claveVisto, 0L);
            long maximo = ultimo;
            for (Parcelable p : mensajes) {
                if (!(p instanceof Bundle)) continue;
                Bundle m = (Bundle) p;
                long cuando = m.getLong("time");
                if (cuando <= ultimo) continue;
                String t = texto(m.getCharSequence("text"));
                if (t.isEmpty()) continue;
                CharSequence remitente = m.getCharSequence("sender");
                if (remitente == null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    Person persona = m.getParcelable("sender_person");
                    if (persona != null) remitente = persona.getName();
                }
                if (remitente != null && remitente.length() > 0) de = remitente.toString();
                if (cuerpo.length() > 0) cuerpo.append('\n');
                cuerpo.append(t);
                maximo = Math.max(maximo, cuando);
            }
            ultimoVisto.put(claveVisto, maximo);
        } else {
            String largo = texto(extras.getCharSequence(Notification.EXTRA_BIG_TEXT));
            cuerpo.append(largo.isEmpty() ? texto(extras.getCharSequence(Notification.EXTRA_TEXT)) : largo);
        }
        String mensaje = cuerpo.toString().trim();
        if (mensaje.isEmpty()) return;
        synchronized (vistos) {
            if (vistos.put(claveVisto + "|" + mensaje, Boolean.TRUE) != null) return;
        }

        PackageManager pm = c.getPackageManager();
        String app;
        try {
            ApplicationInfo info = pm.getApplicationInfo(paquete, 0);
            app = pm.getApplicationLabel(info).toString();
        } catch (PackageManager.NameNotFoundException e) {
            app = paquete;
        }

        Entrante e = new Entrante();
        e.canal = canal;
        e.app = app;
        e.paquete = paquete;
        e.de = de.isEmpty() ? app : de;
        if (grupo) e.grupo = conversacion.isEmpty() ? titulo : conversacion;
        if ("email".equals(canal)) e.asunto = texto(extras.getCharSequence(Notification.EXTRA_TEXT));
        e.texto = mensaje.length() > 3000 ? mensaje.substring(0, 3000) : mensaje;
        if (responder != null) e.claveRespuesta = Respuestas.recordar(paquete, claveConversacion, responder);

        try {
            JSONObject reciente = new JSONObject()
                    .put("app", app).put("de", e.de).put("grupo", e.grupo == null ? "" : e.grupo)
                    .put("texto", e.texto).put("fecha", Almacen.ahora());
            synchronized (recientes) {
                recientes.addLast(reciente);
                while (recientes.size() > MAX_RECIENTES) recientes.removeFirst();
            }
        } catch (Exception ignorada) {
        }
        Asistente.entrante(c, e);
    }
}
