package com.jarvis.asistente;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.PowerManager;
import android.provider.Settings;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * La pantalla de Jarvis: transparente, muestra el HUD (que sirve el servidor interno) encima de tu fondo o de la app
 * que estabas usando. Escucha con el reconocimiento de voz del sistema y habla con {@link Voz}. Todo en el celular.
 */
public class Principal extends Activity {
    static final String EXTRA_ESCUCHAR = "escuchar";
    static final String EXTRA_ORDEN = "orden";
    static final String EXTRA_DECIR = "decir";
    static final String EXTRA_ESCUCHAR_DESPUES = "escuchar_despues";
    static volatile boolean visible;

    private static final int PEDIDO_PERMISOS = 1;

    private WebView web;
    private SpeechRecognizer reconocedor;
    private Dictado dictado;
    private boolean paginaLista;
    private final List<String> pendientes = new ArrayList<>();
    private long ultimoNivel;
    private int reintentos;

    @Override
    protected void onCreate(Bundle guardado) {
        super.onCreate(guardado);
        // De borde a borde: el contenido va detrás de la barra de estado, que queda transparente.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) getWindow().setDecorFitsSystemWindows(false);
        else getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);

        ServidorLocal.iniciar(this);
        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        prepararWeb();
        setContentView(web);
        cargar();
        pedirPermisos();
        procesar(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        procesar(intent);
    }

    @Override
    protected void onResume() {
        super.onResume();
        visible = true;
        web.onResume();
        // Al volver de los ajustes del sistema, la interfaz se entera de los permisos nuevos.
        Eventos.emitir("estado", null);
    }

    @Override
    protected void onPause() {
        visible = false;
        web.onPause();
        detenerReconocimiento();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (reconocedor != null) reconocedor.destroy();
        if (dictado != null) dictado.cancelar();
        web.destroy();
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        Voz.de(this).callar();
        moveTaskToBack(true);
    }

    // ---------- Página ----------

    @SuppressLint("SetJavaScriptEnabled")
    private void prepararWeb() {
        WebSettings ajustes = web.getSettings();
        ajustes.setJavaScriptEnabled(true);
        ajustes.setDomStorageEnabled(true);
        ajustes.setMediaPlaybackRequiresUserGesture(false);
        web.addJavascriptInterface(new Puente(), "Android");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView vista, WebResourceRequest pedido) {
                Uri url = pedido.getUrl();
                if ("127.0.0.1".equals(url.getHost()) && url.getPort() == ServidorLocal.puerto()) return false;
                // Los links (noticias, accesos) se abren en su app o en el navegador.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (Exception ignorada) {
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView vista, String url) {
                if (url != null && url.startsWith("http://127.0.0.1")) reintentos = 0;
                paginaLista = true;
                for (String codigo : pendientes) web.evaluateJavascript(codigo, null);
                pendientes.clear();
            }

