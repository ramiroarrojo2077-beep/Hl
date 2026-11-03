package ar.gravity.app

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.sqrt

/**
 * Voz nativa para las llamadas con los compañeros. El WebView de Android no trae la Web Speech API
 * (ni SpeechRecognition ni speechSynthesis): la página la usa por acá, como `window.GravityVoz`.
 *
 * - Escuchar: android.speech.SpeechRecognizer, una frase por cada escuchar().
 * - Hablar: TextToSpeech sintetiza a un WAV, se calcula la envolvente de volumen (para animar la
 *   llamada al ritmo de la voz) y se reproduce con MediaPlayer. Las frases van en cola FIFO.
 *
 * Los métodos con @JavascriptInterface corren en el hilo del puente de JavaScript: no hacen trabajo
 * ahí, pasan todo al hilo principal (que verifica que la página sea la del motor local) o al hilo
 * "gravity-voz" (síntesis y lectura del WAV). Los eventos vuelven con window.gravityVoz.evento({...}).
 * El contrato completo está en android/VOZ.md.
 */
class VozPuente(private val actividad: Activity, private val web: WebView) {

    private val app = actividad.applicationContext
    private val principal = Handler(Looper.getMainLooper())
    private val hilo = HandlerThread("gravity-voz").apply { start() }
    private val trabajador = Handler(hilo.looper)
    private val carpeta = File(app.cacheDir, "voz")

    @Volatile private var liberado = false

    /** Entre onStart y onStop de la Activity: fuera de eso no se abre el micrófono. */
    private var visible = false

    // ---------------------------------------------------------------- Estado del reconocimiento (hilo principal)

    private var reconocedor: SpeechRecognizer? = null
    /** Número de la sesión de escucha vigente: los avisos de una sesión vieja se descartan. */
    private var sesionStt = 0
    private var escuchando = false
    /** Idioma pedido mientras se espera la respuesta al permiso del micrófono. */
    private var idiomaPendiente: String? = null
    private var pidiendoPermiso = false
    private var ultimoNivel = 0L
    private var ultimoParcial = ""

    // ---------------------------------------------------------------- Estado del texto a voz

    @Volatile private var tts: TextToSpeech? = null
    private val estadoTts = AtomicInteger(TTS_NADA)
    @Volatile private var ttsSenal = CountDownLatch(1)
    @Volatile private var voces: List<InfoVoz> = emptyList()
    @Volatile private var mapaVoces: Map<String, Voice> = emptyMap()
    @Volatile private var vozPorDefecto: String? = null
    /** Voz cargada en el motor de TTS ahora (solo la toca el hilo gravity-voz). */
    private var vozAplicada: String? = null
    /** Síntesis pedidas al motor de TTS, por utteranceId. */
    private val enCurso = ConcurrentHashMap<String, Encargo>()
    private val numerador = AtomicInteger()

    /** Sube con cada callar(): lo que llega de una generación vieja se tira. */
    @Volatile private var generacion = 0
    private val pendientes = ArrayDeque<Frase>()
    private var sintetizando: Frase? = null
    private val listas = ArrayDeque<Lista>()
    private var reproductor: MediaPlayer? = null
    private var sonando: Lista? = null

    private class Frase(
        val id: String,
        val texto: String,
        val voz: String?,
        val velocidad: Float,
        val tono: Float,
        val generacion: Int,
    )

    private class Encargo(val frase: Frase, val archivo: File)

    private class Lista(val frase: Frase, val archivo: File, val analisis: Analisis?)

    private class Analisis(val duracionMs: Long, val vacio: Boolean, val envolvente: JSONArray)

    private class InfoVoz(val id: String, val nombre: String, val idioma: String, val calidad: String, val red: Boolean)

    // ================================================================ Métodos para JavaScript

    /** JSON con lo que hay: reconocimiento, voces, permiso del micrófono. Prende el TTS si hace falta. */
    @JavascriptInterface
    fun disponible(): String = try {
        if (!origenValidoAhora()) {
            "{}"
        } else {
            asegurarTts()
            // La primera vez el motor de TTS tarda un poco en ligarse: se lo espera un rato corto.
            if (estadoTts.get() == TTS_INICIANDO) ttsSenal.await(ESPERA_TTS_MS, TimeUnit.MILLISECONDS)
            armarDisponible().toString()
        }
    } catch (e: Exception) {
        "{}"
    }

