package com.jarvis.asistente;

import android.content.Context;
import android.util.Log;

import com.sun.mail.imap.IMAPFolder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Properties;

import javax.mail.Address;
import javax.mail.AuthenticationFailedException;
import javax.mail.BodyPart;
import javax.mail.Flags;
import javax.mail.Folder;
import javax.mail.Message;
import javax.mail.Multipart;
import javax.mail.Part;
import javax.mail.Session;
import javax.mail.Store;
import javax.mail.Transport;
import javax.mail.UIDFolder;
import javax.mail.event.MessageCountAdapter;
import javax.mail.event.MessageCountEvent;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;
import javax.mail.search.FlagTerm;

/**
 * Correo por IMAP/SMTP con JavaMail (Gmail con contraseña de aplicación, Yahoo, iCloud, …). Opcional: sin cuentas,
 * los mails llegan igual como notificaciones de Gmail (pero sin poder responderlos). Escucha en vivo con IMAP IDLE y
 * abre la bandeja en solo lectura: nunca marca como leído ni borra. Formato de Ajustes.EMAIL_CUENTAS:
 * "a@gmail.com:clave,b@yahoo.com:clave".
 */
final class Correo {
    private Correo() {}

    private static final String TAG = "JarvisCorreo";
    private static final int MAX_TEXTO = 3000;

    private static final class Cuenta {
        String usuario, clave, imap, smtp;
        volatile String estado = "conectando";
        volatile String error;
        volatile int noLeidos;
        volatile Thread hilo;
        volatile Store store;
    }

    private static final List<Cuenta> cuentas = new ArrayList<>();
    private static String configuracionActual = "";

    private static String configuracion(Context c) {
        String unica = Ajustes.texto(c, Ajustes.EMAIL_USUARIO).trim();
        String clave = Ajustes.texto(c, Ajustes.EMAIL_CLAVE).replaceAll("\\s+", "");
        String varias = Ajustes.texto(c, Ajustes.EMAIL_CUENTAS);
        if (unica.isEmpty() || clave.isEmpty()) return varias;
        return unica + ":" + clave + (varias.isEmpty() ? "" : "," + varias);
    }

    private static List<Cuenta> leerCuentas(Context c) {
        List<Cuenta> lista = new ArrayList<>();
        for (String entrada : configuracion(c).split(",")) {
            int separador = entrada.indexOf(':');
            if (separador <= 0) continue;
            Cuenta cuenta = new Cuenta();
            cuenta.usuario = entrada.substring(0, separador).trim();
            cuenta.clave = entrada.substring(separador + 1).replaceAll("\\s+", "");
            String dominio = cuenta.usuario.contains("@") ? cuenta.usuario.substring(cuenta.usuario.indexOf('@') + 1).toLowerCase() : "";
            if (dominio.equals("gmail.com") || dominio.equals("googlemail.com")) {
                cuenta.imap = "imap.gmail.com";
                cuenta.smtp = "smtp.gmail.com";
            } else if (dominio.startsWith("yahoo.")) {
                cuenta.imap = "imap.mail.yahoo.com";
                cuenta.smtp = "smtp.mail.yahoo.com";
            } else if (dominio.equals("icloud.com") || dominio.equals("me.com")) {
                cuenta.imap = "imap.mail.me.com";
                cuenta.smtp = "smtp.mail.me.com";
            } else {
                cuenta.imap = "imap." + dominio;
                cuenta.smtp = "smtp." + dominio;
            }
            if (!cuenta.usuario.isEmpty() && !cuenta.clave.isEmpty()) lista.add(cuenta);
        }
        return lista;
    }

    static boolean configurado(Context c) {
        return !leerCuentas(c).isEmpty();
    }

    /** Arranca (o reinicia, si cambiaron las cuentas) la escucha de todas las cuentas. Los mails nuevos van a Asistente.entrante. */
    static synchronized void iniciar(Context c) {
        String configuracion = configuracion(c);
        if (configuracion.equals(configuracionActual) && !cuentas.isEmpty()) return;
        detener();
        configuracionActual = configuracion;
        Context app = c.getApplicationContext();
        for (Cuenta cuenta : leerCuentas(c)) {
            cuentas.add(cuenta);
            cuenta.hilo = new Thread(() -> escuchar(app, cuenta), "jarvis-correo");
            cuenta.hilo.start();
        }
        Eventos.emitir("estado", null);
    }

