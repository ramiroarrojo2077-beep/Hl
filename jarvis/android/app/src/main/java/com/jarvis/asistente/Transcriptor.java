package com.jarvis.asistente;

import android.content.Context;

/**
 * Audio a texto: Whisper en Groq (whisper-large-v3-turbo, language=es, prompt "Jarvis.") y, si no hay clave o falla,
 * Gemini (generateContent con inline_data, modelo de Ajustes.GEMINI_MODELO). Lo usa el detector de la palabra "Jarvis"
 * cuando no hay AccessKey de Picovoice.
 */
final class Transcriptor {
    private Transcriptor() {}

    static boolean disponible(Context c) {
        throw new UnsupportedOperationException("pendiente");
    }

    /** @param tipo MIME, por ejemplo "audio/wav". Devuelve "" si no se entendió nada. */
    static String transcribir(Context c, byte[] audio, String tipo) throws Exception {
        throw new UnsupportedOperationException("pendiente");
    }
}
