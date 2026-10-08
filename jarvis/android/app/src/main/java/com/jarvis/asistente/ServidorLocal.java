package com.jarvis.asistente;

import android.content.Context;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Servidor HTTP interno (solo 127.0.0.1): sirve la interfaz HUD desde los assets de la app y la misma API que la
 * versión de PC, implementada con el cerebro del celular. Toda ruta /api/ exige el token de Ajustes.tokenLocal
 * (Authorization: Bearer o ?token=), un Host 127.0.0.1/localhost y un Origin propio si viene.
 */
final class ServidorLocal {
    private ServidorLocal() {}

    private static final String TAG = "JarvisServidor";
    private static final int MAX_CUERPO = 16 * 1024 * 1024;
    private static ServerSocket socket;
    private static Context contexto;
    private static final ExecutorService conexiones = Executors.newFixedThreadPool(16);
    private static final ScheduledExecutorService latidos = Executors.newSingleThreadScheduledExecutor();

    private static final class ErrorHttp extends Exception {
        final int estado;
        ErrorHttp(int estado, String mensaje) {
            super(mensaje);
            this.estado = estado;
        }
    }

    private static final class Pedido {
        String metodo, ruta;
        Map<String, String> parametros = new HashMap<>();
        Map<String, String> cabeceras = new HashMap<>();
        byte[] cuerpo = new byte[0];

        JSONObject json() throws ErrorHttp {
            String t = new String(cuerpo, StandardCharsets.UTF_8).trim();
            if (t.isEmpty()) return new JSONObject();
            try {
                return new JSONObject(t);
            } catch (Exception e) {
                throw new ErrorHttp(400, "El cuerpo tiene que ser un objeto JSON.");
            }
        }
    }

    /** Arranca una sola vez (idempotente). Usa el puerto 3700 o, si está ocupado, uno libre. */
    static synchronized void iniciar(Context c) {
        if (socket != null && !socket.isClosed()) return;
        contexto = c.getApplicationContext();
        InetAddress local;
        try {
            // En Android getLoopbackAddress() devuelve ::1 (IPv6) y la pantalla se conecta a 127.0.0.1.
            local = InetAddress.getByAddress(new byte[] {127, 0, 0, 1});
        } catch (IOException e) {
            return;
        }
        try {
            try {
                socket = new ServerSocket(3700, 50, local);
            } catch (IOException ocupado) {
                socket = new ServerSocket(0, 50, local);
            }
        } catch (IOException e) {
            Log.e(TAG, "No pude abrir el servidor interno: " + e.getMessage());
            return;
        }
        ServerSocket propio = socket;
        new Thread(() -> {
            while (!propio.isClosed()) {
                try {
                    Socket cliente = propio.accept();
                    conexiones.execute(() -> atender(cliente));
                } catch (IOException e) {
                    if (!propio.isClosed()) Log.w(TAG, "Error aceptando: " + e.getMessage());
                }
            }
        }, "jarvis-servidor").start();
    }

    static int puerto() {
        return socket == null ? 3700 : socket.getLocalPort();
    }

    static String url(Context c) {
        return "http://127.0.0.1:" + puerto() + "/?modo=vertical&movil=1&token=" + Ajustes.tokenLocal(c);
    }

    // ---------- HTTP ----------

    private static String leerLinea(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int x;
        while ((x = in.read()) != -1) {
            if (x == '\n') break;
            if (x != '\r') b.write(x);
            if (b.size() > 16384) throw new IOException("Línea demasiado larga");
        }
        if (x == -1 && b.size() == 0) return null;
        return b.toString(StandardCharsets.UTF_8.name());
    }

