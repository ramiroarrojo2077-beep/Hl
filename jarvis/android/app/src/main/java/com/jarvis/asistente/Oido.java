package com.jarvis.asistente;

import android.annotation.SuppressLint;
import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;


import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import ai.picovoice.porcupine.Porcupine;
import ai.picovoice.porcupine.PorcupineException;
import ai.picovoice.porcupine.PorcupineManager;

/**
 * Escucha en segundo plano hasta que digas "Jarvis".
 *
 * Con una AccessKey de Picovoice (gratis para uso personal) usa Porcupine: detecta la palabra en el
 * celular, sin internet y gastando muy poca batería. Sin clave, detecta cuándo hablás y transcribe ese pedacito
 * (Whisper en Groq, gratis) para buscar la palabra.
 */
final class Oido {
    interface Oyente {
        /** @param orden lo que dijiste después de "Jarvis" en la misma frase, o null si solo la llamaste. */
        void palabraClave(String orden);
    }

    private static final String TAG = "JarvisOido";
    private static final int FRECUENCIA = 16000;
    private static final int MUESTRAS_BLOQUE = 480; // 30 ms
    private static final int MAX_PASIVAS_POR_MINUTO = 8;
    private static final int MAX_CORTAS_POR_MINUTO = 20;
    // Solo cuenta si una oración EMPIEZA con "Jarvis" (o "che/hola/ey Jarvis"): nombrarla de pasada no la abre. Se
    // aplica sobre el texto sin tildes ni mayúsculas.
    static final String NOMBRES = "jarvis|yarvis|jarbis|yarbis|charvis|sharvis|llarvis|jervis|yervis|harvis|garvis|jarviz|"
            + "yarviz|javis|jarvi|yarvi|charvi|jarbi|jervi";
    private static final Pattern PALABRA_CLAVE = Pattern.compile(
            "(?:^|[.!?…]\\s*)[\\s\\p{Punct}¡¿…«»\"'\\u00a0]*"
                    + "(?:(?:che|ey|eh|ehh|hey|hola|buenas|oye|oi|ok|okay|okey|bueno|dale|a ver|ah)[\\s\\p{Punct}¡¿…«»\\u00a0]+){0,2}"
                    + "(" + NOMBRES + ")\\b");
    private static final Pattern SOLO_NOMBRES = Pattern.compile(
            "(?:[\\s\\p{Punct}¡¿…«»\\u00a0]*(?:" + NOMBRES + ")\\b)*[\\s\\p{Punct}¡¿…«»\\u00a0]*");

