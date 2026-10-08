package com.jarvis.asistente;

import android.content.Context;
import android.util.Base64;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.UUID;

import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * Voces neuronales en la nube, para que Jarvis no suene a Google:
 * - Microsoft Edge (gratis, sin clave): "es-AR-ElenaNeural" (argentina), "es-AR-TomasNeural", "es-MX-DaliaNeural"…
 *   Usa el mismo servicio que el "Leer en voz alta" de Edge (protocolo del proyecto edge-tts 7.2.8).
 * - Gemini TTS (con tu clave de Gemini; el cupo gratis es chico).
 * Devuelven un archivo de audio en el caché o null si no se pudo (nunca lanzan).
 */
final class VozNube {
    private VozNube() {}

    private static final String TAG = "JarvisVozNube";
    private static final String HOST = "speech.platform.bing.com";
    private static final String TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
    private static final String VERSION_CHROMIUM = "143.0.3650.75";
    private static final long EPOCA_WINDOWS = 11644473600L;
    private static volatile double desfaseReloj = 0;
    private static int contador;

    private static synchronized File archivo(Context c, String extension) {
        File carpeta = new File(c.getCacheDir(), "voz");
        if (!carpeta.exists()) carpeta.mkdirs();
        // Rota entre unos pocos archivos para no pisar el que está sonando.
        return new File(carpeta, "nube" + (contador++ % 4) + "." + extension);
    }

    private static String escaparXml(String texto) {
        return texto.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("'", "&apos;").replace("\"", "&quot;");
    }

    // ---------- Microsoft Edge ----------

    private static String tokenGec() throws Exception {
        double segundos = System.currentTimeMillis() / 1000.0 + desfaseReloj + EPOCA_WINDOWS;
        segundos -= segundos % 300;
        String aHashear = String.format(Locale.US, "%.0f", segundos * 1e7) + TOKEN;
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(aHashear.getBytes(StandardCharsets.US_ASCII));
        StringBuilder sb = new StringBuilder();
        for (byte b : hash) sb.append(String.format("%02X", b));
        return sb.toString();
    }

    private static String fechaJs() {
        SimpleDateFormat f = new SimpleDateFormat("EEE MMM dd yyyy HH:mm:ss 'GMT+0000 (Coordinated Universal Time)'", Locale.US);
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(new Date());
    }

    /** @param voz por ejemplo "es-AR-ElenaNeural". @param velocidad por ejemplo "+8%". */
    static File edge(Context c, String texto, String voz, String velocidad) {
        for (int intento = 0; intento < 2; intento++) {
            try {
                byte[] mp3 = edgeBytes(texto, voz, velocidad);
                if (mp3 == null || mp3.length < 512) return null;
                File f = archivo(c, "mp3");
                try (FileOutputStream salida = new FileOutputStream(f)) {
                    salida.write(mp3);
                }
                return f;
            } catch (RelojCorrido e) {
                // El servicio rechaza si el reloj del celular está corrido: se ajusta con la hora del servidor y se reintenta.
                desfaseReloj += e.desfase;
            } catch (Exception e) {
                Log.w(TAG, "Voz de Edge no disponible: " + e.getMessage());
                return null;
            }
        }
        return null;
    }

    private static final class RelojCorrido extends Exception {
        final double desfase;
        RelojCorrido(double desfase) {
            super("reloj corrido");
            this.desfase = desfase;
        }
    }

