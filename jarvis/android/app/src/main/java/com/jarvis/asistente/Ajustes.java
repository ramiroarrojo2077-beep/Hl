package com.jarvis.asistente;

import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;

/** Dónde está tu servidor de Jarvis y cómo hablarle. */
final class Ajustes {
    private Ajustes() {}

    private static SharedPreferences preferencias(Context c) {
        return c.getSharedPreferences("jarvis", Context.MODE_PRIVATE);
    }

    static String servidor(Context c) {
        return preferencias(c).getString("servidor", "");
    }

    static String token(Context c) {
        return preferencias(c).getString("token", "");
    }

    static String clavePicovoice(Context c) {
        return preferencias(c).getString("picovoice", "");
    }

    static boolean configurado(Context c) {
        return !servidor(c).isEmpty();
    }

    static boolean escuchaContinua(Context c) {
        return preferencias(c).getBoolean("continua", true);
    }

    static void escuchaContinua(Context c, boolean valor) {
        preferencias(c).edit().putBoolean("continua", valor).apply();
    }

    static boolean yaPregunto(Context c, String clave) {
        SharedPreferences p = preferencias(c);
        boolean pregunto = p.getBoolean("pregunto_" + clave, false);
        if (!pregunto) p.edit().putBoolean("pregunto_" + clave, true).apply();
        return pregunto;
    }

    static void guardar(Context c, String servidor, String token, String clavePicovoice) {
        String limpio = servidor.trim();
        while (limpio.endsWith("/")) limpio = limpio.substring(0, limpio.length() - 1);
        if (!limpio.isEmpty() && !limpio.startsWith("http://") && !limpio.startsWith("https://")) limpio = "http://" + limpio;
        preferencias(c).edit()
                .putString("servidor", limpio)
                .putString("token", token.trim())
                .putString("picovoice", clavePicovoice.trim())
                .apply();
    }

    /** URL completa a una ruta del servidor, con el token incluido. */
    static String url(Context c, String ruta) {
        String token = token(c);
        if (token.isEmpty()) return servidor(c) + ruta;
        return servidor(c) + ruta + (ruta.contains("?") ? "&" : "?") + "token=" + Uri.encode(token);
    }
}