    static String sinTildes(String texto) {
        return java.text.Normalizer.normalize(texto, java.text.Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase(java.util.Locale.ROOT);
    }

    private static final Pattern ALUCINACIONES = Pattern.compile(
            "amara\\.org|gracias por ver|suscr[ií]b|subt[ií]tulos", Pattern.CASE_INSENSITIVE);

    private final Context contexto;
    private final Oyente oyente;
    private final Handler principal = new Handler(Looper.getMainLooper());
    private final ExecutorService red = Executors.newSingleThreadExecutor();
    private PorcupineManager porcupine;
    private Thread hiloGrabacion;
    private volatile boolean activo;
    private volatile boolean ocupado;
    private final ArrayDeque<Long> pasivas = new ArrayDeque<>();
    private final ArrayDeque<Long> cortas = new ArrayDeque<>();
    // Si Groq dice que se acabó el cupo (429), descansa un rato en vez de seguir gastando pedidos.
    private volatile long sinCupoHasta;

    Oido(Context c, Oyente o) {
        contexto = c.getApplicationContext();
        oyente = o;
    }

    boolean activo() {
        return activo;
    }

    void iniciar() {
        if (activo) return;
        activo = true;
        String clave = Ajustes.texto(contexto, Ajustes.PICOVOICE);
        if (!clave.isEmpty() && iniciarPorcupine(clave)) return;
        iniciarDetectorDeVoz();
    }

    void detener() {
        activo = false;
        if (porcupine != null) {
            try {
                porcupine.stop();
            } catch (PorcupineException ignorada) {
            }
            porcupine.delete();
            porcupine = null;
        }
        if (hiloGrabacion != null) {
            hiloGrabacion.interrupt();
            // Espera a que suelte el micrófono antes de que otro lo use.
            try {
                hiloGrabacion.join(400);
            } catch (InterruptedException ignorada) {
                Thread.currentThread().interrupt();
            }
            hiloGrabacion = null;
        }
    }

    // ---------- Porcupine ----------

    private boolean iniciarPorcupine(String clave) {
        try {
            porcupine = new PorcupineManager.Builder()
                    .setAccessKey(clave)
                    .setKeyword(Porcupine.BuiltInKeyword.JARVIS)
                    .setSensitivity(0.5f)
                    .setErrorCallback(e -> Log.w(TAG, "Porcupine: " + e.getMessage()))
                    .build(contexto, indice -> principal.post(() -> avisar(null)));
            porcupine.start();
            Log.i(TAG, "Escuchando \"Jarvis\" con Porcupine");
            return true;
        } catch (PorcupineException e) {
            Log.w(TAG, "No pude iniciar Porcupine (¿AccessKey inválida?), uso el detector de voz: " + e.getMessage());
            if (porcupine != null) porcupine.delete();
            porcupine = null;
            return false;
        }
    }

    // ---------- Detector de voz + transcripción en el servidor ----------

    @SuppressLint("MissingPermission")
    private void iniciarDetectorDeVoz() {
        hiloGrabacion = new Thread(() -> {
            int minimo = AudioRecord.getMinBufferSize(FRECUENCIA, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            AudioRecord grabadora;
            try {
                grabadora = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, FRECUENCIA,
                        AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minimo, MUESTRAS_BLOQUE * 8));
            } catch (Exception e) {
                Log.w(TAG, "Sin acceso al micrófono: " + e.getMessage());
                return;
            }
            if (grabadora.getState() != AudioRecord.STATE_INITIALIZED) {
                grabadora.release();
                return;
            }
            grabadora.startRecording();
            Log.i(TAG, "Escuchando \"Jarvis\" con el detector de voz");
            short[] bloque = new short[MUESTRAS_BLOQUE];
            ArrayDeque<short[]> previo = new ArrayDeque<>();
            List<short[]> segmento = null;
            double ruido = 0.006;
            double voz = 0;
            double hablado = 0;
            double silencio = 0;
            final double duracion = (double) MUESTRAS_BLOQUE / FRECUENCIA;
            try {
                while (!Thread.currentThread().isInterrupted()) {
                    int leidas = grabadora.read(bloque, 0, bloque.length);
                    if (leidas <= 0) continue;
                    short[] copia = java.util.Arrays.copyOf(bloque, leidas);
                    // Mientras Jarvis habla o se está transcribiendo, no escucha (para no oírse a sí misma).
                    if (ocupado || Voz.de(contexto).estaHablando()) {
                        segmento = null;
                        previo.clear();
                        voz = 0;
                        continue;
                    }
                    double suma = 0;
                    for (int i = 0; i < leidas; i++) {
                        double x = copia[i] / 32768.0;
                        suma += x * x;
                    }
                    double rms = Math.sqrt(suma / leidas);
                    double umbral = Math.max(0.012, ruido * 3.2);
                    if (segmento == null) {
                        previo.addLast(copia);
                        while (previo.size() * duracion > 0.45) previo.removeFirst();
                        if (rms > umbral) {
                            voz += duracion;
                            if (voz >= 0.09) {
                                segmento = new ArrayList<>(previo);
                                hablado = voz;
                                silencio = 0;
                            }
                        } else {
                            voz = 0;
                            ruido = ruido * 0.97 + rms * 0.03;
                        }
                    } else {
                        segmento.add(copia);
                        if (rms > umbral * 0.8) {
                            hablado += duracion;
                            silencio = 0;
                        } else {
                            silencio += duracion;
                        }
                        // Para la palabra clave alcanza con frases cortas.
                        // Un poco más de un segundo: si decís "Jarvis, poné…" con una pausa corta, no te corta la orden.
                        if (silencio > 1.0 || segmento.size() * duracion > 10) {
                            // Un "Jarvis" rápido o de lejos tiene poca voz fuerte: con 0,2 s alcanza (Whisper filtra el ruido).
                            if (hablado >= 0.2) {
                                // Los cortos ("Jarvis", "Jarvis, poné música") pasan siempre; el tope es para la charla o la tele.
                                boolean largo = segmento.size() * duracion > 3.5;
                                if (Transcriptor.disponible(contexto) && puedeTranscribir(largo)) enviar(segmento);
                                else if (largo) ruido *= 1.5;
                            }
                            segmento = null;
                            voz = 0;
                        }
                    }
                }
            } finally {
                grabadora.stop();
                grabadora.release();
            }
        }, "jarvis-oido");
        hiloGrabacion.start();
    }

    // Si hay mucho ruido (tele, música), se pone menos sensible en vez de gastar cupo.
    private boolean puedeTranscribir(boolean largo) {
        long ahora = System.currentTimeMillis();
        if (ahora < sinCupoHasta) return false;
        // Sin Groq, cada frase oída se transcribiría con Gemini y se comería el cupo de la charla: pocas y solo cortas.
        boolean conGemini = !Ajustes.tiene(contexto, Ajustes.GROQ);
        if (conGemini && largo) return false;
        if (!largo) {
            while (!cortas.isEmpty() && ahora - cortas.peekFirst() > 60_000) cortas.removeFirst();
            if (cortas.size() >= (conGemini ? 4 : MAX_CORTAS_POR_MINUTO)) return false;
            cortas.addLast(ahora);
            return true;
        }
        while (!pasivas.isEmpty() && ahora - pasivas.peekFirst() > 60_000) pasivas.removeFirst();
        if (pasivas.size() >= MAX_PASIVAS_POR_MINUTO) return false;
        pasivas.addLast(ahora);
        return true;
    }