    private static void atender(Socket cliente) {
        try (Socket s = cliente) {
            s.setSoTimeout(30_000);
            InputStream in = new java.io.BufferedInputStream(s.getInputStream());
            OutputStream out = s.getOutputStream();
            String linea = leerLinea(in);
            if (linea == null || linea.isEmpty()) return;
            String[] partes = linea.split(" ");
            if (partes.length < 2) return;
            Pedido p = new Pedido();
            p.metodo = partes[0].toUpperCase(Locale.ROOT);
            String destino = partes[1];
            int q = destino.indexOf('?');
            p.ruta = URLDecoder.decode(q >= 0 ? destino.substring(0, q) : destino, "UTF-8");
            if (q >= 0) {
                for (String par : destino.substring(q + 1).split("&")) {
                    int igual = par.indexOf('=');
                    if (igual > 0) p.parametros.put(URLDecoder.decode(par.substring(0, igual), "UTF-8"), URLDecoder.decode(par.substring(igual + 1), "UTF-8"));
                }
            }
            String h;
            while ((h = leerLinea(in)) != null && !h.isEmpty()) {
                int dos = h.indexOf(':');
                if (dos > 0) p.cabeceras.put(h.substring(0, dos).trim().toLowerCase(Locale.ROOT), h.substring(dos + 1).trim());
            }
            int largo = 0;
            try {
                largo = Integer.parseInt(p.cabeceras.getOrDefault("content-length", "0"));
            } catch (NumberFormatException ignorada) {
            }
            if (largo > MAX_CUERPO) {
                responderJson(out, 413, error("El cuerpo es demasiado grande."));
                return;
            }
            if (largo > 0) {
                p.cuerpo = new byte[largo];
                int leidos = 0;
                while (leidos < largo) {
                    int n = in.read(p.cuerpo, leidos, largo - leidos);
                    if (n < 0) break;
                    leidos += n;
                }
            }
            s.setSoTimeout(0);
            try {
                if (p.ruta.startsWith("/api/")) {
                    if (!autorizado(p)) throw new ErrorHttp(401, "No autorizado.");
                    rutear(p, out);
                } else if ("GET".equals(p.metodo)) {
                    servirArchivo(p.ruta, out);
                } else {
                    throw new ErrorHttp(404, "No encontrado.");
                }
            } catch (ErrorHttp e) {
                responderJson(out, e.estado, error(e.getMessage()));
            } catch (IA.ErrorIA e) {
                responderJson(out, 503, error(mensajeIA(e)));
            } catch (Exception e) {
                Log.e(TAG, "Error en " + p.ruta, e);
                responderJson(out, 500, error(e.getMessage() == null ? "Algo falló. Probá de nuevo." : e.getMessage()));
            }
        } catch (Exception ignorada) {
            // El cliente se fue: no importa.
        }
    }

    private static String mensajeIA(IA.ErrorIA e) {
        if (e.estado == 401 || e.estado == 403) return "La clave de la IA es inválida. Revisala en Ajustes.";
        if (e.estado == 429) return "Se terminó el cupo gratis de la IA por ahora. Probá en un rato o agregá otra clave en Ajustes.";
        return e.getMessage();
    }

