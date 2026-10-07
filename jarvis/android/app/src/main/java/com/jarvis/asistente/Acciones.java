package com.jarvis.asistente;

import android.content.Context;

import org.json.JSONObject;

/**
 * Avisos que Jarvis te da por su cuenta y borradores de respuesta. Nada se envía sin tu aprobación.
 *
 * Aviso: {id, canal, de, titulo, resumen, texto (lo que dice en voz alta), importancia (baja|media|alta), fecha,
 *   propuestaId?, origen?}. origen = {canal:"notificacion", clave, paquete, app} o
 *   {canal:"email", cuenta, responderA, asunto, messageId, references:[...]}.
 * Propuesta (borrador): {id, canal ("notificacion"|"email"|"whatsapp_nuevo"), para, paraNombre, app, cuenta?, asunto?,
 *   texto, motivo, enRespuestaA?:{messageId, references}, claveRespuesta?, estado (pendiente|enviada|descartada|error),
 *   error?, fecha}.
 */
final class Acciones {
    private Acciones() {}

    static boolean activa(Context c) {
        throw new UnsupportedOperationException("pendiente");
    }

    /** Guarda, emite "activa" y "estado", y avisa al servicio (Servicio.alCambiarAjustes) para prender/apagar el oído. */
    static void cambiarActiva(Context c, boolean activa) {
        throw new UnsupportedOperationException("pendiente");
    }

    /** Completa id/estado/fecha, guarda, emite "propuesta" y la devuelve. */
    static JSONObject crearPropuesta(Context c, JSONObject datos) {
        throw new UnsupportedOperationException("pendiente");
    }

    /**
     * Guarda el aviso (completa id/fecha/propuestaId), emite "aviso" {aviso, propuesta, hablar}. hablar = activa &&
     * (forzarVoz || Ajustes.superaUmbral). Si hablar y la pantalla de Jarvis no está a la vista (Principal.visible), llama a
     * Servicio.darAviso(c, texto + lectura del borrador, hayPropuesta, de) para que se abra sola y te lo diga.
     * La lectura del borrador es igual que en la PC: si mide ≤280 " Te propongo responderle: {texto} ¿Se la mando?",
     * si no " Te dejé una respuesta preparada. ¿Se la mando?".
     */
    static JSONObject registrarAviso(Context c, JSONObject aviso, JSONObject propuesta, boolean forzarVoz) {
        throw new UnsupportedOperationException("pendiente");
    }

    static JSONObject editarPropuesta(Context c, String id, String texto, String asunto) throws Exception {
        throw new UnsupportedOperationException("pendiente");
    }

    /**
     * Envía: "notificacion" → Respuestas.responder; "email" → Correo.enviar; "whatsapp_nuevo" → abre el chat de WhatsApp
     * con el texto escrito (https://wa.me/NUMERO?text=…) para que toques enviar. Si falla, emite la propuesta con
     * estado "error" y la deja "pendiente" para reintentar, y lanza la excepción con el motivo.
     */
    static JSONObject enviarPropuesta(Context c, String id, String texto, String asunto) throws Exception {
        throw new UnsupportedOperationException("pendiente");
    }

    static JSONObject descartarPropuesta(Context c, String id) throws Exception {
        throw new UnsupportedOperationException("pendiente");
    }

    /** "Borrador de {mail|WhatsApp|app} para X listo. Esperando que {usuario} lo apruebe." */
    static String describirPropuesta(Context c, JSONObject propuesta) {
        throw new UnsupportedOperationException("pendiente");
    }
}
