package com.jarvis.asistente;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONException;
import org.json.JSONObject;

import java.security.SecureRandom;

/** Configuración de Jarvis guardada en el celular: claves de las IA gratuitas, voz, correo y preferencias. */
final class Ajustes {
    private Ajustes() {}

    static final String USUARIO = "usuario";
    static final String CIUDAD = "ciudad";
    static final String PAIS = "pais";
    static final String GEMINI = "gemini";
    static final String GEMINI_MODELO = "geminiModelo";
    static final String GROQ = "groq";
    static final String GROQ_MODELO = "groqModelo";
    static final String OPENROUTER = "openrouter";
    static final String OPENROUTER_MODELO = "openrouterModelo";
    static final String ELEVENLABS = "elevenlabs";
    static final String ELEVENLABS_VOZ = "elevenlabsVoz";
    static final String ELEVENLABS_MODELO = "elevenlabsModelo";
    static final String TAVILY = "tavily";
    static final String PICOVOICE = "picovoice";
    // "yo@gmail.com:clavedeaplicacion,otra@gmail.com:otraclave"
    static final String EMAIL_CUENTAS = "emailCuentas";
    // Desde qué importancia te avisa en voz alta: baja | media | alta
    static final String AVISAR_DESDE = "avisarDesde";
    // "HH:MM" para el resumen de buenos días, vacío lo desactiva.
    static final String RESUMEN_DIARIO = "resumenDiario";
    // low | medium | high
    static final String RAZONAMIENTO = "razonamiento";

    /** Claves que nunca se devuelven completas a la interfaz. */
    static final String[] SECRETOS = {GEMINI, GROQ, OPENROUTER, ELEVENLABS, TAVILY, PICOVOICE, EMAIL_CUENTAS};
    static final String[] TODAS = {
        USUARIO, CIUDAD, PAIS, GEMINI, GEMINI_MODELO, GROQ, GROQ_MODELO, OPENROUTER, OPENROUTER_MODELO,
        ELEVENLABS, ELEVENLABS_VOZ, ELEVENLABS_MODELO, TAVILY, PICOVOICE, EMAIL_CUENTAS, AVISAR_DESDE,
        RESUMEN_DIARIO, RAZONAMIENTO,
    };
    private static final String OCULTO = "••••";

    private static SharedPreferences preferencias(Context c) {
        return c.getApplicationContext().getSharedPreferences("jarvis", Context.MODE_PRIVATE);
    }

    private static String porDefecto(String clave) {
        switch (clave) {
            case USUARIO: return "jefe";
            case PAIS: return "AR";
            case GEMINI_MODELO: return "gemini-flash-latest";
            case GROQ_MODELO: return "openai/gpt-oss-120b";
            case ELEVENLABS_MODELO: return "eleven_flash_v2_5";
            case AVISAR_DESDE: return "media";
            case RAZONAMIENTO: return "low";
            default: return "";
        }
    }

    /** Valor de un ajuste (con su valor por defecto si está vacío). */
    static String texto(Context c, String clave) {
        String valor = preferencias(c).getString(clave, "").trim();
        return valor.isEmpty() ? porDefecto(clave) : valor;
    }

    static boolean tiene(Context c, String clave) {
        return !preferencias(c).getString(clave, "").trim().isEmpty();
    }

    private static boolean esSecreto(String clave) {
        for (String s : SECRETOS) if (s.equals(clave)) return true;
        return false;
    }

    /** Para la interfaz: los secretos van ocultos ("••••1234") y con "configurado" para saber si están. */
    static JSONObject comoJson(Context c) {
        JSONObject json = new JSONObject();
        try {
            for (String clave : TODAS) {
                String valor = preferencias(c).getString(clave, "").trim();
                if (esSecreto(clave)) {
                    json.put(clave, valor.isEmpty() ? "" : OCULTO + valor.substring(Math.max(0, valor.length() - 4)));
                } else {
                    json.put(clave, valor.isEmpty() ? porDefecto(clave) : valor);
                }
            }
        } catch (JSONException ignorada) {
        }
        return json;
    }

    /** Guarda los ajustes conocidos. Un secreto que llega oculto (sin cambios) se deja como estaba. */
    static void actualizar(Context c, JSONObject cambios) {
        SharedPreferences.Editor editor = preferencias(c).edit();
        for (String clave : TODAS) {
            if (!cambios.has(clave)) continue;
            String valor = cambios.optString(clave, "").trim();
            if (esSecreto(clave) && valor.startsWith(OCULTO)) continue;
            editor.putString(clave, valor);
        }
        editor.apply();
    }

    static boolean escuchaContinua(Context c) {
        return preferencias(c).getBoolean("continua", true);
    }

    static void escuchaContinua(Context c, boolean valor) {
        preferencias(c).edit().putBoolean("continua", valor).apply();
    }

    /** Pregunta algo una sola vez (devuelve true si ya se había preguntado). */
    static boolean yaPregunto(Context c, String clave) {
        SharedPreferences p = preferencias(c);
        boolean pregunto = p.getBoolean("pregunto_" + clave, false);
        if (!pregunto) p.edit().putBoolean("pregunto_" + clave, true).apply();
        return pregunto;
    }

    /** Token del servidor interno: solo la pantalla de Jarvis lo conoce, otras apps del celular no pueden usar la API. */
    static synchronized String tokenLocal(Context c) {
        String token = preferencias(c).getString("tokenLocal", "");
        if (token.isEmpty()) {
            byte[] bytes = new byte[24];
            new SecureRandom().nextBytes(bytes);
            StringBuilder sb = new StringBuilder();
            for (byte b : bytes) sb.append(String.format("%02x", b));
            token = sb.toString();
            preferencias(c).edit().putString("tokenLocal", token).apply();
        }
        return token;
    }

    private static int nivel(String importancia) {
        switch (importancia) {
            case "alta": return 2;
            case "media": return 1;
            default: return 0;
        }
    }

    /** ¿Esta importancia alcanza para avisar en voz alta y abrir la app? */
    static boolean superaUmbral(Context c, String importancia) {
        return nivel(importancia) >= nivel(texto(c, AVISAR_DESDE));
    }
}
