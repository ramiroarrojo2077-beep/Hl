package com.jarvis.asistente;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Cliente de IA gratuita con formato de chat de OpenAI (Gemini, Groq y OpenRouter lo hablan).
 * Prueba los proveedores en orden (gemini → groq → openrouter, solo los que tienen clave en {@link Ajustes});
 * si uno falla o se queda sin cupo (429/503) lo saltea un rato (Retry-After o 60 s) y sigue con el próximo.
 * Si ya se emitió texto en vivo, no cambia de proveedor (duplicaría la respuesta) y relanza el error.
 */
final class IA {
    private IA() {}

    private static final String TAG = "JarvisIA";
    private static final int CONEXION_MS = 15_000;
    private static final int LECTURA_MS = 90_000;
    private static final long PAUSA_MS = 60_000;
    private static final int MAX_RESPUESTA = 8 * 1024 * 1024;
    private static final int MAX_DETALLE = 16 * 1024;
    private static final String SIN_IA =
            "No hay ninguna IA configurada. Prendé la IA del celular (Qwen) en Ajustes o pegá tu clave gratis de Gemini o de Groq.";
    private static final String CANCELADA = "Se canceló la respuesta.";
    // Gemini dice en el cuerpo cuánto esperar cuando se queda sin cupo ("retryDelay": "33s").
    private static final Pattern ESPERA_GEMINI = Pattern.compile("\"retryDelay\"\\s*:\\s*\"(\\d+(?:\\.\\d+)?)s\"");

    // Un proveedor que se quedó sin cupo gratis se saltea un rato (nombre → hasta cuándo, en ms).
    private static final Map<String, Long> enPausaHasta = new ConcurrentHashMap<>();
    // Modelos que rechazaron reasoning_effort (los que no "piensan"): no se les vuelve a mandar.
    private static final Set<String> sinRazonamiento = ConcurrentHashMap.newKeySet();

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
        /** Cuánto pide el proveedor que se espere antes de volver a probar (0 = lo de siempre). */
        final long esperarMs;
        /** Lo que dijo el proveedor, tal cual (para los logs y para decidir reintentos). */
        String detalle = "";

        ErrorIA(String mensaje, int estado) {
            this(mensaje, estado, 0);
        }

