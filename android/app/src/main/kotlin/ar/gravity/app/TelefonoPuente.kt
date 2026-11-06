package ar.gravity.app

import android.Manifest
import android.app.Activity
import android.app.ActivityManager
import android.app.AlarmManager
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.media.AudioManager
import android.net.TrafficStats
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.PowerManager
import android.os.Process
import android.os.StatFs
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.AlarmClock
import android.provider.DocumentsContract
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Gravity Phone: puente entre la pantalla y Android para el panel del teléfono. Todo con las APIs y los
 * permisos normales del sistema (nada de servicios de accesibilidad ni permisos especiales):
 *
 * - info(): batería, memoria, almacenamiento, temperatura, tráfico y CPU de Gravity, y el estado de cada permiso.
 * - accion(): linterna, vibrar, temporizador y alarma (con la app de reloj), volumen, compartir texto, cámara
 *   y abrir pantallas de Ajustes (solo de una lista fija).
 * - Carpetas que el usuario elige con el selector del sistema (Storage Access Framework): buscar archivos,
 *   encontrar grandes y duplicados, abrir, copiar a la computadora de Gravity y borrar (lo confirma la pantalla).
 *
 * Seguridad: cada método exige el token de la página, que solo se le pasa al marco principal cuando es la
 * página del motor local (las vistas de proyectos van en iframes aislados y no lo pueden leer). Los eventos
 * vuelven con window.gravityTelefono.evento({...}).
 */
class TelefonoPuente(private val actividad: Activity, private val web: WebView) {

    private val app = actividad.applicationContext
    private val principal = Handler(Looper.getMainLooper())
    private val hilo = HandlerThread("gravity-telefono").apply { start() }
    private val trabajador = Handler(hilo.looper)
    private val token: String = ByteArray(24).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
    @Volatile private var liberado = false
    @Volatile private var cancelarBusqueda = 0

    // ================================================================ Token y origen

    private fun esNuestraPagina(): Boolean {
        if (liberado) return false
        val url = try { web.url } catch (e: Exception) { null } ?: return false
        val uri = Uri.parse(url)
        return uri.scheme == "http" && uri.host == "127.0.0.1" && uri.port == Gravity.PUERTO
    }

    /** Lo llama MainActivity al terminar de cargar: solo el marco principal recibe el token. */
    fun paginaLista() {
        if (!esNuestraPagina()) return
        web.evaluateJavascript("window.__gravityTelefono='$token';window.dispatchEvent&&window.dispatchEvent(new Event('gravity-telefono'))", null)
    }

    private fun valido(t: String?): Boolean = !liberado && t != null && MessageDigest.isEqual(t.toByteArray(), token.toByteArray())

    private fun emitir(tipo: String, datos: JSONObject = JSONObject()) {
        principal.post {
            if (!esNuestraPagina()) return@post
            try {
                datos.put("tipo", tipo)
                web.evaluateJavascript("window.gravityTelefono&&window.gravityTelefono.evento(${JSONObject.quote(datos.toString())})", null)
            } catch (e: Exception) {
                // La página se fue.
            }
        }
    }

    // ================================================================ Información del teléfono

