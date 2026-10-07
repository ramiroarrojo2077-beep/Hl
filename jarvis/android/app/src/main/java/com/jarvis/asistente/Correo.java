package com.jarvis.asistente;

import android.content.Context;

import org.json.JSONArray;

/**
 * Correo por IMAP/SMTP con JavaMail (Gmail con contraseña de aplicación, Yahoo, iCloud, …). Opcional: sin cuentas,
 * los mails llegan igual como notificaciones de Gmail (pero sin poder responderlos). Escucha en vivo con IMAP IDLE,
 * nunca marca como leído (usa PEEK) ni borra. Formato de Ajustes.EMAIL_CUENTAS: "a@gmail.com:clave,b@yahoo.com:clave".
 * Servidores: gmail/googlemail → imap.gmail.com/smtp.gmail.com (465 SSL); yahoo → imap.mail.yahoo.com/smtp.mail.yahoo.com;
 * icloud/me.com → imap.mail.me.com/smtp.mail.me.com (587 STARTTLS); otros → imap.DOMINIO/smtp.DOMINIO.
 */
final class Correo {
    private Correo() {}

    static boolean configurado(Context c) {
        throw new UnsupportedOperationException("pendiente");
    }

    /** Arranca (o reinicia, si cambiaron las cuentas) la escucha de todas las cuentas. Los mails nuevos van a Asistente.entrante. */
    static void iniciar(Context c) {
        throw new UnsupportedOperationException("pendiente");
    }

    static void detener() {
        throw new UnsupportedOperationException("pendiente");
    }

    /** [{cuenta, estado (conectando|conectado|error), noLeidos, error?}]. */
    static JSONArray estado() {
        throw new UnsupportedOperationException("pendiente");
    }

    /** [{cuenta, de, deNombre, asunto, texto (máx. 1200), fecha, leido}] más recientes primero. */
    static JSONArray leer(Context c, int cantidad, boolean soloNoLeidos) throws Exception {
        throw new UnsupportedOperationException("pendiente");
    }

    /** Envía por SMTP; con messageId arma In-Reply-To y References para que quede en el mismo hilo. */
    static void enviar(Context c, String cuenta, String para, String asunto, String texto, String messageId,
            String[] references) throws Exception {
        throw new UnsupportedOperationException("pendiente");
    }
}