    private static JSONObject error(String mensaje) {
        try {
            return new JSONObject().put("error", mensaje);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    private static boolean autorizado(Pedido p) throws Exception {
        String host = p.cabeceras.getOrDefault("host", "");
        if (!host.matches("(127\\.0\\.0\\.1|localhost)(:\\d+)?")) return false;
        String origen = p.cabeceras.get("origin");
        if (origen != null && !origen.equals("http://" + host) && !origen.equals("null")) return false;
        String auth = p.cabeceras.getOrDefault("authorization", "");
        String enviado = auth.toLowerCase(Locale.ROOT).startsWith("bearer ") ? auth.substring(7).trim() : p.parametros.getOrDefault("token", "");
        return MessageDigest.isEqual(enviado.getBytes(StandardCharsets.UTF_8), Ajustes.tokenLocal(contexto).getBytes(StandardCharsets.UTF_8));
    }

    private static void escribirCabecera(OutputStream out, int estado, String tipo, long largo) throws IOException {
        String texto = estado == 200 ? "OK" : estado == 201 ? "Created" : estado == 401 ? "Unauthorized" : estado == 404 ? "Not Found" : "Error";
        StringBuilder sb = new StringBuilder("HTTP/1.1 ").append(estado).append(' ').append(texto).append("\r\n")
                .append("Content-Type: ").append(tipo).append("\r\n")
                .append("Cache-Control: no-store\r\nConnection: close\r\n");
        if (largo >= 0) sb.append("Content-Length: ").append(largo).append("\r\n");
        sb.append("\r\n");
        out.write(sb.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static void responder(OutputStream out, int estado, String tipo, byte[] cuerpo) throws IOException {
        escribirCabecera(out, estado, tipo, cuerpo.length);
        out.write(cuerpo);
        out.flush();
    }

    private static void responderJson(OutputStream out, int estado, Object json) throws IOException {
        responder(out, estado, "application/json; charset=utf-8", json.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static void servirArchivo(String ruta, OutputStream out) throws Exception {
        String archivo = ruta.equals("/") ? "index.html" : ruta.substring(1);
        if (archivo.contains("..") || archivo.startsWith("/") || archivo.contains("\\")) throw new ErrorHttp(404, "No encontrado.");
        String extension = archivo.contains(".") ? archivo.substring(archivo.lastIndexOf('.') + 1) : "";
        String tipo;
        switch (extension) {
            case "html": tipo = "text/html; charset=utf-8"; break;
            case "css": tipo = "text/css; charset=utf-8"; break;
            case "js": tipo = "text/javascript; charset=utf-8"; break;
            case "svg": tipo = "image/svg+xml"; break;
            case "png": tipo = "image/png"; break;
            case "json": tipo = "application/json"; break;
            case "ico": tipo = "image/x-icon"; break;
            default: tipo = "application/octet-stream";
        }
        byte[] datos;
        try (InputStream in = contexto.getAssets().open(archivo)) {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
            datos = b.toByteArray();
        } catch (IOException e) {
            throw new ErrorHttp(404, "No encontrado.");
        }
        responder(out, 200, tipo, datos);
    }

    // ---------- SSE ----------

    private static final class Sse {
        private final OutputStream out;
        volatile boolean cerrado;

        Sse(OutputStream out) throws IOException {
            this.out = out;
            escribirCabecera(out, 200, "text/event-stream; charset=utf-8", -1);
            out.flush();
        }

        synchronized void enviar(String evento, String datos) {
            if (cerrado) return;
            try {
                out.write(("event: " + evento + "\ndata: " + datos + "\n\n").getBytes(StandardCharsets.UTF_8));
                out.flush();
            } catch (IOException e) {
                cerrado = true;
            }
        }

        synchronized void latido() {
            if (cerrado) return;
            try {
                out.write(": latido\n\n".getBytes(StandardCharsets.UTF_8));
                out.flush();
            } catch (IOException e) {
                cerrado = true;
            }
        }
    }

    private static JSONObject estado() throws Exception {
        Context c = contexto;
        return new JSONObject()
                .put("usuario", Ajustes.texto(c, Ajustes.USUARIO))
                .put("activa", Acciones.activa(c))
                .put("ia", IA.proveedores(c))
                .put("voz", true)
                .put("vozNatural", ElevenLabs.disponible(c))
                .put("email", Correo.estado())
                .put("whatsapp", new JSONObject().put("estado", "apagado"))
                .put("telegram", new JSONObject().put("estado", "apagado"))
                .put("movil", true)
                .put("notificaciones", Escucha.permisoConcedido(c))
                .put("superponer", Settings.canDrawOverlays(c))
                .put("ajustes", true);
    }

    private static void eventos(OutputStream out) throws Exception {
        Sse sse = new Sse(out);
        sse.enviar("estado", estado().toString());
        Eventos.Oyente oyente = (tipo, datos) -> {
            if ("estado".equals(tipo)) {
                try {
                    datos = estado().toString();
                } catch (Exception e) {
                    return;
                }
            }
            sse.enviar(tipo, datos);
        };
        Eventos.escuchar(oyente);
        ScheduledFuture<?> latido = latidos.scheduleAtFixedRate(sse::latido, 25, 25, TimeUnit.SECONDS);
        try {
            while (!sse.cerrado) Thread.sleep(1000);
        } finally {
            Eventos.dejar(oyente);
            latido.cancel(false);
        }
    }

    // ---------- Rutas ----------

    private static String id(String ruta, String prefijo, String sufijo) {
        String resto = ruta.substring(prefijo.length());
        if (sufijo != null) {
            if (!resto.endsWith(sufijo)) return null;
            resto = resto.substring(0, resto.length() - sufijo.length());
        }
        return resto.matches("[\\w-]+") ? resto : null;
    }

    private static JSONArray alReves(JSONArray lista, int maximo, String filtroEstado) {
        JSONArray salida = new JSONArray();
        for (int i = lista.length() - 1; i >= 0 && salida.length() < maximo; i--) {
            JSONObject o = lista.optJSONObject(i);
            if (o != null && (filtroEstado == null || filtroEstado.equals(o.optString("estado")))) salida.put(o);
        }
        return salida;
    }

    private static void rutear(Pedido p, OutputStream out) throws Exception {
        Context c = contexto;
        Almacen almacen = Almacen.de(c);
        String r = p.ruta;
        String m = p.metodo;
        String id;

        if (m.equals("GET") && r.equals("/api/estado")) {
            responderJson(out, 200, estado());
        } else if (m.equals("POST") && r.equals("/api/activa")) {
            JSONObject j = p.json();
            if (!j.has("activa")) throw new ErrorHttp(400, "Falta \"activa\" (true o false).");
            Acciones.cambiarActiva(c, j.optBoolean("activa"));
            responderJson(out, 200, new JSONObject().put("activa", j.optBoolean("activa")));
        } else if (m.equals("GET") && r.equals("/api/eventos")) {
            eventos(out);
        } else if (m.equals("POST") && r.equals("/api/chat")) {
            chat(p, out);
        } else if (m.equals("GET") && r.equals("/api/historial")) {
            synchronized (almacen) {
                JSONArray h = almacen.historial();
                JSONArray salida = new JSONArray();
                for (int i = Math.max(0, h.length() - 100); i < h.length(); i++) salida.put(h.opt(i));
                responderJson(out, 200, salida);
            }
        } else if (m.equals("DELETE") && r.equals("/api/historial")) {
            almacen.reemplazar("historial", new JSONArray());
            responderJson(out, 200, new JSONObject().put("listo", true));
        } else if (m.equals("GET") && r.equals("/api/memoria")) {
            responderJson(out, 200, almacen.memoria());
        } else if (m.equals("DELETE") && r.startsWith("/api/memoria/") && (id = id(r, "/api/memoria/", null)) != null) {
            synchronized (almacen) {
                JSONArray nuevo = new JSONArray();
                JSONArray mem = almacen.memoria();
                for (int i = 0; i < mem.length(); i++) if (!id.equals(mem.optJSONObject(i).optString("id"))) nuevo.put(mem.opt(i));
                almacen.reemplazar("memoria", nuevo);
            }
            Eventos.emitir("memoria", almacen.memoria());
            responderJson(out, 200, new JSONObject().put("listo", true));
        } else if (m.equals("GET") && r.equals("/api/recordatorios")) {
            JSONArray salida = new JSONArray();
            synchronized (almacen) {
                JSONArray rec = almacen.recordatorios();
                for (int i = 0; i < rec.length(); i++) if (!rec.optJSONObject(i).optBoolean("avisado")) salida.put(rec.opt(i));
            }
            responderJson(out, 200, salida);
        } else if (m.equals("POST") && r.equals("/api/recordatorios")) {
            JSONObject j = p.json();
            String texto = j.optString("texto", "").trim();
            long cuando = Almacen.leerIso(j.optString("cuando"));
            if (texto.isEmpty() || cuando < 0) throw new ErrorHttp(400, "Hacen falta \"texto\" y \"cuando\" (fecha ISO 8601).");
            JSONObject nuevo = new JSONObject().put("id", Almacen.nuevoId()).put("texto", texto).put("cuando", Almacen.iso(cuando)).put("avisado", false);
            synchronized (almacen) {
                almacen.recordatorios().put(nuevo);
            }
            almacen.guardar();
            Eventos.emitir("recordatorios", almacen.recordatorios());
            Asistente.programar(c);
            responderJson(out, 201, nuevo);
        } else if (m.equals("DELETE") && r.startsWith("/api/recordatorios/") && (id = id(r, "/api/recordatorios/", null)) != null) {
            synchronized (almacen) {
                JSONArray nuevo = new JSONArray();
                JSONArray rec = almacen.recordatorios();
                for (int i = 0; i < rec.length(); i++) if (!id.equals(rec.optJSONObject(i).optString("id"))) nuevo.put(rec.opt(i));
                almacen.reemplazar("recordatorios", nuevo);
            }
            Eventos.emitir("recordatorios", almacen.recordatorios());
            Asistente.programar(c);
            responderJson(out, 200, new JSONObject().put("listo", true));
        } else if (m.equals("GET") && r.equals("/api/avisos")) {
            int cantidad = 30;
            try {
                cantidad = Math.min(200, Math.max(1, Integer.parseInt(p.parametros.getOrDefault("cantidad", "30"))));
            } catch (NumberFormatException ignorada) {
            }
            synchronized (almacen) {
                responderJson(out, 200, alReves(almacen.avisos(), cantidad, null));
            }
        } else if (m.equals("GET") && r.equals("/api/propuestas")) {
            String filtro = p.parametros.get("estado");
            synchronized (almacen) {
                responderJson(out, 200, alReves(almacen.propuestas(), Integer.MAX_VALUE, filtro == null || filtro.isEmpty() ? null : filtro));
            }
        } else if (m.equals("PATCH") && r.startsWith("/api/propuestas/") && (id = id(r, "/api/propuestas/", null)) != null) {
            JSONObject j = p.json();
            responderJson(out, 200, conError400(() -> Acciones.editarPropuesta(c, id(r, "/api/propuestas/", null), j.optString("texto", null), j.optString("asunto", null))));
        } else if (m.equals("POST") && r.startsWith("/api/propuestas/") && (id = id(r, "/api/propuestas/", "/enviar")) != null) {
            JSONObject j = p.json();
            String propuesta = id;
            responderJson(out, 200, conError400(() -> Acciones.enviarPropuesta(c, propuesta, j.optString("texto", null), j.optString("asunto", null))));
        } else if (m.equals("POST") && r.startsWith("/api/propuestas/") && (id = id(r, "/api/propuestas/", "/descartar")) != null) {
            String propuesta = id;
            responderJson(out, 200, conError400(() -> Acciones.descartarPropuesta(c, propuesta)));
        } else if (m.equals("GET") && r.equals("/api/sistema")) {
            responderJson(out, 200, Info.sistema(c));
        } else if (m.equals("GET") && r.equals("/api/clima")) {
            responderJson(out, 200, conError502(() -> Info.clima(c, p.parametros.get("ciudad"))));
        } else if (m.equals("GET") && r.equals("/api/noticias")) {
            responderJson(out, 200, conError502(() -> Info.noticias(c, p.parametros.getOrDefault("tema", ""), 12)));
        } else if (m.equals("GET") && r.equals("/api/resumen")) {
            responderJson(out, 200, new JSONObject().put("texto", Asistente.resumenDelDia(c)));
        } else if (m.equals("GET") && r.equals("/api/voces")) {
            responderJson(out, 200, conError502(() -> ElevenLabs.voces(c)));
        } else if (m.equals("POST") && r.equals("/api/transcribir")) {
            if (p.cuerpo.length < 1000) throw new ErrorHttp(400, "El audio está vacío.");
            String tipo = p.cabeceras.getOrDefault("content-type", "audio/wav");
            responderJson(out, 200, new JSONObject().put("texto", conError502(() -> Transcriptor.transcribir(c, p.cuerpo, tipo))));
        } else if (m.equals("POST") && r.equals("/api/hablar")) {
            String texto = p.json().optString("texto", "").trim();
            if (texto.isEmpty()) throw new ErrorHttp(400, "Falta \"texto\".");
            if (!ElevenLabs.disponible(c)) throw new ErrorHttp(503, "La voz de ElevenLabs no está disponible.");
            byte[] audio;
            try {
                audio = ElevenLabs.sintetizarBytes(c, texto);
            } catch (Exception e) {
                throw new ErrorHttp(503, "La voz de ElevenLabs falló; usá la del sistema.");
            }
            responder(out, 200, "audio/mpeg", audio);
        } else if (m.equals("GET") && r.equals("/api/agenda")) {
            java.util.Calendar hoy = java.util.Calendar.getInstance();
            hoy.set(java.util.Calendar.HOUR_OF_DAY, 0);
            hoy.set(java.util.Calendar.MINUTE, 0);
            hoy.set(java.util.Calendar.SECOND, 0);
            JSONArray eventos;
            try {
                eventos = Telefono.agenda(c, hoy.getTimeInMillis(), hoy.getTimeInMillis() + 3 * 86_400_000L);
            } catch (Exception e) {
                eventos = new JSONArray();
            }
            responderJson(out, 200, eventos);
        } else if (m.equals("GET") && r.equals("/api/ajustes")) {
            responderJson(out, 200, Ajustes.comoJson(c));
        } else if (m.equals("POST") && r.equals("/api/ajustes")) {
            Ajustes.actualizar(c, p.json());
            Correo.iniciar(c);
            Servicio.alCambiarAjustes(c);
            Asistente.programar(c);
            Eventos.emitir("estado", null);
            responderJson(out, 200, Ajustes.comoJson(c));
        } else {
            throw new ErrorHttp(404, "Ruta no encontrada.");
        }
    }

    private interface Accion<T> {
        T hacer() throws Exception;
    }

    private static <T> T conError400(Accion<T> a) throws ErrorHttp {
        try {
            return a.hacer();
        } catch (Exception e) {
            throw new ErrorHttp(400, e.getMessage());
        }
    }

    private static <T> T conError502(Accion<T> a) throws ErrorHttp {
        try {
            return a.hacer();
        } catch (Exception e) {
            throw new ErrorHttp(502, e.getMessage() == null ? "No pude conectarme." : e.getMessage());
        }
    }

    private static void chat(Pedido p, OutputStream out) throws Exception {
        JSONObject j = p.json();
        String mensaje = j.optString("mensaje", "").trim();
        if (mensaje.length() > 8000) mensaje = mensaje.substring(0, 8000);
        if (mensaje.isEmpty()) throw new ErrorHttp(400, "Falta \"mensaje\".");
        String canal = "voz".equals(j.optString("canal")) ? "voz" : "texto".equals(j.optString("canal")) ? "texto" : "api";
        boolean enVivo = j.optBoolean("stream") || p.cabeceras.getOrDefault("accept", "").contains("text/event-stream");
        if (!enVivo) {
            responderJson(out, 200, new JSONObject().put("respuesta", Asistente.chat(contexto, mensaje, canal, null, null)));
            return;
        }
        Sse sse = new Sse(out);
        try {
            String respuesta = Asistente.chat(contexto, mensaje, canal,
                    delta -> {
                        try {
                            sse.enviar("texto", new JSONObject().put("delta", delta).toString());
                        } catch (Exception ignorada) {
                        }
                    },
                    nombre -> {
                        try {
                            sse.enviar("herramienta", new JSONObject().put("nombre", nombre).toString());
                        } catch (Exception ignorada) {
                        }
                    });
            sse.enviar("fin", new JSONObject().put("respuesta", respuesta).toString());
        } catch (IA.ErrorIA e) {
            sse.enviar("error", new JSONObject().put("mensaje", mensajeIA(e)).toString());
        } catch (Exception e) {
            Log.e(TAG, "Error en el chat", e);
            sse.enviar("error", new JSONObject().put("mensaje", e.getMessage() == null ? "Algo falló. Probá de nuevo." : e.getMessage()).toString());
        }
    }
}
