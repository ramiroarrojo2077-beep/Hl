package com.jarvis.asistente;

/** Algo que te llegó (un mensaje de cualquier app o un mail) y que Jarvis tiene que analizar. */
final class Entrante {
    /** "whatsapp", "telegram", "email", "sms", "instagram", "messenger" o "app" (cualquier otra). */
    String canal = "app";
    /** Nombre visible de la app ("WhatsApp", "Gmail"…). */
    String app = "";
    /** Paquete de Android de la app que lo mandó (vacío para mails leídos por IMAP). */
    String paquete = "";
    /** Quién lo manda. */
    String de = "";
    /** Nombre del grupo, si es un mensaje de grupo. */
    String grupo;
    /** Asunto (mails). */
    String asunto;
    String texto = "";
    /** Clave para responder desde la notificación (ver {@link Respuestas}); null si no se puede. */
    String claveRespuesta;
    /** Datos para responder un mail por SMTP; null si no es un mail leído por IMAP. */
    String cuentaEmail;
    String responderA;
    String messageId;
    String[] references;

    boolean puedeResponder() {
        return claveRespuesta != null || (cuentaEmail != null && responderA != null && !responderA.isEmpty());
    }
}
