package app.orbita.client;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

// Cliente del motor Órbita. El servidor solo acepta localhost, así que se conecta
// al PC con `adb reverse tcp:3000 tcp:3000`.
public class MainActivity extends Activity {
    private static final String URL = "http://localhost:3000/";
    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) view.loadDataWithBaseURL(null,
                    "<meta name=viewport content='width=device-width'><body style='font-family:sans-serif;padding:24px'>"
                    + "<h2>Sin conexión con Órbita</h2><p>En el PC: <code>npm start</code> y luego "
                    + "<code>adb reverse tcp:3000 tcp:3000</code> con el teléfono conectado por USB.</p>"
                    + "<p><a href='" + URL + "'>Reintentar</a></p>", "text/html", "utf-8", null);
            }
        });
        setContentView(web);
        if (state == null) web.loadUrl(URL); else web.restoreState(state);
    }

    @Override protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
}
