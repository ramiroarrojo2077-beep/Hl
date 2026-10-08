package com.jarvis.asistente;

import android.app.ActivityManager;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.util.Log;

import com.google.ai.edge.litertlm.Backend;
import com.google.ai.edge.litertlm.Contents;
import com.google.ai.edge.litertlm.Conversation;
import com.google.ai.edge.litertlm.ConversationConfig;
import com.google.ai.edge.litertlm.Engine;
import com.google.ai.edge.litertlm.EngineConfig;
import com.google.ai.edge.litertlm.LogSeverity;
import com.google.ai.edge.litertlm.Message;
import com.google.ai.edge.litertlm.MessageCallback;
import com.google.ai.edge.litertlm.SamplerConfig;
import com.google.ai.edge.litertlm.ToolCall;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Qwen dentro del celular (LiteRT-LM de Google): la IA que responde sin internet y sin claves. Se descarga sola la
 * primera vez (por Wi-Fi) y queda en el celular. Si no hay claves de la nube, es la IA de Jarvis; si hay (Gemini, Groq),
 * es el respaldo cuando se acaba el cupo o no hay internet, así Jarvis nunca se queda sin responder.
 *
 * Las herramientas se le explican en el prompt con el formato que Qwen aprendió ({@code <tool_call>{...}</tool_call>})
 * y la respuesta se traduce al mismo formato de llamadas de OpenAI que usa el resto de la app.
 */
final class Local {
    private Local() {}

    private static final String TAG = "JarvisLocal";

    /** Un modelo descargable (los dos son de litert-community, Apache-2.0, sin cuenta). */
    static final class Modelo {
        final String id;
        final String nombre;
        final String url;
        final String archivo;
        final long bytes;
        final boolean piensa;

        Modelo(String id, String nombre, String url, String archivo, long bytes, boolean piensa) {
            this.id = id;
            this.nombre = nombre;
            this.url = url;
            this.archivo = archivo;
            this.bytes = bytes;
            this.piensa = piensa;
        }
    }

    // URLs fijadas a un commit: el archivo no puede cambiar por debajo.
    static final Modelo QWEN_15B = new Modelo("qwen2.5-1.5b", "Qwen 2.5 1.5B",
            "https://huggingface.co/litert-community/Qwen2.5-1.5B-Instruct/resolve/19edb84c69a0212f29a6ef17ba0d6f278b6a1614/"
                    + "Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv4096.litertlm?download=true",
            "qwen2.5-1.5b.litertlm", 1_597_931_520L, false);
    static final Modelo QWEN_06B = new Modelo("qwen3-0.6b", "Qwen 3 0.6B",
            "https://huggingface.co/litert-community/Qwen3-0.6B/resolve/8414150f2e9dcc82449bcc9c5abc404b399a4d06/"
                    + "Qwen3-0.6B.litertlm?download=true",
            "qwen3-0.6b.litertlm", 614_236_160L, true);

    private static final int MAX_TOKENS = 3072;
    private static final int MAX_SALIDA = 512;
    private static final long ESPERA_MAXIMA_MS = 120_000;
    private static final long DESCARGAR_SI_CAMBIO_MS = 30 * 60_000L;

    // Herramientas que se le ofrecen a Qwen (las más útiles: un modelo chico se confunde con muchas).
    private static final Set<String> HERRAMIENTAS = new HashSet<>(Arrays.asList(
            "clima", "noticias", "buscar_web", "calcular", "crear_recordatorio", "leer_mensajes", "leer_emails",
            "buscar_emails", "ver_agenda", "agregar_tarea", "ver_tareas", "responder_aviso", "enviar_borrador",
            "corregir_borrador", "descartar_borrador", "recordar", "reproducir", "navegar", "llamar", "poner_alarma",
            "poner_temporizador", "abrir"));

    private static final Object motorLock = new Object();
    private static Engine motor;
    private static String motorDe;
    private static long ultimoUso;
    private static volatile boolean descargando;
    private static volatile int progreso = -1;
    private static volatile String errorDescarga;
    private static long ultimoIntento;

    // ---------- Qué modelo y si ya está ----------

