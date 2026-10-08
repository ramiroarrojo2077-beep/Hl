package com.jarvis.asistente;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
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

/**
 * Trabaja en segundo plano, todo dentro del celular: mantiene vivo el servidor interno y el correo, escucha la
 * palabra "Jarvis" y, cuando hay algo para decirte o la llamás, abre la app sola.
 */
public class Servicio extends Service {
    static final String ACCION_PAUSAR_OIDO = "pausar_oido";
    static final String ACCION_REANUDAR_OIDO = "reanudar_oido";
    static final String ACCION_REINICIAR = "reiniciar";
    static final String ACCION_AVISO = "aviso";
    static final String EXTRA_SIN_MICROFONO = "sin_microfono";
    private static final String EXTRA_TEXTO = "texto";
    private static final String EXTRA_ESPERAR = "esperar";
    private static final String EXTRA_DE = "de";

    private static final String TAG = "JarvisServicio";
    private static final String CANAL_FONDO = "fondo";
    private static final String CANAL_AVISOS = "avisos";
    private static final int ID_FONDO = 1;

    private static volatile Servicio instancia;

    private final Handler principal = new Handler(Looper.getMainLooper());
    private NotificationManager notificaciones;
    private Oido oido;
    private boolean conMicrofono;
    private boolean oidoPausado;
    private int idAviso = 100;

    // ---------- Para el resto de la app ----------

    static void iniciar(Context c) {
        try {
            c.startForegroundService(new Intent(c, Servicio.class));
        } catch (RuntimeException e) {
            Log.w(TAG, "No pude iniciar el servicio: " + e.getMessage());
        }
    }

    /** Cambió la configuración o se activó/desactivó Jarvis: reacomoda el oído y el correo. */
    static void alCambiarAjustes(Context c) {
        enviar(c, new Intent(c, Servicio.class).setAction(ACCION_REINICIAR));
    }

    /** Abre la app y te dice el aviso (si la pantalla de Jarvis no está a la vista). Se puede llamar desde cualquier hilo. */
    static void darAviso(Context c, String texto, boolean esperarRespuesta, String de) {
        Servicio s = instancia;
        if (s != null) {
            s.principal.post(() -> s.darAvisoAhora(texto, esperarRespuesta, de));
            return;
        }
        enviar(c, new Intent(c, Servicio.class)
                .setAction(ACCION_AVISO)
                .putExtra(EXTRA_TEXTO, texto)
                .putExtra(EXTRA_ESPERAR, esperarRespuesta)
                .putExtra(EXTRA_DE, de));
    }

    private static void enviar(Context c, Intent i) {
        try {
            if (instancia != null) c.startService(i);
            else c.startForegroundService(i);
        } catch (RuntimeException e) {
            Log.w(TAG, "No pude hablar con el servicio: " + e.getMessage());
        }
    }

    // ---------- Ciclo de vida ----------

    @Override
    public void onCreate() {
        super.onCreate();
        instancia = this;
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
        // Si ya tenía micrófono, una orden sin él (por ejemplo, del arranque) no se lo saca.
        conMicrofono = conMicrofono || puedeMicrofono;
        ponerEnPrimerPlano();

        if (ACCION_PAUSAR_OIDO.equals(accion)) {
            oidoPausado = true;
            oido.detener();
            actualizarNotificacion();
            return START_STICKY;
        }
        if (ACCION_REANUDAR_OIDO.equals(accion)) {
            oidoPausado = false;
            actualizarOido();
            return START_STICKY;
        }
        if (ACCION_AVISO.equals(accion)) {
            darAvisoAhora(intent.getStringExtra(EXTRA_TEXTO), intent.getBooleanExtra(EXTRA_ESPERAR, false), intent.getStringExtra(EXTRA_DE));
            return START_STICKY;
        }
        if (ACCION_REINICIAR.equals(accion)) oido.detener();

        ServidorLocal.iniciar(this);
        Correo.iniciar(this);
        Asistente.programar(this);
        try {
            Local.asegurar(this, false);
        } catch (Throwable ignorada) {
        }
        actualizarOido();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        oido.detener();
        if (instancia == this) instancia = null;
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
        String texto = !Acciones.activa(this) ? "Desactivada" : oido.activo() ? "Activa · Decí «Jarvis»" : "Activa";
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
                // Android no deja pedir el micrófono en este momento (por ejemplo, recién prendido): sigue sin él.
                Log.w(TAG, "Sin micrófono en segundo plano: " + e.getMessage());
                conMicrofono = false;
                startForeground(ID_FONDO, n, Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0);
            }
        } else {
            startForeground(ID_FONDO, n);
        }
    }

    private void actualizarNotificacion() {
        notificaciones.notify(ID_FONDO, notificacionFija());
    }

    // ---------- Palabra "Jarvis" ----------

    private void actualizarOido() {
        boolean debe = conMicrofono && !oidoPausado && Acciones.activa(this) && Ajustes.escuchaContinua(this);
        if (debe) oido.iniciar();
        else oido.detener();
        actualizarNotificacion();
    }

    private void alLlamarla(String orden) {
        if (!Acciones.activa(this)) return;
        // Suelta el micrófono para que la app te escuche con el reconocimiento de voz del sistema.
        oido.detener();
        try {
            new ToneGenerator(AudioManager.STREAM_MUSIC, 70).startTone(ToneGenerator.TONE_PROP_ACK, 150);
        } catch (RuntimeException ignorada) {
        }
        Intent i = new Intent(this, Principal.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        if (orden != null) i.putExtra(Principal.EXTRA_ORDEN, orden);
        else i.putExtra(Principal.EXTRA_ESCUCHAR, true);
        if (!abrirApp(i)) {
            notificar("Te escucho", "Tocá para hablar con Jarvis", i);
            actualizarOido();
        }
    }

    /** Abre la app arriba de lo que estés usando (necesita «Mostrar sobre otras apps»). */
    private boolean abrirApp(Intent i) {
        if (!Settings.canDrawOverlays(this)) return false;
        try {
            startActivity(i);
            return true;
        } catch (RuntimeException e) {
            Log.w(TAG, "No pude abrir la app: " + e.getMessage());
            return false;
        }
    }

    private void notificar(String titulo, String texto, Intent i) {
        PendingIntent pi = PendingIntent.getActivity(this, idAviso, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        notificaciones.notify(idAviso++, new Notification.Builder(this, CANAL_AVISOS)
                .setSmallIcon(R.drawable.ic_reactor)
                .setContentTitle(titulo)
                .setContentText(texto)
                .setStyle(new Notification.BigTextStyle().bigText(texto))
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build());
    }

    // ---------- Avisos ----------

    private void darAvisoAhora(String texto, boolean esperarRespuesta, String de) {
        if (texto == null || texto.isEmpty() || Principal.visible) return;
        Intent i = new Intent(this, Principal.class)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra(Principal.EXTRA_DECIR, texto)
                .putExtra(Principal.EXTRA_ESCUCHAR_DESPUES, esperarRespuesta);
        oido.detener();
        if (abrirApp(i)) return;
        // Sin permiso para abrirse sola: te lo dice igual y deja la notificación.
        Voz.de(this).hablar(texto, this::actualizarOido);
        notificar(de == null || de.isEmpty() ? "Jarvis" : de, texto, i);
    }
}
