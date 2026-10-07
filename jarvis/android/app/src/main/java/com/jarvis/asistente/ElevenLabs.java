package com.jarvis.asistente;

import android.content.Context;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import java.util.regex.Pattern;

/**
 * Voz natural con ElevenLabs, directo desde el celular. Si no hay clave, o se terminó el cupo (401/402/429 o texto
 * "quota"/"credits"), devuelve null y descansa 30 minutos: mientras tanto habla la voz del sistema.
 * Sin Ajustes.ELEVENLABS_VOZ elige sola: voces propias en español > femenina en español > predeterminadas femeninas
 * (Sarah, Laura, Alice, Matilda, Jessica, Charlotte, Lily, Rachel) > cualquiera. Mismo criterio que la versión de PC.
 */
final class ElevenLabs {
    private ElevenLabs() {}

    private static final String TAG = "JarvisElevenLabs";
    private static final String API = "https://api.elevenlabs.io";
    private static final String[] PREDETERMINADAS_FEMENINAS = {
        "Sarah", "Laura", "Alice", "Matilda", "Jessica", "Charlotte", "Lily", "Rachel",
    };
    // Sarah (predeterminada): por si la clave tiene permisos restringidos y no deja listar las voces.
    private static final String VOZ_DE_RESPALDO = "EXAVITQu4vr4xnSDxMaL";
    private static final Pattern ESPANOL = Pattern.compile("spanish|español|latin|argentin|mexican|castilian");
    private static final Pattern SIN_CUPO = Pattern.compile("quota|credits", Pattern.CASE_INSENSITIVE);
    private static final Pattern ENLACES = Pattern.compile("https?://\\S+");
    private static final int CONEXION_MS = 15_000;
    private static final int LECTURA_MS = 30_000;
    private static final int MAX_TEXTO = 1200;
    private static final int MAX_CACHE_AUDIO = 40;
    // Además del tope de 40, un tope de memoria: un audio largo pesa más de 1 MB.
    private static final long MAX_CACHE_BYTES = 12L * 1024 * 1024;
    private static final int MAX_AUDIO = 16 * 1024 * 1024;
    private static final long PAUSA_MS = 30 * 60_000L;
    // Archivos de voz que quedan en el caché: alcanza con que no se borre el que está por sonar.
    private static final int ARCHIVOS_A_GUARDAR = 6;
    private static final String PREFIJO = "jarvis-voz-";
    // Los archivos de esta ejecución llevan esta marca; los de ejecuciones anteriores ya no los usa nadie.
    private static final String ESTA_VEZ = PREFIJO + Long.toString(System.currentTimeMillis(), 36) + "-";
    private static final AtomicLong contador = new AtomicLong();
    private static final Object archivos = new Object();
    // Elegir la voz es un pedido de red: que lo haga un solo hilo y los demás esperen el resultado.
    private static final Object eligiendo = new Object();

    // Estado compartido entre hilos, protegido por el candado de la clase.
    private static String claveActual = "";
    private static String vozAuto;
    private static long pausaHasta;
    private static long bytesEnCache;
    private static final LinkedHashMap<String, byte[]> cache = new LinkedHashMap<>(16, 0.75f, true);

    /** Se terminó el cupo o la clave no sirve: un rato se usa la voz del sistema. */
    private static final class EnPausa extends Exception {
        EnPausa() {
            super("ElevenLabs está en pausa (sin cupo o con la clave inválida); mientras tanto uso la voz del sistema.");
        }
    }

    private static final class ErrorHttp extends IOException {
        final int estado;
        final String detalle;

        ErrorHttp(int estado, String detalle) {
            super("ElevenLabs respondió con un error (HTTP " + estado + ")" + (detalle.isEmpty() ? "." : ": " + detalle));
            this.estado = estado;
            this.detalle = detalle;
        }
    }

    private static String clave(Context c) {
        return Ajustes.tiene(c, Ajustes.ELEVENLABS) ? Ajustes.texto(c, Ajustes.ELEVENLABS).replaceAll("\\s+", "") : "";
    }

    /** Si cambió la clave, lo aprendido con la anterior (voz elegida, audios, pausa) ya no vale. */
    private static void alinear(String clave) {
        synchronized (ElevenLabs.class) {
            if (clave.equals(claveActual)) return;
            claveActual = clave;
            vozAuto = null;
            pausaHasta = 0;
            cache.clear();
            bytesEnCache = 0;
        }
    }

    private static void pausar(String clave) {
        synchronized (ElevenLabs.class) {
            if (!clave.equals(claveActual)) return;
            pausaHasta = System.currentTimeMillis() + PAUSA_MS;
        }
        Log.w(TAG, "Sin cupo o clave inválida: uso la voz del sistema por 30 minutos");
    }

