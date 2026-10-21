package ar.gravity.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.graphics.Bitmap
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.PopupMenu
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import java.util.Locale
import kotlin.math.abs

/**
 * Gravity para Android: un WebView a pantalla completa que abre el Gravity de tu compu.
 * La primera vez pide la dirección; después se cambia desde el botón flotante,
 * desde la pantalla de error o manteniendo apretado el ícono de la app.
 */
class MainActivity : Activity() {

    private lateinit var raiz: FrameLayout
    private lateinit var web: WebView
    private lateinit var progreso: ProgressBar
    private lateinit var panelError: View
    private lateinit var errorDetalle: TextView
    private lateinit var errorDireccion: TextView
    private lateinit var panelDireccion: View
    private lateinit var campoDireccion: EditText
    private lateinit var avisoDireccion: TextView
    private lateinit var botonCancelar: Button
    private lateinit var manija: ImageButton

    /** Dirección guardada (null hasta que la cargás la primera vez). */
    private var direccion: String? = null

    /** ControlAtras en Android 13+; Any para no cargar la clase en versiones viejas. */
    private var controlAtras: Any? = null

    /**
     * Hubo un error de carga desde el último onPageFinished. WebView avisa onPageStarted recién
     * cuando la navegación se confirma (en un error, después de onReceivedError), así que la
     * decisión de mostrar u ocultar la pantalla de error se toma en onPageFinished.
     */
    private var errorPendiente = false
    /** Al cambiar de dirección: limpiar el historial cuando cargue la primera página de la nueva. */
    private var limpiarHistorialAlLlegarA: String? = null
    private var rendererCaido = false
    private var callbackArchivos: ValueCallback<Array<Uri>>? = null
    private var fraccionManija = 0.42f
    private var arrastrandoManija = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        raiz = findViewById(R.id.raiz)
        web = findViewById(R.id.web)
        progreso = findViewById(R.id.progreso)
        panelError = findViewById(R.id.panelError)
        errorDetalle = findViewById(R.id.errorDetalle)
        errorDireccion = findViewById(R.id.errorDireccion)
        panelDireccion = findViewById(R.id.panelDireccion)
        campoDireccion = findViewById(R.id.campoDireccion)
        avisoDireccion = findViewById(R.id.avisoDireccion)
        botonCancelar = findViewById(R.id.botonCancelar)
        manija = findViewById(R.id.manija)

        if (Build.VERSION.SDK_INT >= 33) controlAtras = ControlAtras(this) { volver() }

        configurarBordes()
        configurarWeb()
        configurarPaneles()
        configurarManija()