    private static byte[] edgeBytes(String texto, String voz, String velocidad) throws Exception {
        String ruta = "/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=" + TOKEN
                + "&ConnectionId=" + UUID.randomUUID().toString().replace("-", "")
                + "&Sec-MS-GEC=" + tokenGec() + "&Sec-MS-GEC-Version=1-" + VERSION_CHROMIUM;
        String mayor = VERSION_CHROMIUM.split("\\.")[0];
        byte[] clave = new byte[16];
        new SecureRandom().nextBytes(clave);
        byte[] muid = new byte[16];
        new SecureRandom().nextBytes(muid);
        StringBuilder m = new StringBuilder();
        for (byte b : muid) m.append(String.format("%02X", b));

        Socket crudo = new Socket();
        crudo.connect(new InetSocketAddress(HOST, 443), 8000);
        SSLSocket socket = (SSLSocket) ((SSLSocketFactory) SSLSocketFactory.getDefault()).createSocket(crudo, HOST, 443, true);
        try {
            socket.setSoTimeout(15000);
            socket.startHandshake();
            OutputStream out = socket.getOutputStream();
            InputStream in = new BufferedInputStream(socket.getInputStream());
            String pedido = "GET " + ruta + " HTTP/1.1\r\n"
                    + "Host: " + HOST + "\r\n"
                    + "Upgrade: websocket\r\nConnection: Upgrade\r\n"
                    + "Sec-WebSocket-Key: " + Base64.encodeToString(clave, Base64.NO_WRAP) + "\r\n"
                    + "Sec-WebSocket-Version: 13\r\n"
                    + "Pragma: no-cache\r\nCache-Control: no-cache\r\n"
                    + "Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold\r\n"
                    + "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/"
                    + mayor + ".0.0.0 Safari/537.36 Edg/" + mayor + ".0.0.0\r\n"
                    + "Accept-Language: en-US,en;q=0.9\r\n"
                    + "Cookie: muid=" + m + ";\r\n\r\n";
            out.write(pedido.getBytes(StandardCharsets.UTF_8));
            out.flush();

            String estado = leerLinea(in);
            String fechaServidor = null;
            String linea;
            while ((linea = leerLinea(in)) != null && !linea.isEmpty()) {
                if (linea.toLowerCase(Locale.ROOT).startsWith("date:")) fechaServidor = linea.substring(5).trim();
            }
            if (estado == null || !estado.contains(" 101")) {
                if (estado != null && estado.contains(" 403") && fechaServidor != null) {
                    SimpleDateFormat f = new SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss zzz", Locale.US);
                    Date servidor = f.parse(fechaServidor);
                    if (servidor != null) {
                        double desfase = (servidor.getTime() - System.currentTimeMillis()) / 1000.0;
                        if (Math.abs(desfase) > 60) throw new RelojCorrido(desfase);
                    }
                }
                throw new IOException("El servicio de voz respondió: " + estado);
            }

            String fecha = fechaJs();
            enviarTexto(out, "X-Timestamp:" + fecha + "\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n"
                    + "{\"context\":{\"synthesis\":{\"audio\":{\"metadataoptions\":{\"sentenceBoundaryEnabled\":\"false\","
                    + "\"wordBoundaryEnabled\":\"false\"},\"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}\r\n");
            String ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='" + voz + "'>"
                    + "<prosody pitch='+0Hz' rate='" + velocidad + "' volume='+0%'>" + escaparXml(texto) + "</prosody></voice></speak>";
            enviarTexto(out, "X-RequestId:" + UUID.randomUUID().toString().replace("-", "") + "\r\nContent-Type:application/ssml+xml\r\n"
                    + "X-Timestamp:" + fecha + "Z\r\nPath:ssml\r\n\r\n" + ssml);

            ByteArrayOutputStream audio = new ByteArrayOutputStream();
            DataInputStream datos = new DataInputStream(in);
            ByteArrayOutputStream mensaje = new ByteArrayOutputStream();
            int tipoMensaje = 0;
            while (true) {
                int b0 = datos.readUnsignedByte();
                int b1 = datos.readUnsignedByte();
                boolean fin = (b0 & 0x80) != 0;
                int opcode = b0 & 0x0F;
                long largo = b1 & 0x7F;
                if (largo == 126) largo = datos.readUnsignedShort();
                else if (largo == 127) largo = datos.readLong();
                if ((b1 & 0x80) != 0) datos.readFully(new byte[4]);
                byte[] carga = new byte[(int) largo];
                datos.readFully(carga);
                if (opcode == 8) break;
                if (opcode == 9) {
                    enviarMarco(out, 0xA, carga);
                    continue;
                }
                if (opcode == 1 || opcode == 2) {
                    tipoMensaje = opcode;
                    mensaje.reset();
                }
                if (opcode == 0 || opcode == 1 || opcode == 2) mensaje.write(carga);
                if (!fin) continue;
                byte[] completo = mensaje.toByteArray();
                if (tipoMensaje == 1) {
                    String t = new String(completo, StandardCharsets.UTF_8);
                    if (t.contains("Path:turn.end")) break;
                } else if (tipoMensaje == 2 && completo.length >= 2) {
                    int cabecera = ((completo[0] & 0xFF) << 8) | (completo[1] & 0xFF);
                    if (cabecera + 2 <= completo.length) {
                        String encabezados = new String(completo, 2, cabecera, StandardCharsets.UTF_8);
                        if (encabezados.contains("Path:audio")) audio.write(completo, cabecera + 2, completo.length - cabecera - 2);
                    }
                }
            }
            return audio.toByteArray();
        } finally {
            try {
                socket.close();
            } catch (IOException ignorada) {
            }
        }
    }

    private static String leerLinea(InputStream in) throws IOException {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int x;
        while ((x = in.read()) != -1) {
            if (x == '\n') break;
            if (x != '\r') b.write(x);
        }
        if (x == -1 && b.size() == 0) return null;
        return b.toString("UTF-8");
    }

