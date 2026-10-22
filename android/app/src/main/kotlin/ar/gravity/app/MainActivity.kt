package ar.gravity.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
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
 * Gravity todo en uno: el motor (Node.js con los bots) corre en este celular, en el servicio
 * [Motor], y esta pantalla lo muestra en un WebView. La primera vez pide la clave de Anthropic.
 */
class MainActivity : Activity() {

    private lateinit var raiz: FrameLayout
    private lateinit var web: WebView
    private lateinit var progreso: ProgressBar
    private lateinit var panelEstado: View
    private lateinit var estadoGirando: ProgressBar
    private lateinit var estadoTitulo: TextView
    private lateinit var estadoDetalle: TextView
    private lateinit var estadoRegistro: TextView
    private lateinit var botonReintentar: Button
    private lateinit var botonClaveDesdeEstado: Button
    private lateinit var panelClave: View
    private lateinit var campoClave: EditText
    private lateinit var avisoClave: TextView
    private lateinit var ayudaClave: TextView
    private lateinit var enlaceConsola: TextView
    private lateinit var botonGemini: Button
    private lateinit var botonClaude: Button
    private lateinit var grupoRespaldo: View
    private lateinit var campoRespaldo: EditText
    private lateinit var botonCancelar: Button
    private lateinit var manija: ImageButton

    private val principal = Handler(Looper.getMainLooper())
    private val preferencias by lazy { getSharedPreferences("gravity", Context.MODE_PRIVATE) }

    /** ControlAtras en Android 13+; Any para no cargar la clase en versiones viejas. */
    private var controlAtras: Any? = null

    /** Modelo elegido en el panel de claves (todavía sin guardar). */
    private var proveedorElegido = Clave.GEMINI

    /** Número de la espera en curso: una espera vieja (de antes de reiniciar) no toca la pantalla. */
    private var espera = 0
    private var cargada = false
    private var errorPendiente = false
    /** Recargas seguidas por errores del motor: si no para, se muestra el error en vez de insistir. */
    private val reintentosRecientes = ArrayDeque<Long>()
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
        panelEstado = findViewById(R.id.panelEstado)
        estadoGirando = findViewById(R.id.estadoGirando)
        estadoTitulo = findViewById(R.id.estadoTitulo)
        estadoDetalle = findViewById(R.id.estadoDetalle)
        estadoRegistro = findViewById(R.id.estadoRegistro)
        botonReintentar = findViewById(R.id.botonReintentar)
        botonClaveDesdeEstado = findViewById(R.id.botonClaveDesdeEstado)
        panelClave = findViewById(R.id.panelClave)
        campoClave = findViewById(R.id.campoClave)
        avisoClave = findViewById(R.id.avisoClave)
        ayudaClave = findViewById(R.id.ayudaClave)
        enlaceConsola = findViewById(R.id.enlaceConsola)
        botonGemini = findViewById(R.id.botonGemini)
        botonClaude = findViewById(R.id.botonClaude)
        grupoRespaldo = findViewById(R.id.grupoRespaldo)
        campoRespaldo = findViewById(R.id.campoRespaldo)
        botonCancelar = findViewById(R.id.botonCancelar)
        manija = findViewById(R.id.manija)

        if (Build.VERSION.SDK_INT >= 33) controlAtras = ControlAtras(this) { volver() }

        configurarBordes()
        configurarWeb()
        configurarPaneles()
        configurarManija()