    /** El modelo elegido en Ajustes o, en automático, según la memoria del celular; null si está apagado. */
    static Modelo modelo(Context c) {
        String elegido = Ajustes.texto(c, Ajustes.IA_LOCAL);
        if ("no".equals(elegido)) return null;
        if (QWEN_15B.id.equals(elegido)) return QWEN_15B;
        if (QWEN_06B.id.equals(elegido)) return QWEN_06B;
        ActivityManager.MemoryInfo memoria = new ActivityManager.MemoryInfo();
        c.getSystemService(ActivityManager.class).getMemoryInfo(memoria);
        // Con 6 GB o más anda el de 1.5B (mejor español); con menos, el liviano.
        return memoria.totalMem >= 5_500_000_000L ? QWEN_15B : QWEN_06B;
    }

    private static File carpeta(Context c) {
        File f = new File(c.getFilesDir(), "modelos");
        //noinspection ResultOfMethodCallIgnored
        f.mkdirs();
        return f;
    }

    static File archivo(Context c, Modelo m) {
        return new File(carpeta(c), m.archivo);
    }

    /** ¿Está descargado y completo? */
    static boolean listo(Context c) {
        Modelo m = modelo(c);
        if (m == null) return false;
        File f = archivo(c, m);
        return f.isFile() && f.length() == m.bytes;
    }

    /** {nombre, modelo, local:true, disponible, descargando, progreso, error?} para la interfaz. */
    static JSONObject estado(Context c) {
        JSONObject o = new JSONObject();
        try {
            Modelo m = modelo(c);
            o.put("nombre", "qwen").put("local", true);
            if (m == null) return o.put("modelo", "apagado").put("disponible", false);
            o.put("modelo", m.nombre + " (en el celular)").put("disponible", listo(c)).put("descargando", descargando)
                    .put("progreso", listo(c) ? 100 : Math.max(0, progreso)).put("bytes", m.bytes);
            if (errorDescarga != null && !descargando) o.put("error", errorDescarga);
        } catch (Exception ignorada) {
        }
        return o;
    }

    // ---------- Descarga ----------

    private static boolean wifi(Context c) {
        ConnectivityManager cm = c.getSystemService(ConnectivityManager.class);
        NetworkCapabilities red = cm.getNetworkCapabilities(cm.getActiveNetwork());
        return red != null && red.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
                && red.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
    }

    /**
     * Si falta el modelo, lo descarga en segundo plano (por Wi-Fi, salvo que en Ajustes se permitan los datos). Retoma
     * donde quedó si se cortó. Se puede llamar seguido: no hace nada si ya está o se está bajando.
     */
    static synchronized void asegurar(Context c, boolean forzar) {
        Modelo m = modelo(c);
        if (m == null || listo(c) || descargando) return;
        long ahora = System.currentTimeMillis();
        if (!forzar && ahora - ultimoIntento < DESCARGAR_SI_CAMBIO_MS && errorDescarga != null) return;
        boolean conDatos = "si".equals(Ajustes.texto(c, Ajustes.DESCARGA_CON_DATOS));
        if (!forzar && !conDatos && !wifi(c)) {
            errorDescarga = "Esperando Wi-Fi para bajar " + m.nombre + ".";
            return;
        }
        ultimoIntento = ahora;
        descargando = true;
        errorDescarga = null;
        Context app = c.getApplicationContext();
        new Thread(() -> descargar(app, m), "jarvis-descarga-qwen").start();
    }

