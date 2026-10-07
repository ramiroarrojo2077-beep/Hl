package com.jarvis.asistente;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.media.AudioManager;
import android.media.ToneGenerator;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Trabaja en segundo plano: mantiene la conexión con tu servidor de Jarvis para recibir los avisos
 * (mails, WhatsApp, recordatorios) y escucha la palabra "Jarvis". En los dos casos abre la app sola.
 */
public class Servicio extends Service {
    static final String ACCION_PAUSAR_OIDO = "pausar_oido";
    static final String ACCION_REANUDAR_OIDO = "reanudar_oido";
    static final String ACCION_REINICIAR = "reiniciar";
    static final String EXTRA_SIN_MICROFONO = "sin_microfono";

    private static final String TAG = "JarvisServicio";
    private static final String CANAL_FONDO = "fondo";
    private static final String CANAL_AVISOS = "avisos";
    private static final int ID_FONDO = 1;

    private final Handler principal = new Handler(Looper.getMainLooper());
    private NotificationManager notificaciones;
    private Thread hiloEventos;
    private volatile boolean detenido;
    private Oido oido;
    private boolean conMicrofono;
    private boolean oidoPausado;
    private boolean activa = true;
    private int idAviso = 100;
    private String estadoConexion = "Conectando con tu Jarvis…";