        if (Clave.lista(this)) {
            if (savedInstanceState != null && web.restoreState(savedInstanceState) != null) cargada = true
            arrancar(reiniciar = false)
        } else {
            mostrarPanelClave()
        }
        actualizarAtras()
    }

    // ---------------------------------------------------------------- Bordes de pantalla

    /** Desde Android 15 la app dibuja detrás de las barras del sistema: se agrega ese espacio como padding. */
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

    // ---------------------------------------------------------------- Motor

    /** Prende el motor (o lo reinicia) y abre Gravity cuando responde. */
    private fun arrancar(reiniciar: Boolean) {
        Gravity.marcarApagado(this, false)
        pedirNotificaciones()
        val numero = ++espera
        mostrarEstado(getString(if (reiniciar) R.string.estado_reiniciando else R.string.estado_arrancando), null, girando = true)
        Thread {
            if (reiniciar) {
                enviarAlMotor(Motor.ACCION_REINICIAR)
                // Se espera a que el motor viejo suelte el puerto antes de prender el nuevo.
                val hasta = System.currentTimeMillis() + 10_000
                while (System.currentTimeMillis() < hasta && motorResponde()) Thread.sleep(300)
                Thread.sleep(500)
            }
            principal.post { if (numero == espera) enviarAlMotor(Motor.ACCION_INICIAR) }
            // La primera vez Node compila el motor entero: puede tardar un poco.
            val hasta = System.currentTimeMillis() + 90_000
            var listo = false
            while (numero == espera && System.currentTimeMillis() < hasta) {
                if (motorResponde()) {
                    listo = true
                    break
                }
                Thread.sleep(400)
            }
            principal.post {
                if (numero != espera || isDestroyed) return@post
                if (listo) abrirGravity() else mostrarFallo()
            }
        }.start()
    }

    private fun enviarAlMotor(accion: String) {
        try {
            Motor.enviar(this, accion)
        } catch (e: Exception) {
            principal.post { avisar(getString(R.string.motor_no_arranca)) }
        }
    }

    /** Responde y es nuestro motor (firma el reto con el token): recién ahí se le manda la cookie. */
    private fun motorResponde(): Boolean = Gravity.motorAutentico(this)

    private fun abrirGravity() {
        val cookie = "gravity_app=${Gravity.token(this)}; Path=/; HttpOnly; SameSite=Strict"
        CookieManager.getInstance().setCookie(Gravity.DIRECCION, cookie) {
            CookieManager.getInstance().flush()
            errorPendiente = false
            if (cargada && !web.url.isNullOrEmpty()) web.reload() else web.loadUrl("${Gravity.DIRECCION}/")
            cargada = true
            ocultarEstado()
            manija.visibility = View.VISIBLE
            actualizarAtras()
            principal.postDelayed({ ofrecerBateria() }, 4_000)
        }
    }

    private fun mostrarFallo() {
        val registro = Gravity.finDelRegistro(this)
        mostrarEstado(getString(R.string.estado_fallo_titulo), getString(R.string.estado_fallo), girando = false, registro = registro)
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
            // La página solo habla con el motor local: nada de archivos ni contenido mixto.
            allowFileAccess = false
            allowContentAccess = false
            @Suppress("DEPRECATION")
            allowFileAccessFromFileURLs = false
            @Suppress("DEPRECATION")
            allowUniversalAccessFromFileURLs = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            userAgentString = "$userAgentString GravityAndroid/2"
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
            if (errorPendiente) {
                // El motor se cayó o se está reiniciando: se espera a que vuelva y se recarga solo.
                errorPendiente = false
                val ahora = System.currentTimeMillis()
                while (reintentosRecientes.isNotEmpty() && ahora - reintentosRecientes.first() > 60_000) reintentosRecientes.removeFirst()
                reintentosRecientes.addLast(ahora)
                if (reintentosRecientes.size > 3) mostrarFallo() else arrancar(reiniciar = false)
            }
            CookieManager.getInstance().flush()
            actualizarAtras()
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            actualizarAtras()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame && esDelMotor(request.url)) errorPendiente = true
        }

        override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
            // 401: la cookie no llegó o el token cambió. Se vuelve a poner.
            // 502-504: la página de "sin conexión" del service worker con el motor caído.
            val codigo = errorResponse.statusCode
            if (request.isForMainFrame && esDelMotor(request.url) && (codigo == 401 || codigo in 502..504)) errorPendiente = true
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // El motor del WebView se cerró (falta de memoria, por ejemplo): se arma la actividad de nuevo.
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

    private fun esDelMotor(uri: Uri): Boolean =
        uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port == Gravity.PUERTO

    /** true = la navegación la maneja la app (se abre afuera); false = sigue en el WebView. */
    private fun manejarNavegacion(uri: Uri): Boolean {
        val esquema = uri.scheme?.lowercase(Locale.ROOT) ?: return true
        if (esDelMotor(uri)) return false
        if (esquema == "about" || esquema == "data" || esquema == "blob" || esquema == "javascript") return false
        // Enlaces de afuera (por ejemplo, el inicio de sesión de Microsoft), mailto:, tel:...
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
            avisar(getString(R.string.descarga_no_soportada))
            return
        }
        try {
            val nombre = URLUtil.guessFileName(url, disposicion, tipo)
            val pedido = DownloadManager.Request(uri)
                .setTitle(nombre)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            if (!tipo.isNullOrBlank()) pedido.setMimeType(tipo)
            // La cookie con el token viaja con la descarga: sin ella el motor la rechaza.
            CookieManager.getInstance().getCookie(url)?.let { pedido.addRequestHeader("Cookie", it) }
            if (!agente.isNullOrBlank()) pedido.addRequestHeader("User-Agent", agente)
            if (Build.VERSION.SDK_INT >= 29) {
                pedido.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, nombre)
            } else {
                pedido.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, nombre)
            }
            (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(pedido)
            avisar(getString(R.string.descarga_iniciada, nombre))
        } catch (e: Exception) {
            avisar(getString(R.string.descarga_fallo))
        }
    }

    // ---------------------------------------------------------------- Paneles

    private fun configurarPaneles() {
        // Sin matar un motor que quizás sigue arrancando: el reinicio forzado está en el menú.
        botonReintentar.setOnClickListener { arrancar(reiniciar = false) }
        botonClaveDesdeEstado.setOnClickListener { mostrarPanelClave() }
        findViewById<Button>(R.id.botonGuardarClave).setOnClickListener { guardarClave() }
        enlaceConsola.setOnClickListener {
            abrirAfuera(Uri.parse(if (proveedorElegido == Clave.GEMINI) CONSOLA_GEMINI else CONSOLA_ANTHROPIC))
        }
        findViewById<TextView>(R.id.enlaceRespaldo).setOnClickListener { abrirAfuera(Uri.parse(CONSOLA_OPENROUTER)) }
        botonGemini.setOnClickListener { marcarProveedor(Clave.GEMINI) }
        botonClaude.setOnClickListener { marcarProveedor(Clave.ANTHROPIC) }
        botonCancelar.setOnClickListener { cerrarPanelClave() }
        campoClave.setOnEditorActionListener { _, accion, _ ->
            if (accion == EditorInfo.IME_ACTION_GO || accion == EditorInfo.IME_ACTION_DONE) {
                guardarClave()
                true
            } else {
                false
            }
        }
    }

    private fun mostrarEstado(titulo: String, detalle: String?, girando: Boolean, registro: String = "") {
        estadoTitulo.text = titulo
        estadoDetalle.text = detalle ?: ""
        estadoDetalle.visibility = if (detalle == null) View.GONE else View.VISIBLE
        estadoRegistro.text = registro
        estadoRegistro.visibility = if (registro.isBlank()) View.GONE else View.VISIBLE
        estadoGirando.visibility = if (girando) View.VISIBLE else View.GONE
        botonReintentar.visibility = if (girando) View.GONE else View.VISIBLE
        botonClaveDesdeEstado.visibility = if (girando) View.GONE else View.VISIBLE
        panelEstado.visibility = View.VISIBLE
        manija.visibility = View.GONE
    }

    private fun ocultarEstado() {
        panelEstado.visibility = View.GONE
        if (cargada && panelClave.visibility != View.VISIBLE) manija.visibility = View.VISIBLE
    }

    private fun mostrarPanelClave() {
        campoClave.setText("")
        campoRespaldo.setText("")
        campoRespaldo.hint = getString(if (Clave.existe(this, Clave.OPENROUTER)) R.string.clave_guardada_pista else R.string.respaldo_pista)
        marcarProveedor(Clave.proveedor(this))
        avisoClave.visibility = View.GONE
        botonCancelar.visibility = if (Clave.lista(this)) View.VISIBLE else View.GONE
        panelClave.visibility = View.VISIBLE
        manija.visibility = View.GONE
        actualizarAtras()
    }

    private fun cerrarPanelClave() {
        ocultarTeclado()
        panelClave.visibility = View.GONE
        if (cargada) manija.visibility = View.VISIBLE
        actualizarAtras()
    }

    /** Gemini (gratis) o Claude: cambia los textos, el enlace y si se ofrece el respaldo gratis. */
    private fun marcarProveedor(proveedor: String) {
        proveedorElegido = proveedor
        val gemini = proveedor == Clave.GEMINI
        botonGemini.setBackgroundResource(if (gemini) R.drawable.boton_primario else R.drawable.boton_secundario)
        botonGemini.setTextColor(getColor(if (gemini) R.color.sobre_primario else R.color.texto))
        botonClaude.setBackgroundResource(if (gemini) R.drawable.boton_secundario else R.drawable.boton_primario)
        botonClaude.setTextColor(getColor(if (gemini) R.color.texto else R.color.sobre_primario))
        ayudaClave.setText(if (gemini) R.string.clave_ayuda_gemini else R.string.clave_ayuda_claude)
        enlaceConsola.setText(if (gemini) R.string.clave_donde_gemini else R.string.clave_donde_claude)
        campoClave.hint = getString(
            when {
                Clave.existe(this, proveedor) -> R.string.clave_guardada_pista
                gemini -> R.string.clave_pista_gemini
                else -> R.string.clave_pista_claude
            },
        )
        grupoRespaldo.visibility = if (gemini) View.VISIBLE else View.GONE
        avisoClave.visibility = View.GONE
    }

    private fun guardarClave() {
        val texto = campoClave.text.toString().trim()
        val respaldo = campoRespaldo.text.toString().trim()
        // Vacío con una clave ya guardada: se mantiene la que estaba.
        val mantiene = texto.isEmpty() && Clave.existe(this, proveedorElegido)
        val error = (if (mantiene) null else Clave.revisar(texto))
            ?: respaldo.takeIf { it.isNotEmpty() && proveedorElegido == Clave.GEMINI }?.let { Clave.revisar(it) }
        if (error != null) {
            avisoClave.setText(error)
            avisoClave.visibility = View.VISIBLE
            return
        }
        val habiaClave = Clave.lista(this)
        try {
            if (!mantiene) Clave.guardar(this, proveedorElegido, texto)
            if (respaldo.isNotEmpty() && proveedorElegido == Clave.GEMINI) Clave.guardar(this, Clave.OPENROUTER, respaldo)
            Clave.elegirProveedor(this, proveedorElegido)
        } catch (e: Exception) {
            avisoClave.text = getString(R.string.clave_no_guardada, e.message ?: e.javaClass.simpleName)
            avisoClave.visibility = View.VISIBLE
            return
        }
        campoClave.setText("")
        campoRespaldo.setText("")
        cerrarPanelClave()
        // El motor lee la clave al arrancar: si ya estaba prendido, se reinicia.
        arrancar(reiniciar = habiaClave)
    }

    private fun ocultarTeclado() {
        val teclado = getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        teclado.hideSoftInputFromWindow(campoClave.windowToken, 0)
    }

    // ---------------------------------------------------------------- Permisos y batería

    private fun pedirNotificaciones() {
        if (Build.VERSION.SDK_INT < 33) return
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        if (preferencias.getBoolean("pidio_notificaciones", false)) return
        preferencias.edit().putBoolean("pidio_notificaciones", true).apply()
        requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), PEDIDO_NOTIFICACIONES)
    }

    private fun sinRestriccionDeBateria(): Boolean =
        getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(packageName)

    /** Una sola vez: sin esto, Android duerme al motor con la pantalla apagada. */
    private fun ofrecerBateria() {
        if (isFinishing || isDestroyed || sinRestriccionDeBateria() || preferencias.getBoolean("ofrecio_bateria", false)) return
        preferencias.edit().putBoolean("ofrecio_bateria", true).apply()
        AlertDialog.Builder(this)
            .setTitle(R.string.bateria_titulo)
            .setMessage(R.string.bateria_explicacion)
            .setPositiveButton(R.string.bateria_permitir) { _, _ -> pedirSinRestriccion() }
            .setNegativeButton(R.string.ahora_no, null)
            .show()
    }

    @SuppressLint("BatteryLife")
    private fun pedirSinRestriccion() {
        try {
            startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:$packageName")))
        } catch (e: ActivityNotFoundException) {
            try {
                startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
            } catch (e2: ActivityNotFoundException) {
                avisar(getString(R.string.bateria_sin_ajuste))
            }
        }
    }

    // ---------------------------------------------------------------- Botón flotante

    /** Se toca para abrir el menú y se arrastra para moverlo por el borde derecho. */
    @SuppressLint("ClickableViewAccessibility")
    private fun configurarManija() {
        fraccionManija = preferencias.getFloat("manija_posicion", 0.42f)
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
                        vista.translationY = (traslacionInicial + desplazamiento).coerceIn(0f, recorridoManija())
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    vista.isPressed = false
                    if (arrastrandoManija) {
                        arrastrandoManija = false
                        val maximo = recorridoManija()
                        fraccionManija = if (maximo > 0f) vista.translationY / maximo else 0f
                        preferencias.edit().putFloat("manija_posicion", fraccionManija).apply()
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
        menu.menu.add(0, MENU_REINICIAR, 1, R.string.menu_reiniciar)
        menu.menu.add(0, MENU_CLAVE, 2, R.string.menu_clave)
        if (!sinRestriccionDeBateria()) menu.menu.add(0, MENU_BATERIA, 3, R.string.menu_bateria)
        menu.menu.add(0, MENU_APAGAR, 4, R.string.menu_apagar)
        menu.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                MENU_RECARGAR -> if (!rendererCaido) web.reload()
                MENU_REINICIAR -> arrancar(reiniciar = true)
                MENU_CLAVE -> mostrarPanelClave()
                MENU_BATERIA -> pedirSinRestriccion()
                MENU_APAGAR -> confirmarApagado()
                else -> return@setOnMenuItemClickListener false
            }
            true
        }
        menu.show()
    }

    private fun confirmarApagado() {
        AlertDialog.Builder(this)
            .setTitle(R.string.apagar_titulo)
            .setMessage(R.string.apagar_explicacion)
            .setPositiveButton(R.string.menu_apagar) { _, _ ->
                espera++
                Gravity.marcarApagado(this, true)
                enviarAlMotor(Motor.ACCION_APAGAR)
                finish()
            }
            .setNegativeButton(R.string.cancelar, null)
            .show()
    }

    // ---------------------------------------------------------------- Atrás

    private fun debeInterceptarAtras(): Boolean =
        (panelClave.visibility == View.VISIBLE && Clave.lista(this)) || (!rendererCaido && web.canGoBack())

    private fun actualizarAtras() {
        if (Build.VERSION.SDK_INT >= 33) {
            (controlAtras as? ControlAtras)?.activar(debeInterceptarAtras())
        }
    }

    private fun volver() {
        when {
            panelClave.visibility == View.VISIBLE && Clave.lista(this) -> cerrarPanelClave()
            !rendererCaido && web.canGoBack() -> web.goBack()
            // Atrás no apaga el motor: los compañeros siguen trabajando con la app cerrada.
            else -> moveTaskToBack(true)
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
        Gravity.marcarVisible(this, true)
        if (rendererCaido) return
        web.onResume()
        // Si el motor se cayó mientras no mirabas, se vuelve a prender al entrar.
        if (panelEstado.visibility == View.VISIBLE && botonReintentar.visibility == View.VISIBLE) arrancar(reiniciar = false)
    }

    override fun onPause() {
        Gravity.marcarVisible(this, false)
        if (!rendererCaido) web.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        if (!rendererCaido) web.saveState(outState)
    }

    override fun onDestroy() {
        espera++
        principal.removeCallbacksAndMessages(null)
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
        const val CONSOLA_GEMINI = "https://aistudio.google.com/apikey"
        const val CONSOLA_ANTHROPIC = "https://console.anthropic.com/settings/keys"
        const val CONSOLA_OPENROUTER = "https://openrouter.ai/settings/keys"
        const val PEDIDO_ARCHIVOS = 41
        const val PEDIDO_NOTIFICACIONES = 42
        const val MENU_RECARGAR = 1
        const val MENU_REINICIAR = 2
        const val MENU_CLAVE = 3
        const val MENU_BATERIA = 4
        const val MENU_APAGAR = 5
    }
}