        direccion = Direcciones.leer(this)
        val restaurado = savedInstanceState != null && web.restoreState(savedInstanceState) != null
        val guardada = direccion
        when {
            guardada == null -> mostrarPanelDireccion()
            else -> {
                if (!restaurado) web.loadUrl(guardada)
                manija.visibility = View.VISIBLE
                if (intent?.action == ACCION_CAMBIAR_DIRECCION) mostrarPanelDireccion()
            }
        }
        actualizarAtras()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == ACCION_CAMBIAR_DIRECCION) mostrarPanelDireccion()
    }

    // ---------------------------------------------------------------- Bordes de pantalla

    /**
     * Desde Android 15 (API 35) las apps que apuntan a esa versión dibujan detrás de las barras
     * del sistema. Se agrega ese espacio como padding (también el del teclado) para que nada
     * quede tapado. En versiones anteriores el sistema ya lo resuelve solo.
     */
    private fun configurarBordes() {
        raiz.setOnApplyWindowInsetsListener { vista, insets ->
            if (Build.VERSION.SDK_INT >= 35) {
                val bordes = insets.getInsets(
                    WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime(),
                )
                vista.setPadding(bordes.left, bordes.top, bordes.right, bordes.bottom)
                WindowInsets.CONSUMED
            } else {
                insets
            }
        }
    }

    // ---------------------------------------------------------------- WebView

    @SuppressLint("SetJavaScriptEnabled")
    private fun configurarWeb() {
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        web.setBackgroundColor(getColor(R.color.fondo))
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            // La página solo habla con tu compu: nada de archivos locales ni contenido mixto.
            allowFileAccess = false
            allowContentAccess = false
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = false
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = "$userAgentString GravityAndroid/1"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        web.webViewClient = ClienteWeb()
        web.webChromeClient = CromoWeb()
        web.setDownloadListener { url, agente, disposicion, tipo, _ ->
            descargar(url, agente, disposicion, tipo)
        }
    }

    private inner class ClienteWeb : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            if (!request.isForMainFrame) return false
            return manejarNavegacion(request.url)
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            progreso.visibility = View.VISIBLE
        }

        override fun onPageFinished(view: WebView, url: String?) {
            progreso.visibility = View.GONE
            val huboError = errorPendiente
            errorPendiente = false
            if (!huboError) ocultarError()
            val destino = limpiarHistorialAlLlegarA
            if (destino != null && url != null && Direcciones.host(url) == Direcciones.host(destino)) {
                // Cambiaste de dirección: el historial del servidor anterior ya no sirve.
                limpiarHistorialAlLlegarA = null
                view.clearHistory()
            }
            CookieManager.getInstance().flush()
            actualizarAtras()
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            actualizarAtras()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            when (error.errorCode) {
                ERROR_UNSUPPORTED_SCHEME, ERROR_FILE, ERROR_FILE_NOT_FOUND -> return
            }
            errorPendiente = true
            val ssl = error.errorCode == ERROR_FAILED_SSL_HANDSHAKE
            mostrarError(getString(if (ssl) R.string.error_ssl else R.string.error_red))
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
            if (!request.isForMainFrame) return
            val codigo = errorResponse.statusCode
            // 502/503/504: túnel o proxy sin Gravity detrás. 520-530: errores de Cloudflare.
            if (codigo == 502 || codigo == 503 || codigo == 504 || codigo in 520..530) {
                errorPendiente = true
                mostrarError(getString(R.string.error_http, codigo))
            }
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            // Nunca se acepta un certificado inválido.
            handler.cancel()
            val hostError = Direcciones.host(error.url ?: "")
            if (hostError != null && hostError == hostServidor()) {
                errorPendiente = true
                mostrarError(getString(R.string.error_ssl))
            }
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // El motor del WebView se cerró (falta de memoria, por ejemplo). Ese WebView ya no se puede
            // usar: se saca de la pantalla, se destruye y se arma la actividad de nuevo.
            if (rendererCaido) return true
            rendererCaido = true
            (view.parent as? ViewGroup)?.removeView(view)
            view.destroy()
            recreate()
            return true
        }
    }

    private inner class CromoWeb : WebChromeClient() {
        override fun onProgressChanged(view: WebView, newProgress: Int) {
            progreso.progress = newProgress
            progreso.visibility = if (newProgress in 0..99) View.VISIBLE else View.GONE
        }

        override fun onShowFileChooser(
            webView: WebView,
            filePathCallback: ValueCallback<Array<Uri>>,
            fileChooserParams: FileChooserParams,
        ): Boolean {
            callbackArchivos?.onReceiveValue(null)
            callbackArchivos = filePathCallback
            return try {
                @Suppress("DEPRECATION")
                startActivityForResult(fileChooserParams.createIntent(), PEDIDO_ARCHIVOS)
                true
            } catch (e: ActivityNotFoundException) {
                callbackArchivos = null
                avisar(getString(R.string.sin_app_archivos))
                false
            }
        }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == PEDIDO_ARCHIVOS) {
            callbackArchivos?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
            callbackArchivos = null
            return
        }
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
    }

    private fun hostServidor(): String? = direccion?.let { Direcciones.host(it) }

    /** true = la navegación la maneja la app (se abre afuera); false = sigue en el WebView. */
    private fun manejarNavegacion(uri: Uri): Boolean {
        val esquema = uri.scheme?.lowercase(Locale.ROOT) ?: return true
        if (esquema == "http" || esquema == "https") {
            val host = uri.host?.lowercase(Locale.ROOT)
            if (host != null && host == hostServidor()) return false
            abrirAfuera(uri)
            return true
        }
        if (esquema == "about" || esquema == "data" || esquema == "blob" || esquema == "javascript") return false
        // mailto:, tel:, geo:, intent:...
        abrirAfuera(uri)
        return true
    }

    private fun abrirAfuera(uri: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
        } catch (e: ActivityNotFoundException) {
            avisar(getString(R.string.sin_app_enlace))
        }
    }

    private fun descargar(url: String, agente: String?, disposicion: String?, tipo: String?) {
        val uri = Uri.parse(url)
        val esquema = uri.scheme?.lowercase(Locale.ROOT)
        if (esquema != "http" && esquema != "https") {
            // blob: y data: no se pueden pasar al gestor de descargas del sistema.
            avisar(getString(R.string.descarga_no_soportada))
            return
        }
        try {
            val nombre = URLUtil.guessFileName(url, disposicion, tipo)
            val pedido = DownloadManager.Request(uri)
                .setTitle(nombre)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            if (!tipo.isNullOrBlank()) pedido.setMimeType(tipo)
            // La sesión (cookie) viaja con la descarga, así funcionan los archivos que piden contraseña.
            CookieManager.getInstance().getCookie(url)?.let { pedido.addRequestHeader("Cookie", it) }
            if (!agente.isNullOrBlank()) pedido.addRequestHeader("User-Agent", agente)
            if (Build.VERSION.SDK_INT >= 29) {
                pedido.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, nombre)
            } else {
                // Antes de Android 10 la carpeta pública pide permiso de almacenamiento; esta no.
                pedido.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, nombre)
            }
            val gestor = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
            gestor.enqueue(pedido)
            avisar(getString(R.string.descarga_iniciada, nombre))
        } catch (e: Exception) {
            avisar(getString(R.string.descarga_fallo))
        }
    }

    // ---------------------------------------------------------------- Error de conexión

    private fun configurarPaneles() {
        findViewById<Button>(R.id.botonReintentar).setOnClickListener { reintentar() }
        findViewById<Button>(R.id.botonCambiarDesdeError).setOnClickListener { mostrarPanelDireccion() }
        findViewById<Button>(R.id.botonConectar).setOnClickListener { guardarDireccion() }
        botonCancelar.setOnClickListener { cerrarPanelDireccion() }
        campoDireccion.setOnEditorActionListener { _, accion, _ ->
            if (accion == EditorInfo.IME_ACTION_GO || accion == EditorInfo.IME_ACTION_DONE) {
                guardarDireccion()
                true
            } else {
                false
            }
        }
        findViewById<TextView>(R.id.ejemploWifi).setOnClickListener { usarEjemplo(getString(R.string.ejemplo_wifi)) }
        findViewById<TextView>(R.id.ejemploTailscale).setOnClickListener { usarEjemplo(getString(R.string.ejemplo_tailscale)) }
    }

    private fun mostrarError(detalle: String) {
        errorDetalle.text = detalle
        errorDireccion.text = direccion ?: ""
        panelError.visibility = View.VISIBLE
    }

    private fun ocultarError() {
        panelError.visibility = View.GONE
    }

    private fun reintentar() {
        if (rendererCaido) return
        val guardada = direccion ?: return mostrarPanelDireccion()
        // Un error viejo (por ejemplo de certificado, que no siempre trae onPageFinished) no tiene
        // que dejar la pantalla de error puesta si este intento sale bien.
        errorPendiente = false
        val actual = web.url
        if (actual.isNullOrEmpty() || actual.startsWith("about:") || actual.startsWith("data:")) {
            web.loadUrl(guardada)
        } else {
            web.reload()
        }
    }

    // ---------------------------------------------------------------- Dirección

    private fun mostrarPanelDireccion() {
        campoDireccion.setText(direccion ?: "")
        campoDireccion.setSelection(campoDireccion.text.length)
        avisoDireccion.visibility = View.GONE
        botonCancelar.visibility = if (direccion == null) View.GONE else View.VISIBLE
        panelDireccion.visibility = View.VISIBLE
        manija.visibility = View.GONE
        actualizarAtras()
    }

    private fun cerrarPanelDireccion() {
        ocultarTeclado()
        panelDireccion.visibility = View.GONE
        if (direccion != null) manija.visibility = View.VISIBLE
        actualizarAtras()
    }

    private fun usarEjemplo(ejemplo: String) {
        campoDireccion.setText(ejemplo)
        campoDireccion.requestFocus()
        campoDireccion.setSelection(ejemplo.length)
        val teclado = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        teclado.showSoftInput(campoDireccion, 0)
    }

    private fun guardarDireccion() {
        when (val revision = Direcciones.revisar(campoDireccion.text.toString())) {
            is Direcciones.Revision.Invalida -> {
                avisoDireccion.setText(revision.mensaje)
                avisoDireccion.visibility = View.VISIBLE
            }
            is Direcciones.Revision.Valida -> {
                val nueva = revision.url
                val cambio = nueva != direccion
                Direcciones.guardar(this, nueva)
                direccion = nueva
                cerrarPanelDireccion()
                if (cambio || web.url.isNullOrEmpty() || panelError.visibility == View.VISIBLE) {
                    ocultarError()
                    errorPendiente = false
                    limpiarHistorialAlLlegarA = nueva
                    web.stopLoading()
                    web.loadUrl(nueva)
                }
            }
        }
    }

    private fun ocultarTeclado() {
        val teclado = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        teclado.hideSoftInputFromWindow(campoDireccion.windowToken, 0)
    }

    // ---------------------------------------------------------------- Botón flotante

    /** Se toca para abrir el menú y se arrastra para moverlo por el borde derecho. */
    @SuppressLint("ClickableViewAccessibility")
    private fun configurarManija() {
        fraccionManija = Direcciones.leerPosicionManija(this)
        val umbral = ViewConfiguration.get(this).scaledTouchSlop
        var inicioY = 0f
        var traslacionInicial = 0f

        manija.setOnTouchListener { vista, evento ->
            when (evento.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    inicioY = evento.rawY
                    traslacionInicial = vista.translationY
                    arrastrandoManija = false
                    vista.isPressed = true
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val desplazamiento = evento.rawY - inicioY
                    if (!arrastrandoManija && abs(desplazamiento) > umbral) {
                        arrastrandoManija = true
                        vista.isPressed = false
                    }
                    if (arrastrandoManija) {
                        val maximo = recorridoManija()
                        vista.translationY = (traslacionInicial + desplazamiento).coerceIn(0f, maximo)
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    vista.isPressed = false
                    if (arrastrandoManija) {
                        arrastrandoManija = false
                        val maximo = recorridoManija()
                        fraccionManija = if (maximo > 0f) vista.translationY / maximo else 0f
                        Direcciones.guardarPosicionManija(this, fraccionManija)
                    } else {
                        vista.performClick()
                    }
                    true
                }
                MotionEvent.ACTION_CANCEL -> {
                    vista.isPressed = false
                    arrastrandoManija = false
                    true
                }
                else -> false
            }
        }
        manija.setOnClickListener { mostrarMenu(it) }
        raiz.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> ubicarManija() }
    }

    /** Cuánto puede bajar la manija desde su lugar arriba a la derecha. */
    private fun recorridoManija(): Float {
        val margen = (manija.layoutParams as? ViewGroup.MarginLayoutParams)?.topMargin ?: 0
        return (raiz.height - raiz.paddingBottom - margen - manija.bottom).toFloat().coerceAtLeast(0f)
    }

    private fun ubicarManija() {
        if (arrastrandoManija) return
        manija.translationY = recorridoManija() * fraccionManija.coerceIn(0f, 1f)
    }

    private fun mostrarMenu(ancla: View) {
        val menu = PopupMenu(this, ancla)
        menu.menu.add(0, MENU_RECARGAR, 0, R.string.menu_recargar)
        menu.menu.add(0, MENU_CAMBIAR, 1, R.string.menu_cambiar_direccion)
        menu.menu.add(0, MENU_NAVEGADOR, 2, R.string.menu_abrir_navegador)
        menu.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                MENU_RECARGAR -> {
                    reintentar()
                    true
                }
                MENU_CAMBIAR -> {
                    mostrarPanelDireccion()
                    true
                }
                MENU_NAVEGADOR -> {
                    val actual = web.url?.takeIf { it.startsWith("http") } ?: direccion
                    if (actual != null) abrirAfuera(Uri.parse(actual))
                    true
                }
                else -> false
            }
        }
        menu.show()
    }

    // ---------------------------------------------------------------- Atrás

    private fun debeInterceptarAtras(): Boolean =
        (panelDireccion.visibility == View.VISIBLE && direccion != null) || (!rendererCaido && web.canGoBack())

    private fun actualizarAtras() {
        if (Build.VERSION.SDK_INT >= 33) {
            (controlAtras as? ControlAtras)?.activar(debeInterceptarAtras())
        }
    }

    private fun volver() {
        when {
            panelDireccion.visibility == View.VISIBLE && direccion != null -> cerrarPanelDireccion()
            !rendererCaido && web.canGoBack() -> {
                ocultarError()
                web.goBack()
            }
            else -> finish()
        }
    }

    /** Android 12 y anteriores. En 13+ lo maneja ControlAtras. */
    @Deprecated("Reemplazado por OnBackInvokedCallback en Android 13+")
    override fun onBackPressed() {
        if (debeInterceptarAtras()) {
            volver()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    // ---------------------------------------------------------------- Ciclo de vida

    override fun onResume() {
        super.onResume()
        if (rendererCaido) return
        web.onResume()
        // Si volvés a la app con la pantalla de error, se prueba de nuevo (quizás ya prendiste la compu).
        if (panelError.visibility == View.VISIBLE && panelDireccion.visibility != View.VISIBLE) reintentar()
    }

    override fun onPause() {
        if (!rendererCaido) web.onPause()
        // Guarda las cookies (la sesión) en disco: si Android cierra la app, seguís logueado.
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (!rendererCaido) web.saveState(outState)
    }

    override fun onDestroy() {
        callbackArchivos?.onReceiveValue(null)
        callbackArchivos = null
        if (!rendererCaido) {
            (web.parent as? ViewGroup)?.removeView(web)
            web.destroy()
        }
        super.onDestroy()
    }

    private fun avisar(texto: String) {
        Toast.makeText(this, texto, Toast.LENGTH_LONG).show()
    }

    private companion object {
        const val ACCION_CAMBIAR_DIRECCION = "ar.gravity.app.CAMBIAR_DIRECCION"
        const val PEDIDO_ARCHIVOS = 41
        const val MENU_RECARGAR = 1
        const val MENU_CAMBIAR = 2
        const val MENU_NAVEGADOR = 3
    }
}
