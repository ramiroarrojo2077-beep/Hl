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
    // Solo cuenta si la frase EMPIEZA con "Jarvis" (o "che/hola/ey Jarvis"): nombrarla de pasada no la abre.
    private static final Pattern PALABRA_CLAVE = Pattern.compile(
            "^[\\s\\p{Punct}¡¿]*(?:(?:che|ey|eh|hey|hola|oye|oi|ok|okay|okey|bueno|dale)[\\s,.!¡]+)?"
                    + "(jarvis|yarvis|jarbis|yarbis|charvis|jervis|harvis|garvis|jarviz|yarviz|jarvi|yarvi)\\b",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CASE);
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
                        if (silencio > 0.8 || segmento.size() * duracion > 8) {
                            if (hablado >= 0.3) {
                                if (Transcriptor.disponible(contexto) && puedeTranscribir()) enviar(segmento);
                                else ruido *= 1.5;
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
    private boolean puedeTranscribir() {
        long ahora = System.currentTimeMillis();
        while (!pasivas.isEmpty() && ahora - pasivas.peekFirst() > 60_000) pasivas.removeFirst();
        if (pasivas.size() >= MAX_PASIVAS_POR_MINUTO) return false;
        pasivas.addLast(ahora);
        return true;
    }

    private void enviar(List<short[]> segmento) {
        ocupado = true;
        byte[] wav = wav(segmento);
        red.execute(() -> {
            try {
                String texto = Transcriptor.transcribirPasivo(contexto, wav).trim();
                Matcher m = PALABRA_CLAVE.matcher(texto);
                if (!ALUCINACIONES.matcher(texto).find() && m.find()) {
                    String resto = texto.substring(m.end()).replaceAll("^[\\s,.;:!¡¿?]+", "").trim();
                    String orden = resto.replaceAll("[^\\p{L}\\p{N}]", "").length() >= 3 ? resto : null;
                    principal.post(() -> avisar(orden));
                }
            } catch (Exception e) {
                Log.w(TAG, "No pude transcribir: " + e.getMessage());
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
