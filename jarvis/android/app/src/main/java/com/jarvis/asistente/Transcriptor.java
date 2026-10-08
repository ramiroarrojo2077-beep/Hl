package com.jarvis.asistente;

import android.content.Context;
import android.util.Base64;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Locale;

/**
 * Audio a texto: Whisper en Groq (whisper-large-v3-turbo, language=es, sin prompt) y, si no hay clave o falla,
 * Gemini (generateContent con inline_data, modelo de Ajustes.GEMINI_MODELO). Lo usa el detector de la palabra "Jarvis"
 * cuando no hay AccessKey de Picovoice.
 */
final class Transcriptor {
    private Transcriptor() {}

    private static final String TAG = "JarvisTranscriptor";
    private static final String URL_GROQ = "https://api.groq.com/openai/v1/audio/transcriptions";
    private static final String URL_GEMINI = "https://generativelanguage.googleapis.com/v1beta/models/";
    private static final int CONEXION_MS = 15_000;
    private static final int LECTURA_MS = 60_000;
    // Groq acepta hasta 25 MB y Gemini 20 MB por pedido (con el base64 incluido): de sobra para frases habladas.
    private static final int MAX_AUDIO = 14 * 1024 * 1024;
    private static final int MAX_RESPUESTA = 2 * 1024 * 1024;
    private static final String INSTRUCCION = "Transcribí exactamente lo que se dice en este audio, en el idioma original. "
            + "La asistente se llama \"Jarvis\". Respondé solo con la transcripción, sin comillas ni comentarios. "
            + "Si no se entiende nada o no habla nadie, respondé vacío.";
    // Para la palabra clave no se nombra a Jarvis: así no la "oye" donde no está.
    private static final String INSTRUCCION_PASIVA = "Transcribí exactamente lo que se dice en este audio, en el idioma original. "
            + "Respondé solo con la transcripción, sin comillas ni comentarios. Si no habla nadie o no se entiende, respondé vacío.";
    private static final SecureRandom azar = new SecureRandom();

    static boolean disponible(Context c) {
        return Ajustes.tiene(c, Ajustes.GROQ) || Ajustes.tiene(c, Ajustes.GEMINI);
    }

    /** @param tipo MIME, por ejemplo "audio/wav". Devuelve "" si no se entendió nada. */
    static String transcribir(Context c, byte[] audio, String tipo) throws Exception {
        return transcribir(c, audio, tipo, false);
    }

    /**
     * Para detectar la palabra "Jarvis" en segundo plano: sin pistas (Whisper tiende a "oír" la pista cuando el audio no
     * es claro) y descartando los pedazos que Whisper marca como dudosos o sin voz.
     */
    static String transcribirPasivo(Context c, byte[] wav) throws Exception {
        return transcribir(c, wav, "audio/wav", true);
    }

    private static String transcribir(Context c, byte[] audio, String tipo, boolean pasivo) throws Exception {
        if (audio == null || audio.length == 0) return "";
        if (audio.length > MAX_AUDIO) throw new IOException("El audio es demasiado largo para transcribirlo.");
        String mime = tipo == null ? "" : tipo;
        int puntoYComa = mime.indexOf(';');
        if (puntoYComa >= 0) mime = mime.substring(0, puntoYComa);
        mime = mime.trim().toLowerCase(Locale.ROOT);
        if (mime.isEmpty()) mime = "audio/webm";

        boolean hayGemini = Ajustes.tiene(c, Ajustes.GEMINI);
        if (Ajustes.tiene(c, Ajustes.GROQ)) {
            try {
                return conGroq(clave(c, Ajustes.GROQ), audio, mime, pasivo);
            } catch (Exception e) {
                if (!hayGemini) throw e;
                Log.w(TAG, "Groq falló, pruebo con Gemini: " + e.getMessage());
            }
        }
        if (hayGemini) return conGemini(clave(c, Ajustes.GEMINI), Ajustes.texto(c, Ajustes.GEMINI_MODELO), audio, mime, pasivo);
        throw new IOException("Para entender audio hace falta la clave gratis de Groq o de Gemini. Pegala en Ajustes.");
    }

    private static String clave(Context c, String cual) {
        return Ajustes.texto(c, cual).replaceAll("\\s+", "");
    }