    @JavascriptInterface
    fun escuchar(idioma: String?) {
        val etiqueta = normalizarIdioma(idioma)
        enPrincipal {
            idiomaPendiente = null
            when {
                !visible -> emitirError(ORIGEN_STT, "segundo_plano", cadena(R.string.voz_segundo_plano))
                !SpeechRecognizer.isRecognitionAvailable(app) ->
                    emitirError(ORIGEN_STT, "sin_reconocedor", cadena(R.string.voz_sin_reconocedor))
                app.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED -> {
                    idiomaPendiente = etiqueta
                    if (!pidiendoPermiso && !actividad.isFinishing) {
                        pidiendoPermiso = true
                        actividad.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), PEDIDO_MICROFONO)
                    }
                }
                else -> arrancarReconocimiento(etiqueta)
            }
        }
    }

    @JavascriptInterface
    fun dejarDeEscuchar() {
        enPrincipal {
            idiomaPendiente = null
            if (escuchando) cortarReconocedor()
        }
    }

    @JavascriptInterface
    fun hablar(id: String?, texto: String?, opcionesJson: String?) {
        val limpio = texto?.trim()
        val opciones = leerOpciones(opcionesJson)
        enPrincipal {
            when {
                id.isNullOrEmpty() || id.length > MAX_ID ->
                    emitirError(ORIGEN_TTS, "invalido", cadena(R.string.voz_id_invalido))
                limpio.isNullOrEmpty() || limpio.length > MAX_TEXTO ->
                    emitirError(ORIGEN_TTS, "invalido", cadena(R.string.voz_texto_invalido), id)
                enCola() >= MAX_COLA ->
                    emitirError(ORIGEN_TTS, "cola_llena", cadena(R.string.voz_cola_llena), id)
                else -> {
                    pendientes.addLast(Frase(id, limpio, opciones.voz, opciones.velocidad, opciones.tono, generacion))
                    asegurarTts()
                    procesarSintesis()
                }
            }
        }
    }

    @JavascriptInterface
    fun callar() {
        enPrincipal { cortarVoz(avisar = true) }
    }

    /**
     * No disponible por ahora: la voz sale por el canal de multimedia (USAGE_MEDIA), que ya usa el
     * parlante (o los auriculares si hay). disponible() devuelve "altavoz": false.
     */
    @JavascriptInterface
    @Suppress("UNUSED_PARAMETER")
    fun altavoz(activo: Boolean) {
        // A propósito vacío: pasar al auricular necesita el modo de llamada de AudioManager, que
        // cambia el audio de todo el celular.
    }

    // ================================================================ Ciclo de vida (lo llama MainActivity)

    fun alMostrarse() {
        visible = true
    }

    /** onStop: el micrófono no queda abierto en segundo plano. La voz que suena sigue. */
    fun alOcultarse() {
        visible = false
        val habia = escuchando || idiomaPendiente != null
        idiomaPendiente = null
        cortarReconocedor()
        if (habia) emitirError(ORIGEN_STT, "segundo_plano", cadena(R.string.voz_segundo_plano))
    }

    /** Respuesta al pedido del micrófono (MainActivity.onRequestPermissionsResult). */
    fun alResponderPermiso(concedido: Boolean) {
        pidiendoPermiso = false
        val idioma = idiomaPendiente ?: return
        idiomaPendiente = null
        if (!esNuestraPagina()) return
        when {
            !concedido -> emitirError(ORIGEN_STT, "permiso", cadena(R.string.voz_permiso))
            !visible -> emitirError(ORIGEN_STT, "segundo_plano", cadena(R.string.voz_segundo_plano))
            else -> arrancarReconocimiento(idioma)
        }
    }

    /** Empieza a cargar otra página (o la misma de nuevo): lo que pidió la anterior se corta sin avisar. */
    fun paginaNueva() {
        if (liberado) return
        idiomaPendiente = null
        if (escuchando) cortarReconocedor()
        cortarVoz(avisar = false)
    }

    /** onDestroy (o el WebView se cayó): suelta micrófono, TTS, reproductor y archivos temporales. */
    fun liberar() {
        if (liberado) return
        idiomaPendiente = null
        cortarReconocedor()
        cortarVoz(avisar = false)
        liberado = true
        // Nada de lo que quedó encolado en el hilo principal (plazos, avisos) tiene que correr ya.
        principal.removeCallbacksAndMessages(null)
        estadoTts.set(TTS_FALLO)
        ttsSenal.countDown()
        val motor = tts
        tts = null
        trabajador.post {
            try {
                motor?.stop()
                motor?.shutdown()
            } catch (e: Exception) {
                // El servicio de TTS ya se había ido.
            }
            borrarTemporales()
        }
        hilo.quitSafely()
    }

    // ================================================================ Origen

    /** true si el WebView muestra la página del motor local. Solo en el hilo principal. */
    private fun esNuestraPagina(): Boolean {
        if (liberado) return false
        val url = try {
            web.url
        } catch (e: Exception) {
            null
        } ?: return false
        val uri = Uri.parse(url)
        return uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port == Gravity.PUERTO
    }

    /** Lo mismo desde el hilo del puente: pregunta al hilo principal y espera la respuesta. */
    private fun origenValidoAhora(): Boolean {
        if (liberado) return false
        if (Looper.myLooper() == Looper.getMainLooper()) return esNuestraPagina()
        val ok = AtomicBoolean(false)
        val listo = CountDownLatch(1)
        if (!principal.post { ok.set(esNuestraPagina()); listo.countDown() }) return false
        return listo.await(1, TimeUnit.SECONDS) && ok.get()
    }

    /** Pasa el trabajo al hilo principal y lo hace solo si la página es la nuestra. */
    private fun enPrincipal(accion: () -> Unit) {
        if (liberado) return
        principal.post {
            if (esNuestraPagina()) {
                try {
                    accion()
                } catch (e: Exception) {
                    // Un error de la voz no puede tirar abajo la app.
                }
            }
        }
    }

    // ================================================================ Eventos hacia JavaScript

    private fun emitir(tipo: String, datos: JSONObject = JSONObject()) {
        if (!esNuestraPagina()) return
        try {
            datos.put("tipo", tipo)
            // U+2028 y U+2029 son válidos en JSON pero cortan un literal de JavaScript viejo.
            val json = datos.toString().replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
            web.evaluateJavascript("window.gravityVoz&&window.gravityVoz.evento($json)", null)
        } catch (e: Exception) {
            // El WebView se está cerrando.
        }
    }

    private fun emitirError(origen: String, codigo: String, mensaje: String, id: String? = null, nativo: Int? = null) {
        val datos = JSONObject().put("origen", origen).put("codigo", codigo).put("mensaje", mensaje)
        if (id != null) datos.put("id", id)
        if (nativo != null) datos.put("nativo", nativo)
        emitir("error", datos)
    }

    private fun cadena(recurso: Int): String = app.getString(recurso)

    private fun armarDisponible(): JSONObject {
        val lista = JSONArray()
        for (v in voces) {
            lista.put(
                JSONObject().put("id", v.id).put("nombre", v.nombre).put("idioma", v.idioma)
                    .put("calidad", v.calidad).put("red", v.red),
            )
        }
        return JSONObject()
            .put("stt", SpeechRecognizer.isRecognitionAvailable(app))
            .put("tts", ttsDisponible())
            .put("ttsListo", estadoTts.get() == TTS_LISTO)
            .put("idioma", IDIOMA)
            .put("permisoMicrofono", app.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
            .put("altavoz", false)
            .put("vozPorDefecto", vozPorDefecto ?: JSONObject.NULL)
            .put("voces", lista)
    }

    private fun ttsDisponible(): Boolean = when (estadoTts.get()) {
        TTS_LISTO -> true
        TTS_FALLO -> false
        else -> try {
            @Suppress("DEPRECATION")
            app.packageManager.queryIntentServices(Intent(TextToSpeech.Engine.INTENT_ACTION_TTS_SERVICE), 0).isNotEmpty()
        } catch (e: Exception) {
            false
        }
    }

    // ================================================================ Reconocimiento de voz (hilo principal)

    private fun arrancarReconocimiento(idioma: String) {
        // Una sesión en marcha se corta destruyendo el reconocedor: así sus avisos tardíos no se
        // mezclan con la sesión nueva.
        if (escuchando) cortarReconocedor()
        val sesion = ++sesionStt
        ultimoNivel = 0L
        ultimoParcial = ""
        try {
            val r = reconocedor ?: SpeechRecognizer.createSpeechRecognizer(app).also { reconocedor = it }
            r.setRecognitionListener(Oyente(sesion))
            r.startListening(intentReconocer(idioma))
            escuchando = true
        } catch (e: Exception) {
            cortarReconocedor()
            emitirError(ORIGEN_STT, "cliente", cadena(R.string.voz_cliente))
        }
    }

    private fun intentReconocer(idioma: String): Intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, idioma)
        putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
        putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, app.packageName)
        // Que no corte apenas hacés una pausa (no todos los reconocedores lo respetan).
        putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, SILENCIO_MS)
        putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, SILENCIO_MS)
    }

    /** Corta la escucha y suelta el servicio de reconocimiento. Sin avisos a la página. */
    private fun cortarReconocedor() {
        sesionStt++
        escuchando = false
        val r = reconocedor ?: return
        reconocedor = null
        try {
            r.destroy()
        } catch (e: Exception) {
            // Ya estaba desligado.
        }
    }

    private fun textoDe(resultados: Bundle?): String {
        if (resultados == null) return ""
        val estable = resultados.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
        // Algunas versiones de Google mandan aparte la parte que todavía puede cambiar.
        val inestable = resultados.getStringArrayList(EXTRA_TEXTO_INESTABLE)?.firstOrNull().orEmpty()
        return when {
            inestable.isBlank() -> estable.trim()
            estable.isBlank() -> inestable.trim()
            estable.endsWith(" ") || inestable.startsWith(" ") -> (estable + inestable).trim()
            else -> "$estable $inestable".trim()
        }
    }

    private fun errorDeReconocimiento(codigo: Int): Pair<String, String> = when (codigo) {
        SpeechRecognizer.ERROR_NETWORK -> "sin_conexion" to cadena(R.string.voz_sin_conexion)
        SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "sin_conexion" to cadena(R.string.voz_tiempo_red)
        SpeechRecognizer.ERROR_AUDIO -> "audio" to cadena(R.string.voz_audio)
        // 11 = ERROR_SERVER_DISCONNECTED (API 31), 14 = ERROR_CANNOT_CHECK_SUPPORT (API 33).
        SpeechRecognizer.ERROR_SERVER, 11, 14 -> "servidor" to cadena(R.string.voz_servidor)
        SpeechRecognizer.ERROR_CLIENT -> "cliente" to cadena(R.string.voz_cliente)
        SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no_hablaste" to cadena(R.string.voz_no_hablaste)
        SpeechRecognizer.ERROR_NO_MATCH -> "no_entendi" to cadena(R.string.voz_no_entendi)
        SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "ocupado" to cadena(R.string.voz_ocupado)
        SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permiso" to cadena(R.string.voz_permiso)
        // 10 = ERROR_TOO_MANY_REQUESTS (API 31).
        10 -> "demasiados" to cadena(R.string.voz_demasiados)
        // 12 = ERROR_LANGUAGE_NOT_SUPPORTED, 13 = ERROR_LANGUAGE_UNAVAILABLE (API 31).
        12 -> "idioma" to cadena(R.string.voz_idioma)
        13 -> "idioma" to cadena(R.string.voz_idioma_descargando)
        else -> "desconocido" to app.getString(R.string.voz_desconocido, codigo)
    }

    private inner class Oyente(private val sesion: Int) : RecognitionListener {
        private fun vigente() = sesion == sesionStt && escuchando && !liberado

        override fun onReadyForSpeech(params: Bundle?) {
            if (vigente()) emitir("escuchando")
        }

        override fun onBeginningOfSpeech() {}

        override fun onRmsChanged(rmsdB: Float) {
            if (!vigente()) return
            val ahora = SystemClock.elapsedRealtime()
            if (ahora - ultimoNivel < NIVEL_CADA_MS) return
            ultimoNivel = ahora
            // Google da más o menos de -2 (silencio) a 10 dB (voz fuerte).
            val valor = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
            emitir("nivel", JSONObject().put("db", redondear(rmsdB, 10)).put("valor", redondear(valor, 100)))
        }

        override fun onBufferReceived(buffer: ByteArray?) {}

        override fun onEndOfSpeech() {
            if (vigente()) emitir("silencio")
        }

        override fun onError(error: Int) {
            if (!vigente()) return
            escuchando = false
            // Con estos errores el reconocedor suele quedar trabado: el próximo escuchar() arma uno nuevo.
            if (error == SpeechRecognizer.ERROR_CLIENT || error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || error == 11) {
                principal.post { if (!escuchando) cortarReconocedor() }
            }
            val (codigo, mensaje) = errorDeReconocimiento(error)
            emitirError(ORIGEN_STT, codigo, mensaje, nativo = error)
        }

        override fun onResults(results: Bundle?) {
            if (!vigente()) return
            escuchando = false
            val texto = textoDe(results)
            if (texto.isEmpty()) {
                emitirError(ORIGEN_STT, "no_entendi", cadena(R.string.voz_no_entendi), nativo = SpeechRecognizer.ERROR_NO_MATCH)
                return
            }
            val datos = JSONObject().put("texto", texto)
            results?.getFloatArray(SpeechRecognizer.CONFIDENCE_SCORES)?.firstOrNull()?.takeIf { it >= 0f }?.let {
                datos.put("confianza", redondear(it, 100))
            }
            emitir("final", datos)
        }

        override fun onPartialResults(partialResults: Bundle?) {
            if (!vigente()) return
            val texto = textoDe(partialResults)
            if (texto.isEmpty() || texto == ultimoParcial) return
            ultimoParcial = texto
            emitir("parcial", JSONObject().put("texto", texto))
        }

        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    // ================================================================ Texto a voz: motor (perezoso)

    @Synchronized
    private fun asegurarTts() {
        if (liberado) return
        val estado = estadoTts.get()
        if (estado == TTS_INICIANDO || estado == TTS_LISTO) return
        ttsSenal = CountDownLatch(1)
        estadoTts.set(TTS_INICIANDO)
        principal.post { crearTts() }
    }

    /** Hilo principal. onInit puede llegar desde otro hilo (o adentro del constructor): se reencola. */
    private fun crearTts() {
        if (liberado) return
        try {
            var creado: TextToSpeech? = null
            creado = TextToSpeech(app) { estado -> principal.post { alIniciarTts(creado, estado) } }
            tts = creado
        } catch (e: Exception) {
            alFallarTts()
        }
    }

    private fun alIniciarTts(motor: TextToSpeech?, estado: Int) {
        if (liberado || motor == null || motor !== tts) return
        if (estado != TextToSpeech.SUCCESS) {
            alFallarTts()
            return
        }
        motor.setOnUtteranceProgressListener(Progreso())
        trabajador.post {
            cargarVoces(motor)
            principal.post {
                if (liberado || motor !== tts) return@post
                estadoTts.set(TTS_LISTO)
                ttsSenal.countDown()
                emitir("voces", armarDisponible())
                procesarSintesis()
            }
        }
    }

    private fun alFallarTts() {
        estadoTts.set(TTS_FALLO)
        val motor = tts
        tts = null
        trabajador.post {
            try {
                motor?.shutdown()
            } catch (e: Exception) {
                // Nada que soltar.
            }
        }
        ttsSenal.countDown()
        val mensaje = cadena(R.string.voz_sin_voz)
        while (pendientes.isNotEmpty()) emitirError(ORIGEN_TTS, "sin_voz", mensaje, pendientes.removeFirst().id)
    }

    /** Hilo gravity-voz: lista de voces instaladas (español primero) y la voz por defecto. */
    private fun cargarVoces(motor: TextToSpeech) {
        vozAplicada = null
        borrarTemporales()
        try {
            listarVoces(motor)
        } catch (e: Exception) {
            // Un motor raro (voces sin idioma, servicio caído): se usa el idioma por defecto.
            mapaVoces = emptyMap()
            vozPorDefecto = null
            voces = emptyList()
        }
    }

    private fun listarVoces(motor: TextToSpeech) {
        val instaladas = motor.voices.orEmpty().filter {
            it.locale != null && it.name != null &&
                it.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) != true
        }
        val ordenadas = instaladas.sortedWith(
            compareBy<Voice>(
                { if (esEspanol(it.locale)) 0 else 1 },
                { if (esEspanol(it.locale)) rangoPais(it.locale) else 0 },
                { it.locale.toLanguageTag() },
                { nombreBase(it.name) },
                { if (it.isNetworkConnectionRequired) 1 else 0 },
            ),
        )
        // Para la llamada conviene una voz local (sin la demora de internet) y de buena calidad.
        val porDefecto = ordenadas.filter { esEspanol(it.locale) }.minWithOrNull(
            compareBy<Voice>(
                { rangoPais(it.locale) },
                { if (it.isNetworkConnectionRequired) 1 else 0 },
                { -it.quality },
                { it.latency },
                { it.name },
            ),
        )
        val formato = Locale.forLanguageTag(IDIOMA)
        val numeros = HashMap<String, MutableList<String>>()
        val info = ordenadas.take(MAX_VOCES).map { v ->
            val idioma = v.locale.toLanguageTag()
            val bases = numeros.getOrPut(idioma) { mutableListOf() }
            val base = nombreBase(v.name)
            if (base !in bases) bases.add(base)
            val lugar = v.locale.getDisplayName(formato).replaceFirstChar { it.titlecase(formato) }
            val nombre = "$lugar · voz ${bases.indexOf(base) + 1}" + if (v.isNetworkConnectionRequired) " · con internet" else ""
            InfoVoz(v.name, nombre, idioma, calidad(v.quality), v.isNetworkConnectionRequired)
        }
        mapaVoces = instaladas.associateBy { it.name }
        vozPorDefecto = porDefecto?.name
        voces = info
    }

    private fun esEspanol(l: Locale?): Boolean = l != null && (l.language == "es" || l.language == "spa")

    private fun rangoPais(l: Locale): Int {
        val i = PAISES.indexOf(l.country.uppercase(Locale.ROOT))
        return if (i >= 0) i else PAISES.size
    }

    /** Google tiene la misma voz local y por internet ("...-local" / "...-network"): se numeran juntas. */
    private fun nombreBase(nombre: String): String = nombre.removeSuffix("-local").removeSuffix("-network")

    private fun calidad(q: Int): String = when {
        q >= Voice.QUALITY_VERY_HIGH -> "muy_alta"
        q >= Voice.QUALITY_HIGH -> "alta"
        q >= Voice.QUALITY_NORMAL -> "normal"
        q >= Voice.QUALITY_LOW -> "baja"
        else -> "muy_baja"
    }

    // ================================================================ Texto a voz: cola (hilo principal)

    private fun enCola(): Int =
        pendientes.size + listas.size + (if (sintetizando != null) 1 else 0) + (if (sonando != null) 1 else 0)

    /** Sintetiza de a una frase, adelantando hasta [ADELANTO] mientras suena otra. */
    private fun procesarSintesis() {
        if (liberado || sintetizando != null || pendientes.isEmpty() || listas.size >= ADELANTO) return
        when (estadoTts.get()) {
            TTS_LISTO -> Unit
            TTS_FALLO -> {
                alFallarTts()
                return
            }
            else -> {
                asegurarTts()
                return
            }
        }
        val frase = pendientes.removeFirst()
        sintetizando = frase
        trabajador.post { sintetizar(frase) }
        vigilarSintesis(frase)
    }

    /** Si el motor de TTS nunca avisa que terminó, la frase se da por fallida y la cola sigue. */
    private fun vigilarSintesis(frase: Frase) {
        val plazo = PLAZO_SINTESIS_MS + frase.texto.length * PLAZO_POR_LETRA_MS
        principal.postDelayed({
            if (!liberado && sintetizando === frase && frase.generacion == generacion) {
                for ((utterance, encargo) in enCurso) {
                    if (encargo.frase === frase && enCurso.remove(utterance) != null) encargo.archivo.delete()
                }
                trabajador.post {
                    try {
                        tts?.stop()
                    } catch (e: Exception) {
                        // El servicio de TTS se fue.
                    }
                }
                alFallarSintesis(frase, null)
            }
        }, plazo)
    }

    private fun alTerminarSintesis(encargo: Encargo, analisis: Analisis?) {
        if (liberado || encargo.frase.generacion != generacion) {
            encargo.archivo.delete()
            return
        }
        if (sintetizando === encargo.frase) sintetizando = null
        listas.addLast(Lista(encargo.frase, encargo.archivo, analisis))
        sonarSiguiente()
        procesarSintesis()
    }

    private fun alFallarSintesis(frase: Frase, codigo: Int?) {
        if (liberado || frase.generacion != generacion) return
        if (sintetizando === frase) sintetizando = null
        val red = codigo == TextToSpeech.ERROR_NETWORK || codigo == TextToSpeech.ERROR_NETWORK_TIMEOUT
        emitirError(
            ORIGEN_TTS,
            if (red) "sin_conexion" else "sintesis",
            cadena(if (red) R.string.voz_red_tts else R.string.voz_sintesis),
            frase.id,
            codigo,
        )
        procesarSintesis()
    }

    private fun sonarSiguiente() {
        while (reproductor == null && listas.isNotEmpty()) {
            val lista = listas.removeFirst()
            val analisis = lista.analisis
            if (analisis != null && analisis.vacio) {
                // El motor no generó sonido (por ejemplo, solo signos): se avisa igual, sin pausa.
                lista.archivo.delete()
                emitir("hablando", datosHablando(lista, 0L))
                emitir("fin", JSONObject().put("id", lista.frase.id))
                continue
            }
            val mp = MediaPlayer()
            reproductor = mp
            sonando = lista
            try {
                mp.setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                FileInputStream(lista.archivo).use { mp.setDataSource(it.fd) }
                mp.setOnPreparedListener { p ->
                    if (reproductor !== p) return@setOnPreparedListener
                    p.start()
                    val duracion = analisis?.duracionMs ?: p.duration.toLong().coerceAtLeast(0L)
                    emitir("hablando", datosHablando(lista, duracion))
                }
                mp.setOnCompletionListener { p -> terminarSonido(p, error = null) }
                mp.setOnErrorListener { p, que, _ ->
                    terminarSonido(p, error = que)
                    true
                }
                mp.prepareAsync()
            } catch (e: Exception) {
                terminarSonido(mp, error = 0)
            }
        }
    }

    private fun datosHablando(lista: Lista, duracionMs: Long): JSONObject = JSONObject()
        .put("id", lista.frase.id)
        .put("duracionMs", duracionMs)
        .put("pasoMs", PASO_MS)
        .put("envolvente", lista.analisis?.envolvente ?: JSONArray())

    /** Terminó de sonar una frase (error == null) o falló la reproducción. */
    private fun terminarSonido(mp: MediaPlayer, error: Int?) {
        if (reproductor !== mp) return
        val lista = sonando
        reproductor = null
        sonando = null
        try {
            mp.release()
        } catch (e: Exception) {
            // Ya estaba liberado.
        }
        if (lista != null) {
            lista.archivo.delete()
            if (error == null) {
                emitir("fin", JSONObject().put("id", lista.frase.id))
            } else {
                emitirError(ORIGEN_TTS, "reproduccion", cadena(R.string.voz_reproduccion), lista.frase.id, error)
            }
        }
        sonarSiguiente()
        procesarSintesis()
    }

    /** Corta lo que suena y vacía la cola. Con [avisar], un "fin" {cortado:true} por cada frase sin terminar. */
    private fun cortarVoz(avisar: Boolean) {
        generacion++
        val cortadas = ArrayList<String>()
        reproductor?.let {
            try {
                it.release()
            } catch (e: Exception) {
                // Nada.
            }
        }
        reproductor = null
        sonando?.let {
            cortadas.add(it.frase.id)
            it.archivo.delete()
        }
        sonando = null
        for (l in listas) {
            cortadas.add(l.frase.id)
            l.archivo.delete()
        }
        listas.clear()
        sintetizando?.let { cortadas.add(it.id) }
        sintetizando = null
        for (f in pendientes) cortadas.add(f.id)
        pendientes.clear()
        if (tts != null) {
            trabajador.post {
                try {
                    tts?.stop()
                } catch (e: Exception) {
                    // El servicio de TTS se fue.
                }
            }
        }
        if (avisar) for (id in cortadas) emitir("fin", JSONObject().put("id", id).put("cortado", true))
    }

    // ================================================================ Texto a voz: síntesis (hilo gravity-voz)

    private fun sintetizar(frase: Frase) {
        if (liberado || frase.generacion != generacion) return
        val motor = tts
        if (motor == null) {
            principal.post { alFallarSintesis(frase, null) }
            return
        }
        val n = numerador.incrementAndGet()
        val archivo = File(carpeta, "frase-$n.wav")
        val utterance = "gravity-voz-$n"
        val resultado = try {
            aplicarVoz(motor, frase)
            carpeta.mkdirs()
            enCurso[utterance] = Encargo(frase, archivo)
            motor.synthesizeToFile(frase.texto, Bundle(), archivo, utterance)
        } catch (e: Exception) {
            TextToSpeech.ERROR
        }
        if (resultado != TextToSpeech.SUCCESS) {
            enCurso.remove(utterance)
            archivo.delete()
            principal.post { alFallarSintesis(frase, null) }
        }
    }

    private fun aplicarVoz(motor: TextToSpeech, frase: Frase) {
        val nombre = frase.voz?.takeIf { mapaVoces.containsKey(it) } ?: vozPorDefecto
        val voz = nombre?.let { mapaVoces[it] }
        if (voz != null) {
            if (nombre != vozAplicada && motor.setVoice(voz) == TextToSpeech.SUCCESS) vozAplicada = nombre
        } else if (vozAplicada != POR_IDIOMA) {
            // El motor no lista voces: se le pide español, lo más cerca posible del rioplatense.
            for (etiqueta in listOf(IDIOMA, "es-US", "es-ES", "es")) {
                if (motor.setLanguage(Locale.forLanguageTag(etiqueta)) >= TextToSpeech.LANG_AVAILABLE) break
            }
            vozAplicada = POR_IDIOMA
        }
        motor.setSpeechRate(frase.velocidad)
        motor.setPitch(frase.tono)
    }

    /** Avisos del motor de TTS: llegan en hilos del sistema. */
    private inner class Progreso : UtteranceProgressListener() {
        override fun onStart(utteranceId: String?) {}

        override fun onDone(utteranceId: String?) {
            val encargo = enCurso.remove(utteranceId ?: return) ?: return
            val encolado = trabajador.post {
                val analisis = analizarWav(encargo.archivo)
                principal.post { alTerminarSintesis(encargo, analisis) }
            }
            if (!encolado) encargo.archivo.delete()
        }

        @Deprecated("Desde la API 21 Android llama a onError(String, Int)")
        override fun onError(utteranceId: String?) {
            onError(utteranceId, TextToSpeech.ERROR)
        }

        override fun onError(utteranceId: String?, errorCode: Int) {
            val encargo = enCurso.remove(utteranceId ?: return) ?: return
            encargo.archivo.delete()
            principal.post { alFallarSintesis(encargo.frase, errorCode) }
        }

        /** Llega por el stop() de callar(): esa generación ya no cuenta y se ignora. */
        override fun onStop(utteranceId: String?, interrupted: Boolean) {
            val encargo = enCurso.remove(utteranceId ?: return) ?: return
            encargo.archivo.delete()
            principal.post { alFallarSintesis(encargo.frase, null) }
        }
    }

    private fun borrarTemporales() {
        try {
            carpeta.listFiles()?.forEach { it.delete() }
            carpeta.mkdirs()
        } catch (e: Exception) {
            // Es la caché: Android la limpia solo si hace falta.
        }
    }

    // ================================================================ WAV: duración y envolvente de volumen

    /** Lee el WAV que dejó el TTS (respeta el encabezado) y arma la envolvente RMS en ventanas de 20 ms. */
    private fun analizarWav(archivo: File): Analisis? = try {
        BufferedInputStream(FileInputStream(archivo), 1 shl 16).use { leerWav(it) }
    } catch (e: Exception) {
        null
    }

    private fun leerWav(entrada: InputStream): Analisis? {
        val cabecera = ByteArray(12)
        if (!leerJusto(entrada, cabecera, 12)) return null
        if (ascii(cabecera, 0) != "RIFF" || ascii(cabecera, 8) != "WAVE") return null
        var formato = -1
        var canales = 0
        var frecuencia = 0
        var bits = 0
        val trozo = ByteArray(8)
        while (leerJusto(entrada, trozo, 8)) {
            val tamano = u32(trozo, 4)
            when (ascii(trozo, 0)) {
                "fmt " -> {
                    if (tamano < 16 || tamano > 1024) return null
                    val fmt = ByteArray(tamano.toInt())
                    if (!leerJusto(entrada, fmt, fmt.size)) return null
                    if (tamano % 2 == 1L) entrada.read()
                    formato = u16(fmt, 0)
                    canales = u16(fmt, 2)
                    frecuencia = u32(fmt, 4).toInt()
                    bits = u16(fmt, 14)
                    // WAVE_FORMAT_EXTENSIBLE: el formato real está en el subformato.
                    if (formato == 0xFFFE && fmt.size >= 26) formato = u16(fmt, 24)
                }
                "data" -> {
                    if (formato < 0 || canales !in 1..8 || frecuencia !in 1_000..384_000) return null
                    // Tamaño 0 o 0xFFFFFFFF: el motor no lo completó; se lee hasta el final.
                    val limite = if (tamano == 0L || tamano == 0xFFFFFFFFL) Long.MAX_VALUE else tamano
                    return envolvente(entrada, limite, formato, canales, frecuencia, bits)
                }
                else -> if (!saltar(entrada, tamano + (tamano and 1L))) return null
            }
        }
        return null
    }

    private fun envolvente(
        entrada: InputStream,
        limite: Long,
        formato: Int,
        canales: Int,
        frecuencia: Int,
        bits: Int,
    ): Analisis? {
        val soportado = (formato == 1 && bits in intArrayOf(8, 16, 24, 32)) || (formato == 3 && bits == 32)
        if (!soportado) return null
        val bytesMuestra = bits / 8
        val porVentana = (frecuencia * PASO_MS / 1000).coerceAtLeast(1) * canales
        var valores = FloatArray(256)
        var cantidad = 0
        var suma = 0.0
        var enVentana = 0
        var muestras = 0L
        val buffer = ByteArray(1 shl 16)
        var arrastre = 0
        var restante = limite
        while (restante > 0) {
            val pedir = minOf((buffer.size - arrastre).toLong(), restante).toInt()
            val leidos = entrada.read(buffer, arrastre, pedir)
            if (leidos <= 0) break
            restante -= leidos
            val total = arrastre + leidos
            val utiles = total - total % bytesMuestra
            var i = 0
            while (i < utiles) {
                val m = muestra(buffer, i, bits, formato)
                suma += m * m
                enVentana++
                muestras++
                if (enVentana == porVentana) {
                    if (cantidad == valores.size) valores = valores.copyOf(cantidad * 2)
                    valores[cantidad++] = sqrt(suma / enVentana).toFloat()
                    suma = 0.0
                    enVentana = 0
                }
                i += bytesMuestra
            }
            arrastre = total - utiles
            if (arrastre > 0) System.arraycopy(buffer, utiles, buffer, 0, arrastre)
        }
        if (enVentana > 0) {
            if (cantidad == valores.size) valores = valores.copyOf(cantidad + 1)
            valores[cantidad++] = sqrt(suma / enVentana).toFloat()
        }
        val cuadros = muestras / canales
        val duracionMs = cuadros * 1000 / frecuencia
        // Se normaliza contra un pico "típico" (percentil 95, no el máximo, para que un golpe
        // suelto no aplaste todo) y se comprime con raíz cuadrada para que se vea más pareja.
        val ordenados = valores.copyOf(cantidad).also { it.sort() }
        val referencia = maxOf(if (cantidad > 0) ordenados[((cantidad - 1) * 95) / 100] else 0f, PISO_RMS)
        val json = JSONArray()
        for (k in 0 until cantidad) {
            val v = sqrt(minOf(1f, valores[k] / referencia).toDouble())
            json.put(Math.round(v * 100) / 100.0)
        }
        return Analisis(duracionMs, cuadros == 0L, json)
    }

    /** Una muestra en -1..1. */
    private fun muestra(b: ByteArray, i: Int, bits: Int, formato: Int): Double = when {
        formato == 3 -> {
            val crudo = (b[i].toInt() and 0xFF) or ((b[i + 1].toInt() and 0xFF) shl 8) or
                ((b[i + 2].toInt() and 0xFF) shl 16) or (b[i + 3].toInt() shl 24)
            java.lang.Float.intBitsToFloat(crudo).toDouble().let { if (it.isNaN()) 0.0 else it.coerceIn(-1.0, 1.0) }
        }
        bits == 16 -> ((b[i].toInt() and 0xFF) or (b[i + 1].toInt() shl 8)).toShort() / 32768.0
        bits == 8 -> ((b[i].toInt() and 0xFF) - 128) / 128.0
        bits == 24 -> ((b[i].toInt() and 0xFF) or ((b[i + 1].toInt() and 0xFF) shl 8) or (b[i + 2].toInt() shl 16)) / 8388608.0
        else -> ((b[i].toInt() and 0xFF) or ((b[i + 1].toInt() and 0xFF) shl 8) or
            ((b[i + 2].toInt() and 0xFF) shl 16) or (b[i + 3].toInt() shl 24)) / 2147483648.0
    }

    private fun leerJusto(entrada: InputStream, destino: ByteArray, cuantos: Int): Boolean {
        var hecho = 0
        while (hecho < cuantos) {
            val n = entrada.read(destino, hecho, cuantos - hecho)
            if (n <= 0) return false
            hecho += n
        }
        return true
    }

    private fun saltar(entrada: InputStream, cuantos: Long): Boolean {
        var falta = cuantos
        while (falta > 0) {
            val n = entrada.skip(falta)
            if (n <= 0) {
                if (entrada.read() < 0) return false
                falta--
            } else {
                falta -= n
            }
        }
        return true
    }

    private fun ascii(b: ByteArray, desde: Int): String = String(b, desde, 4, Charsets.US_ASCII)

    private fun u16(b: ByteArray, i: Int): Int = (b[i].toInt() and 0xFF) or ((b[i + 1].toInt() and 0xFF) shl 8)

    private fun u32(b: ByteArray, i: Int): Long =
        ((b[i].toLong() and 0xFF) or ((b[i + 1].toLong() and 0xFF) shl 8) or
            ((b[i + 2].toLong() and 0xFF) shl 16) or ((b[i + 3].toLong() and 0xFF) shl 24))

    // ================================================================ Entradas desde JavaScript

    private class Opciones(val voz: String?, val velocidad: Float, val tono: Float)

    private fun leerOpciones(json: String?): Opciones {
        if (json.isNullOrBlank() || json.length > MAX_OPCIONES) return Opciones(null, 1f, 1f)
        return try {
            val o = JSONObject(json)
            val voz = if (o.isNull("voz")) null else o.optString("voz").takeIf { it.isNotBlank() && it.length <= 200 }
            Opciones(voz, rango(o.optDouble("velocidad", 1.0)), rango(o.optDouble("tono", 1.0)))
        } catch (e: Exception) {
            Opciones(null, 1f, 1f)
        }
    }

    private fun rango(valor: Double): Float = if (valor.isNaN()) 1f else valor.coerceIn(0.5, 2.0).toFloat()

    /** Etiqueta BCP 47 sencilla ("es-AR"); cualquier otra cosa cae en es-AR. */
    private fun normalizarIdioma(idioma: String?): String {
        val limpio = idioma?.trim()?.replace('_', '-') ?: return IDIOMA
        return if (limpio.length <= 35 && PATRON_IDIOMA.matches(limpio)) limpio else IDIOMA
    }

    private fun redondear(valor: Float, escala: Int): Double = Math.round(valor * escala).toDouble() / escala

    companion object {
        /** requestCode del permiso del micrófono (MainActivity.onRequestPermissionsResult). */
        const val PEDIDO_MICROFONO = 43

        private const val IDIOMA = "es-AR"
        private const val ORIGEN_STT = "stt"
        private const val ORIGEN_TTS = "tts"
        private const val TTS_NADA = 0
        private const val TTS_INICIANDO = 1
        private const val TTS_LISTO = 2
        private const val TTS_FALLO = 3
        private const val ESPERA_TTS_MS = 1_500L
        private const val SILENCIO_MS = 1_500L
        private const val NIVEL_CADA_MS = 50L
        private const val PASO_MS = 20
        private const val ADELANTO = 2
        private const val PLAZO_SINTESIS_MS = 20_000L
        private const val PLAZO_POR_LETRA_MS = 15L
        private const val MAX_ID = 64
        private const val MAX_TEXTO = 4_000
        private const val MAX_OPCIONES = 2_000
        private const val MAX_COLA = 100
        private const val MAX_VOCES = 300
        private const val PISO_RMS = 0.02f
        private const val POR_IDIOMA = "\u0000idioma"
        /** No está en el SDK: lo usan versiones de la app de Google para la parte provisoria del parcial. */
        private const val EXTRA_TEXTO_INESTABLE = "android.speech.extra.UNSTABLE_TEXT"
        private val PATRON_IDIOMA = Regex("^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$")
        /** Preferencia de acento para la voz por defecto: rioplatense primero, España al final. */
        private val PAISES = listOf("AR", "UY", "PY", "419", "US", "MX", "CO", "CL", "PE", "VE", "EC", "BO", "CR", "ES")
    }
}