    static synchronized void detener() {
        for (Cuenta cuenta : cuentas) {
            Thread h = cuenta.hilo;
            cuenta.hilo = null;
            if (h != null) h.interrupt();
            cerrar(cuenta.store);
        }
        cuentas.clear();
        configuracionActual = "";
    }

    /** [{cuenta, estado (conectando|conectado|error), noLeidos, error?}]. */
    static synchronized JSONArray estado() {
        JSONArray lista = new JSONArray();
        for (Cuenta cuenta : cuentas) {
            try {
                JSONObject o = new JSONObject().put("cuenta", cuenta.usuario).put("estado", cuenta.estado).put("noLeidos", cuenta.noLeidos);
                if (cuenta.error != null) o.put("error", cuenta.error);
                lista.put(o);
            } catch (Exception ignorada) {
            }
        }
        return lista;
    }

    private static Session sesion() {
        Properties p = new Properties();
        p.put("mail.imaps.connectiontimeout", "15000");
        p.put("mail.imaps.timeout", "60000");
        p.put("mail.smtp.connectiontimeout", "15000");
        p.put("mail.smtp.timeout", "30000");
        return Session.getInstance(p);
    }

    private static Store conectar(Cuenta cuenta) throws Exception {
        Store store = sesion().getStore("imaps");
        store.connect(cuenta.imap, 993, cuenta.usuario, cuenta.clave);
        return store;
    }

    private static void cerrar(Store store) {
        try {
            if (store != null) store.close();
        } catch (Exception ignorada) {
        }
    }

    private static void cambiar(Cuenta cuenta, String estado, String error) {
        cuenta.estado = estado;
        cuenta.error = error;
        Eventos.emitir("estado", null);
    }

    private static void escuchar(Context c, Cuenta cuenta) {
        long ultimoUid = -1;
        long espera = 5000;
        while (cuenta.hilo == Thread.currentThread()) {
            Store store = null;
            try {
                cambiar(cuenta, "conectando", null);
                store = conectar(cuenta);
                cuenta.store = store;
                IMAPFolder bandeja = (IMAPFolder) store.getFolder("INBOX");
                // Solo lectura: así nunca marca nada como leído.
                bandeja.open(Folder.READ_ONLY);
                // La primera vez arranca desde ahora: no anuncia mails viejos.
                if (ultimoUid < 0) ultimoUid = bandeja.getUIDNext() - 1;
                final long[] desde = {ultimoUid};
                bandeja.addMessageCountListener(new MessageCountAdapter() {
                    @Override
                    public void messagesAdded(MessageCountEvent evento) {
                        for (Message m : evento.getMessages()) {
                            try {
                                long uid = bandeja.getUID(m);
                                if (uid <= desde[0]) continue;
                                desde[0] = uid;
                                Asistente.entrante(c, aEntrante(cuenta.usuario, m));
                            } catch (Exception e) {
                                Log.w(TAG, "No pude leer un mail: " + e.getMessage());
                            }
                        }
                        actualizarNoLeidos(cuenta, bandeja);
                    }
                });
                actualizarNoLeidos(cuenta, bandeja);
                cambiar(cuenta, "conectado", null);
                espera = 5000;
                long ultimoRecuento = System.currentTimeMillis();
                while (cuenta.hilo == Thread.currentThread() && store.isConnected()) {
                    bandeja.idle(true);
                    if (System.currentTimeMillis() - ultimoRecuento > 180_000) {
                        actualizarNoLeidos(cuenta, bandeja);
                        ultimoRecuento = System.currentTimeMillis();
                    }
                }
                ultimoUid = desde[0];
            } catch (AuthenticationFailedException e) {
                cambiar(cuenta, "error", "Usuario o clave incorrectos (en Gmail usá una contraseña de aplicación)");
            } catch (Exception e) {
                if (cuenta.hilo != Thread.currentThread()) break;
                cambiar(cuenta, "error", "No se pudo conectar: " + e.getMessage());
            } finally {
                cerrar(store);
            }
            if (cuenta.hilo != Thread.currentThread()) break;
            try {
                Thread.sleep(espera);
            } catch (InterruptedException e) {
                break;
            }
            espera = Math.min(espera * 2, 300_000);
        }
    }

    private static void actualizarNoLeidos(Cuenta cuenta, Folder bandeja) {
        try {
            int cantidad = bandeja.getUnreadMessageCount();
            if (cantidad != cuenta.noLeidos) {
                cuenta.noLeidos = cantidad;
                Eventos.emitir("estado", null);
            }
        } catch (Exception ignorada) {
        }
    }