    private static String extension(String mime) {
        if (mime.contains("ogg")) return "ogg";
        if (mime.contains("mp4") || mime.contains("m4a") || mime.contains("aac")) return "m4a";
        if (mime.contains("mpeg") || mime.contains("mp3")) return "mp3";
        if (mime.contains("wav")) return "wav";
        return "webm";
    }

    // ---------- Whisper en Groq ----------

    private static String conGroq(String clave, byte[] audio, String mime, boolean pasivo) throws IOException {
        byte[] semilla = new byte[12];
        azar.nextBytes(semilla);
        StringBuilder limite = new StringBuilder("----JarvisLimite");
        for (byte b : semilla) limite.append(String.format(Locale.ROOT, "%02x", b));

        ByteArrayOutputStream cuerpo = new ByteArrayOutputStream(audio.length + 1024);
        escribir(cuerpo, "--" + limite + "\r\n"
                + "Content-Disposition: form-data; name=\"file\"; filename=\"audio." + extension(mime) + "\"\r\n"
                + "Content-Type: " + mime + "\r\n\r\n");
        cuerpo.write(audio);
        escribir(cuerpo, "\r\n");
        campo(cuerpo, limite, "model", "whisper-large-v3-turbo");
        campo(cuerpo, limite, "language", "es");
        // Sin "prompt": con una pista, Whisper a veces la devuelve tal cual cuando no entiende el audio (y cualquier ruido
        // terminaba pareciendo "Jarvis"). En modo pasivo pide los detalles para descartar lo dudoso.
        campo(cuerpo, limite, "response_format", pasivo ? "verbose_json" : "json");
        campo(cuerpo, limite, "temperature", "0");
        escribir(cuerpo, "--" + limite + "--\r\n");

        String respuesta = enviar("Groq", URL_GROQ, cuerpo.toByteArray(),
                "multipart/form-data; boundary=" + limite, "Authorization", "Bearer " + clave);
        try {
            JSONObject json = new JSONObject(respuesta);
            JSONArray segmentos = pasivo ? json.optJSONArray("segments") : null;
            if (segmentos == null) return json.isNull("text") ? "" : json.optString("text", "").trim();
            StringBuilder texto = new StringBuilder();
            for (int i = 0; i < segmentos.length(); i++) {
                JSONObject s = segmentos.optJSONObject(i);
                if (s == null || dudoso(s)) continue;
                texto.append(s.optString("text", ""));
            }
            return texto.toString().trim();
        } catch (JSONException e) {
            throw new IOException("Groq devolvió una transcripción que no entiendo.");
        }
    }

    /**
     * Un pedazo que Whisper mismo descartaría: probablemente sin voz y con poca confianza, o texto repetitivo (la regla
     * de openai/whisper; con una sola palabra corta la confianza puede ser baja aunque se haya dicho bien).
     */
    static boolean dudoso(JSONObject segmento) {
        double sinVoz = segmento.optDouble("no_speech_prob", 0);
        double confianza = segmento.optDouble("avg_logprob", 0);
        double compresion = segmento.optDouble("compression_ratio", 1);
        Log.d(TAG, "segmento: sinVoz=" + sinVoz + " confianza=" + confianza + " compresion=" + compresion);
        return (sinVoz > 0.6 && confianza < -1.0) || compresion > 2.4;
    }

    private static void campo(ByteArrayOutputStream cuerpo, CharSequence limite, String nombre, String valor) {
        escribir(cuerpo, "--" + limite + "\r\n"
                + "Content-Disposition: form-data; name=\"" + nombre + "\"\r\n\r\n"
                + valor + "\r\n");
    }

    private static void escribir(ByteArrayOutputStream cuerpo, String texto) {
        byte[] bytes = texto.getBytes(StandardCharsets.UTF_8);
        cuerpo.write(bytes, 0, bytes.length);
    }

    // ---------- Gemini ----------

