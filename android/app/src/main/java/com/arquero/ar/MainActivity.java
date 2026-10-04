package com.arquero.ar;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.io.IOException;

/**
 * Pantalla de entrada. Levanta el servidor local con el juego y lo abre con
 * Chrome: Android no permite realidad aumentada web (WebXR) dentro de una
 * WebView, pero Chrome sí, con ARCore.
 */
public class MainActivity extends Activity {
    private static final String CHROME = "com.android.chrome";
    private static final int FONDO = Color.parseColor("#0B1410");
    private static final int VERDE = Color.parseColor("#C6FF1A");

    private String direccion;
    private TextView estado;
    private Button jugar;
    private Button enChrome;
    private boolean abrirAlEstarListo;

    @Override
    protected void onCreate(Bundle guardado) {
        super.onCreate(guardado);
        setContentView(armarPantalla());
        // La primera vez abre el juego directamente.
        abrirAlEstarListo = guardado == null;

        new Thread(() -> {
            try {
                ServidorLocal servidor = ServidorLocal.iniciar(getAssets()::open);
                String url = "http://localhost:" + servidor.puerto() + "/index.html?app=android";
                runOnUiThread(() -> listo(url));
            } catch (IOException e) {
                runOnUiThread(() -> estado.setText("No se pudo preparar el juego: " + e.getMessage()));
            }
        }, "inicio").start();
    }

    private void listo(String url) {
        direccion = url;
        jugar.setEnabled(true);
        enChrome.setEnabled(true);
        if (!chromeInstalado()) {
            estado.setText("Para la realidad aumentada hace falta Google Chrome. Instalalo desde Play Store.");
        }
        if (abrirAlEstarListo) {
            abrirAlEstarListo = false;
            abrir(false);
        }
    }

    /**
     * Abre el juego en una pestaña de Chrome integrada a la app (Custom Tab) o, si
     * {@code completo}, en Chrome normal.
     */
    private void abrir(boolean completo) {
        if (direccion == null) return;
        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(direccion));
        if (!completo) {
            // Protocolo de Custom Tabs sin la biblioteca de androidx: una sesión vacía.
            Bundle extras = new Bundle();
            extras.putBinder("android.support.customtabs.extra.SESSION", null);
            intent.putExtras(extras);
            intent.putExtra("android.support.customtabs.extra.TOOLBAR_COLOR", FONDO);
            intent.putExtra("android.support.customtabs.extra.TITLE_VISIBILITY", 0);
            intent.putExtra("androidx.browser.customtabs.extra.SHARE_STATE", 2);
        } else {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        if (chromeInstalado()) intent.setPackage(CHROME);
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            estado.setText("No encontré un navegador para abrir el juego. Instalá Google Chrome.");
        }
    }

    private boolean chromeInstalado() {
        try {
            getPackageManager().getPackageInfo(CHROME, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    // ---------- Pantalla (sin XML: es chica) ----------

    private View armarPantalla() {
        LinearLayout raiz = new LinearLayout(this);
        raiz.setOrientation(LinearLayout.VERTICAL);
        raiz.setGravity(Gravity.CENTER_HORIZONTAL | Gravity.CENTER_VERTICAL);
        raiz.setBackgroundColor(FONDO);
        raiz.setFitsSystemWindows(true);
        int margen = dp(24);
        raiz.setPadding(margen, margen, margen, margen);

        TextView titulo = texto("ARQUERO", 44, Color.WHITE, true);
        TextView ar = texto("AR", 44, VERDE, true);
        LinearLayout fila = new LinearLayout(this);
        fila.setGravity(Gravity.CENTER);
        fila.addView(titulo);
        ar.setPadding(dp(10), 0, 0, 0);
        fila.addView(ar);
        raiz.addView(fila);

        TextView bajada = texto(
                "Poné un arco con arquero en tu piso real y pateale con tu pelota de verdad.",
                16, Color.parseColor("#A9B8AE"), false);
        bajada.setGravity(Gravity.CENTER);
        bajada.setPadding(0, dp(10), 0, dp(28));
        raiz.addView(bajada);

        jugar = boton("Jugar", true);
        jugar.setOnClickListener(v -> abrir(false));
        raiz.addView(jugar, anchoCompleto(dp(56)));

        enChrome = boton("Abrir en Chrome", false);
        enChrome.setOnClickListener(v -> abrir(true));
        LinearLayout.LayoutParams p = anchoCompleto(dp(52));
        p.topMargin = dp(10);
        raiz.addView(enChrome, p);

        TextView ayuda = texto(
                "Necesita Google Chrome y «Servicios de Google Play para RA». La primera vez Chrome te pide "
                        + "permiso para usar la cámara. Si dentro de la app no arranca la realidad aumentada, "
                        + "usá «Abrir en Chrome».",
                13, Color.parseColor("#A9B8AE"), false);
        ayuda.setGravity(Gravity.CENTER);
        ayuda.setPadding(0, dp(24), 0, 0);
        raiz.addView(ayuda);

        estado = texto("", 14, Color.parseColor("#FFD2D3"), false);
        estado.setGravity(Gravity.CENTER);
        estado.setPadding(0, dp(16), 0, 0);
        raiz.addView(estado);
        return raiz;
    }

    private TextView texto(String s, int sp, int color, boolean negrita) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextColor(color);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        if (negrita) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private Button boton(String s, boolean principal) {
        Button b = new Button(this);
        b.setText(s);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(principal ? FONDO : Color.WHITE);
        GradientDrawable forma = new GradientDrawable();
        forma.setCornerRadius(dp(16));
        if (principal) {
            forma.setColor(VERDE);
        } else {
            forma.setColor(Color.TRANSPARENT);
            forma.setStroke(dp(1), Color.parseColor("#3A4A40"));
        }
        b.setBackground(forma);
        b.setEnabled(false);
        return b;
    }

    private LinearLayout.LayoutParams anchoCompleto(int alto) {
        return new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, alto);
    }

    private int dp(int valor) {
        return Math.round(valor * getResources().getDisplayMetrics().density);
    }
}