    private static String textoDe(Part parte) throws Exception {
        if (parte.isMimeType("text/plain")) return String.valueOf(parte.getContent());
        if (parte.isMimeType("text/html")) {
            return String.valueOf(parte.getContent()).replaceAll("(?is)<(style|script)[^>]*>.*?</\\1>", " ")
                    .replaceAll("<[^>]+>", " ").replaceAll("&nbsp;", " ").replaceAll("\\s+", " ");
        }
        if (parte.isMimeType("multipart/*")) {
            Multipart mp = (Multipart) parte.getContent();
            String html = null;
            for (int i = 0; i < mp.getCount(); i++) {
                BodyPart bp = mp.getBodyPart(i);
                if (Part.ATTACHMENT.equalsIgnoreCase(bp.getDisposition())) continue;
                if (bp.isMimeType("text/plain")) return String.valueOf(bp.getContent());
                String t = textoDe(bp);
                if (html == null && !t.isEmpty()) html = t;
            }
            return html == null ? "" : html;
        }
        return "";
    }

    private static String limpiar(String texto) {
        StringBuilder sb = new StringBuilder();
        for (String linea : texto.split("\n")) if (!linea.trim().startsWith(">")) sb.append(linea).append('\n');
        String limpio = sb.toString().replaceAll("\n{3,}", "\n\n").trim();
        return limpio.length() > MAX_TEXTO ? limpio.substring(0, MAX_TEXTO) : limpio;
    }

    private static Entrante aEntrante(String cuenta, Message m) throws Exception {
        Entrante e = new Entrante();
        e.canal = "email";
        e.app = "Correo";
        e.cuentaEmail = cuenta;
        Address[] de = m.getFrom();
        InternetAddress remitente = de != null && de.length > 0 && de[0] instanceof InternetAddress ? (InternetAddress) de[0] : null;
        e.de = remitente == null ? "Desconocido" : (remitente.getPersonal() != null ? remitente.getPersonal() : remitente.getAddress());
        Address[] responder = m.getReplyTo();
        e.responderA = responder != null && responder.length > 0 && responder[0] instanceof InternetAddress
                ? ((InternetAddress) responder[0]).getAddress() : (remitente == null ? "" : remitente.getAddress());
        e.asunto = m.getSubject() == null ? "(sin asunto)" : m.getSubject();
        e.texto = limpiar(textoDe(m));
        String[] id = m.getHeader("Message-ID");
        e.messageId = id != null && id.length > 0 ? id[0] : "";
        String[] refs = m.getHeader("References");
        e.references = refs != null && refs.length > 0 ? refs[0].trim().split("\\s+") : new String[0];
        return e;
    }

    /** [{cuenta, de, deNombre, asunto, texto (máx. 1200), fecha, leido}] más recientes primero. */
    static JSONArray leer(Context c, int cantidad, boolean soloNoLeidos) throws Exception {
        List<Cuenta> lista = leerCuentas(c);
        if (lista.isEmpty()) throw new Exception("No hay ninguna cuenta de correo configurada.");
        List<JSONObject> todos = new ArrayList<>();
        for (Cuenta cuenta : lista) {
            Store store = null;
            try {
                store = conectar(cuenta);
                Folder bandeja = store.getFolder("INBOX");
                bandeja.open(Folder.READ_ONLY);
                Message[] mensajes = soloNoLeidos
                        ? bandeja.search(new FlagTerm(new Flags(Flags.Flag.SEEN), false))
                        : bandeja.getMessages(Math.max(1, bandeja.getMessageCount() - cantidad + 1), bandeja.getMessageCount());
                for (int i = Math.max(0, mensajes.length - cantidad); i < mensajes.length; i++) {
                    Message m = mensajes[i];
                    Entrante e = aEntrante(cuenta.usuario, m);
                    todos.add(new JSONObject()
                            .put("cuenta", cuenta.usuario).put("de", e.responderA).put("deNombre", e.de)
                            .put("asunto", e.asunto).put("texto", e.texto.length() > 1200 ? e.texto.substring(0, 1200) : e.texto)
                            .put("fecha", Almacen.iso(m.getReceivedDate() != null ? m.getReceivedDate().getTime() : System.currentTimeMillis()))
                            .put("leido", m.isSet(Flags.Flag.SEEN)));
                }
            } finally {
                cerrar(store);
            }
        }
        todos.sort((a, b) -> b.optString("fecha").compareTo(a.optString("fecha")));
        JSONArray salida = new JSONArray();
        for (int i = 0; i < Math.min(cantidad, todos.size()); i++) salida.put(todos.get(i));
        return salida;
    }