    @JavascriptInterface
    fun info(t: String?): String {
        if (!valido(t)) return "{}"
        return try {
            val o = JSONObject()
            o.put("modelo", "${Build.MANUFACTURER} ${Build.MODEL}").put("android", Build.VERSION.RELEASE).put("sdk", Build.VERSION.SDK_INT)
            o.put("nucleos", Runtime.getRuntime().availableProcessors()).put("encendidoMin", SystemClock.elapsedRealtime() / 60_000)
            // Batería
            val bm = app.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            val est = app.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            val pm = app.getSystemService(Context.POWER_SERVICE) as PowerManager
            o.put("bateria", JSONObject()
                .put("nivel", bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY))
                .put("cargando", bm.isCharging)
                .put("temperatura", (est?.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0) ?: 0) / 10.0)
                .put("voltaje", (est?.getIntExtra(BatteryManager.EXTRA_VOLTAGE, 0) ?: 0) / 1000.0)
                .put("corrienteMa", bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CURRENT_NOW) / 1000)
                .put("ahorro", pm.isPowerSaveMode)
                .put("sinOptimizacion", pm.isIgnoringBatteryOptimizations(app.packageName)))
            if (Build.VERSION.SDK_INT >= 29) o.put("termico", pm.currentThermalStatus)
            // Memoria y almacenamiento
            val am = app.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val mi = ActivityManager.MemoryInfo().also { am.getMemoryInfo(it) }
            o.put("memoria", JSONObject().put("totalMb", mi.totalMem / 1_048_576).put("libreMb", mi.availMem / 1_048_576).put("baja", mi.lowMemory).put("umbralMb", mi.threshold / 1_048_576))
            val sf = StatFs(Environment.getDataDirectory().path)
            o.put("almacenamiento", JSONObject().put("totalMb", sf.totalBytes / 1_048_576).put("libreMb", sf.availableBytes / 1_048_576))
            // Lo que gasta Gravity: CPU de la pantalla, tráfico de red de la app y espacio de sus datos
            val uid = Process.myUid()
            o.put("gravity", JSONObject()
                .put("cpuPantallaSeg", Process.getElapsedCpuTime() / 1000)
                .put("redRecibidaMb", TrafficStats.getUidRxBytes(uid) / 1_048_576.0)
                .put("redEnviadaMb", TrafficStats.getUidTxBytes(uid) / 1_048_576.0)
                .put("datosMb", tamano(app.filesDir) / 1_048_576))
            o.put("permisos", permisos())
            o.put("carpetas", carpetas())
            o.toString()
        } catch (e: Exception) {
            JSONObject().put("error", e.message ?: "error").toString()
        }
    }

    private fun tamano(f: File, prof: Int = 0): Long {
        if (prof > 12) return 0
        if (f.isFile) return f.length()
        return f.listFiles()?.sumOf { tamano(it, prof + 1) } ?: 0
    }

    private fun permisos(): JSONObject {
        val nm = app.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val oyentes = Settings.Secure.getString(app.contentResolver, "enabled_notification_listeners") ?: ""
        val p = JSONObject()
            .put("microfono", app.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED)
            .put("notificaciones", nm.areNotificationsEnabled())
            .put("leerNotificaciones", oyentes.contains(ComponentName(app, Escucha::class.java).flattenToString()))
            .put("sinOptimizacionBateria", (app.getSystemService(Context.POWER_SERVICE) as PowerManager).isIgnoringBatteryOptimizations(app.packageName))
        if (Build.VERSION.SDK_INT >= 31) p.put("alarmasExactas", (app.getSystemService(Context.ALARM_SERVICE) as AlarmManager).canScheduleExactAlarms())
        return p
    }

    private fun carpetas(): JSONArray {
        val a = JSONArray()
        for (p in app.contentResolver.persistedUriPermissions) {
            if (!DocumentsContract.isTreeUri(p.uri)) continue
            a.put(JSONObject().put("uri", p.uri.toString()).put("nombre", nombreArbol(p.uri)).put("escritura", p.isWritePermission))
        }
        return a
    }

    private fun nombreArbol(uri: Uri): String = try {
        DocumentsContract.getTreeDocumentId(uri).substringAfter(':').ifBlank { DocumentsContract.getTreeDocumentId(uri) }
    } catch (e: Exception) {
        uri.lastPathSegment ?: "carpeta"
    }

    // ================================================================ Acciones del dispositivo

    @JavascriptInterface
    fun accion(t: String?, nombre: String?, datosJson: String?): String {
        if (!valido(t)) return "{\"ok\":false}"
        val d = try { JSONObject(datosJson ?: "{}") } catch (e: Exception) { JSONObject() }
        principal.post {
            if (!esNuestraPagina()) return@post
            val r = try { hacer(nombre ?: "", d) } catch (e: Exception) { e.message ?: "No se pudo." }
            emitir("accion", JSONObject().put("nombre", nombre).put("ok", r == null).put("error", r ?: JSONObject.NULL))
        }
        return "{\"ok\":true}"
    }

    /** null = hecho; si no, el motivo. Solo acciones de una lista fija. */
    private fun hacer(nombre: String, d: JSONObject): String? {
        when (nombre) {
            "linterna" -> {
                val cm = app.getSystemService(Context.CAMERA_SERVICE) as CameraManager
                val id = cm.cameraIdList.firstOrNull { cm.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true } ?: return "Este teléfono no tiene linterna."
                cm.setTorchMode(id, d.optBoolean("prender", true))
            }
            "vibrar" -> {
                val v = app.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                if (!v.hasVibrator()) return "Este teléfono no vibra."
                v.vibrate(VibrationEffect.createOneShot(d.optLong("ms", 300).coerceIn(30, 3000), VibrationEffect.DEFAULT_AMPLITUDE))
            }
            "temporizador" -> abrir(Intent(AlarmClock.ACTION_SET_TIMER).putExtra(AlarmClock.EXTRA_LENGTH, d.optInt("segundos", 60).coerceIn(1, 86_399)).putExtra(AlarmClock.EXTRA_MESSAGE, d.optString("mensaje", "Gravity")).putExtra(AlarmClock.EXTRA_SKIP_UI, false))?.let { return it }
            "alarma" -> abrir(Intent(AlarmClock.ACTION_SET_ALARM).putExtra(AlarmClock.EXTRA_HOUR, d.optInt("hora", 8).coerceIn(0, 23)).putExtra(AlarmClock.EXTRA_MINUTES, d.optInt("minutos", 0).coerceIn(0, 59)).putExtra(AlarmClock.EXTRA_MESSAGE, d.optString("mensaje", "Gravity")).putExtra(AlarmClock.EXTRA_SKIP_UI, false))?.let { return it }
            "volumen" -> (app.getSystemService(Context.AUDIO_SERVICE) as AudioManager).adjustStreamVolume(AudioManager.STREAM_MUSIC, if (d.optBoolean("subir", true)) AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI)
            "compartir" -> abrir(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, d.optString("texto").take(20_000)), null))?.let { return it }
            "camara" -> abrir(Intent("android.media.action.STILL_IMAGE_CAMERA"))?.let { return it }
            "ajuste" -> abrir(ajuste(d.optString("cual")) ?: return "Ese ajuste no está en la lista.")?.let { return it }
            else -> return "Acción desconocida."
        }
        return null
    }

    private fun abrir(i: Intent): String? = try {
        actividad.startActivity(i)
        null
    } catch (e: Exception) {
        "No hay una app para eso en este teléfono."
    }

    /** Pantallas de Ajustes que se pueden abrir (lista fija). */
    private fun ajuste(cual: String): Intent? {
        val paquete = Uri.fromParts("package", app.packageName, null)
        return when (cual) {
            "wifi" -> Intent(Settings.ACTION_WIFI_SETTINGS)
            "bluetooth" -> Intent(Settings.ACTION_BLUETOOTH_SETTINGS)
            "datos" -> Intent(Settings.ACTION_DATA_ROAMING_SETTINGS)
            "pantalla" -> Intent(Settings.ACTION_DISPLAY_SETTINGS)
            "sonido" -> Intent(Settings.ACTION_SOUND_SETTINGS)
            "bateria" -> Intent(Intent.ACTION_POWER_USAGE_SUMMARY)
            "ahorro" -> Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS)
            "ubicacion" -> Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS)
            "almacenamiento" -> Intent(Settings.ACTION_INTERNAL_STORAGE_SETTINGS)
            "idioma" -> Intent(Settings.ACTION_LOCALE_SETTINGS)
            "fecha" -> Intent(Settings.ACTION_DATE_SETTINGS)
            "accesibilidad" -> Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            "seguridad" -> Intent(Settings.ACTION_SECURITY_SETTINGS)
            "no_molestar" -> Intent(Settings.ACTION_ZEN_MODE_PRIORITY_SETTINGS)
            "app" -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, paquete)
            "notificaciones_app" -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, app.packageName)
            "notificaciones_acceso" -> Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            "optimizacion_bateria" -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            "alarmas_exactas" -> if (Build.VERSION.SDK_INT >= 31) Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, paquete) else null
            "general" -> Intent(Settings.ACTION_SETTINGS)
            else -> null
        }
    }

    // ================================================================ Carpetas permitidas (SAF)

    @JavascriptInterface
    fun elegirCarpeta(t: String?) {
        if (!valido(t)) return
        principal.post {
            if (!esNuestraPagina()) return@post
            try {
                @Suppress("DEPRECATION")
                actividad.startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION), PEDIDO_CARPETA)
            } catch (e: Exception) {
                emitir("carpetas", JSONObject().put("error", "No hay selector de carpetas."))
            }
        }
    }

    /** Lo llama MainActivity.onActivityResult. */
    fun carpetaElegida(resultado: Int, datos: Intent?) {
        val uri = datos?.data
        if (resultado == Activity.RESULT_OK && uri != null) {
            try {
                app.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            } catch (e: Exception) {
                try { app.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (e2: Exception) { /* sin permiso persistente */ }
            }
        }
        emitir("carpetas", JSONObject().put("carpetas", carpetas()))
    }

    @JavascriptInterface
    fun soltarCarpeta(t: String?, uri: String?) {
        if (!valido(t) || uri == null) return
        try {
            app.contentResolver.releasePersistableUriPermission(Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        } catch (e: Exception) {
            try { app.contentResolver.releasePersistableUriPermission(Uri.parse(uri), Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (e2: Exception) { /* ya no estaba */ }
        }
        emitir("carpetas", JSONObject().put("carpetas", carpetas()))
    }

    private class Doc(val uri: Uri, val nombre: String, val mime: String, val tamano: Long, val modificado: Long, val ruta: String)

    /** Recorre una carpeta otorgada (hasta [max] archivos y 8 niveles). */
    private fun recorrer(arbol: Uri, max: Int, alVer: (Doc) -> Boolean) {
        if (app.contentResolver.persistedUriPermissions.none { it.uri == arbol }) throw IllegalStateException("Esa carpeta no está permitida.")
        val pila = ArrayDeque<Pair<String, String>>()
        pila.addLast(DocumentsContract.getTreeDocumentId(arbol) to "")
        var vistos = 0
        val generacion = cancelarBusqueda
        while (pila.isNotEmpty() && vistos < max && generacion == cancelarBusqueda) {
            val (id, ruta) = pila.removeFirst()
            val hijos = DocumentsContract.buildChildDocumentsUriUsingTree(arbol, id)
            val cols = arrayOf(DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME, DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED)
            app.contentResolver.query(hijos, cols, null, null, null)?.use { c ->
                while (c.moveToNext() && vistos < max) {
                    val hijo = c.getString(0) ?: continue
                    val nombre = c.getString(1) ?: "?"
                    val mime = c.getString(2) ?: ""
                    if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                        if (ruta.count { it == '/' } < 8) pila.addLast(hijo to "$ruta$nombre/")
                        continue
                    }
                    vistos++
                    if (!alVer(Doc(DocumentsContract.buildDocumentUriUsingTree(arbol, hijo), nombre, mime, if (c.isNull(3)) 0 else c.getLong(3), if (c.isNull(4)) 0 else c.getLong(4), "$ruta$nombre"))) return
                }
            }
        }
    }

    private fun json(d: Doc) = JSONObject().put("uri", d.uri.toString()).put("nombre", d.nombre).put("mime", d.mime).put("tamano", d.tamano).put("modificado", d.modificado).put("ruta", d.ruta)

    @JavascriptInterface
    fun buscar(t: String?, carpeta: String?, consulta: String?, id: String?) {
        if (!valido(t) || carpeta == null) return
        cancelarBusqueda++
        val q = (consulta ?: "").trim().lowercase()
        trabajador.post {
            try {
                val res = JSONArray()
                recorrer(Uri.parse(carpeta), 20_000) { d ->
                    if (q.isEmpty() || d.ruta.lowercase().contains(q) || d.mime.lowercase().contains(q)) res.put(json(d))
                    res.length() < 300
                }
                emitir("resultados", JSONObject().put("id", id).put("items", res))
            } catch (e: Exception) {
                emitir("resultados", JSONObject().put("id", id).put("error", e.message ?: "No se pudo buscar."))
            }
        }
    }

    /** Archivos grandes y duplicados (mismo tamaño y mismo contenido, comparado por SHA-256). */
    @JavascriptInterface
    fun analizar(t: String?, carpeta: String?, id: String?) {
        if (!valido(t) || carpeta == null) return
        trabajador.post {
            try {
                val todos = ArrayList<Doc>()
                recorrer(Uri.parse(carpeta), 20_000) { d -> todos.add(d); true }
                val grandes = JSONArray()
                todos.sortedByDescending { it.tamano }.take(30).forEach { grandes.put(json(it)) }
                val dup = JSONArray()
                var revisados = 0L
                for ((tam, grupo) in todos.filter { it.tamano > 0 }.groupBy { it.tamano }) {
                    if (grupo.size < 2 || revisados > 2_000_000_000L) continue
                    val porHash = HashMap<String, MutableList<Doc>>()
                    for (d in grupo) { val h = hash(d.uri) ?: continue; revisados += tam; porHash.getOrPut(h) { ArrayList() }.add(d) }
                    for (xs in porHash.values) if (xs.size > 1) dup.put(JSONObject().put("tamano", tam).put("archivos", JSONArray().also { a -> xs.forEach { a.put(json(it)) } }))
                }
                emitir("analisis", JSONObject().put("id", id).put("total", todos.size).put("bytes", todos.sumOf { it.tamano }).put("grandes", grandes).put("duplicados", dup))
            } catch (e: Exception) {
                emitir("analisis", JSONObject().put("id", id).put("error", e.message ?: "No se pudo analizar."))
            }
        }
    }

    private fun hash(uri: Uri): String? = try {
        val md = MessageDigest.getInstance("SHA-256")
        app.contentResolver.openInputStream(uri)?.use { e ->
            val b = ByteArray(64 * 1024)
            while (true) { val n = e.read(b); if (n < 0) break; md.update(b, 0, n) }
        }
        md.digest().joinToString("") { "%02x".format(it) }
    } catch (e: Exception) {
        null
    }

    /** Copia un archivo de una carpeta permitida a la computadora de Gravity (compartidos/). */
    @JavascriptInterface
    fun copiarAGravity(t: String?, uri: String?, id: String?) {
        if (!valido(t) || uri == null) return
        trabajador.post {
            try {
                val u = Uri.parse(uri)
                if (!permitido(u)) throw IllegalStateException("Ese archivo no está en una carpeta permitida.")
                val nombre = app.contentResolver.query(u, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0) else null } ?: "archivo"
                val limpio = nombre.replace(Regex("[^\\w.\\- ]+"), "_").take(120).ifBlank { "archivo" }
                val carpeta = File(File(File(app.filesDir, "gravity"), "computadora"), "compartidos").apply { mkdirs() }
                var destino = File(carpeta, limpio)
                var n = 2
                while (destino.exists()) { destino = File(carpeta, limpio.substringBeforeLast('.') + "-$n" + (if (limpio.contains('.')) "." + limpio.substringAfterLast('.') else "")); n++ }
                var total = 0L
                app.contentResolver.openInputStream(u)?.use { e -> destino.outputStream().use { s ->
                    val b = ByteArray(64 * 1024)
                    while (true) { val k = e.read(b); if (k < 0) break; total += k; if (total > MAX_COPIA) throw IllegalStateException("El archivo pasa los 500 MB."); s.write(b, 0, k) }
                } } ?: throw IllegalStateException("No se pudo leer el archivo.")
                emitir("copiado", JSONObject().put("id", id).put("ruta", "compartidos/${destino.name}").put("bytes", total))
            } catch (e: Exception) {
                emitir("copiado", JSONObject().put("id", id).put("error", e.message ?: "No se pudo copiar."))
            }
        }
    }

    /** Borra un archivo de una carpeta permitida. La pantalla pide confirmación antes de llamar. */
    @JavascriptInterface
    fun borrar(t: String?, uri: String?, id: String?) {
        if (!valido(t) || uri == null) return
        trabajador.post {
            val ok = try { val u = Uri.parse(uri); permitido(u) && DocumentsContract.deleteDocument(app.contentResolver, u) } catch (e: Exception) { false }
            emitir("borrado", JSONObject().put("id", id).put("uri", uri).put("ok", ok))
        }
    }

    @JavascriptInterface
    fun abrirArchivo(t: String?, uri: String?, mime: String?) {
        if (!valido(t) || uri == null) return
        principal.post {
            val u = Uri.parse(uri)
            if (!esNuestraPagina() || !permitido(u)) return@post
            abrir(Intent(Intent.ACTION_VIEW).setDataAndType(u, mime?.ifBlank { null } ?: "*/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))?.let { emitir("accion", JSONObject().put("nombre", "abrir").put("ok", false).put("error", it)) }
        }
    }

    private fun permitido(u: Uri): Boolean = try {
        val arbolDoc = DocumentsContract.getTreeDocumentId(u)
        app.contentResolver.persistedUriPermissions.any { p -> DocumentsContract.isTreeUri(p.uri) && p.uri.authority == u.authority && arbolDoc.startsWith(DocumentsContract.getTreeDocumentId(p.uri)) }
    } catch (e: Exception) {
        false
    }

    fun liberar() {
        liberado = true
        hilo.quitSafely()
    }

    companion object {
        const val PEDIDO_CARPETA = 51
        private const val MAX_COPIA = 500L * 1024 * 1024
    }
}
