package com.jarvis.asistente;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONException;
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
        return Almacen.de(c).activa();
    }

    /** Guarda, emite "activa" y "estado", y avisa al servicio para prender/apagar el oído. */
    static void cambiarActiva(Context c, boolean activa) {
        Almacen.de(c).activa(activa);
        try {
            Eventos.emitir("activa", new JSONObject().put("activa", activa));
        } catch (JSONException ignorada) {
        }
        Eventos.emitir("estado", null);
        Servicio.alCambiarAjustes(c);
    }

    /** Completa id/estado/fecha, guarda, emite "propuesta" y la devuelve. */
    static JSONObject crearPropuesta(Context c, JSONObject datos) {
        Almacen almacen = Almacen.de(c);
        try {
            datos.put("id", Almacen.nuevoId()).put("estado", "pendiente").put("fecha", Almacen.ahora());
        } catch (JSONException ignorada) {
        }
        synchronized (almacen) {
            almacen.propuestas().put(datos);
        }
        almacen.guardar();
        Eventos.emitir("propuesta", datos);
        return datos;
    }

    static JSONObject registrarAviso(Context c, JSONObject aviso, JSONObject propuesta, boolean forzarVoz) {
        Almacen almacen = Almacen.de(c);
        try {
            aviso.put("id", Almacen.nuevoId()).put("fecha", Almacen.ahora());
            if (propuesta != null) aviso.put("propuestaId", propuesta.optString("id"));
        } catch (JSONException ignorada) {
        }
        synchronized (almacen) {
            almacen.avisos().put(aviso);
        }
        almacen.guardar();
        // Con Jarvis desactivada, el aviso queda anotado pero no te interrumpe.
        boolean hablar = almacen.activa() && (forzarVoz || Ajustes.superaUmbral(c, aviso.optString("importancia", "media")));
        try {
            Eventos.emitir("aviso", new JSONObject().put("aviso", aviso).put("propuesta", propuesta == null ? JSONObject.NULL : propuesta).put("hablar", hablar));
        } catch (JSONException ignorada) {
        }
        if (hablar && !Principal.visible) {
            String texto = aviso.optString("texto");
            if (propuesta != null) {
                String borrador = propuesta.optString("texto");
                texto += borrador.length() <= 280
                        ? " Te propongo responderle: " + borrador + " ¿Se la mando?"
                        : " Te dejé una respuesta preparada. ¿Se la mando?";
            }
            Servicio.darAviso(c, texto, propuesta != null, aviso.optString("de"));
        }
        return aviso;
    }

    private static JSONObject pendiente(Context c, String id) throws Exception {
        Almacen almacen = Almacen.de(c);
        JSONObject p;
        synchronized (almacen) {
            p = almacen.buscar(almacen.propuestas(), id);
        }
        if (p == null) throw new Exception("No existe esa propuesta.");
        String estado = p.optString("estado");
        if (!"pendiente".equals(estado) && !"error".equals(estado)) throw new Exception("Esa propuesta ya fue " + estado + ".");
        return p;
    }

    static JSONObject editarPropuesta(Context c, String id, String texto, String asunto) throws Exception {
        JSONObject p = pendiente(c, id);
        Almacen almacen = Almacen.de(c);
        synchronized (almacen) {
            if (texto != null && !texto.trim().isEmpty()) p.put("texto", texto.trim());
            if (asunto != null && !asunto.trim().isEmpty()) p.put("asunto", asunto.trim());
        }
        almacen.guardar();
        Eventos.emitir("propuesta", p);
        return p;
    }

    static JSONObject enviarPropuesta(Context c, String id, String texto, String asunto) throws Exception {
        JSONObject p = editarPropuesta(c, id, texto, asunto);
        Almacen almacen = Almacen.de(c);
        try {
            switch (p.optString("canal")) {
                case "notificacion":
                    if (!Respuestas.responder(c, p.optString("claveRespuesta", p.optString("para")), p.optString("texto"))) {
                        p.put("nota", "Abrí la respuesta en " + p.optString("app", "la app") + " con el texto copiado: pegalo y tocá enviar.");
                    }
                    break;
                case "sms_nuevo": {
                    Uri sms = Uri.parse("smsto:" + Uri.encode(p.optString("para")));
                    c.startActivity(new Intent(Intent.ACTION_SENDTO, sms).putExtra("sms_body", p.optString("texto")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    p.put("nota", "Abrí Mensajes con el SMS escrito: falta tocar enviar.");
                    break;
                }
                case "email": {
                    JSONObject respuesta = p.optJSONObject("enRespuestaA");
                    String[] refs = new String[0];
                    if (respuesta != null) {
                        JSONArray arreglo = respuesta.optJSONArray("references");
                        refs = new String[arreglo == null ? 0 : arreglo.length()];
                        for (int i = 0; i < refs.length; i++) refs[i] = arreglo.optString(i);
                    }
                    Correo.enviar(c, p.optString("cuenta"), p.optString("para"), p.optString("asunto"), p.optString("texto"),
                            respuesta == null ? null : respuesta.optString("messageId"), refs);
                    break;
                }
                case "whatsapp_compartir": {
                    // Un chat o grupo que no escribió hace poco: WhatsApp no deja abrir un grupo por nombre, así que se
                    // comparte el texto y vos elegís el grupo (también queda copiado).
                    c.getSystemService(android.content.ClipboardManager.class)
                            .setPrimaryClip(android.content.ClipData.newPlainText("Jarvis", p.optString("texto")));
                    Intent compartir = new Intent(Intent.ACTION_SEND).setType("text/plain").setPackage("com.whatsapp")
                            .putExtra(Intent.EXTRA_TEXT, p.optString("texto")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    try {
                        c.startActivity(compartir);
                    } catch (android.content.ActivityNotFoundException sinWhatsapp) {
                        c.startActivity(Intent.createChooser(compartir.setPackage(null), "Mandar con").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    }
                    p.put("nota", "Abrí WhatsApp con el mensaje: elegí «" + p.optString("paraNombre") + "» y tocá enviar.");
                    break;
                }
                case "whatsapp_nuevo": {
                    Uri chat = Uri.parse("https://wa.me/" + p.optString("para").replaceAll("\\D", "") + "?text=" + Uri.encode(p.optString("texto")));
                    c.startActivity(new Intent(Intent.ACTION_VIEW, chat).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                    break;
                }
                default:
                    throw new Exception("No sé cómo enviar esa propuesta.");
            }
            synchronized (almacen) {
                p.put("estado", "enviada");
                p.remove("error");
            }
        } catch (Exception e) {
            synchronized (almacen) {
                p.put("estado", "error");
                p.put("error", e.getMessage());
            }
            almacen.guardar();
            Eventos.emitir("propuesta", p);
            // Queda pendiente para poder reintentar.
            synchronized (almacen) {
                p.put("estado", "pendiente");
            }
            almacen.guardar();
            throw new Exception("No se pudo enviar: " + e.getMessage());
        }
        almacen.guardar();
        Eventos.emitir("propuesta", p);
        return p;
    }

    static JSONObject descartarPropuesta(Context c, String id) throws Exception {
        JSONObject p = pendiente(c, id);
        Almacen almacen = Almacen.de(c);
        synchronized (almacen) {
            p.put("estado", "descartada");
        }
        almacen.guardar();
        Eventos.emitir("propuesta", p);
        return p;
    }

    /** "Borrador de {mail|WhatsApp|app} para X listo. Esperando que {usuario} lo apruebe." */
    static String describirPropuesta(Context c, JSONObject propuesta) {
        String canal = "email".equals(propuesta.optString("canal")) ? "mail" : propuesta.optString("app", "mensaje");
        if (canal.isEmpty()) canal = "mensaje";
        return "Borrador de " + canal + " para " + propuesta.optString("paraNombre") + " listo. Esperando que "
                + Ajustes.texto(c, Ajustes.USUARIO) + " lo apruebe.";
    }
}
