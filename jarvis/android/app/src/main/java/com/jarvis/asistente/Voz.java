package com.jarvis.asistente;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * La voz de Jarvis en el celular: usa ElevenLabs a través de tu servidor y, si no está
 * configurado o se terminó el cupo, la voz del sistema.
 */
final class Voz {
    private static final String TAG = "JarvisVoz";
    private static Voz instancia;

    private final Context contexto;
    private final Handler principal = new Handler(Looper.getMainLooper());
    private final ExecutorService hilo = Executors.newSingleThreadExecutor();
    private final AudioManager audio;
    private final AudioAttributes atributos = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();
    private final AudioFocusRequest foco;
    private TextToSpeech tts;
    private boolean ttsListo;
    private Runnable alListo;
    private MediaPlayer reproductor;
    private int turno;
    private volatile boolean hablando;

    static synchronized Voz de(Context c) {
        if (instancia == null) instancia = new Voz(c.getApplicationContext());
        return instancia;
    }

    private Voz(Context c) {
        contexto = c;
        audio = (AudioManager) c.getSystemService(Context.AUDIO_SERVICE);
        // La música baja el volumen mientras Jarvis habla.
        foco = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                .setAudioAttributes(atributos)
                .build();
        tts = new TextToSpeech(c, estado -> {
            ttsListo = estado == TextToSpeech.SUCCESS;
            if (ttsListo) {
                int resultado = tts.setLanguage(new Locale("es", "AR"));
                if (resultado < 0) tts.setLanguage(new Locale("es"));
                tts.setAudioAttributes(atributos);
            }
            if (alListo != null) {
                Runnable r = alListo;
                alListo = null;
                r.run();
            }
        });
    }

    boolean estaHablando() {
        return hablando;
    }

    void hablar(String texto, Runnable alTerminar) {
        callar();
        final int miTurno = ++turno;
        hablando = true;
        audio.requestAudioFocus(foco);
        hilo.execute(() -> {
            File mp3 = descargarElevenLabs(texto);
            principal.post(() -> {
                if (miTurno != turno) return;
                if (mp3 != null) reproducir(mp3, texto, miTurno, alTerminar);
                else conSistema(texto, miTurno, alTerminar);
            });
        });
    }

    void callar() {
        turno++;
        hablando = false;
        if (tts != null) tts.stop();
        if (reproductor != null) {
            reproductor.release();
            reproductor = null;
        }
        audio.abandonAudioFocusRequest(foco);
    }

    private void terminar(int miTurno, Runnable alTerminar) {
        if (miTurno != turno) return;
        hablando = false;
        if (reproductor != null) {
            reproductor.release();
            reproductor = null;
        }
        audio.abandonAudioFocusRequest(foco);
        if (alTerminar != null) alTerminar.run();
    }

    private File descargarElevenLabs(String texto) {
        if (!Ajustes.configurado(contexto)) return null;
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL(Ajustes.url(contexto, "/api/hablar")).openConnection();
            con.setRequestMethod("POST");
            con.setConnectTimeout(5000);
            con.setReadTimeout(20000);
            con.setDoOutput(true);
            con.setRequestProperty("Content-Type", "application/json");
            byte[] cuerpo = new JSONObject().put("texto", texto).toString().getBytes(StandardCharsets.UTF_8);
            try (OutputStream salida = con.getOutputStream()) {
                salida.write(cuerpo);
            }
            if (con.getResponseCode() != 200) return null;
            File archivo = new File(contexto.getCacheDir(), "voz.mp3");
            try (InputStream entrada = con.getInputStream(); OutputStream salida = new FileOutputStream(archivo)) {
                byte[] buffer = new byte[16384];
                int leidos;
                while ((leidos = entrada.read(buffer)) > 0) salida.write(buffer, 0, leidos);
            }
            return archivo;
        } catch (Exception e) {
            Log.w(TAG, "ElevenLabs no disponible: " + e.getMessage());
            return null;
        } finally {
            if (con != null) con.disconnect();
        }
    }

    private void reproducir(File mp3, String texto, int miTurno, Runnable alTerminar) {
        try {
            reproductor = new MediaPlayer();
            reproductor.setAudioAttributes(atributos);
            reproductor.setDataSource(mp3.getPath());
            reproductor.setOnCompletionListener(mp -> terminar(miTurno, alTerminar));
            reproductor.setOnErrorListener((mp, que, extra) -> {
                conSistema(texto, miTurno, alTerminar);
                return true;
            });
            reproductor.prepare();
            reproductor.start();
        } catch (Exception e) {
            conSistema(texto, miTurno, alTerminar);
        }
    }

    private void conSistema(String texto, int miTurno, Runnable alTerminar) {
        if (miTurno != turno) return;
        if (!ttsListo) {
            if (tts != null && alListo == null) {
                alListo = () -> conSistema(texto, miTurno, alTerminar);
                return;
            }
            terminar(miTurno, alTerminar);
            return;
        }
        String id = "jarvis-" + miTurno;
        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) {}

            @Override
            public void onDone(String utteranceId) {
                if (id.equals(utteranceId)) principal.post(() -> terminar(miTurno, alTerminar));
            }

            @Override
            public void onError(String utteranceId) {
                if (id.equals(utteranceId)) principal.post(() -> terminar(miTurno, alTerminar));
            }
        });
        tts.speak(texto, TextToSpeech.QUEUE_FLUSH, null, id);
    }
}