    /** Tiene clave y no está en pausa por falta de cupo. */
    static boolean disponible(Context c) {
        String clave = clave(c);
        if (clave.isEmpty()) return false;
        synchronized (ElevenLabs.class) {
            alinear(clave);
            return pausaHasta <= System.currentTimeMillis();
        }
    }

    /** Devuelve un mp3 en el caché de la app, o null si no se pudo (nunca lanza). */
    static File sintetizar(Context c, String texto) {
        try {
            if (clave(c).isEmpty()) return null;
            return guardarArchivo(c, sintetizarBytes(c, texto));
        } catch (EnPausa e) {
            return null;
        } catch (Exception | OutOfMemoryError e) {
            Log.w(TAG, "No pude generar la voz, uso la del sistema: " + e.getMessage());
            return null;
        }
    }

    /** Bytes del mp3 (para POST /api/hablar). */
    static byte[] sintetizarBytes(Context c, String texto) throws Exception {
        String limpio = limpiar(texto);
        if (limpio.isEmpty()) throw new IllegalArgumentException("No hay texto para decir.");
        String clave = clave(c);
        if (clave.isEmpty()) throw new IOException("Falta la clave de ElevenLabs. Pegala en Ajustes.");
        String modelo = Ajustes.texto(c, Ajustes.ELEVENLABS_MODELO);
        String vozFija = Ajustes.texto(c, Ajustes.ELEVENLABS_VOZ);
        String llave = modelo + "|" + vozFija + "|" + limpio;
        synchronized (ElevenLabs.class) {
            alinear(clave);
            byte[] guardado = cache.get(llave);
            if (guardado != null) return guardado;
            if (pausaHasta > System.currentTimeMillis()) throw new EnPausa();
        }

        String voz = elegirVoz(clave, vozFija);
        JSONObject cuerpo = new JSONObject()
                .put("text", limpio)
                .put("model_id", modelo)
                .put("voice_settings", new JSONObject()
                        .put("stability", 0.45)
                        .put("similarity_boost", 0.8)
                        .put("style", 0.15)
                        .put("use_speaker_boost", true));
        if (modelo.contains("v2_5")) cuerpo.put("language_code", "es");

        byte[] audio;
        try {
            audio = pedir(clave, "/v1/text-to-speech/" + URLEncoder.encode(voz, "UTF-8").replace("+", "%20")
                    + "?output_format=mp3_44100_128", "POST", cuerpo, "audio/mpeg");
        } catch (ErrorHttp e) {
            // Si la voz que había elegido sola ya no existe, la próxima vez elige otra.
            if (vozFija.isEmpty() && (e.estado == 404 || e.detalle.contains("voice_not_found"))) {
                synchronized (ElevenLabs.class) {
                    if (voz.equals(vozAuto)) vozAuto = null;
                }
            }
            throw e;
        }
        if (audio.length == 0) throw new IOException("ElevenLabs devolvió un audio vacío.");
        synchronized (ElevenLabs.class) {
            if (clave.equals(claveActual)) guardarEnCache(llave, audio);
        }
        return audio;
    }

    /** [{id, nombre, tipo, etiquetas}] de tu cuenta. */
    static JSONArray voces(Context c) throws Exception {
        String clave = clave(c);
        if (clave.isEmpty()) throw new IOException("Falta la clave de ElevenLabs. Pegala en Ajustes.");
        JSONArray crudas = listarVoces(clave);
        JSONArray lista = new JSONArray();
        for (int i = 0; i < crudas.length(); i++) {
            JSONObject v = crudas.optJSONObject(i);
            if (v == null || cadena(v, "voice_id").isEmpty()) continue;
            JSONObject voz = new JSONObject()
                    .put("id", cadena(v, "voice_id"))
                    .put("nombre", cadena(v, "name"));
            // put(clave, null) no agrega nada: igual que en la PC, si falta no aparece.
            voz.put("tipo", v.isNull("category") ? null : v.opt("category"));
            voz.put("etiquetas", v.optJSONObject("labels"));
            lista.put(voz);
        }
        return lista;
    }

    // ---------- Elegir la voz ----------

    private static JSONArray listarVoces(String clave) throws IOException {
        byte[] bytes = pedir(clave, "/v2/voices?page_size=100", "GET", null, "application/json");
        try {
            JSONArray voces = new JSONObject(new String(bytes, StandardCharsets.UTF_8)).optJSONArray("voices");
            return voces != null ? voces : new JSONArray();
        } catch (JSONException e) {
            throw new IOException("ElevenLabs devolvió una lista de voces que no entiendo.");
        }
    }

