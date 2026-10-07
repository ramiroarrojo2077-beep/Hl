package com.jarvis.asistente;

import android.content.Context;

import org.json.JSONArray;

import java.io.File;

/**
 * Voz natural con ElevenLabs, directo desde el celular. Si no hay clave, o se terminó el cupo (401/402/429 o texto
 * "quota"/"credits"), devuelve null y descansa 30 minutos: mientras tanto habla la voz del sistema.
 * Sin Ajustes.ELEVENLABS_VOZ elige sola: voces propias en español > femenina en español > predeterminadas femeninas
 * (Sarah, Laura, Alice, Matilda, Jessica, Charlotte, Lily, Rachel) > cualquiera. Mismo criterio que la versión de PC.
 */
final class ElevenLabs {
    private ElevenLabs() {}

    /** Tiene clave y no está en pausa por falta de cupo. */
    static boolean disponible(Context c) {
        throw new UnsupportedOperationException("pendiente");
    }

    /** Devuelve un mp3 en el caché de la app, o null si no se pudo (nunca lanza). */
    static File sintetizar(Context c, String texto) {
        throw new UnsupportedOperationException("pendiente");
    }

    /** Bytes del mp3 (para POST /api/hablar). */
    static byte[] sintetizarBytes(Context c, String texto) throws Exception {
        throw new UnsupportedOperationException("pendiente");
    }

    /** [{id, nombre, tipo, etiquetas}] de tu cuenta. */
    static JSONArray voces(Context c) throws Exception {
        throw new UnsupportedOperationException("pendiente");
    }
}
