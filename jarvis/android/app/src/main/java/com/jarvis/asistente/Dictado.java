package com.jarvis.asistente;

import android.annotation.SuppressLint;
import android.content.Context;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Log;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.regex.Pattern;

/**
 * El oído propio de Jarvis para tus órdenes: graba con el micrófono, detecta sola cuándo empezás y terminás de hablar
 * y transcribe con Whisper (Groq) o Gemini. Sin la ventanita ni el pitido de Google.
 */
final class Dictado {
    interface Oyente {
        /** Volumen actual (RMS 0..1), para animar el reactor. */
        void nivel(float rms);
        /** Terminaste de hablar: ahora transcribe. */
        void procesando();
        /** Lo que dijiste ("" si no dijiste nada o no se entendió). */
        void resultado(String texto);
        void error(String mensaje);
    }

    private static final String TAG = "JarvisDictado";
    private static final int FRECUENCIA = 16000;
    private static final int MUESTRAS_BLOQUE = 480; // 30 ms
    private static final double SIN_HABLAR_S = 7;
    private static final double SILENCIO_FINAL_S = 1.1;
    private static final double MAXIMO_S = 25;
    private static final Pattern ALUCINACIONES = Pattern.compile(
            "amara\\.org|gracias por ver|suscr[ií]b|subt[ií]tulos|^\\W*$", Pattern.CASE_INSENSITIVE);

    private static final Pattern SOLO_NOMBRE = Pattern.compile("[\\s\\p{Punct}¡¿]*(jarvis|yarvis|jarbis)[\\s\\p{Punct}]*",
            Pattern.CASE_INSENSITIVE);

    private final Context contexto;
    private Thread hilo;
    private volatile boolean cancelado;

    Dictado(Context c) {
        contexto = c.getApplicationContext();
    }

    static boolean disponible(Context c) {
        return Transcriptor.disponible(c);
    }

    synchronized void iniciar(Oyente oyente) {
        cancelar();
        cancelado = false;
        hilo = new Thread(() -> grabar(oyente), "jarvis-dictado");
        hilo.start();
    }

    synchronized void cancelar() {
        cancelado = true;
        if (hilo != null) {
            hilo.interrupt();
            try {
                hilo.join(300);
            } catch (InterruptedException ignorada) {
                Thread.currentThread().interrupt();
            }
            hilo = null;
        }
    }

    @SuppressLint("MissingPermission")
    private void grabar(Oyente oyente) {
        int minimo = AudioRecord.getMinBufferSize(FRECUENCIA, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        AudioRecord grabadora = null;
        // El servicio puede tardar un instante en soltar el micrófono: se reintenta un par de veces.
        for (int intento = 0; intento < 4 && !cancelado; intento++) {
            try {
                grabadora = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, FRECUENCIA,
                        AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(minimo, MUESTRAS_BLOQUE * 8));
                if (grabadora.getState() == AudioRecord.STATE_INITIALIZED) break;
                grabadora.release();
            } catch (Exception e) {
                Log.w(TAG, "Micrófono ocupado: " + e.getMessage());
            }
            grabadora = null;
            try {
                Thread.sleep(250);
            } catch (InterruptedException e) {
                return;
            }
        }
        if (grabadora == null) {
            if (!cancelado) oyente.error("No puedo usar el micrófono ahora.");
            return;
        }

        List<short[]> segmento = null;
        try {
            grabadora.startRecording();
            short[] bloque = new short[MUESTRAS_BLOQUE];
            ArrayDeque<short[]> previo = new ArrayDeque<>();
            final double duracion = (double) MUESTRAS_BLOQUE / FRECUENCIA;
            double ruido = 0.004;
            double esperando = 0;
            double voz = 0;
            double hablado = 0;
            double silencio = 0;
            long ultimoNivel = 0;
            while (!cancelado && !Thread.currentThread().isInterrupted()) {
                int leidas = grabadora.read(bloque, 0, bloque.length);
                if (leidas <= 0) continue;
                short[] copia = Arrays.copyOf(bloque, leidas);
                double suma = 0;
                for (int i = 0; i < leidas; i++) {
                    double x = copia[i] / 32768.0;
                    suma += x * x;
                }
                double rms = Math.sqrt(suma / leidas);
                long ahora = System.currentTimeMillis();
                if (ahora - ultimoNivel > 70) {
                    ultimoNivel = ahora;
                    oyente.nivel((float) rms);
                }
                double umbral = Math.max(0.010, ruido * 3.0);
                if (segmento == null) {
                    esperando += duracion;
                    previo.addLast(copia);
                    while (previo.size() * duracion > 0.5) previo.removeFirst();
                    if (rms > umbral) {
                        voz += duracion;
                        if (voz >= 0.1) {
                            segmento = new ArrayList<>(previo);
                            hablado = voz;
                            silencio = 0;
                        }
                    } else {
                        voz = 0;
                        // Aprende el ruido de fondo mientras no hablás.
                        ruido = ruido * 0.95 + rms * 0.05;
                    }
                    if (esperando > SIN_HABLAR_S) break;
                } else {
                    segmento.add(copia);
                    if (rms > umbral * 0.75) {
                        hablado += duracion;
                        silencio = 0;
                    } else {
                        silencio += duracion;
                    }
                    if (silencio > SILENCIO_FINAL_S || segmento.size() * duracion > MAXIMO_S) break;
                }
            }
            if (segmento != null && hablado < 0.25) segmento = null;
        } catch (Exception e) {
            Log.w(TAG, "Falló la grabación: " + e.getMessage());
            segmento = null;
        } finally {
            try {
                grabadora.stop();
            } catch (Exception ignorada) {
            }
            grabadora.release();
        }
        if (cancelado) return;
        if (segmento == null) {
            oyente.resultado("");
            return;
        }
        oyente.procesando();
        try {
            String texto = Transcriptor.transcribir(contexto, Oido.wav(segmento), "audio/wav").trim();
            // Solo "Jarvis" (o nada entendible) no es una orden.
            if (ALUCINACIONES.matcher(texto).find() || SOLO_NOMBRE.matcher(texto).matches()) texto = "";
            if (!cancelado) oyente.resultado(texto);
        } catch (Exception e) {
            if (!cancelado) oyente.error(e.getMessage() == null ? "No te pude entender." : e.getMessage());
        }
    }
}