            @Override
            public void onReceivedError(WebView vista, WebResourceRequest pedido, WebResourceError error) {
                if (!pedido.isForMainFrame()) return;
                // El servidor interno puede tardar un instante en arrancar: se reintenta solo antes de mostrar el error.
                if (reintentos++ < 3) {
                    ServidorLocal.iniciar(Principal.this);
                    web.postDelayed(Principal.this::cargar, 800);
                } else {
                    mostrarError(String.valueOf(error.getDescription()));
                }
            }
        });
    }

    private void cargar() {
        paginaLista = false;
        web.loadUrl(ServidorLocal.url(this));
    }

    private void mostrarError(String detalle) {
        paginaLista = false;
        String html = "<html><body style=\"margin:0;height:100vh;display:grid;place-items:center;background:rgba(8,0,2,.8);"
                + "color:#ffd6d6;font:16px sans-serif;text-align:center\"><div style=\"padding:24px\">"
                + "<div style=\"font:700 22px sans-serif;color:#ff4d4d;letter-spacing:.3em\">J.A.R.V.I.S.</div>"
                + "<p>No pude abrir la interfaz.</p>"
                + "<p style=\"opacity:.6;font-size:13px\">" + android.text.Html.escapeHtml(detalle) + "</p>"
                + "<p><button onclick=\"Android.reintentar()\" style=\"padding:10px 18px;background:#ff2b2b;color:#fff;border:0\">REINTENTAR</button></p>"
                + "</div></body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "utf-8", null);
    }

    private void js(String codigo) {
        runOnUiThread(() -> {
            if (paginaLista) web.evaluateJavascript(codigo, null);
            else pendientes.add(codigo);
        });
    }

    private void estado(String nombre) {
        js("window.jarvisMovil&&jarvisMovil.estado(" + (nombre == null ? "null" : JSONObject.quote(nombre)) + ")");
    }

    // ---------- Lo que llega del servicio: avisos y la palabra "Jarvis" ----------

    private void procesar(Intent intent) {
        if (intent == null) return;
        String decir = intent.getStringExtra(EXTRA_DECIR);
        String orden = intent.getStringExtra(EXTRA_ORDEN);
        boolean escuchar = intent.getBooleanExtra(EXTRA_ESCUCHAR, false);
        boolean escucharDespues = intent.getBooleanExtra(EXTRA_ESCUCHAR_DESPUES, false);
        // Que no se repita si Android vuelve a entregar el mismo intent.
        intent.removeExtra(EXTRA_DECIR);
        intent.removeExtra(EXTRA_ORDEN);
        intent.removeExtra(EXTRA_ESCUCHAR);

        if (decir != null) {
            js("window.jarvisMovil&&jarvisMovil.mostrar(" + JSONObject.quote(decir) + ")");
            estado("hablando");
            Voz.de(this).hablar(decir, () -> {
                estado(null);
                if (escucharDespues) escuchar();
                else ordenAlServicio(Servicio.ACCION_REANUDAR_OIDO);
            });
        } else if (orden != null) {
            js("window.jarvisMovil&&jarvisMovil.oido(" + JSONObject.quote(orden) + ")");
        } else if (escuchar) {
            // Te llamó con "Jarvis": ya queda escuchando, sin tocar nada.
            escuchar();
        }
    }

    // ---------- Reconocimiento de voz ----------

    private void escuchar() {
        runOnUiThread(() -> {
            if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[] {Manifest.permission.RECORD_AUDIO}, PEDIDO_PERMISOS);
                return;
            }
            boolean propio = Dictado.disponible(this);
            if (!propio && !SpeechRecognizer.isRecognitionAvailable(this)) {
                js("window.jarvisMovil&&jarvisMovil.mostrar('Para escucharte pegá la clave gratis de Groq en Ajustes.')");
                return;
            }
            Voz.de(this).callar();
            ordenAlServicio(Servicio.ACCION_PAUSAR_OIDO);
            estado("escuchando");
            // Un instante para que el servicio suelte el micrófono (si no, se graba sin audio).
            web.postDelayed(propio ? this::empezarDictado : this::empezarReconocimiento, 350);
        });
    }

    // Oído propio (Whisper): sin la ventana ni el sonido de Google.
    private void empezarDictado() {
        if (dictado == null) dictado = new Dictado(this);
        estado("escuchando");
        dictado.iniciar(new Dictado.Oyente() {
            @Override
            public void nivel(float rms) {
                js("window.jarvisMovil&&jarvisMovil.nivel(" + rms + ")");
            }

            @Override
            public void procesando() {
                estado("pensando");
            }

            @Override
            public void resultado(String texto) {
                js("window.jarvisMovil&&jarvisMovil.oido(" + JSONObject.quote(texto) + ")");
                ordenAlServicio(Servicio.ACCION_REANUDAR_OIDO);
            }

            @Override
            public void error(String mensaje) {
                js("window.jarvisMovil&&(jarvisMovil.oido(''),jarvisMovil.mostrar(" + JSONObject.quote(mensaje) + "))");
                ordenAlServicio(Servicio.ACCION_REANUDAR_OIDO);
            }
        });
    }

    private void empezarReconocimiento() {
        runOnUiThread(() -> {
            if (reconocedor == null) {
                reconocedor = SpeechRecognizer.createSpeechRecognizer(this);
                reconocedor.setRecognitionListener(new Oyente());
            }
            Intent pedido = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-AR")
                    .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                    .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
            estado("escuchando");
            reconocedor.startListening(pedido);
        });
    }

    private void detenerReconocimiento() {
        if (reconocedor != null) reconocedor.cancel();
        if (dictado != null) dictado.cancelar();
        ordenAlServicio(Servicio.ACCION_REANUDAR_OIDO);
    }

    private class Oyente implements RecognitionListener {
        @Override
        public void onReadyForSpeech(Bundle params) {
            estado("escuchando");
        }

        @Override
        public void onBeginningOfSpeech() {}

        @Override
        public void onRmsChanged(float db) {
            long ahora = System.currentTimeMillis();
            if (ahora - ultimoNivel < 80) return;
            ultimoNivel = ahora;
            float nivel = Math.max(0f, Math.min(1f, (db + 2f) / 12f));
            js("window.jarvisMovil&&jarvisMovil.nivel(" + (nivel / 12f) + ")");
        }

        @Override
        public void onBufferReceived(byte[] buffer) {}

        @Override
        public void onEndOfSpeech() {
            estado("pensando");
        }

        @Override
        public void onError(int error) {
            js("window.jarvisMovil&&jarvisMovil.oido('')");
            ordenAlServicio(Servicio.ACCION_REANUDAR_OIDO);
        }

        @Override
        public void onResults(Bundle resultados) {
            ArrayList<String> textos = resultados.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            String texto = textos != null && !textos.isEmpty() ? textos.get(0) : "";
            js("window.jarvisMovil&&jarvisMovil.oido(" + JSONObject.quote(texto) + ")");
            ordenAlServicio(Servicio.ACCION_REANUDAR_OIDO);
        }

        @Override
        public void onPartialResults(Bundle parciales) {}

        @Override
        public void onEvent(int tipo, Bundle params) {}
    }

    /** Lo que la página puede pedirle al celular. */
    private class Puente {
        @JavascriptInterface
        public void escuchar() {
            Principal.this.escuchar();
        }

        @JavascriptInterface
        public void hablar(String texto) {
            runOnUiThread(() -> Voz.de(Principal.this).hablar(texto, () -> js("window.jarvisMovil&&jarvisMovil.finHablar()")));
        }

        @JavascriptInterface
        public void callar() {
            runOnUiThread(() -> Voz.de(Principal.this).callar());
        }

        @JavascriptInterface
        public void escuchaContinua(boolean activa) {
            Ajustes.escuchaContinua(Principal.this, activa);
            ordenAlServicio(Servicio.ACCION_REANUDAR_OIDO);
        }

        @JavascriptInterface
        public void ocultar() {
            runOnUiThread(() -> moveTaskToBack(true));
        }

        @JavascriptInterface
        public void reintentar() {
            reintentos = 0;
            runOnUiThread(Principal.this::cargar);
        }

        /** "notificaciones" | "superponer" | "bateria" | "alarmas" | "app". */
        @JavascriptInterface
        public void abrirPermiso(String cual) {
            runOnUiThread(() -> abrirAjusteDelSistema(cual));
        }
    }

    // ---------- Servicio y permisos ----------

    private void ordenAlServicio(String accion) {
        try {
            startService(new Intent(this, Servicio.class).setAction(accion));
        } catch (RuntimeException ignorada) {
        }
    }

    private void pedirPermisos() {
        List<String> faltan = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            faltan.add(Manifest.permission.RECORD_AUDIO);
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            faltan.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        // Agenda, contactos y llamadas (para "¿qué tengo hoy?" o "llamá a mamá").
        for (String permiso : new String[] {Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR,
                Manifest.permission.READ_CONTACTS, Manifest.permission.CALL_PHONE}) {
            if (checkSelfPermission(permiso) != PackageManager.PERMISSION_GRANTED && !Ajustes.yaPregunto(this, "permiso_" + permiso)) faltan.add(permiso);
        }
        if (!faltan.isEmpty()) requestPermissions(faltan.toArray(new String[0]), PEDIDO_PERMISOS);
        else despuesDePermisos();
    }

    @Override
    public void onRequestPermissionsResult(int codigo, String[] permisos, int[] resultados) {
        super.onRequestPermissionsResult(codigo, permisos, resultados);
        despuesDePermisos();
    }

    private void despuesDePermisos() {
        Servicio.iniciar(this);
        pedirPermisosEspeciales();
    }

    // Lo que Android no deja pedir con un cartel común: se explica y se abre la pantalla de ajustes, una sola vez cada uno.
    private void pedirPermisosEspeciales() {
        if (!Escucha.permisoConcedido(this) && !Ajustes.yaPregunto(this, "notificaciones")) {
            explicar("Conectarse a tus apps",
                    "Para leerte lo que te llega por WhatsApp, Gmail, Telegram, Instagram y demás, y responder cuando vos lo aprobás, activá a Jarvis en «Acceso a notificaciones».",
                    "notificaciones");
        } else if (!Settings.canDrawOverlays(this) && !Ajustes.yaPregunto(this, "superponer")) {
            explicar("Que se abra sola",
                    "Para que Jarvis aparezca cuando la llamás o tiene algo para decirte, activá «Mostrar sobre otras apps».",
                    "superponer");
        } else if (!getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(getPackageName())
                && !Ajustes.yaPregunto(this, "bateria")) {
            abrirAjusteDelSistema("bateria");
        }
    }

    private void explicar(String titulo, String mensaje, String permiso) {
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle(titulo)
                .setMessage(mensaje)
                .setPositiveButton("Activar", (d, w) -> abrirAjusteDelSistema(permiso))
                .setNegativeButton("Ahora no", (d, w) -> pedirPermisosEspeciales())
                .show();
    }

    @SuppressLint("BatteryLife")
    private void abrirAjusteDelSistema(String cual) {
        Intent i;
        switch (cual) {
            case "notificaciones":
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                            .putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
                                    new ComponentName(this, Escucha.class).flattenToString());
                } else {
                    i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
                }
                break;
            case "superponer":
                i = new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()));
                break;
            case "bateria":
                i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()));
                break;
            case "alarmas":
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S
                        || getSystemService(AlarmManager.class).canScheduleExactAlarms()) return;
                i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName()));
                break;
            default:
                i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
        }
        try {
            startActivity(i);
        } catch (RuntimeException e) {
            // Algunos celulares no tienen la pantalla específica: se abre la de la app.
            try {
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName())));
            } catch (RuntimeException ignorada) {
            }
        }
    }
}