        ErrorIA(String mensaje, int estado, long esperarMs) {
            super(mensaje);
            this.estado = estado;
            this.esperarMs = esperarMs;
        }
    }

    private static final class Proveedor {
        final String nombre;
        final String visible;
        final String url;
        final String clave;
        final String modelo;

        Proveedor(String nombre, String visible, String url, String clave, String modelo) {
            this.nombre = nombre;
            this.visible = visible;
            this.url = url;
            // Una clave pegada con espacios o saltos de línea rompería el encabezado HTTP.
            this.clave = clave.replaceAll("\\s+", "");
            this.modelo = modelo;
        }

        boolean piensa() {
            return nombre.equals("gemini") || nombre.equals("groq");
        }
    }

    /** Los proveedores con clave, en el orden de preferencia. Se lee cada vez: los ajustes cambian en caliente. */
    private static List<Proveedor> configurados(Context c) {
        List<Proveedor> lista = new ArrayList<>(3);
        if (Ajustes.tiene(c, Ajustes.GEMINI)) {
            lista.add(new Proveedor("gemini", "Gemini", "https://generativelanguage.googleapis.com/v1beta/openai",
                    Ajustes.texto(c, Ajustes.GEMINI), Ajustes.texto(c, Ajustes.GEMINI_MODELO)));
        }
        if (Ajustes.tiene(c, Ajustes.GROQ)) {
            lista.add(new Proveedor("groq", "Groq", "https://api.groq.com/openai/v1",
                    Ajustes.texto(c, Ajustes.GROQ), Ajustes.texto(c, Ajustes.GROQ_MODELO)));
        }
        if (Ajustes.tiene(c, Ajustes.OPENROUTER) && Ajustes.tiene(c, Ajustes.OPENROUTER_MODELO)) {
            lista.add(new Proveedor("openrouter", "OpenRouter", "https://openrouter.ai/api/v1",
                    Ajustes.texto(c, Ajustes.OPENROUTER), Ajustes.texto(c, Ajustes.OPENROUTER_MODELO)));
        }
        return lista;
    }

    private static boolean enPausa(String nombre, long ahora) {
        Long hasta = enPausaHasta.get(nombre);
        return hasta != null && hasta > ahora;
    }

    /** ¿Hay al menos una IA lista (con clave en la nube, o Qwen ya bajado al celular)? */
    static boolean configurada(Context c) {
        return !configurados(c).isEmpty() || localLista(c);
    }

    // Lo de Qwen nunca puede tumbar a Jarvis: ante cualquier problema, se hace de cuenta que no está.
    private static boolean localPrendida(Context c) {
        try {
            return Local.modelo(c) != null;
        } catch (Throwable e) {
            return false;
        }
    }

    private static boolean localLista(Context c) {
        try {
            return Local.listo(c);
        } catch (Throwable e) {
            return false;
        }
    }

    private static Respuesta conLocal(Context c, JSONArray mensajes, JSONArray herramientas, boolean json, AlTexto alTexto)
            throws ErrorIA {
        try {
            return Local.completar(c, mensajes, herramientas, json, alTexto);
        } catch (ErrorIA e) {
            throw e;
        } catch (Throwable e) {
            throw new ErrorIA("La IA del celular no está disponible.", 0);
        }
    }

    /** Sin claves de la nube: todo lo piensa Qwen en el celular (más lento y gasta batería: se usa con medida). */
    static boolean soloLocal(Context c) {
        return configurados(c).isEmpty();
    }

    /** [{nombre, modelo, disponible}] en orden de uso. */
    static JSONArray proveedores(Context c) {
        JSONArray lista = new JSONArray();
        long ahora = System.currentTimeMillis();
        for (Proveedor p : configurados(c)) {
            try {
                lista.put(new JSONObject()
                        .put("nombre", p.nombre)
                        .put("modelo", p.modelo)
                        .put("disponible", !enPausa(p.nombre, ahora)));
            } catch (JSONException ignorada) {
            }
        }
        try {
            if (Local.modelo(c) != null) lista.put(Local.estado(c));
        } catch (Throwable ignorada) {
        }
        return lista;
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
        List<Proveedor> todos = configurados(c);
        if (mensajes == null) mensajes = new JSONArray();
        // Sin claves de la nube: responde Qwen en el celular.
        if (todos.isEmpty()) {
            if (!localPrendida(c)) throw new ErrorIA(SIN_IA, 0);
            return conLocal(c, mensajes, herramientas, json, alTexto);
        }
        // Sin internet que funcione no tiene sentido esperar a la nube: contesta Qwen al toque.
        boolean qwenLista = localLista(c);
        if (qwenLista && !Local.hayInternet(c)) {
            Log.i(TAG, "Sin internet: respondo con Qwen en el celular");
            return conLocal(c, mensajes, herramientas, json, alTexto);
        }

        // Los que están en pausa van al final, sin perder el orden de preferencia.
        long ahora = System.currentTimeMillis();
        List<Proveedor> ordenados = new ArrayList<>(todos.size());
        List<Proveedor> pausados = new ArrayList<>();
        for (Proveedor p : todos) (enPausa(p.nombre, ahora) ? pausados : ordenados).add(p);
        // Con Qwen lista, los que están en pausa ni se prueban (no se espera a que vuelvan a fallar).
        if (!qwenLista || ordenados.isEmpty() && pausados.isEmpty()) ordenados.addAll(pausados);

        String razonamiento = Ajustes.texto(c, Ajustes.RAZONAMIENTO);
        Set<String> fallas = new LinkedHashSet<>();
        ErrorIA ultimo = null;
        Respuesta vacia = null;
        for (Proveedor p : ordenados) {
            if (Thread.currentThread().isInterrupted()) throw new ErrorIA(CANCELADA, 0);
            final boolean[] empezo = {false};
            AlTexto envoltura = alTexto == null ? null : pedazo -> {
                empezo[0] = true;
                alTexto.delta(pedazo);
            };
            try {
                Respuesta r = llamar(p, mensajes, herramientas, json, envoltura, razonamiento);
                if (!r.texto.trim().isEmpty() || r.llamadas.length() > 0) return r;
                // Gemini a veces corta sin decir nada (filtro o llamada mal armada): vale la pena probar otro.
                Log.w(TAG, p.visible + " devolvió una respuesta vacía");
                if (vacia == null) vacia = r;
                if (empezo[0]) return r;
            } catch (ErrorIA e) {
                ultimo = e;
                if (e.estado == 429 || e.estado == 503) {
                    long espera = e.esperarMs > 0 ? e.esperarMs : PAUSA_MS;
                    enPausaHasta.put(p.nombre, System.currentTimeMillis() + espera);
                } else if (e.estado == 0 && qwenLista && !CANCELADA.equals(e.getMessage())) {
                    // Problema de conexión: un minuto sin probarlo, así las próximas vueltas van directo a Qwen.
                    enPausaHasta.put(p.nombre, System.currentTimeMillis() + PAUSA_MS);
                }
                Log.w(TAG, p.visible + " falló: " + e.getMessage()
                        + (e.detalle.isEmpty() || e.getMessage().contains(e.detalle) ? "" : " (" + e.detalle + ")"));
                // Si ya se mostró parte de la respuesta y se cortó internet, Qwen sigue desde ahí (sin repetir lo dicho).
                if (empezo[0] && !CANCELADA.equals(e.getMessage()) && qwenLista && alTexto != null) {
                    try {
                        alTexto.delta(" … Se cortó internet, sigo yo: ");
                        return conLocal(c, mensajes, herramientas, json, alTexto);
                    } catch (ErrorIA local) {
                        throw e;
                    }
                }
                if (empezo[0] || CANCELADA.equals(e.getMessage())) throw e;
                fallas.add(e.getMessage());
            } catch (RuntimeException e) {
                // Puede venir de quien recibe el texto en vivo: si ya empezó, es su problema y se propaga.
                if (empezo[0]) throw e;
                Log.w(TAG, p.visible + " falló de forma inesperada", e);
                ultimo = new ErrorIA(p.visible + " devolvió algo que no entiendo.", 0);
                fallas.add(ultimo.getMessage());
            }
        }
        // Se acabó el cupo, no hay internet, la clave falló o la nube contestó vacío: responde Qwen en el celular, así
        // nunca te quedás sin respuesta.
        if (localPrendida(c) && !Thread.currentThread().isInterrupted()) {
            try {
                Log.i(TAG, "Las IA de la nube no respondieron: paso a Qwen en el celular");
                return conLocal(c, mensajes, herramientas, json, alTexto);
            } catch (ErrorIA local) {
                fallas.add(local.getMessage());
            }
        }
        if (vacia != null) return vacia;
        if (ultimo == null) throw new ErrorIA("Ninguna IA respondió.", 0);
        if (fallas.size() <= 1) throw ultimo;
        throw new ErrorIA("Ninguna IA respondió. " + String.join(" ", fallas), ultimo.estado, ultimo.esperarMs);
    }

    /** Pide un JSON y lo devuelve parseado (tolera que venga envuelto en ```json). */
    static JSONObject completarJson(Context c, JSONArray mensajes) throws ErrorIA {
        Respuesta r = completar(c, mensajes, null, true, null);
        String limpio = r.texto.replaceFirst("(?i)^\\s*```(?:json)?", "").replaceFirst("```\\s*$", "");
        int inicio = limpio.indexOf('{');
        int fin = limpio.lastIndexOf('}');
        if (inicio >= 0 && fin > inicio) {
            try {
                return new JSONObject(limpio.substring(inicio, fin + 1));
            } catch (JSONException ignorada) {
            }
        }
        Log.w(TAG, "JSON inválido de " + r.proveedor + ": " + recortar(r.texto, 300));
        throw new ErrorIA("La IA no devolvió un JSON válido.", 0);
    }

    // ---------- Un pedido a un proveedor ----------

    private static Respuesta llamar(Proveedor p, JSONArray mensajes, JSONArray herramientas, boolean json,
            AlTexto alTexto, String razonamiento) throws ErrorIA {
        // Con json la respuesta se usa entera, no tiene sentido mostrarla en vivo.
        AlTexto enVivo = json ? null : alTexto;
        String modelo = p.nombre + "/" + p.modelo;
        boolean conRazonamiento = p.piensa() && !razonamiento.isEmpty() && !sinRazonamiento.contains(modelo);
        try {
            return pedir(p, mensajes, herramientas, json, enVivo, conRazonamiento ? razonamiento : null);
        } catch (ErrorIA e) {
            // Los modelos que no "piensan" rechazan reasoning_effort: se aprende y se reintenta sin él.
            if (conRazonamiento && e.estado == 400 && e.detalle.toLowerCase(Locale.ROOT).contains("reasoning")) {
                Log.i(TAG, modelo + " no acepta reasoning_effort, sigo sin él");
                sinRazonamiento.add(modelo);
                return pedir(p, mensajes, herramientas, json, enVivo, null);
            }
            throw e;
        }
    }

    private static Respuesta pedir(Proveedor p, JSONArray mensajes, JSONArray herramientas, boolean json,
            AlTexto alTexto, String razonamiento) throws ErrorIA {
        byte[] cuerpo;
        try {
            JSONObject o = new JSONObject();
            o.put("model", p.modelo);
            o.put("messages", prepararMensajes(mensajes, p));
            o.put("stream", alTexto != null);
            if (herramientas != null && herramientas.length() > 0) o.put("tools", herramientas);
            if (json) o.put("response_format", new JSONObject().put("type", "json_object"));
            if (razonamiento != null) o.put("reasoning_effort", razonamiento);
            cuerpo = o.toString().getBytes(StandardCharsets.UTF_8);
        } catch (JSONException e) {
            throw new ErrorIA("No pude armar el pedido para " + p.visible + ".", 0);
        }

        HttpURLConnection con = null;
        boolean completo = false;
        try {
            con = (HttpURLConnection) new URL(p.url + "/chat/completions").openConnection();
            con.setConnectTimeout(CONEXION_MS);
            con.setReadTimeout(LECTURA_MS);
            con.setUseCaches(false);
            con.setRequestMethod("POST");
            con.setDoOutput(true);
            con.setFixedLengthStreamingMode(cuerpo.length);
            con.setRequestProperty("Content-Type", "application/json");
            con.setRequestProperty("Accept", alTexto != null ? "text/event-stream" : "application/json");
            con.setRequestProperty("Authorization", "Bearer " + p.clave);
            if (p.nombre.equals("openrouter")) con.setRequestProperty("X-Title", "Jarvis");
            try (OutputStream salida = con.getOutputStream()) {
                salida.write(cuerpo);
            }
            int estado = con.getResponseCode();
            if (estado < 200 || estado >= 300) throw errorHttp(p, estado, con);
            Respuesta r;
            try (InputStream entrada = con.getInputStream()) {
                r = alTexto != null ? new LectorStream(p, alTexto).leer(entrada) : leerCompleta(p, entrada);
            }
            completo = true;
            return r;
        } catch (SocketTimeoutException e) {
            throw new ErrorIA(p.visible + " tardó demasiado en responder.", 0);
        } catch (IOException e) {
            ErrorIA error = new ErrorIA("No pude conectarme con " + p.visible + ". Fijate si hay internet.", 0);
            error.detalle = String.valueOf(e.getMessage());
            throw error;
        } finally {
            // Si todo salió bien la conexión queda para reusarla (ahorra el saludo TLS del próximo pedido).
            if (con != null && !completo) con.disconnect();
        }
    }

    /** Copias livianas: el arreglo del que llama no se toca. */
    private static JSONArray prepararMensajes(JSONArray mensajes, Proveedor p) throws JSONException {
        boolean esGemini = p.nombre.equals("gemini");
        JSONArray copia = new JSONArray();
        for (int i = 0; i < mensajes.length(); i++) {
            JSONObject m = mensajes.optJSONObject(i);
            if (m == null) continue;
            JSONObject nuevo = copiarSin(m, esGemini ? null : "name");
            nuevo.remove("tool_calls");
            JSONArray llamadas = m.optJSONArray("tool_calls");
            // Un tool_calls vacío lo rechazan varios proveedores.
            if (llamadas != null && llamadas.length() > 0) {
                JSONArray limpias = new JSONArray();
                for (int j = 0; j < llamadas.length(); j++) {
                    JSONObject l = llamadas.optJSONObject(j);
                    if (l != null) limpias.put(copiarSin(l, esGemini ? null : "extra_content"));
                }
                nuevo.put("tool_calls", limpias);
            }
            copia.put(nuevo);
        }
        return copia;
    }

    private static JSONObject copiarSin(JSONObject original, String sacar) throws JSONException {
        JSONObject copia = new JSONObject();
        Iterator<String> claves = original.keys();
        while (claves.hasNext()) {
            String clave = claves.next();
            if (!clave.equals(sacar)) copia.put(clave, original.opt(clave));
        }
        return copia;
    }

    private static Respuesta leerCompleta(Proveedor p, InputStream entrada) throws IOException, ErrorIA {
        String texto = leerTexto(entrada, MAX_RESPUESTA);
        JSONObject json;
        try {
            json = new JSONObject(texto);
        } catch (JSONException e) {
            ErrorIA error = new ErrorIA(p.visible + " devolvió una respuesta que no entiendo.", 0);
            error.detalle = recortar(texto, 300);
            throw error;
        }
        return desdeCompleta(p, json);
    }

    private static Respuesta desdeCompleta(Proveedor p, JSONObject json) throws ErrorIA {
        Object error = json.opt("error");
        if (error != null && error != JSONObject.NULL) throw errorEnCuerpo(p, error);
        Respuesta r = new Respuesta();
        r.proveedor = p.nombre;
        JSONArray opciones = json.optJSONArray("choices");
        JSONObject opcion = opciones != null ? opciones.optJSONObject(0) : null;
        JSONObject mensaje = opcion != null ? opcion.optJSONObject("message") : null;
        if (mensaje == null) return r;
        r.texto = contenido(mensaje.opt("content"));
        JSONArray crudas = mensaje.optJSONArray("tool_calls");
        List<Llamada> llamadas = new ArrayList<>();
        if (crudas != null) {
            for (int i = 0; i < crudas.length(); i++) {
                JSONObject cruda = crudas.optJSONObject(i);
                if (cruda == null) continue;
                Llamada l = new Llamada();
                l.sumar(cruda);
                llamadas.add(l);
            }
        }
        r.llamadas = normalizar(llamadas);
        return r;
    }

    // ---------- Stream (SSE) ----------

    /** Una llamada a herramienta que se va armando de a pedazos. */
    private static final class Llamada {
        String id = "";
        final StringBuilder nombre = new StringBuilder();
        final StringBuilder argumentos = new StringBuilder();
        Object extra;

        void sumar(JSONObject parte) {
            String nuevoId = cadena(parte, "id");
            if (!nuevoId.isEmpty()) id = nuevoId;
            JSONObject funcion = parte.optJSONObject("function");
            if (funcion != null) {
                nombre.append(cadena(funcion, "name"));
                argumentos.append(cadena(funcion, "arguments"));
            }
            Object e = parte.opt("extra_content");
            if (e != null && e != JSONObject.NULL) extra = e;
        }
    }

    private static final class LectorStream {
        private final Proveedor proveedor;
        private final AlTexto alTexto;
        private final StringBuilder texto = new StringBuilder();
        private final List<Llamada> llamadas = new ArrayList<>();
        // Lo que no vino como "data:" (por si el proveedor ignoró el stream y mandó un JSON común).
        private final StringBuilder otros = new StringBuilder();
        private boolean vinoDatos;

        LectorStream(Proveedor proveedor, AlTexto alTexto) {
            this.proveedor = proveedor;
            this.alTexto = alTexto;
        }

        Respuesta leer(InputStream entrada) throws IOException, ErrorIA {
            BufferedReader lector = new BufferedReader(new InputStreamReader(entrada, StandardCharsets.UTF_8));
            String linea;
            while ((linea = lector.readLine()) != null) {
                if (Thread.currentThread().isInterrupted()) throw new ErrorIA(CANCELADA, 0);
                procesar(linea.trim());
            }
            if (!vinoDatos && otros.length() > 0) return sinStream();
            Respuesta r = new Respuesta();
            r.proveedor = proveedor.nombre;
            r.texto = texto.toString();
            r.llamadas = normalizar(llamadas);
            return r;
        }

        private void procesar(String linea) throws ErrorIA {
            if (!linea.startsWith("data:")) {
                if (!linea.isEmpty() && !linea.startsWith(":") && otros.length() < MAX_RESPUESTA) {
                    otros.append(linea).append('\n');
                }
                return;
            }
            String datos = linea.substring(5).trim();
            if (datos.isEmpty() || datos.equals("[DONE]")) return;
            vinoDatos = true;
            JSONObject chunk;
            try {
                chunk = new JSONObject(datos);
            } catch (JSONException e) {
                return;
            }
            Object error = chunk.opt("error");
            if (error != null && error != JSONObject.NULL) throw errorEnCuerpo(proveedor, error);
            JSONArray opciones = chunk.optJSONArray("choices");
            JSONObject opcion = opciones != null ? opciones.optJSONObject(0) : null;
            JSONObject delta = opcion != null ? opcion.optJSONObject("delta") : null;
            if (delta == null) return;
            String pedazo = contenido(delta.opt("content"));
            if (!pedazo.isEmpty()) {
                texto.append(pedazo);
                alTexto.delta(pedazo);
            }
            JSONArray partes = delta.optJSONArray("tool_calls");
            if (partes == null) return;
            for (int j = 0; j < partes.length(); j++) {
                JSONObject parte = partes.optJSONObject(j);
                if (parte == null) continue;
                int i = ubicar(parte);
                // Un índice disparatado no puede inflar la lista sin límite.
                if (i > 128) continue;
                while (llamadas.size() <= i) llamadas.add(null);
                Llamada llamada = llamadas.get(i);
                if (llamada == null) {
                    llamada = new Llamada();
                    llamadas.set(i, llamada);
                }
                llamada.sumar(parte);
            }
        }

        /** Por "index"; algunos proveedores no lo mandan y entonces se ubica por id, o es la última. */
        private int ubicar(JSONObject parte) {
            Object indice = parte.opt("index");
            if (indice instanceof Number) return Math.max(0, ((Number) indice).intValue());
            String id = cadena(parte, "id");
            int i = -1;
            if (!id.isEmpty()) {
                for (int k = 0; k < llamadas.size(); k++) {
                    Llamada l = llamadas.get(k);
                    if (l != null && id.equals(l.id)) {
                        i = k;
                        break;
                    }
                }
            } else {
                i = llamadas.size() - 1;
            }
            return i < 0 ? llamadas.size() : i;
        }

        private Respuesta sinStream() throws ErrorIA {
            JSONObject json;
            try {
                json = new JSONObject(otros.toString());
            } catch (JSONException e) {
                ErrorIA error = new ErrorIA(proveedor.visible + " devolvió una respuesta que no entiendo.", 0);
                error.detalle = recortar(otros.toString(), 300);
                throw error;
            }
            Respuesta r = desdeCompleta(proveedor, json);
            if (!r.texto.isEmpty()) alTexto.delta(r.texto);
            return r;
        }
    }

    private static JSONArray normalizar(List<Llamada> llamadas) {
        JSONArray lista = new JSONArray();
        long ahora = System.currentTimeMillis();
        int i = 0;
        for (Llamada l : llamadas) {
            if (l == null) continue;
            try {
                JSONObject funcion = new JSONObject()
                        .put("name", l.nombre.toString())
                        .put("arguments", l.argumentos.length() > 0 ? l.argumentos.toString() : "{}");
                JSONObject llamada = new JSONObject()
                        .put("id", l.id.isEmpty() ? "llamada_" + ahora + "_" + i : l.id)
                        .put("type", "function")
                        .put("function", funcion);
                if (l.extra != null) llamada.put("extra_content", l.extra);
                lista.put(llamada);
            } catch (JSONException ignorada) {
            }
            i++;
        }
        return lista;
    }

    // ---------- Errores ----------

    private static ErrorIA errorHttp(Proveedor p, int estado, HttpURLConnection con) {
        String cuerpo = "";
        try (InputStream error = con.getErrorStream()) {
            if (error != null) cuerpo = leerTexto(error, MAX_DETALLE);
        } catch (IOException ignorada) {
        }
        String detalle = mensajeDeError(cuerpo);
        long esperar = segundosAMs(con.getHeaderField("Retry-After"));
        if (esperar <= 0) {
            Matcher m = ESPERA_GEMINI.matcher(cuerpo);
            if (m.find()) esperar = segundosAMs(m.group(1));
        }
        ErrorIA error = new ErrorIA(explicar(p, estado, detalle), estado, esperar);
        error.detalle = detalle;
        return error;
    }

    /** Error que llega adentro de una respuesta 200 o en medio del stream: {error:{message, code}}. */
    private static ErrorIA errorEnCuerpo(Proveedor p, Object error) {
        String detalle;
        int estado = 0;
        if (error instanceof JSONObject) {
            JSONObject e = (JSONObject) error;
            detalle = cadena(e, "message");
            Object codigo = e.opt("code");
            if (codigo instanceof Number) estado = ((Number) codigo).intValue();
            else if (codigo instanceof String && ((String) codigo).matches("\\d{3}")) estado = Integer.parseInt((String) codigo);
            if (estado < 400 || estado > 599) estado = 0;
        } else {
            detalle = String.valueOf(error);
        }
        detalle = recortar(detalle.replaceAll("\\s+", " ").trim(), 300);
        String mensaje = estado != 0
                ? explicar(p, estado, detalle)
                : p.visible + " cortó la respuesta" + (detalle.isEmpty() ? "." : ": " + conPunto(recortar(detalle, 160)));
        ErrorIA e = new ErrorIA(mensaje, estado);
        e.detalle = detalle;
        return e;
    }

    /** Mensajes pensados para que Jarvis los diga en voz alta. */
    private static String explicar(Proveedor p, int estado, String detalle) {
        String minusculas = detalle.toLowerCase(Locale.ROOT);
        if (estado == 401 || estado == 403
                || (estado == 400 && (minusculas.contains("api key not valid") || minusculas.contains("api_key_invalid")))) {
            return "La clave de " + p.visible + " no es válida o no tiene permiso. Revisala en Ajustes.";
        }
        switch (estado) {
            case 400:
                return p.visible + " rechazó el pedido" + (detalle.isEmpty() ? "." : ": " + conPunto(recortar(detalle, 160)));
            case 404:
                return p.visible + " no encuentra el modelo \"" + p.modelo + "\". Revisalo en Ajustes.";
            case 413:
                return "La conversación es demasiado larga para " + p.visible + ".";
            case 429:
                return p.visible + " se quedó sin cupo gratis por ahora.";
            default:
                if (estado >= 500) return p.visible + " está saturado o caído en este momento.";
                return p.visible + " respondió con un error (" + estado + ").";
        }
    }

    /** Saca el "message" de {error:{message}} o [{error:{message}}] (Gemini); si no, el texto crudo. */
    private static String mensajeDeError(String cuerpo) {
        String detalle = cuerpo;
        try {
            Object valor = new JSONTokener(cuerpo).nextValue();
            if (valor instanceof JSONArray) valor = ((JSONArray) valor).opt(0);
            if (valor instanceof JSONObject) {
                JSONObject json = (JSONObject) valor;
                Object error = json.opt("error");
                if (error instanceof JSONObject) detalle = cadena((JSONObject) error, "message");
                else if (error instanceof String) detalle = (String) error;
                else if (json.has("message")) detalle = cadena(json, "message");
            }
        } catch (JSONException | RuntimeException ignorada) {
        }
        return recortar(detalle.replaceAll("\\s+", " ").trim(), 300);
    }

    private static long segundosAMs(String valor) {
        if (valor == null) return 0;
        try {
            double segundos = Double.parseDouble(valor.trim());
            return segundos > 0 && segundos < 7 * 24 * 3600 ? (long) (segundos * 1000) : 0;
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    // ---------- Utilidades ----------

    /** Un texto que puede faltar o venir como null de JSON ("" en ese caso, nunca "null"). */
    private static String cadena(JSONObject o, String clave) {
        Object v = o.opt(clave);
        if (v == null || v == JSONObject.NULL) return "";
        return v instanceof String ? (String) v : v.toString();
    }

    /** content puede ser texto o, en algunos proveedores, una lista de partes [{type:"text", text}]. */
    private static String contenido(Object valor) {
        if (valor instanceof String) return (String) valor;
        if (valor instanceof JSONArray) {
            JSONArray partes = (JSONArray) valor;
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < partes.length(); i++) {
                JSONObject parte = partes.optJSONObject(i);
                if (parte != null && !parte.optBoolean("thought", false)) sb.append(cadena(parte, "text"));
            }
            return sb.toString();
        }
        return "";
    }

    private static String leerTexto(InputStream entrada, int maximo) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] bloque = new byte[8192];
        int leidos;
        while ((leidos = entrada.read(bloque)) != -1) {
            if (bytes.size() + leidos > maximo) throw new IOException("Respuesta demasiado grande");
            bytes.write(bloque, 0, leidos);
        }
        return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
    }

    private static String recortar(String texto, int maximo) {
        if (texto == null) return "";
        return texto.length() <= maximo ? texto : texto.substring(0, maximo) + "…";
    }

    private static String conPunto(String texto) {
        if (texto.isEmpty()) return texto;
        char ultimo = texto.charAt(texto.length() - 1);
        return ultimo == '.' || ultimo == '!' || ultimo == '?' || ultimo == '…' ? texto : texto + ".";
    }
}