    private static String elegirVoz(String clave, String vozFija) throws IOException {
        if (!vozFija.isEmpty()) return vozFija;
        synchronized (eligiendo) {
            synchronized (ElevenLabs.class) {
                alinear(clave);
                if (vozAuto != null) return vozAuto;
            }
            String id;
            String nombre;
            try {
                JSONObject elegida = elegir(listarVoces(clave));
                if (elegida == null) throw new IOException("Tu cuenta de ElevenLabs no tiene voces disponibles.");
                id = cadena(elegida, "voice_id");
                nombre = cadena(elegida, "name");
            } catch (ErrorHttp e) {
                if (!sinPermisoDeVoces(e)) throw e;
                id = VOZ_DE_RESPALDO;
                nombre = "Sarah";
            }
            synchronized (ElevenLabs.class) {
                if (clave.equals(claveActual)) vozAuto = id;
            }
            Log.i(TAG, "Uso la voz \"" + nombre + "\" (" + id + "). Podés fijar otra en Ajustes.");
            return id;
        }
    }

    /** Clave restringida que puede hablar pero no listar voces. */
    private static boolean sinPermisoDeVoces(ErrorHttp e) {
        return (e.estado == 401 || e.estado == 403) && e.detalle.contains("missing_permissions");
    }

    // Prioridad: voces tuyas en español (diseñadas o clonadas) > cualquier voz femenina en español >
    // predeterminadas femeninas > cualquier femenina > la primera.
    private static JSONObject elegir(JSONArray crudas) {
        List<JSONObject> voces = new ArrayList<>();
        for (int i = 0; i < crudas.length(); i++) {
            JSONObject v = crudas.optJSONObject(i);
            if (v != null && !cadena(v, "voice_id").isEmpty()) voces.add(v);
        }
        for (JSONObject v : voces) if (propia(v) && hablaEspanol(v)) return v;
        for (JSONObject v : voces) if (femenina(v) && hablaEspanol(v)) return v;
        for (String nombre : PREDETERMINADAS_FEMENINAS) {
            for (JSONObject v : voces) if (cadena(v, "name").startsWith(nombre)) return v;
        }
        for (JSONObject v : voces) if (femenina(v)) return v;
        return voces.isEmpty() ? null : voces.get(0);
    }

    private static boolean propia(JSONObject v) {
        return !"premade".equals(cadena(v, "category"));
    }

    private static boolean femenina(JSONObject v) {
        JSONObject etiquetas = v.optJSONObject("labels");
        return etiquetas != null && "female".equals(cadena(etiquetas, "gender").toLowerCase(Locale.ROOT));
    }

    private static boolean hablaEspanol(JSONObject v) {
        JSONObject etiquetas = v.optJSONObject("labels");
        if (etiquetas != null) {
            StringBuilder todas = new StringBuilder();
            Iterator<String> claves = etiquetas.keys();
            while (claves.hasNext()) todas.append(cadena(etiquetas, claves.next())).append(' ');
            if (ESPANOL.matcher(todas.toString().toLowerCase(Locale.ROOT)).find()) return true;
        }
        JSONArray idiomas = v.optJSONArray("verified_languages");
        if (idiomas != null) {
            for (int i = 0; i < idiomas.length(); i++) {
                JSONObject idioma = idiomas.optJSONObject(i);
                if (idioma != null && cadena(idioma, "language").toLowerCase(Locale.ROOT).startsWith("es")) return true;
            }
        }
        return false;
    }

    // ---------- Caché y archivos ----------

    /** Sin enlaces (no se leen en voz alta) y con un tope de largo, sin cortar un emoji por la mitad. */
    private static String limpiar(String texto) {
        if (texto == null) return "";
        String limpio = ENLACES.matcher(texto).replaceAll("").trim();
        if (limpio.length() > MAX_TEXTO) {
            int fin = MAX_TEXTO;
            if (Character.isHighSurrogate(limpio.charAt(fin - 1))) fin--;
            limpio = limpio.substring(0, fin).trim();
        }
        return limpio;
    }

    // Se llama con el candado de la clase tomado.
    private static void guardarEnCache(String llave, byte[] audio) {
        if (audio.length > MAX_CACHE_BYTES / 4) return;
        byte[] previo = cache.put(llave, audio);
        if (previo != null) bytesEnCache -= previo.length;
        bytesEnCache += audio.length;
        Iterator<Map.Entry<String, byte[]>> viejos = cache.entrySet().iterator();
        while ((cache.size() > MAX_CACHE_AUDIO || bytesEnCache > MAX_CACHE_BYTES) && viejos.hasNext()) {
            bytesEnCache -= viejos.next().getValue().length;
            viejos.remove();
        }
    }

    /**
     * Cada audio va a un archivo nuevo, así nunca se pisa uno que se está reproduciendo; los viejos se borran
     * (el reproductor ya tiene abierto el suyo, borrarlo no lo corta).
     */
    private static File guardarArchivo(Context c, byte[] audio) throws IOException {
        File carpeta = c.getCacheDir();
        File destino = new File(carpeta, ESTA_VEZ + contador.incrementAndGet() + ".mp3");
        boolean ok = false;
        try (FileOutputStream salida = new FileOutputStream(destino)) {
            salida.write(audio);
            ok = true;
        } finally {
            if (!ok) borrar(destino);
        }
        borrarViejos(carpeta);
        return destino;
    }