    private static void descargar(Context c, Modelo m) {
        File destino = archivo(c, m);
        File parcial = new File(destino.getPath() + ".parte");
        android.os.PowerManager.WakeLock despierta = c.getSystemService(android.os.PowerManager.class)
                .newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "jarvis:descarga");
        android.net.wifi.WifiManager.WifiLock wifiDespierto = null;
        try {
            despierta.acquire(3 * 3_600_000L);
            android.net.wifi.WifiManager wm = c.getSystemService(android.net.wifi.WifiManager.class);
            if (wm != null) {
                wifiDespierto = wm.createWifiLock(android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF, "jarvis:descarga");
                wifiDespierto.acquire();
            }
            // Otros modelos que hayan quedado (por ejemplo, si cambiaste de modelo) liberan espacio.
            File[] viejos = carpeta(c).listFiles();
            if (viejos != null) {
                for (File f : viejos) if (!f.getName().startsWith(m.archivo)) //noinspection ResultOfMethodCallIgnored
                    f.delete();
            }
            if (carpeta(c).getUsableSpace() + parcial.length() < m.bytes + 200_000_000L) {
                throw new Exception("No hay espacio: hacen falta " + (m.bytes / 1_000_000) + " MB libres.");
            }
            for (int intento = 0; intento < 5 && !listo(c); intento++) {
                try {
                    bajar(c, m, parcial);
                } catch (Exception e) {
                    Log.w(TAG, "Descarga cortada: " + e.getMessage());
                    errorDescarga = e.getMessage();
                    Thread.sleep(5_000L * (intento + 1));
                    continue;
                }
                if (parcial.length() == m.bytes) {
                    if (!parcial.renameTo(destino)) throw new Exception("No pude guardar el modelo.");
                    errorDescarga = null;
                    Log.i(TAG, m.nombre + " descargado");
                }
            }
            if (!listo(c) && errorDescarga == null) errorDescarga = "No pude bajar " + m.nombre + ".";
        } catch (Exception e) {
            errorDescarga = e.getMessage();
            Log.w(TAG, "No pude bajar el modelo: " + e.getMessage());
        } finally {
            descargando = false;
            if (wifiDespierto != null && wifiDespierto.isHeld()) wifiDespierto.release();
            if (despierta.isHeld()) despierta.release();
            Eventos.emitir("estado", null);
        }
    }

    private static void bajar(Context c, Modelo m, File parcial) throws Exception {
        long ya = parcial.isFile() ? parcial.length() : 0;
        if (ya > m.bytes) {
            //noinspection ResultOfMethodCallIgnored
            parcial.delete();
            ya = 0;
        }
        HttpURLConnection con = (HttpURLConnection) new URL(m.url).openConnection();
        con.setConnectTimeout(20_000);
        con.setReadTimeout(60_000);
        con.setInstanceFollowRedirects(true);
        if (ya > 0) con.setRequestProperty("Range", "bytes=" + ya + "-");
        int estado = con.getResponseCode();
        if (estado == 416) return;
        if (estado != 200 && estado != 206) throw new Exception("El servidor del modelo respondió " + estado + ".");
        boolean sigue = estado == 206;
        try (InputStream entrada = con.getInputStream(); FileOutputStream salida = new FileOutputStream(parcial, sigue)) {
            long total = sigue ? ya : 0;
            byte[] bloque = new byte[256 * 1024];
            int leidos;
            int ultimo = -1;
            while ((leidos = entrada.read(bloque)) != -1) {
                salida.write(bloque, 0, leidos);
                total += leidos;
                int ahora = (int) (total * 100 / m.bytes);
                if (ahora != ultimo) {
                    ultimo = ahora;
                    progreso = ahora;
                    Eventos.emitir("estado", null);
                }
                if (total > m.bytes) throw new Exception("El archivo del modelo es más grande de lo esperado.");
            }
        } finally {
            con.disconnect();
        }
    }

    // ---------- Motor ----------

    private static Engine motor(Context c, Modelo m) throws Exception {
        synchronized (motorLock) {
            ultimoUso = System.currentTimeMillis();
            if (motor != null && m.id.equals(motorDe)) return motor;
            cerrarMotor();
            Engine.Companion.setNativeMinLogSeverity(LogSeverity.ERROR);
            EngineConfig config = new EngineConfig(archivo(c, m).getAbsolutePath(), new Backend.CPU(), null, null,
                    MAX_TOKENS, null, c.getCacheDir().getPath());
            Engine e = new Engine(config);
            e.initialize();
            motor = e;
            motorDe = m.id;
            Log.i(TAG, m.nombre + " cargado");
            return e;
        }
    }

    private static void cerrarMotor() {
        if (motor != null) {
            try {
                motor.close();
            } catch (Throwable ignorada) {
            }
            motor = null;
            motorDe = null;
        }
    }

    /** Libera la memoria si hace rato que no se usa (lo llama el ciclo de 15 minutos). */
    static void liberarSiNoSeUsa() {
        synchronized (motorLock) {
            if (motor != null && System.currentTimeMillis() - ultimoUso > 10 * 60_000L) {
                cerrarMotor();
                Log.i(TAG, "Modelo liberado de la memoria");
            }
        }
    }

    // ---------- Charla ----------

    private static final Pattern LLAMADA = Pattern.compile("<tool_call>\\s*(\\{.*?\\})\\s*</tool_call>", Pattern.DOTALL);
    private static final Pattern PENSAMIENTO = Pattern.compile("<think>.*?(</think>|$)", Pattern.DOTALL);

    /**
     * Mismo contrato que un proveedor de {@link IA}: mensajes y herramientas en formato OpenAI, respuesta con texto o
     * llamadas a herramientas.
     */
    static IA.Respuesta completar(Context c, JSONArray mensajes, JSONArray herramientas, boolean json, IA.AlTexto alTexto)
            throws IA.ErrorIA {
        Modelo m = modelo(c);
        if (m == null) throw new IA.ErrorIA("La IA del celular está apagada en Ajustes.", 0);
        if (!listo(c)) {
            asegurar(c, false);
            throw new IA.ErrorIA(descargando
                    ? "Todavía estoy bajando mi cerebro del celular (" + Math.max(0, progreso) + "%). Mientras tanto podés pegar la clave gratis de Gemini en Ajustes."
                    : "Para responder sin internet necesito bajar mi cerebro del celular (" + (m.bytes / 1_000_000) + " MB, por Wi-Fi).", 503);
        }
        try {
            List<Message> previos = new ArrayList<>();
            String sistema = "";
            String ultimo = "";
            JSONArray utiles = recortar(c, mensajes);
            for (int i = 0; i < utiles.length(); i++) {
                JSONObject msj = utiles.getJSONObject(i);
                String rol = msj.optString("role");
                String texto = textoDe(msj);
                boolean esUltimo = i == utiles.length() - 1;
                switch (rol) {
                    case "system":
                        sistema = texto;
                        continue;
                    case "assistant":
                        if (esUltimo) break;
                        previos.add(Message.Companion.model(texto));
                        continue;
                    default:
                        if (esUltimo) ultimo = texto;
                        else previos.add(Message.Companion.user(texto));
                }
            }
            if (ultimo.isEmpty()) ultimo = "Seguí.";
            // Las herramientas se eligen por lo último que pidió el usuario (no por el resultado de una herramienta).
            String pedido = "";
            for (int i = mensajes.length() - 1; i >= 0 && pedido.isEmpty(); i--) {
                JSONObject msj = mensajes.optJSONObject(i);
                if (msj != null && "user".equals(msj.optString("role"))) pedido = msj.optString("content");
            }
            JSONArray ofrecidas = json ? new JSONArray() : elegir(herramientas, pedido);
            sistema = sistema + instruccionesHerramientas(ofrecidas) + (json ? "\n\nRespondé SOLO con el JSON pedido, sin texto antes ni después." : "");

            Map<String, Object> extra = Collections.singletonMap("enable_thinking", (Object) false);
            Engine e = motor(c, m);
            ConversationConfig config = new ConversationConfig(Contents.Companion.of(sistema), previos, Collections.emptyList(),
                    new SamplerConfig(20, 0.8, json || ofrecidas.length() > 0 ? 0.3 : 0.6, 0), false, null, extra, null, false, MAX_SALIDA);
            synchronized (motorLock) {
                ultimoUso = System.currentTimeMillis();
                Conversation charla = e.createConversation(config);
                try {
                    return generar(charla, m.piensa ? ultimo + " /no_think" : ultimo, alTexto, json);
                } finally {
                    try {
                        // Si se cortó (por ejemplo, se canceló la charla), que el motor no siga generando.
                        charla.cancelProcess();
                        charla.close();
                    } catch (Throwable ignorada) {
                    }
                    ultimoUso = System.currentTimeMillis();
                }
            }
        } catch (IA.ErrorIA e) {
            throw e;
        } catch (Throwable e) {
            Log.w(TAG, "Qwen falló", e);
            if (e instanceof OutOfMemoryError) {
                synchronized (motorLock) {
                    cerrarMotor();
                }
            }
            throw new IA.ErrorIA("La IA del celular falló: " + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()), 0);
        }
    }

    private static IA.Respuesta generar(Conversation charla, String texto, IA.AlTexto alTexto, boolean json) throws Exception {
        StringBuilder todo = new StringBuilder();
        List<ToolCall> llamadasNativas = new ArrayList<>();
        AtomicReference<Throwable> falla = new AtomicReference<>();
        CountDownLatch fin = new CountDownLatch(1);
        final int[] emitido = {0};
        final boolean[] enVivo = {alTexto != null && !json};
        charla.sendMessageAsync(Message.Companion.user(texto), new MessageCallback() {
            @Override
            public void onMessage(Message parte) {
                String d = parte.toString();
                if (parte.getToolCalls() != null) llamadasNativas.addAll(parte.getToolCalls());
                if (d == null || d.isEmpty()) return;
                synchronized (todo) {
                    todo.append(d);
                    if (!enVivo[0]) return;
                    // Lo que empieza con "<" puede ser una llamada a herramienta o un pensamiento: no se lee en voz alta.
                    String visible = PENSAMIENTO.matcher(todo).replaceAll("");
                    int corte = visible.indexOf("<tool_call>");
                    if (corte >= 0) visible = visible.substring(0, corte);
                    String sinEspacios = visible.trim();
                    if (sinEspacios.isEmpty() || (sinEspacios.startsWith("<") && sinEspacios.length() < 12)) return;
                    if (sinEspacios.startsWith("<tool") || sinEspacios.startsWith("<think")) return;
                    if (visible.length() > emitido[0]) {
                        String nuevo = visible.substring(emitido[0]);
                        emitido[0] = visible.length();
                        try {
                            alTexto.delta(emitido[0] == nuevo.length() ? nuevo.replaceAll("^\\s+", "") : nuevo);
                        } catch (RuntimeException ignorada) {
                        }
                    }
                }
            }

            @Override
            public void onDone() {
                fin.countDown();
            }

            @Override
            public void onError(Throwable t) {
                falla.set(t);
                fin.countDown();
            }
        });
        if (!fin.await(ESPERA_MAXIMA_MS, TimeUnit.MILLISECONDS)) {
            charla.cancelProcess();
            throw new Exception("tardó demasiado");
        }
        if (falla.get() != null) throw new Exception(falla.get().getMessage(), falla.get());

        IA.Respuesta r = new IA.Respuesta();
        r.proveedor = "qwen";
        String salida;
        synchronized (todo) {
            salida = PENSAMIENTO.matcher(todo).replaceAll("").trim();
        }
        // Llamadas que el motor ya reconoció…
        for (ToolCall t : llamadasNativas) {
            JSONObject args = new JSONObject();
            if (t.getArguments() != null) {
                for (Map.Entry<String, Object> a : t.getArguments().entrySet()) args.put(a.getKey(), a.getValue() == null ? JSONObject.NULL : a.getValue());
            }
            r.llamadas.put(llamada(t.getName(), args));
        }
        // …y las que vinieron como texto <tool_call>{"name":…, "arguments":…}</tool_call>.
        Matcher m = LLAMADA.matcher(salida);
        while (m.find()) {
            try {
                JSONObject j = new JSONObject(m.group(1));
                String nombre = j.optString("name");
                if (nombre.isEmpty()) continue;
                Object args = j.opt("arguments");
                JSONObject a = args instanceof JSONObject ? (JSONObject) args
                        : args instanceof String ? new JSONObject((String) args) : new JSONObject();
                r.llamadas.put(llamada(nombre, a));
            } catch (Exception malArmada) {
                Log.w(TAG, "Llamada mal armada: " + m.group(1));
            }
        }
        r.texto = LLAMADA.matcher(salida).replaceAll("").replaceAll("</?tool_call>", "").trim();
        // Si se mostró algo en vivo y además pidió herramientas, el texto ya está dicho.
        return r;
    }

    private static JSONObject llamada(String nombre, JSONObject argumentos) throws Exception {
        return new JSONObject().put("id", "q" + UUID.randomUUID().toString().substring(0, 8)).put("type", "function")
                .put("function", new JSONObject().put("name", nombre).put("arguments", argumentos.toString()));
    }

    private static String textoDe(JSONObject msj) {
        String rol = msj.optString("role");
        String contenido = msj.isNull("content") ? "" : msj.optString("content", "");
        if ("assistant".equals(rol)) {
            JSONArray llamadas = msj.optJSONArray("tool_calls");
            StringBuilder sb = new StringBuilder(contenido);
            if (llamadas != null) {
                for (int i = 0; i < llamadas.length(); i++) {
                    JSONObject f = llamadas.optJSONObject(i).optJSONObject("function");
                    if (f == null) continue;
                    sb.append(sb.length() > 0 ? "\n" : "").append("<tool_call>\n{\"name\": ").append(JSONObject.quote(f.optString("name")))
                            .append(", \"arguments\": ").append(f.optString("arguments", "{}")).append("}\n</tool_call>");
                }
            }
            return sb.toString();
        }
        if ("tool".equals(rol)) {
            String r = contenido.length() > 2500 ? contenido.substring(0, 2500) + "…" : contenido;
            return "<tool_response>\n{\"name\": " + JSONObject.quote(msj.optString("name")) + ", \"result\": " + JSONObject.quote(r) + "}\n</tool_response>";
        }
        return contenido;
    }

    /**
     * Un modelo chico anda más rápido y mejor con poco contexto: system corto (si es el de la charla), las últimas
     * vueltas, y los resultados de herramientas seguidos juntos en un solo turno de "usuario".
     */
    private static JSONArray recortar(Context c, JSONArray mensajes) throws Exception {
        List<JSONObject> lista = new ArrayList<>();
        JSONObject sistema = null;
        for (int i = 0; i < mensajes.length(); i++) {
            JSONObject msj = mensajes.getJSONObject(i);
            if ("system".equals(msj.optString("role"))) sistema = msj;
            else lista.add(msj);
        }
        // Junta los resultados de herramientas consecutivos.
        List<JSONObject> juntos = new ArrayList<>();
        for (JSONObject msj : lista) {
            boolean esHerramienta = "tool".equals(msj.optString("role"));
            JSONObject anterior = juntos.isEmpty() ? null : juntos.get(juntos.size() - 1);
            if (esHerramienta && anterior != null && "tool_junto".equals(anterior.optString("role"))) {
                anterior.put("content", anterior.optString("content") + "\n" + textoDe(msj));
            } else if (esHerramienta) {
                juntos.add(new JSONObject().put("role", "tool_junto").put("content", textoDe(msj)));
            } else {
                juntos.add(msj);
            }
        }
        // Las últimas 8 vueltas, empezando por un mensaje del usuario.
        int desde = Math.max(0, juntos.size() - 8);
        while (desde > 0 && desde < juntos.size() && !"user".equals(juntos.get(desde).optString("role"))) desde--;
        JSONArray salida = new JSONArray();
        if (sistema != null) {
            String s = sistema.optString("content");
            salida.put(new JSONObject().put("role", "system").put("content", s.length() > 3500 ? Asistente.sistemaCorto(c) : s));
        }
        for (int i = desde; i < juntos.size(); i++) {
            JSONObject msj = juntos.get(i);
            if ("tool_junto".equals(msj.optString("role"))) salida.put(new JSONObject().put("role", "user").put("content", msj.optString("content")));
            else salida.put(msj);
        }
        return salida;
    }

    // Palabras del pedido → herramientas que tienen sentido (un modelo chico elige mejor entre pocas).
    private static final String[][] PISTAS = {
            {"clim|llueve|lluvia|llover|temperatura|frio|calor|pronostico|paraguas", "clima"},
            {"noticia|paso hoy|novedades", "noticias"},
            {"busca|averigua|quien es|que es|cuanto sale|precio|cuando juega|resultado|horario|dolar|internet", "buscar_web"},
            {"calcul|cuanto es|cuanto da|por ciento|%|dividido|multiplic|raiz", "calcular"},
            {"recorda|recordatorio|avisame|acordame", "crear_recordatorio"},
            {"mensaje|whatsapp|escribio|me escribieron|telegram|instagram|chat", "leer_mensajes,responder_aviso"},
            {"mail|correo|email|gmail", "leer_emails,buscar_emails,responder_aviso"},
            {"agenda|calendario|reunion|turno|evento|que tengo|cita", "ver_agenda"},
            {"tarea|pendiente|anota|tengo que", "agregar_tarea,ver_tareas"},
            {"manda|envia|mandala|mandalo|dale|si|ok|listo|perfecto", "enviar_borrador"},
            {"cambia|corregi|modifica|agrega", "corregir_borrador"},
            {"descarta|no la mandes|no lo mandes|borra", "descartar_borrador"},
            {"acordate|guarda|me gusta|mi cumple|soy|vivo", "recordar"},
            {"pone|reproduci|musica|cancion|tema|spotify|youtube", "reproducir"},
            {"como llego|llevame|navega|ruta|mapa", "navegar"},
            {"llama", "llamar"},
            {"alarma|despertame", "poner_alarma"},
            {"temporizador|timer|cuenta regresiva", "poner_temporizador"},
            {"abri|abre|abrir", "abrir"},
    };

    /** Hasta 6 herramientas relacionadas con lo que pediste (ninguna si es charla). */
    static JSONArray elegir(JSONArray herramientas, String pedido) {
        JSONArray salida = new JSONArray();
        if (herramientas == null || herramientas.length() == 0) return salida;
        String t = java.text.Normalizer.normalize(pedido == null ? "" : pedido, java.text.Normalizer.Form.NFD)
                .replaceAll("\\p{M}", "").toLowerCase(java.util.Locale.ROOT);
        Set<String> elegidas = new java.util.LinkedHashSet<>();
        for (String[] pista : PISTAS) {
            if (Pattern.compile("\\b(?:" + pista[0] + ")").matcher(t).find()) elegidas.addAll(Arrays.asList(pista[1].split(",")));
        }
        for (int i = 0; i < herramientas.length() && salida.length() < 6; i++) {
            JSONObject f = herramientas.optJSONObject(i).optJSONObject("function");
            if (f != null && HERRAMIENTAS.contains(f.optString("name")) && elegidas.contains(f.optString("name"))) salida.put(herramientas.opt(i));
        }
        return salida;
    }

    /** El bloque "# Tools" tal cual lo aprendió Qwen (en inglés, con una línea JSON por herramienta). */
    private static String instruccionesHerramientas(JSONArray herramientas) {
        if (herramientas == null || herramientas.length() == 0) return "";
        StringBuilder sb = new StringBuilder("\n\n# Tools\n\nYou may call one or more functions to assist with the user query.\n\n"
                + "You are provided with function signatures within <tools></tools> XML tags:\n<tools>\n");
        for (int i = 0; i < herramientas.length(); i++) {
            JSONObject f = herramientas.optJSONObject(i).optJSONObject("function");
            if (f == null) continue;
            try {
                String descripcion = f.optString("description");
                int punto = descripcion.indexOf(". ");
                if (punto > 0) descripcion = descripcion.substring(0, punto + 1);
                JSONObject corta = new JSONObject().put("name", f.optString("name")).put("description", descripcion);
                if (f.has("parameters")) corta.put("parameters", f.optJSONObject("parameters"));
                sb.append(new JSONObject().put("type", "function").put("function", corta)).append('\n');
            } catch (Exception ignorada) {
            }
        }
        sb.append("</tools>\n\nFor each function call, return a json object with function name and arguments within "
                + "<tool_call></tool_call> XML tags:\n<tool_call>\n{\"name\": <function-name>, \"arguments\": <args-json-object>}\n</tool_call>");
        return sb.toString();
    }
}