    private static String conGemini(String clave, String modelo, byte[] audio, String mime, boolean pasivo) throws IOException {
        if (modelo.startsWith("models/")) modelo = modelo.substring("models/".length());
        byte[] cuerpo;
        try {
            JSONObject datos = new JSONObject()
                    .put("mime_type", mime)
                    .put("data", Base64.encodeToString(audio, Base64.NO_WRAP));
            JSONArray partes = new JSONArray()
                    .put(new JSONObject().put("inline_data", datos))
                    .put(new JSONObject().put("text", pasivo ? INSTRUCCION_PASIVA : INSTRUCCION));
            JSONObject pedido = new JSONObject()
                    .put("contents", new JSONArray().put(new JSONObject().put("parts", partes)));
            cuerpo = pedido.toString().getBytes(StandardCharsets.UTF_8);
        } catch (JSONException e) {
            throw new IOException("No pude armar el pedido para Gemini.");
        }

        String url = URL_GEMINI + URLEncoder.encode(modelo, "UTF-8").replace("+", "%20") + ":generateContent";
        String respuesta = enviar("Gemini", url, cuerpo, "application/json", "x-goog-api-key", clave);
        try {
            JSONObject json = new JSONObject(respuesta);
            JSONArray candidatos = json.optJSONArray("candidates");
            JSONObject candidato = candidatos != null ? candidatos.optJSONObject(0) : null;
            JSONObject contenido = candidato != null ? candidato.optJSONObject("content") : null;
            JSONArray partesRespuesta = contenido != null ? contenido.optJSONArray("parts") : null;
            if (partesRespuesta == null) return "";
            StringBuilder texto = new StringBuilder();
            for (int i = 0; i < partesRespuesta.length(); i++) {
                JSONObject parte = partesRespuesta.optJSONObject(i);
                // Las partes con "thought": true son lo que pensó el modelo, no la transcripción.
                if (parte == null || parte.optBoolean("thought", false) || parte.isNull("text")) continue;
                texto.append(parte.optString("text", ""));
            }
            return texto.toString().trim();
        } catch (JSONException e) {
            throw new IOException("Gemini devolvió una transcripción que no entiendo.");
        }
    }

    // ---------- HTTP ----------

    /** El servicio contestó con un error (no es un problema de conexión). */
    private static final class FalloHttp extends IOException {
        FalloHttp(String mensaje) {
            super(mensaje);
        }
    }

    private static String enviar(String quien, String url, byte[] cuerpo, String tipo, String encabezado, String valor)
            throws IOException {
        HttpURLConnection con = null;
        boolean completo = false;
        try {
            con = (HttpURLConnection) new URL(url).openConnection();
            con.setConnectTimeout(CONEXION_MS);
            con.setReadTimeout(LECTURA_MS);
            con.setUseCaches(false);
            con.setRequestMethod("POST");
            con.setDoOutput(true);
            con.setFixedLengthStreamingMode(cuerpo.length);
            con.setRequestProperty("Content-Type", tipo);
            con.setRequestProperty("Accept", "application/json");
            con.setRequestProperty(encabezado, valor);
            try (OutputStream salida = con.getOutputStream()) {
                salida.write(cuerpo);
            }
            int estado = con.getResponseCode();
            if (estado < 200 || estado >= 300) {
                String detalle = "";
                try (InputStream error = con.getErrorStream()) {
                    if (error != null) detalle = leer(error, 16 * 1024);
                } catch (IOException ignorada) {
                }
                detalle = detalle.replaceAll("\\s+", " ").trim();
                if (detalle.length() > 200) detalle = detalle.substring(0, 200) + "…";
                throw new FalloHttp(quien + " no pudo pasar el audio a texto (HTTP " + estado + ")"
                        + (detalle.isEmpty() ? "." : ": " + detalle));
            }
            String respuesta;
            try (InputStream entrada = con.getInputStream()) {
                respuesta = leer(entrada, MAX_RESPUESTA);
            }
            completo = true;
            return respuesta;
        } catch (FalloHttp e) {
            throw e;
        } catch (SocketTimeoutException e) {
            throw new IOException(quien + " tardó demasiado en transcribir.", e);
        } catch (IOException e) {
            throw new IOException("No pude conectarme con " + quien + " para transcribir. Fijate si hay internet.", e);
        } finally {
            if (con != null && !completo) con.disconnect();
        }
    }

    private static String leer(InputStream entrada, int maximo) throws IOException {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] bloque = new byte[8192];
        int leidos;
        while ((leidos = entrada.read(bloque)) != -1) {
            if (bytes.size() + leidos > maximo) throw new IOException("Respuesta demasiado grande");
            bytes.write(bloque, 0, leidos);
        }
        return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
    }
}
