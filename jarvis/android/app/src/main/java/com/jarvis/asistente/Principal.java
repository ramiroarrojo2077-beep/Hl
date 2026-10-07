package com.jarvis.asistente;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
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
import android.text.InputType;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * La pantalla de Jarvis: transparente, muestra el HUD de tu servidor encima de tu fondo o de la app
 * que estabas usando. Escucha con el reconocimiento de voz del sistema y habla con {@link Voz}.
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
    private boolean paginaLista;
    private final List<String> pendientes = new ArrayList<>();
    private long ultimoNivel;

    @Override
    protected void onCreate(Bundle guardado) {
        super.onCreate(guardado);
        // De borde a borde: el contenido va detrás de la barra de estado, que queda transparente.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) getWindow().setDecorFitsSystemWindows(false);
        else getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);

        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        prepararWeb();
        setContentView(web);

        if (!Ajustes.configurado(this)) mostrarConfiguracion();
        else cargar();
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
                String url = pedido.getUrl().toString();
                if (url.startsWith(Ajustes.servidor(Principal.this))) return false;
                // Los links (noticias, accesos) se abren en el navegador.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
                } catch (Exception ignorada) {
                }
                return true;
            }

            @Override
            public void onPageFinished(WebView vista, String url) {
                paginaLista = true;
                for (String codigo : pendientes) web.evaluateJavascript(codigo, null);
                pendientes.clear();
            }

            @Override
            public void onReceivedError(WebView vista, WebResourceRequest pedido, WebResourceError error) {
                if (pedido.isForMainFrame()) mostrarSinConexion(String.valueOf(error.getDescription()));
            }
        });
    }

    private void cargar() {
        paginaLista = false;
        web.loadUrl(Ajustes.url(this, "/?modo=vertical&movil=1"));
    }

    private void mostrarSinConexion(String detalle) {
        paginaLista = false;
        String html = "<html><body style=\"margin:0;height:100vh;display:grid;place-items:center;background:rgba(8,0,2,.8);"
                + "color:#ffd6d6;font:16px sans-serif;text-align:center\"><div style=\"padding:24px\">"
                + "<div style=\"font:700 22px sans-serif;color:#ff4d4d;letter-spacing:.3em\">J.A.R.V.I.S.</div>"
                + "<p>No me puedo conectar con tu PC.<br>¿Está prendida y con Jarvis andando?</p>"
                + "<p style=\"opacity:.6;font-size:13px\">" + android.text.Html.escapeHtml(detalle) + "</p>"
                + "<p><button onclick=\"Android.reintentar()\" style=\"padding:10px 18px;margin:6px;background:#ff2b2b;color:#fff;border:0\">REINTENTAR</button>"
                + "<button onclick=\"Android.configurar()\" style=\"padding:10px 18px;margin:6px;background:none;color:#ff8f8f;border:1px solid #ff2b2b\">CONFIGURAR</button></p>"
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
            if (!SpeechRecognizer.isRecognitionAvailable(this)) {
                js("window.jarvisMovil&&jarvisMovil.mostrar('No encuentro el reconocimiento de voz del celular. Instalá o actualizá la app de Google.')");
                return;
            }
            Voz.de(this).callar();
            ordenAlServicio(Servicio.ACCION_PAUSAR_OIDO);
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
            runOnUiThread(Principal.this::cargar);
        }

        @JavascriptInterface
        public void configurar() {
            runOnUiThread(Principal.this::mostrarConfiguracion);
        }
    }

    // ---------- Servicio, permisos y configuración ----------

    private void ordenAlServicio(String accion) {
        if (!Ajustes.configurado(this)) return;
        try {
            startService(new Intent(this, Servicio.class).setAction(accion));
        } catch (RuntimeException ignorada) {
        }
    }

    private void iniciarServicio() {
        if (Ajustes.configurado(this)) startForegroundService(new Intent(this, Servicio.class));
    }

    private void pedirPermisos() {
        List<String> faltan = new ArrayList<>();
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            faltan.add(Manifest.permission.RECORD_AUDIO);
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            faltan.add(Manifest.permission.POST_NOTIFICATIONS);
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
        iniciarServicio();
        pedirAbrirseSola();
    }

    // Sin estos dos permisos especiales, Android no la deja abrirse sola ni seguir en segundo plano.
    private void pedirAbrirseSola() {
        if (!Ajustes.configurado(this)) return;
        if (!Settings.canDrawOverlays(this) && !Ajustes.yaPregunto(this, "superponer")) {
            new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                    .setTitle("Que se abra sola")
                    .setMessage("Para que Jarvis aparezca cuando la llamás o tiene algo para decirte, activá «Mostrar sobre otras apps» en la próxima pantalla.")
                    .setPositiveButton("Activar", (d, w) -> startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName()))))
                    .setNegativeButton("Ahora no", null)
                    .setOnDismissListener(d -> pedirBateria())
                    .show();
            return;
        }
        pedirBateria();
    }

    @SuppressLint("BatteryLife")
    private void pedirBateria() {
        PowerManager energia = getSystemService(PowerManager.class);
        if (energia.isIgnoringBatteryOptimizations(getPackageName()) || Ajustes.yaPregunto(this, "bateria")) return;
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
        } catch (RuntimeException ignorada) {
        }
    }

    private EditText campo(LinearLayout caja, String titulo, String valor, String ayuda) {
        TextView rotulo = new TextView(this);
        rotulo.setText(titulo);
        rotulo.setTextColor(0xFFFF8F8F);
        rotulo.setPadding(0, 24, 0, 4);
        EditText entrada = new EditText(this);
        entrada.setText(valor);
        entrada.setHint(ayuda);
        entrada.setSingleLine(true);
        entrada.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        caja.addView(rotulo);
        caja.addView(entrada);
        return entrada;
    }

    private void mostrarConfiguracion() {
        LinearLayout caja = new LinearLayout(this);
        caja.setOrientation(LinearLayout.VERTICAL);
        caja.setPadding(48, 16, 48, 0);
        EditText servidor = campo(caja, "Dirección de tu PC con Jarvis", Ajustes.servidor(this), "http://192.168.0.10:3700");
        EditText token = campo(caja, "Token (JARVIS_TOKEN del .env)", Ajustes.token(this), "el mismo que en la PC");
        EditText picovoice = campo(caja, "AccessKey de Picovoice (opcional)", Ajustes.clavePicovoice(this), "para detectar «Jarvis» sin internet");
        new AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
                .setTitle("Conectar con tu Jarvis")
                .setView(caja)
                .setCancelable(Ajustes.configurado(this))
                .setPositiveButton("Guardar", (d, w) -> {
                    Ajustes.guardar(this, servidor.getText().toString(), token.getText().toString(), picovoice.getText().toString());
                    if (!Ajustes.configurado(this)) {
                        mostrarConfiguracion();
                        return;
                    }
                    startForegroundService(new Intent(this, Servicio.class).setAction(Servicio.ACCION_REINICIAR));
                    cargar();
                    pedirAbrirseSola();
                })
                .show();
    }
}