    @Override
    public void onCreate() {
        super.onCreate();
        notificaciones = getSystemService(NotificationManager.class);
        NotificationChannel fondo = new NotificationChannel(CANAL_FONDO, "Jarvis en segundo plano", NotificationManager.IMPORTANCE_MIN);
        fondo.setShowBadge(false);
        NotificationChannel avisos = new NotificationChannel(CANAL_AVISOS, "Avisos de Jarvis", NotificationManager.IMPORTANCE_HIGH);
        notificaciones.createNotificationChannel(fondo);
        notificaciones.createNotificationChannel(avisos);
        oido = new Oido(this, this::alLlamarla);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String accion = intent != null ? intent.getAction() : null;
        boolean puedeMicrofono = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
                && (intent == null || !intent.getBooleanExtra(EXTRA_SIN_MICROFONO, false));
        if (ACCION_PAUSAR_OIDO.equals(accion)) {
            oidoPausado = true;
            oido.detener();
            return START_STICKY;
        }
        if (ACCION_REANUDAR_OIDO.equals(accion)) {
            oidoPausado = false;
            actualizarOido();
            return START_STICKY;
        }
        if (ACCION_REINICIAR.equals(accion)) {
            oido.detener();
            detenerEventos();
        }
        // Si ya tenía micrófono, una orden sin él (por ejemplo, del arranque) no se lo saca.
        conMicrofono = conMicrofono || puedeMicrofono;
        ponerEnPrimerPlano();
        if (Ajustes.configurado(this)) iniciarEventos();
        actualizarOido();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        detenerEventos();
        oido.detener();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    // ---------- Notificación fija ----------

    private PendingIntent abrir(boolean escuchar, int codigo) {
        Intent i = new Intent(this, Principal.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra(Principal.EXTRA_ESCUCHAR, escuchar);
        return PendingIntent.getActivity(this, codigo, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification notificacionFija() {
        String texto = estadoConexion + (oido.activo() ? " · Decí «Jarvis»" : "");
        return new Notification.Builder(this, CANAL_FONDO)
                .setSmallIcon(R.drawable.ic_reactor)
                .setContentTitle("Jarvis")
                .setContentText(texto)
                .setOngoing(true)
                .setContentIntent(abrir(false, 1))
                .addAction(new Notification.Action.Builder(null, "Hablar", abrir(true, 2)).build())
                .build();
    }

    private void ponerEnPrimerPlano() {
        Notification n = notificacionFija();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            int tipo = 0;
            if (Build.VERSION.SDK_INT >= 34) tipo |= ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE;
            if (conMicrofono) tipo |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
            try {
                startForeground(ID_FONDO, n, tipo);
            } catch (RuntimeException e) {
                // Android no deja pedir el micrófono en este momento: sigue solo con los avisos.
                Log.w(TAG, "Sin micrófono en segundo plano: " + e.getMessage());
                conMicrofono = false;
                startForeground(ID_FONDO, n, Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0);
            }
        } else {
            startForeground(ID_FONDO, n);
        }
    }

    private void actualizarNotificacion(String estado) {
        estadoConexion = estado;
        principal.post(() -> notificaciones.notify(ID_FONDO, notificacionFija()));
    }

    // ---------- Palabra "Jarvis" ----------

    private void actualizarOido() {
        boolean debe = conMicrofono && activa && !oidoPausado && Ajustes.configurado(this) && Ajustes.escuchaContinua(this);
        if (debe) oido.iniciar();
        else oido.detener();
        notificaciones.notify(ID_FONDO, notificacionFija());
    }

    private void alLlamarla(String orden) {
        if (!activa) return;
        // Suelta el micrófono para que la app te escuche con el reconocimiento de voz del sistema.
        oido.detener();
        try {
            new ToneGenerator(AudioManager.STREAM_MUSIC, 70).startTone(ToneGenerator.TONE_PROP_ACK, 150);
        } catch (RuntimeException ignorada) {
        }
        Intent i = new Intent(this, Principal.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (orden != null) i.putExtra(Principal.EXTRA_ORDEN, orden);
        else i.putExtra(Principal.EXTRA_ESCUCHAR, true);
        abrirApp(i, "Te escucho", "Tocá para hablar con Jarvis");
    }

    /** Abre la app arriba de lo que estés usando. Si Android no lo permite, deja una notificación. */
    private void abrirApp(Intent i, String titulo, String texto) {
        if (Settings.canDrawOverlays(this)) {
            try {
                startActivity(i);
                return;
            } catch (RuntimeException e) {
                Log.w(TAG, "No pude abrir la app: " + e.getMessage());
            }
        }
        PendingIntent pi = PendingIntent.getActivity(this, idAviso, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        notificaciones.notify(idAviso++, new Notification.Builder(this, CANAL_AVISOS)
                .setSmallIcon(R.drawable.ic_reactor)
                .setContentTitle(titulo)
                .setContentText(texto)
                .setStyle(new Notification.BigTextStyle().bigText(texto))
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build());
        actualizarOido();
    }

    // ---------- Avisos del servidor ----------

    private void iniciarEventos() {
        if (hiloEventos != null && hiloEventos.isAlive()) return;
        detenido = false;
        hiloEventos = new Thread(this::bucleEventos, "jarvis-eventos");
        hiloEventos.start();
    }

    private void detenerEventos() {
        detenido = true;
        if (hiloEventos != null) hiloEventos.interrupt();
        hiloEventos = null;
    }

    private void bucleEventos() {
        long espera = 3000;
        while (!detenido) {
            HttpURLConnection con = null;
            try {
                con = (HttpURLConnection) new URL(Ajustes.url(this, "/api/eventos")).openConnection();
                con.setRequestProperty("Accept", "text/event-stream");
                con.setConnectTimeout(10_000);
                // El servidor manda un latido cada 25 segundos.
                con.setReadTimeout(70_000);
                int codigo = con.getResponseCode();
                if (codigo == 401) throw new IOException("Token incorrecto");
                if (codigo != 200) throw new IOException("HTTP " + codigo);
                actualizarNotificacion("Conectada a tu Jarvis");
                espera = 3000;
                BufferedReader lector = new BufferedReader(new InputStreamReader(con.getInputStream(), StandardCharsets.UTF_8));
                String linea;
                String evento = null;
                StringBuilder datos = new StringBuilder();
                while (!detenido && (linea = lector.readLine()) != null) {
                    if (linea.isEmpty()) {
                        if (evento != null) despachar(evento, datos.toString());
                        evento = null;
                        datos.setLength(0);
                    } else if (linea.startsWith("event:")) {
                        evento = linea.substring(6).trim();
                    } else if (linea.startsWith("data:")) {
                        datos.append(linea.substring(5).trim());
                    }
                }
            } catch (Exception e) {
                if (detenido) return;
                Log.w(TAG, "Sin conexión con el servidor: " + e.getMessage());
                actualizarNotificacion("Sin conexión con tu PC (" + e.getMessage() + "). Reintentando…");
            } finally {
                if (con != null) con.disconnect();
            }
            try {
                Thread.sleep(espera);
            } catch (InterruptedException e) {
                return;
            }
            espera = Math.min(espera * 2, 60_000);
        }
    }

    private void despachar(String evento, String datos) {
        try {
            JSONObject json = new JSONObject(datos);
            if (evento.equals("estado") || evento.equals("activa")) {
                boolean nueva = json.optBoolean("activa", true);
                principal.post(() -> {
                    if (nueva != activa) {
                        activa = nueva;
                        actualizarOido();
                    }
                });
            } else if (evento.equals("aviso") && json.optBoolean("hablar")) {
                JSONObject aviso = json.getJSONObject("aviso");
                JSONObject propuesta = json.optJSONObject("propuesta");
                String texto = aviso.optString("texto");
                if (propuesta != null) {
                    String borrador = propuesta.optString("texto");
                    texto += borrador.length() <= 280
                            ? " Te propongo responderle: " + borrador + " ¿Se la mando?"
                            : " Te dejé una respuesta preparada. ¿Se la mando?";
                }
                final String decir = texto;
                final boolean preguntar = propuesta != null;
                principal.post(() -> darAviso(decir, preguntar, aviso.optString("de", "Jarvis")));
            }
        } catch (Exception e) {
            Log.w(TAG, "Evento inválido: " + e.getMessage());
        }
    }

    private void darAviso(String texto, boolean esperarRespuesta, String de) {
        // Si la app está a la vista, el aviso lo da la propia pantalla.
        if (Principal.visible) return;
        Intent i = new Intent(this, Principal.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra(Principal.EXTRA_DECIR, texto)
                .putExtra(Principal.EXTRA_ESCUCHAR_DESPUES, esperarRespuesta);
        if (Settings.canDrawOverlays(this)) {
            oido.detener();
            try {
                startActivity(i);
                return;
            } catch (RuntimeException e) {
                Log.w(TAG, "No pude abrir la app: " + e.getMessage());
            }
        }
        // Sin permiso para abrirse sola: te lo dice igual y deja la notificación.
        oido.detener();
        Voz.de(this).hablar(texto, this::actualizarOido);
        PendingIntent pi = PendingIntent.getActivity(this, idAviso, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        notificaciones.notify(idAviso++, new Notification.Builder(this, CANAL_AVISOS)
                .setSmallIcon(R.drawable.ic_reactor)
                .setContentTitle(de)
                .setContentText(texto)
                .setStyle(new Notification.BigTextStyle().bigText(texto))
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build());
    }
}
