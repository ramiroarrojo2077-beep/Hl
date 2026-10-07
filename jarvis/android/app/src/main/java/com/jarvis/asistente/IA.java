package com.jarvis.asistente;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Cliente de IA gratuita con formato de chat de OpenAI (Gemini, Groq y OpenRouter lo hablan).
 * Prueba los proveedores en orden (gemini → groq → openrouter, solo los que tienen clave en {@link Ajustes});
 * si uno falla o se queda sin cupo (429/503) lo saltea un rato (Retry-After o 60 s) y sigue con el próximo.
 * Si ya se emitió texto en vivo, no cambia de proveedor (duplicaría la respuesta) y relanza el error.
 */
final class IA {
    private IA() {}

    /** Recibe la respuesta en vivo, de a pedacitos. */
    interface AlTexto {
        void delta(String pedazo);
    }

    static final class Respuesta {
        String texto = "";
        /** [{id, type:"function", function:{name, arguments}, extra_content?}] — extra_content es la firma de Gemini. */
        JSONArray llamadas = new JSONArray();
        String proveedor = "";
    }

    static final class ErrorIA extends Exception {
        final int estado;
        ErrorIA(String mensaje, int estado) {
            super(mensaje);
            this.estado = estado;
        }
    }

    /** ¿Hay al menos una IA con clave? */
    static boolean configurada(Context c) {
        throw new UnsupportedOperationException("pendiente");
    }

    /** [{nombre, modelo, disponible}] en orden de uso. */
    static JSONArray proveedores(Context c) {
        throw new UnsupportedOperationException("pendiente");
    }

    /**
     * @param mensajes formato OpenAI: [{role, content, tool_calls?, tool_call_id?, name?}]. Para proveedores que no son
     *     Gemini hay que quitar "name" y "extra_content" de cada mensaje/llamada antes de enviar.
     * @param herramientas definiciones OpenAI [{type:"function", function:{name, description, parameters?}}] o null.
     * @param json true = response_format json_object (sin stream).
     * @param alTexto si no es null, pide stream:true y va entregando el texto.
     * @throws ErrorIA si ninguna IA está configurada o todas fallaron.
     */
    static Respuesta completar(Context c, JSONArray mensajes, JSONArray herramientas, boolean json, AlTexto alTexto)
            throws ErrorIA {
        throw new UnsupportedOperationException("pendiente");
    }

    /** Pide un JSON y lo devuelve parseado (tolera que venga envuelto en ```json). */
    static JSONObject completarJson(Context c, JSONArray mensajes) throws ErrorIA {
        throw new UnsupportedOperationException("pendiente");
    }
}