    private static final Pattern PRIMERA_PALABRA = Pattern.compile(
            "^[\\s\\p{Punct}¡¿…«»\\u00a0]*(?:(?:che|ey|eh|hey|hola|buenas|oye|ok|okey|bueno|dale)[\\s\\p{Punct}¡¿…«»\\u00a0]+){0,2}(\\p{L}+)");

    /** Cuántas letras hay que cambiar para pasar de una palabra a otra. */
    static int distancia(String a, String b) {
        int[] fila = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) fila[j] = j;
        for (int i = 1; i <= a.length(); i++) {
            int diagonal = fila[0];
            fila[0] = i;
            for (int j = 1; j <= b.length(); j++) {
                int arriba = fila[j];
                fila[j] = Math.min(Math.min(fila[j] + 1, fila[j - 1] + 1), diagonal + (a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1));
                diagonal = arriba;
            }
        }
        return fila[b.length()];
    }

    /**
     * En una frase corta, si la primera palabra se parece mucho a "jarvis" (Whisper sin pista a veces escribe "jarbiz",
     * "yarbis", "chavis"…), se toma como el nombre. Devuelve dónde termina esa palabra, o -1.
     */
    static int pareceJarvis(String normal) {
        Matcher m = PRIMERA_PALABRA.matcher(normal);
        if (!m.find()) return -1;
        String palabra = m.group(1);
        if (palabra.length() < 4 || palabra.length() > 8) return -1;
        if ("jyglschdz".indexOf(palabra.charAt(0)) < 0) return -1;
        int d = distancia(palabra, "jarvis");
        // A dos letras de distancia solo si termina como "Jarvis" (así "jardín" no la abre).
        return d <= 1 || (d == 2 && palabra.matches(".*(is|iz|ys|es|ez)")) ? m.end(1) : -1;
    }

    private void enviar(List<short[]> segmento) {
        ocupado = true;
        // Frase corta (hasta 2,5 s): es cuando vale la pena aceptar un "Jarvis" mal escrito.
        int muestras = 0;
        for (short[] s : segmento) muestras += s.length;
        final boolean corta = muestras <= FRECUENCIA * 2.5;
        byte[] wav = wav(segmento);
        red.execute(() -> {
            try {
                String texto = Transcriptor.transcribirPasivo(contexto, wav).trim();
                // Sin tildes y en minúsculas tiene el mismo largo (NFD + sacar marcas solo quita las tildes), así que
                // las posiciones sirven para cortar el texto original.
                String normal = sinTildes(texto);
                Matcher m = PALABRA_CLAVE.matcher(normal);
                int fin = ALUCINACIONES.matcher(texto).find() ? -1 : m.find() ? m.end() : corta ? pareceJarvis(normal) : -1;
                if (fin >= 0) {
                    String base = normal.length() == texto.length() ? texto : normal;
                    String resto = base.substring(fin).replaceAll("^[\\s,.;:!¡¿?…]+", "").trim();
                    // "Jarvis… Jarvis" es llamarla, no una orden.
                    String orden = resto.replaceAll("[^\\p{L}\\p{N}]", "").length() >= 3
                            && !SOLO_NOMBRES.matcher(sinTildes(resto)).matches() ? resto : null;
                    principal.post(() -> avisar(orden));
                }
            } catch (Exception e) {
                Log.w(TAG, "No pude transcribir: " + e.getMessage());
                if (e.getMessage() != null && e.getMessage().contains("HTTP 429")) sinCupoHasta = System.currentTimeMillis() + 90_000;
            } finally {
                ocupado = false;
            }
        });
    }

    private void avisar(String orden) {
        if (activo && !Voz.de(contexto).estaHablando()) oyente.palabraClave(orden);
    }

    static byte[] wav(List<short[]> segmento) {
        int muestras = 0;
        for (short[] s : segmento) muestras += s.length;
        ByteBuffer b = ByteBuffer.allocate(44 + muestras * 2).order(ByteOrder.LITTLE_ENDIAN);
        b.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + muestras * 2).put("WAVE".getBytes(StandardCharsets.US_ASCII));
        b.put("fmt ".getBytes(StandardCharsets.US_ASCII)).putInt(16).putShort((short) 1).putShort((short) 1);
        b.putInt(FRECUENCIA).putInt(FRECUENCIA * 2).putShort((short) 2).putShort((short) 16);
        b.put("data".getBytes(StandardCharsets.US_ASCII)).putInt(muestras * 2);
        for (short[] s : segmento) for (short x : s) b.putShort(x);
        return b.array();
    }
}