    /** Busca en la bandeja de entrada por remitente, asunto o texto: [{cuenta, de, deNombre, asunto, texto, fecha, leido}]. */
    static JSONArray buscar(Context c, String consulta, int cantidad) throws Exception {
        List<Cuenta> lista = leerCuentas(c);
        if (lista.isEmpty()) throw new Exception("No hay ninguna cuenta de correo configurada. Cargala en Ajustes.");
        javax.mail.search.SearchTerm termino = new javax.mail.search.OrTerm(new javax.mail.search.SearchTerm[] {
            new javax.mail.search.FromStringTerm(consulta), new javax.mail.search.SubjectTerm(consulta), new javax.mail.search.BodyTerm(consulta),
        });
        List<JSONObject> todos = new ArrayList<>();
        for (Cuenta cuenta : lista) {
            Store store = null;
            try {
                store = conectar(cuenta);
                Folder bandeja = store.getFolder("INBOX");
                bandeja.open(Folder.READ_ONLY);
                Message[] mensajes = bandeja.search(termino);
                for (int i = Math.max(0, mensajes.length - cantidad); i < mensajes.length; i++) {
                    Message m = mensajes[i];
                    Entrante e = aEntrante(cuenta.usuario, m);
                    todos.add(new JSONObject()
                            .put("cuenta", cuenta.usuario).put("de", e.responderA).put("deNombre", e.de)
                            .put("asunto", e.asunto).put("texto", e.texto.length() > 1500 ? e.texto.substring(0, 1500) : e.texto)
                            .put("fecha", Almacen.iso(m.getReceivedDate() != null ? m.getReceivedDate().getTime() : System.currentTimeMillis()))
                            .put("leido", m.isSet(Flags.Flag.SEEN)));
                }
            } finally {
                cerrar(store);
            }
        }
        todos.sort((a, b) -> b.optString("fecha").compareTo(a.optString("fecha")));
        JSONArray salida = new JSONArray();
        for (int i = 0; i < Math.min(cantidad, todos.size()); i++) salida.put(todos.get(i));
        return salida;
    }

    /** Envía por SMTP; con messageId arma In-Reply-To y References para que quede en el mismo hilo. */
    static void enviar(Context c, String cuenta, String para, String asunto, String texto, String messageId,
            String[] references) throws Exception {
        List<Cuenta> lista = leerCuentas(c);
        if (lista.isEmpty()) throw new Exception("No hay ninguna cuenta de correo configurada.");
        Cuenta elegida = lista.get(0);
        for (Cuenta cu : lista) if (cu.usuario.equalsIgnoreCase(cuenta)) elegida = cu;
        boolean starttls = elegida.smtp.equals("smtp.mail.me.com");
        Properties p = new Properties();
        p.put("mail.smtp.auth", "true");
        p.put("mail.smtp.host", elegida.smtp);
        p.put("mail.smtp.port", starttls ? "587" : "465");
        if (starttls) p.put("mail.smtp.starttls.enable", "true");
        else p.put("mail.smtp.ssl.enable", "true");
        p.put("mail.smtp.connectiontimeout", "15000");
        p.put("mail.smtp.timeout", "30000");
        MimeMessage mensaje = new MimeMessage(Session.getInstance(p));
        mensaje.setFrom(new InternetAddress(elegida.usuario));
        mensaje.setRecipients(Message.RecipientType.TO, InternetAddress.parse(para));
        mensaje.setSubject(asunto, "UTF-8");
        mensaje.setText(texto, "UTF-8");
        if (messageId != null && !messageId.isEmpty()) {
            mensaje.setHeader("In-Reply-To", messageId);
            StringBuilder refs = new StringBuilder();
            if (references != null) for (String r : references) refs.append(r).append(' ');
            mensaje.setHeader("References", refs.append(messageId).toString().trim());
        }
        Transport transporte = Session.getInstance(p).getTransport("smtp");
        try {
            transporte.connect(elegida.smtp, elegida.usuario, elegida.clave);
            transporte.sendMessage(mensaje, mensaje.getAllRecipients());
        } finally {
            transporte.close();
        }
    }
}
