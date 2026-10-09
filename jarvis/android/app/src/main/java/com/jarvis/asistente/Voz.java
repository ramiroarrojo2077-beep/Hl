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


import java.io.File;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * La voz de Jarvis en el celular: usa ElevenLabs y, si no está configurado o se terminó el cupo,
 * la voz del sistema.
 */
final class Voz {
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

    /** Con qué voz habló la última vez (elevenlabs | edge | gemini | sistema) y por qué no usó la elegida, si pasó. */
    static volatile String ultimoMotor = "";
    static volatile String ultimoError;

    void hablar(String texto, Runnable alTerminar) {
        callar();
        final int miTurno = ++turno;
        hablando = true;
        audio.requestAudioFocus(foco);
        hilo.execute(() -> {
            File mp3 = sintetizar(texto);
            principal.post(() -> {
                if (miTurno != turno) return;
                if (mp3 != null) reproducir(mp3, texto, miTurno, alTerminar);
                else conSistema(texto, miTurno, alTerminar);
            });
        });
    }

    /** Para "Probar voz": genera el audio (bloquea, llamar desde un hilo de fondo), lo dice y cuenta qué motor usó. */
    org.json.JSONObject probar(String texto) {
        File mp3 = sintetizar(texto);
        String motor = mp3 == null ? "sistema" : ultimoMotor;
        principal.post(() -> {
            callar();
            final int miTurno = ++turno;
            hablando = true;
            audio.requestAudioFocus(foco);
            if (mp3 != null) reproducir(mp3, texto, miTurno, null);
            else conSistema(texto, miTurno, null);
        });
        org.json.JSONObject r = new org.json.JSONObject();
        try {
            String elegida = Ajustes.texto(contexto, Ajustes.VOZ);
            r.put("ok", true).put("elegida", elegida).put("motor", motor);
            if (ultimoError != null) r.put("error", ultimoError);
        } catch (org.json.JSONException ignorada) {
        }
        return r;
    }

    private static String vozEdge(String voz) {
        switch (voz) {
            case "tomas": return "es-AR-TomasNeural";
            case "dalia": return "es-MX-DaliaNeural";
            case "paloma": return "es-US-PalomaNeural";
            case "elvira": return "es-ES-ElviraNeural";
            default: return "es-AR-ElenaNeural";
        }
    }

    /** La voz elegida en Ajustes y, si falla, las de respaldo. null = voz del sistema. */
    private File sintetizar(String texto) {
        String voz = Ajustes.texto(contexto, Ajustes.VOZ);
        File f = null;
        String motor;
        switch (voz) {
            case "sistema":
                ultimoMotor = "sistema";
                ultimoError = null;
                return null;
            case "elevenlabs":
                motor = "elevenlabs";
                if (!Ajustes.tiene(contexto, Ajustes.ELEVENLABS)) {
                    ultimoError = "Elegiste ElevenLabs pero falta su clave en Ajustes > Voz.";
                } else {
                    f = ElevenLabs.sintetizar(contexto, texto);
                    ultimoError = f == null ? ElevenLabs.ultimoError : ElevenLabs.ultimoError;
                }
                break;
            case "gemini":
                motor = "gemini";
                f = VozNube.gemini(contexto, texto, "Kore");
                ultimoError = f == null ? "La voz de Gemini no respondió (¿clave o cupo?)." : null;
                break;
            default:
                motor = "edge";
                f = VozNube.edge(contexto, texto, vozEdge(voz), "+6%");
                ultimoError = f == null ? "La voz neural no respondió (¿sin internet?)." : null;
        }
        if (f != null) {
            ultimoMotor = motor;
            return f;
        }
        // Respaldo: ElevenLabs si está (salvo que sea la que falló), después la neural de Microsoft, y si no la del celular.
        if (!"elevenlabs".equals(voz) && ElevenLabs.disponible(contexto)) {
            f = ElevenLabs.sintetizar(contexto, texto);
            if (f != null) ultimoMotor = "elevenlabs";
        }
        if (f == null && ("elevenlabs".equals(voz) || "gemini".equals(voz))) {
            f = VozNube.edge(contexto, texto, vozEdge("elena"), "+6%");
            if (f != null) ultimoMotor = "edge";
        }
        if (f == null) ultimoMotor = "sistema";
        return f;
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