    private static void borrarViejos(File carpeta) {
        synchronized (archivos) {
            File[] lista = carpeta.listFiles((d, nombre) -> nombre.startsWith(PREFIJO) && nombre.endsWith(".mp3"));
            if (lista == null) return;
            // Se ordena por el contador y no por la hora: un cambio de reloj no puede borrar el audio recién hecho.
            List<File> deEstaVez = new ArrayList<>();
            for (File f : lista) {
                if (numero(f.getName()) >= 0) deEstaVez.add(f);
                else borrar(f);
            }
            if (deEstaVez.size() <= ARCHIVOS_A_GUARDAR) return;
            deEstaVez.sort((a, b) -> Long.compare(numero(b.getName()), numero(a.getName())));
            for (int i = ARCHIVOS_A_GUARDAR; i < deEstaVez.size(); i++) borrar(deEstaVez.get(i));
        }
    }

    /** El contador de un archivo de esta ejecución, o -1 si es de otra. */
    private static long numero(String nombre) {
        if (!nombre.startsWith(ESTA_VEZ)) return -1;
        try {
            return Long.parseLong(nombre.substring(ESTA_VEZ.length(), nombre.length() - ".mp3".length()));
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    private static void borrar(File f) {
        if (!f.delete()) Log.w(TAG, "No pude borrar " + f.getName());
    }

    // ---------- HTTP ----------

    private static byte[] pedir(String clave, String ruta, String metodo, JSONObject cuerpo, String aceptar)
            throws IOException {
        HttpURLConnection con = null;
        boolean completo = false;
        try {
            con = (HttpURLConnection) new URL(API + ruta).openConnection();
            con.setConnectTimeout(CONEXION_MS);
            con.setReadTimeout(LECTURA_MS);
            con.setUseCaches(false);
            con.setRequestMethod(metodo);
            con.setRequestProperty("xi-api-key", clave);
            con.setRequestProperty("Accept", aceptar);
            if (cuerpo != null) {
                byte[] bytes = cuerpo.toString().getBytes(StandardCharsets.UTF_8);
                con.setDoOutput(true);
                con.setFixedLengthStreamingMode(bytes.length);
                con.setRequestProperty("Content-Type", "application/json");
                try (OutputStream salida = con.getOutputStream()) {
                    salida.write(bytes);
                }
            }
            int estado = con.getResponseCode();
            if (estado < 200 || estado >= 300) {
                String detalle = "";
                try (InputStream error = con.getErrorStream()) {
                    if (error != null) detalle = new String(leer(error, 16 * 1024), StandardCharsets.UTF_8);
                } catch (IOException ignorada) {
                }
                detalle = detalle.replaceAll("\\s+", " ").trim();
                if (detalle.length() > 300) detalle = detalle.substring(0, 300);
                ErrorHttp error = new ErrorHttp(estado, detalle);
                // Sin cupo o clave inválida: se descansa media hora y mientras tanto habla la voz del sistema.
                boolean sinCupo = estado == 401 || estado == 402 || estado == 429 || SIN_CUPO.matcher(detalle).find();
                if (sinCupo && !(ruta.startsWith("/v2/voices") && sinPermisoDeVoces(error))) pausar(clave);
                throw error;
            }
            byte[] respuesta;
            try (InputStream entrada = con.getInputStream()) {
                respuesta = leer(entrada, MAX_AUDIO);
            }
            completo = true;
            return respuesta;
        } catch (ErrorHttp e) {
            throw e;
        } catch (SocketTimeoutException e) {
            throw new IOException("ElevenLabs tardó demasiado en responder.", e);
        } catch (IOException e) {
            throw new IOException("No pude conectarme con ElevenLabs. Fijate si hay internet.", e);
        } finally {
            if (con != null && !completo) con.disconnect();
        }
    }

    private static byte[] leer(InputStream entrada, int maximo) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] bloque = new byte[16 * 1024];
        int leidos;
        while ((leidos = entrada.read(bloque)) != -1) {
            if (bytes.size() + leidos > maximo) throw new IOException("Respuesta demasiado grande");
            bytes.write(bloque, 0, leidos);
        }
        return bytes.toByteArray();
    }

    /** Un texto que puede faltar o venir como null de JSON ("" en ese caso, nunca "null"). */
    private static String cadena(JSONObject o, String clave) {
        Object v = o.opt(clave);
        if (v == null || v == JSONObject.NULL) return "";
        return v instanceof String ? (String) v : v.toString();
    }
}
