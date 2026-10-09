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
    // El mejor Qwen que corre en un celular con este motor (necesita ~8 GB de RAM). Su tamaño exacto no está publicado
    // en un lugar verificable: se toma del servidor al bajarlo (0 = desconocido) y, si la URL no existe, se pasa al
    // de 1.5B solo.
    static final Modelo QWEN_17B = new Modelo("qwen3-1.7b", "Qwen 3 1.7B",
            "https://huggingface.co/litert-community/Qwen3-1.7B/resolve/main/Qwen3_1.7B.litertlm?download=true",
            "qwen3-1.7b.litertlm", 0L, true);
    static final Modelo QWEN_06B = new Modelo("qwen3-0.6b", "Qwen 3 0.6B",
            "https://huggingface.co/litert-community/Qwen3-0.6B/resolve/8414150f2e9dcc82449bcc9c5abc404b399a4d06/"
                    + "Qwen3-0.6B.litertlm?download=true",
            "qwen3-0.6b.litertlm", 614_236_160L, true);

    // Entrada + salida (el KV cache). Los dos modelos aceptan 4096.
    private static final int MAX_TOKENS = 4096;
    // Presupuesto del prompt en caracteres (~3 por token en castellano), dejando lugar para la respuesta.
    private static final int MAX_CARACTERES = 8000;
    private static final int MAX_RESULTADO = 1200;
    private static final int MAX_SALIDA = 512;
    private static final long ESPERA_MAXIMA_MS = 120_000;
    private static final long DESCARGAR_SI_CAMBIO_MS = 30 * 60_000L;

    // Herramientas que se le ofrecen a Qwen (las más útiles: un modelo chico se confunde con muchas).
    private static final Set<String> HERRAMIENTAS = new HashSet<>(Arrays.asList(
            "clima", "noticias", "buscar_web", "calcular", "crear_recordatorio", "leer_mensajes", "leer_emails",
            "buscar_emails", "ver_agenda", "agregar_tarea", "ver_tareas", "responder_aviso", "enviar_borrador",
            "proponer_whatsapp", "proponer_email", "proponer_sms",
            "corregir_borrador", "descartar_borrador", "recordar", "reproducir", "navegar", "llamar", "poner_alarma",
            "poner_temporizador", "abrir"));

    private static final Object motorLock = new Object();
    // Lo que se está generando para algo de fondo (análisis, revisión): si hablás vos, se corta para atenderte.
    private static volatile Conversation enCursoDeFondo;
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
        // El motor solo existe para celulares de 64 bits.
        if (android.os.Build.SUPPORTED_64_BIT_ABIS.length == 0) return null;
        if (QWEN_17B.id.equals(elegido) && !noDisponible(c, QWEN_17B)) return QWEN_17B;
        if (QWEN_15B.id.equals(elegido) || QWEN_17B.id.equals(elegido)) return QWEN_15B;
        if (QWEN_06B.id.equals(elegido)) return QWEN_06B;
        ActivityManager.MemoryInfo memoria = new ActivityManager.MemoryInfo();
        c.getSystemService(ActivityManager.class).getMemoryInfo(memoria);
        // Automático: el mejor que entra en la memoria del celular (un celular de 8 GB informa ~7,3 GB).
        if (memoria.totalMem >= 7_000_000_000L && !noDisponible(c, QWEN_17B)) return QWEN_17B;
        return memoria.totalMem >= 5_500_000_000L ? QWEN_15B : QWEN_06B;
    }

    private static android.content.SharedPreferences preferencias(Context c) {
        return c.getApplicationContext().getSharedPreferences("jarvis-modelos", Context.MODE_PRIVATE);
    }

    /** Si la URL del modelo no existe (404), no se vuelve a intentar y se usa el siguiente. */
    private static boolean noDisponible(Context c, Modelo m) {
        return preferencias(c).getBoolean("no_" + m.id, false);
    }

    /** Tamaño esperado: el publicado, o el que informó el servidor al empezar a bajarlo (-1 si no se sabe). */
    static long esperado(Context c, Modelo m) {
        return m.bytes > 0 ? m.bytes : preferencias(c).getLong("tam_" + m.id, -1);
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
        long tam = esperado(c, m);
        // El archivo final solo existe después de bajarse completo (se renombra al terminar).
        return f.isFile() && (tam <= 0 ? f.length() > 100_000_000L : f.length() == tam);
    }

    /** {nombre, modelo, local:true, disponible, descargando, progreso, error?} para la interfaz. */
    static JSONObject estado(Context c) {
        JSONObject o = new JSONObject();
        try {
            Modelo m = modelo(c);
            o.put("nombre", "qwen").put("local", true);
            if (m == null) return o.put("modelo", "apagado").put("disponible", false);
            o.put("modelo", m.nombre + " (en el celular)").put("disponible", listo(c)).put("descargando", descargando)
                    .put("progreso", listo(c) ? 100 : Math.max(0, progreso)).put("bytes", Math.max(0, esperado(c, m)));
            if (errorDescarga != null && !descargando) o.put("error", errorDescarga);
        } catch (Exception ignorada) {
        }
        return o;
    }

    // ---------- Descarga ----------

    private static boolean wifi(Context c) {
        try {
            ConnectivityManager cm = c.getSystemService(ConnectivityManager.class);
            NetworkCapabilities red = cm.getNetworkCapabilities(cm.getActiveNetwork());
            return red != null && red.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
                    && red.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** ¿Hay internet que funcione de verdad? (Si no, ni se intenta la nube: responde Qwen al toque.) */
    static boolean hayInternet(Context c) {
        try {
            ConnectivityManager cm = c.getSystemService(ConnectivityManager.class);
            NetworkCapabilities red = cm.getNetworkCapabilities(cm.getActiveNetwork());
            return red != null && red.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
        } catch (RuntimeException e) {
            return true;
        }
    }

    private static boolean puedeBajar(Context c, boolean forzar) {
        return forzar || "si".equals(Ajustes.texto(c, Ajustes.DESCARGA_CON_DATOS)) || wifi(c);
    }

    /**
     * Si falta el modelo, lo descarga en segundo plano (por Wi-Fi, salvo que en Ajustes se permitan los datos). Retoma
     * donde quedó si se cortó. Se puede llamar seguido: no hace nada si ya está o se está bajando.
     */
    static synchronized void asegurar(Context c, boolean forzar) {
        try {
            Modelo m = modelo(c);
            if (m == null) {
                // Apagada: se libera la memoria y el espacio (hasta 1,6 GB).
                if (!descargando) borrarModelos(c, null);
                return;
            }
            if (listo(c) || descargando) return;
            long ahora = System.currentTimeMillis();
            if (!forzar && ahora - ultimoIntento < DESCARGAR_SI_CAMBIO_MS && errorDescarga != null && !errorDescarga.startsWith("Esperando")) return;
            if (!puedeBajar(c, false) && !forzar) {
                errorDescarga = "Esperando Wi-Fi para bajar " + m.nombre + ".";
                return;
            }
            ultimoIntento = ahora;
            descargando = true;
            progreso = -1;
            errorDescarga = null;
            Context app = c.getApplicationContext();
            new Thread(() -> descargar(app, m, forzar), "jarvis-descarga-qwen").start();
        } catch (Throwable e) {
            descargando = false;
            errorDescarga = e.getMessage();
            Log.w(TAG, "No pude preparar la descarga", e);
        }
    }

    /** Borra los modelos que no sean {@code salvo} (null = todos) y, si estaba cargado otro, lo cierra. */
    private static void borrarModelos(Context c, Modelo salvo) {
        File[] archivos = carpeta(c).listFiles();
        if (archivos == null || archivos.length == 0) return;
        synchronized (motorLock) {
            if (motor != null && (salvo == null || !salvo.id.equals(motorDe))) cerrarMotor();
        }
        for (File f : archivos) {
            if (salvo == null || !f.getName().startsWith(salvo.archivo)) //noinspection ResultOfMethodCallIgnored
                f.delete();
        }
    }

    /** La URL del modelo no existe (404/410). */
    private static final class NoExiste extends Exception {
        NoExiste(String mensaje) {
            super(mensaje);
        }
    }

    private static boolean completo(Context c, Modelo m, File destino) {
        long tam = esperado(c, m);
        return destino.isFile() && (tam <= 0 || destino.length() == tam);
    }

    /** Se cortó a propósito (cambió el modelo elegido o se fue el Wi-Fi): el .parte queda para seguir después. */
    private static final class Pausa extends Exception {
        Pausa(String mensaje) {
            super(mensaje);
        }
    }

    private static void descargar(Context c, Modelo m, boolean forzar) {
        File destino = archivo(c, m);
        File parcial = new File(destino.getPath() + ".parte");
        android.os.PowerManager.WakeLock despierta = c.getSystemService(android.os.PowerManager.class)
                .newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "jarvis:descarga");
        android.net.wifi.WifiManager.WifiLock wifiDespierto = null;
        boolean siguiente = false;
        try {
            despierta.acquire(3 * 3_600_000L);
            android.net.wifi.WifiManager wm = c.getSystemService(android.net.wifi.WifiManager.class);
            if (wm != null) {
                wifiDespierto = wm.createWifiLock(android.net.wifi.WifiManager.WIFI_MODE_FULL_HIGH_PERF, "jarvis:descarga");
                wifiDespierto.acquire();
            }
            // Otros modelos que hayan quedado (por ejemplo, si cambiaste de modelo) liberan espacio.
            borrarModelos(c, m);
            long tam = esperado(c, m) > 0 ? esperado(c, m) : 2_300_000_000L;
            if (carpeta(c).getUsableSpace() + parcial.length() < tam + 200_000_000L) {
                throw new Exception("No hay espacio: hacen falta " + (tam / 1_000_000) + " MB libres.");
            }
            for (int intento = 0; intento < 5 && !completo(c, m, destino); intento++) {
                if (modelo(c) != m) throw new Pausa("Cambiaste el modelo.");
                if (!puedeBajar(c, forzar)) throw new Pausa("Esperando Wi-Fi para bajar " + m.nombre + ".");
                try {
                    bajar(c, m, parcial, forzar);
                } catch (Pausa p) {
                    throw p;
                } catch (NoExiste e) {
                    // Ese modelo no está publicado donde se esperaba: se marca y se baja el siguiente mejor.
                    preferencias(c).edit().putBoolean("no_" + m.id, true).apply();
                    //noinspection ResultOfMethodCallIgnored
                    parcial.delete();
                    Log.w(TAG, m.nombre + " no está disponible: paso al siguiente");
                    throw new Pausa("Siguiente modelo");
                } catch (Exception e) {
                    Log.w(TAG, "Descarga cortada: " + e.getMessage());
                    errorDescarga = e.getMessage();
                    Thread.sleep(5_000L * (intento + 1));
                    continue;
                }
                if (esperado(c, m) > 0 && parcial.length() == esperado(c, m)) {
                    if (!parcial.renameTo(destino)) throw new Exception("No pude guardar el modelo.");
                    errorDescarga = null;
                    Log.i(TAG, m.nombre + " descargado");
                }
            }
            if (!completo(c, m, destino) && errorDescarga == null) errorDescarga = "No pude bajar " + m.nombre + ".";
        } catch (Pausa p) {
            errorDescarga = p.getMessage();
            if ("Siguiente modelo".equals(p.getMessage())) {
                errorDescarga = null;
                siguiente = true;
            }
        } catch (Exception e) {
            errorDescarga = e.getMessage();
            Log.w(TAG, "No pude bajar el modelo: " + e.getMessage());
        } finally {
            descargando = false;
            if (wifiDespierto != null && wifiDespierto.isHeld()) wifiDespierto.release();
            if (despierta.isHeld()) despierta.release();
            Eventos.emitir("estado", null);
        }
        // El modelo no existía: se arranca con el siguiente mejor.
        if (siguiente) asegurar(c, forzar);
    }

    private static void bajar(Context c, Modelo m, File parcial, boolean forzar) throws Exception {
        long ya = parcial.isFile() ? parcial.length() : 0;
        if (esperado(c, m) > 0 && ya > esperado(c, m)) {
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
        if (estado == 404 || estado == 410 || estado == 401) throw new NoExiste(m.nombre + " no está disponible (" + estado + ").");
        if (estado != 200 && estado != 206) throw new Exception("El servidor del modelo respondió " + estado + ".");
        boolean sigue = estado == 206;
        if (m.bytes <= 0) {
            // Tamaño total que informa el servidor (Content-Range: bytes a-b/TOTAL, o el largo si arranca de cero).
            long total = -1;
            String rango = con.getHeaderField("Content-Range");
            if (sigue && rango != null && rango.contains("/")) {
                try {
                    total = Long.parseLong(rango.substring(rango.lastIndexOf('/') + 1).trim());
                } catch (NumberFormatException ignorada) {
                }
            } else if (!sigue) {
                total = con.getContentLengthLong();
            }
            if (total > 0) preferencias(c).edit().putLong("tam_" + m.id, total).apply();
        }
        try (InputStream entrada = con.getInputStream(); FileOutputStream salida = new FileOutputStream(parcial, sigue)) {
            long total = sigue ? ya : 0;
            byte[] bloque = new byte[256 * 1024];
            int leidos;
            int ultimo = -1;
            long revisado = total;
            while ((leidos = entrada.read(bloque)) != -1) {
                salida.write(bloque, 0, leidos);
                total += leidos;
                long tam = esperado(c, m);
                int ahora = tam > 0 ? (int) (total * 100 / tam) : 0;
                if (ahora != ultimo) {
                    ultimo = ahora;
                    progreso = ahora;
                    Eventos.emitir("estado", null);
                }
                if (tam > 0 && total > tam) throw new Exception("El archivo del modelo es más grande de lo esperado.");
                // Cada 8 MB: si cambiaste de modelo o se fue el Wi-Fi (y no querés gastar datos), se pausa.
                if (total - revisado > 8_000_000L) {
                    revisado = total;
                    if (modelo(c) != m) throw new Pausa("Cambiaste el modelo.");
                    if (!puedeBajar(c, forzar)) throw new Pausa("Esperando Wi-Fi para bajar " + m.nombre + ".");
                }
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
                    : "Para responder sin internet necesito bajar mi cerebro del celular (" + m.nombre + ", por Wi-Fi).", 503);
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
            SamplerConfig muestreo = new SamplerConfig(20, 0.8, json || ofrecidas.length() > 0 ? 0.3 : 0.6, 0);
            boolean deFondo = alTexto == null;
            // Si hablás vos y Qwen está ocupado con algo de fondo (analizar un mensaje), lo corta para atenderte.
            Conversation fondo = enCursoDeFondo;
            if (!deFondo && fondo != null) {
                try {
                    fondo.cancelProcess();
                } catch (Throwable ignorada) {
                }
            }
            String pedidoFinal = m.piensa ? ultimo + " /no_think" : ultimo;
            synchronized (motorLock) {
                Engine e = motor(c, m);
                ultimoUso = System.currentTimeMillis();
                try {
                    return conversar(e, new ConversationConfig(Contents.Companion.of(sistema), previos, Collections.emptyList(),
                            muestreo, false, null, extra, null, false, MAX_SALIDA), pedidoFinal, alTexto, json, deFondo);
                } catch (Exception largo) {
                    String msj = String.valueOf(largo.getMessage()).toLowerCase(java.util.Locale.ROOT);
                    if (!msj.contains("too long") && !msj.contains("kv") && !msj.contains("token")) throw largo;
                    // El prompt no entró: se reintenta solo con las instrucciones y el último mensaje.
                    Log.w(TAG, "Prompt demasiado largo, reintento corto: " + largo.getMessage());
                    return conversar(e, new ConversationConfig(Contents.Companion.of(sistema.length() > 3000 ? sistema.substring(0, 3000) : sistema),
                            new ArrayList<>(), Collections.emptyList(), muestreo, false, null, extra, null, false, MAX_SALIDA),
                            pedidoFinal.length() > 3000 ? pedidoFinal.substring(pedidoFinal.length() - 3000) : pedidoFinal, alTexto, json, deFondo);
                } finally {
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

    private static IA.Respuesta conversar(Engine e, ConversationConfig config, String texto, IA.AlTexto alTexto, boolean json,
                                          boolean deFondo) throws Exception {
        Conversation charla = e.createConversation(config);
        if (deFondo) enCursoDeFondo = charla;
        try {
            return generar(charla, texto, alTexto, json);
        } finally {
            if (deFondo) enCursoDeFondo = null;
            try {
                charla.close();
            } catch (Throwable ignorada) {
            }
        }
    }

    private static IA.Respuesta generar(Conversation charla, String texto, IA.AlTexto alTexto, boolean json) throws Exception {
        StringBuilder todo = new StringBuilder();
        List<ToolCall> llamadasNativas = new ArrayList<>();
        AtomicReference<Throwable> falla = new AtomicReference<>();
        CountDownLatch fin = new CountDownLatch(1);
        final int[] emitido = {0};
        final boolean[] enVivo = {alTexto != null && !json};
        // Después de cortar por tiempo no se manda más texto en vivo.
        final java.util.concurrent.atomic.AtomicBoolean terminado = new java.util.concurrent.atomic.AtomicBoolean(false);
        charla.sendMessageAsync(Message.Companion.user(texto), new MessageCallback() {
            @Override
            public void onMessage(Message parte) {
                String d = parte.toString();
                if (parte.getToolCalls() != null) llamadasNativas.addAll(parte.getToolCalls());
                if (d == null || d.isEmpty()) return;
                synchronized (todo) {
                    if (terminado.get()) return;
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
        boolean cortada = false;
        if (!fin.await(ESPERA_MAXIMA_MS, TimeUnit.MILLISECONDS)) {
            // Se le pide que pare y se espera a que el motor lo confirme antes de cerrar la conversación.
            charla.cancelProcess();
            fin.await(10, TimeUnit.SECONDS);
            cortada = true;
        }
        terminado.set(true);
        String parcial;
        synchronized (todo) {
            parcial = LLAMADA.matcher(PENSAMIENTO.matcher(todo).replaceAll("")).replaceAll("").trim();
        }
        if (cortada || falla.get() != null) {
            boolean cancelada = falla.get() instanceof java.util.concurrent.CancellationException;
            // Si ya dijo algo, eso es la respuesta (mejor media respuesta que un error).
            if (!parcial.isEmpty() && !parcial.startsWith("<")) {
                IA.Respuesta r = new IA.Respuesta();
                r.proveedor = "qwen";
                r.texto = parcial;
                return r;
            }
            if (cortada) throw new Exception("tardó demasiado");
            if (cancelada) throw new Exception("se cortó para atender otro pedido");
            throw new Exception(falla.get().getMessage(), falla.get());
        }

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
            String r = contenido.length() > MAX_RESULTADO ? contenido.substring(0, MAX_RESULTADO) + "…" : contenido;
            return "<tool_response>\n{\"name\": " + JSONObject.quote(msj.optString("name")) + ", \"result\": " + JSONObject.quote(r) + "}\n</tool_response>";
        }
        return contenido;
    }

    /**
     * Un modelo chico anda más rápido y mejor con poco contexto: el system corto si es el de la charla, las últimas
     * vueltas que entren en el presupuesto y los resultados de herramientas seguidos juntos en un turno de "usuario".
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
        String textoSistema = "";
        if (sistema != null) {
            String s = sistema.optString("content");
            // El de la charla (largo, con memoria y avisos) se cambia por uno corto; los demás (análisis, revisión)
            // se respetan, y si son muy largos se cortan por el final (las instrucciones van al principio).
            if (s.contains(Asistente.MARCA_CHARLA)) s = Asistente.sistemaCorto(c);
            else if (s.length() > 3500) s = s.substring(0, 3500);
            textoSistema = s;
        }
        // Desde el final hacia atrás, mientras entre en el presupuesto (el último siempre entra).
        int usado = textoSistema.length();
        int desde = juntos.size();
        while (desde > 0) {
            JSONObject msj = juntos.get(desde - 1);
            int largo = "tool_junto".equals(msj.optString("role")) ? msj.optString("content").length() : textoDe(msj).length();
            if (desde < juntos.size() && usado + largo > MAX_CARACTERES) break;
            usado += largo;
            desde--;
            if (juntos.size() - desde >= 8) break;
        }
        // Que empiece por un mensaje del usuario (no por una respuesta o un resultado suelto).
        while (desde > 0 && desde < juntos.size() - 1 && !"user".equals(juntos.get(desde).optString("role"))) desde++;
        JSONArray salida = new JSONArray();
        if (sistema != null) salida.put(new JSONObject().put("role", "system").put("content", textoSistema));
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
            {"mandale|mandale un|escribile|decile|avisale|whatsapp a|mensaje a|un whatsapp|un mensaje", "proponer_whatsapp,proponer_sms"},
            {"mail a|correo a|un mail|un correo|email a", "proponer_email"},
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
            if (Pattern.compile("\\b(?:" + pista[0] + ")\\b").matcher(t).find()) elegidas.addAll(Arrays.asList(pista[1].split(",")));
        }
        String limpio = t.replaceAll("[^a-z ]", " ").replaceAll("\\s+", " ").trim();
        // "Mandala" solo se ofrece si el pedido entero es una confirmación corta (si no, "dale, decile a Juan…" podría
        // mandar otro borrador).
        if (limpio.matches("(si|dale|ok|okey|listo|perfecto|de una|mandala|mandalo|enviala|envialo|mandasela|mandaselo)"
                + "( (si|dale|mandala|mandalo|enviala|envialo|mandasela|mandaselo|nomas|ya))?")) {
            elegidas.add("enviar_borrador");
        }
        // Una pregunta sin pistas probablemente sea de actualidad: mejor buscar que inventar.
        boolean charla = limpio.matches(".*\\b(como estas|como andas|como va|que tal|que haces|como te llamas|quien sos)\\b.*");
        if (elegidas.isEmpty() && !charla && (t.contains("?") || limpio.matches("^(que|quien|quienes|cuando|donde|cuanto|cuanta|cuantos|como|cual|a que hora)\\b.*"))) {
            elegidas.add("buscar_web");
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