    private static void enviarTexto(OutputStream out, String texto) throws IOException {
        enviarMarco(out, 0x1, texto.getBytes(StandardCharsets.UTF_8));
    }

    // Los marcos que manda el cliente van enmascarados (RFC 6455).
    private static void enviarMarco(OutputStream out, int opcode, byte[] carga) throws IOException {
        ByteArrayOutputStream marco = new ByteArrayOutputStream();
        marco.write(0x80 | opcode);
        if (carga.length < 126) {
            marco.write(0x80 | carga.length);
        } else if (carga.length < 65536) {
            marco.write(0x80 | 126);
            marco.write(carga.length >> 8);
            marco.write(carga.length & 0xFF);
        } else {
            marco.write(0x80 | 127);
            marco.write(ByteBuffer.allocate(8).putLong(carga.length).array());
        }
        byte[] mascara = new byte[4];
        new SecureRandom().nextBytes(mascara);
        marco.write(mascara);
        for (int i = 0; i < carga.length; i++) marco.write(carga[i] ^ mascara[i % 4]);
        out.write(marco.toByteArray());
        out.flush();
    }

    // ---------- Gemini TTS ----------

    private static final String[] MODELOS_GEMINI = {"gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"};

    /** @param voz voz de Gemini, por ejemplo "Kore", "Aoede" o "Leda". */
    static File gemini(Context c, String texto, String voz) {
        String clave = Ajustes.texto(c, Ajustes.GEMINI).replaceAll("\\s+", "");
        if (clave.isEmpty()) return null;
        for (String modelo : MODELOS_GEMINI) {
            HttpURLConnection con = null;
            try {
                con = (HttpURLConnection) new URL("https://generativelanguage.googleapis.com/v1beta/models/" + modelo + ":generateContent").openConnection();
                con.setRequestMethod("POST");
                con.setConnectTimeout(10000);
                con.setReadTimeout(30000);
                con.setDoOutput(true);
                con.setRequestProperty("Content-Type", "application/json");
                con.setRequestProperty("x-goog-api-key", clave);
                JSONObject cuerpo = new JSONObject()
                        .put("contents", new JSONArray().put(new JSONObject().put("parts", new JSONArray().put(new JSONObject()
                                .put("text", "Decí en español rioplatense, con voz cálida, segura y natural: " + texto)))))
                        .put("generationConfig", new JSONObject()
                                .put("responseModalities", new JSONArray().put("AUDIO"))
                                .put("speechConfig", new JSONObject().put("voiceConfig", new JSONObject()
                                        .put("prebuiltVoiceConfig", new JSONObject().put("voiceName", voz)))));
                try (OutputStream salida = con.getOutputStream()) {
                    salida.write(cuerpo.toString().getBytes(StandardCharsets.UTF_8));
                }
                if (con.getResponseCode() != 200) continue;
                ByteArrayOutputStream b = new ByteArrayOutputStream();
                try (InputStream in = con.getInputStream()) {
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
                }
                JSONObject r = new JSONObject(b.toString("UTF-8"));
                JSONArray partes = r.getJSONArray("candidates").getJSONObject(0).getJSONObject("content").getJSONArray("parts");
                for (int i = 0; i < partes.length(); i++) {
                    JSONObject datos = partes.getJSONObject(i).optJSONObject("inlineData");
                    if (datos == null) continue;
                    byte[] pcm = Base64.decode(datos.getString("data"), Base64.DEFAULT);
                    int frecuencia = 24000;
                    String tipo = datos.optString("mimeType");
                    int rate = tipo.indexOf("rate=");
                    if (rate >= 0) {
                        try {
                            frecuencia = Integer.parseInt(tipo.substring(rate + 5).replaceAll("\\D.*", ""));
                        } catch (NumberFormatException ignorada) {
                        }
                    }
                    File f = archivo(c, "wav");
                    try (FileOutputStream salida = new FileOutputStream(f)) {
                        salida.write(cabeceraWav(pcm.length, frecuencia));
                        salida.write(pcm);
                    }
                    return f;
                }
            } catch (Exception e) {
                Log.w(TAG, "Voz de Gemini no disponible (" + modelo + "): " + e.getMessage());
            } finally {
                if (con != null) con.disconnect();
            }
        }
        return null;
    }

    private static byte[] cabeceraWav(int bytes, int frecuencia) {
        ByteBuffer b = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + bytes).put("WAVE".getBytes(StandardCharsets.US_ASCII));
        b.put("fmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short) 1).putShort((short) 1);
        b.putInt(frecuencia).putInt(frecuencia * 2).putShort((short) 2).putShort((short) 16);
        b.put("data".getBytes(StandardCharsets.US_ASCII)).putInt(bytes);
        return b.array();
    }
}
