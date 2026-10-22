package ar.gravity.app

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.system.Os
import android.system.OsConstants
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.text.DateFormat
import java.util.Date
import java.util.TimeZone

/**
 * El motor de Gravity: Node.js corriendo el servidor de los bots dentro del celular, en su propio
 * proceso (":motor") y como servicio en primer plano, así sigue trabajando con la app cerrada.
 *
 * Mientras haya trabajo en marcha mantiene la CPU despierta; cuando no, programa una alarma para
 * la próxima rutina y deja dormir al celular. Las conversaciones quedan en files/gravity.
 */
class Motor : Service() {

    private lateinit var hilo: HandlerThread
    private lateinit var vigia: Handler
    private lateinit var despierto: PowerManager.WakeLock
    private var receptorPantalla: BroadcastReceiver? = null

    /** Después de una alarma o de apagar la pantalla, la CPU queda despierta al menos hasta acá. */
    @Volatile
    private var despiertoAlMenosHasta = 0L

    /** Se está apagando: el vigía ya no toca la notificación ni las alarmas. */
    @Volatile
    private var cerrando = false
    private var alarmaProgramada = 0L
    private var avisadas = 0
    private var ultimoTexto = ""

    /** El motor respondió pasado el primer minuto: el arranque salió bien. */
    private var sano = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instancia = this
        crearCanales(this)
        hilo = HandlerThread("gravity-vigia").apply { start() }
        vigia = Handler(hilo.looper)
        despierto = getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Gravity:motor")
            .apply { setReferenceCounted(false) }
        // Al apagar la pantalla, Android puede dormir la CPU en segundos: se revisa enseguida si hay trabajo.
        receptorPantalla = object : BroadcastReceiver() {
            override fun onReceive(contexto: Context, intent: Intent) {
                mantenerDespierto(45_000)
                revisarPronto(0)
            }
        }
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(receptorPantalla, IntentFilter(Intent.ACTION_SCREEN_OFF), Context.RECEIVER_NOT_EXPORTED)
        } else {
            registerReceiver(receptorPantalla, IntentFilter(Intent.ACTION_SCREEN_OFF))
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Android exige mostrar la notificación apenas arranca un servicio en primer plano.
        val aviso = notificacion(ultimoTexto.ifEmpty { getString(R.string.motor_arrancando) })
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(ID_MOTOR, aviso, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            } else {
                startForeground(ID_MOTOR, aviso)
            }
        } catch (e: IllegalStateException) {
            // Android 12+: relanzó el servicio (START_STICKY) con la app en segundo plano y no deja pasarlo
            // a primer plano. No se crashea: se cierra y una alarma exacta (si se puede) lo vuelve a prender.
            if (!nodeArrancado) {
                if (Build.VERSION.SDK_INT < 31 || getSystemService(AlarmManager::class.java).canScheduleExactAlarms()) {
                    programarAlarma(System.currentTimeMillis() + 60_000)
                }
                stopSelf(startId)
                return START_NOT_STICKY
            }
        }

        when (intent?.action) {
            ACCION_APAGAR -> {
                Gravity.marcarApagado(this, true)
                terminar()
                return START_NOT_STICKY
            }
            ACCION_REINICIAR -> {
                // Con el motor parado no hay nada que reiniciar: se prende directo.
                if (nodeArrancado) {
                    terminar()
                    return START_NOT_STICKY
                }
                Fallos.olvidar(this)
            }
            ACCION_DESPERTAR -> mantenerDespierto(3 * 60_000L)
            ACCION_INICIAR -> Fallos.olvidar(this)
        }

        if (!nodeArrancado) {
            if (!arrancarNode()) return START_NOT_STICKY
        }
        revisarPronto(1_000)
        return START_STICKY
    }

    override fun onDestroy() {
        instancia = null
        vigia.removeCallbacksAndMessages(null)
        hilo.quitSafely()
        receptorPantalla?.let { unregisterReceiver(it) }
        if (despierto.isHeld) despierto.release()
        super.onDestroy()
    }

    // ---------------------------------------------------------------- Node

    /** false si no se pudo arrancar (y el servicio ya se cerró). */
    private fun arrancarNode(): Boolean {
        val proveedor = Clave.proveedor(this)
        val clave = Clave.leer(this, proveedor)
        val respaldo = Clave.leer(this, Clave.RESPALDO)
        if (clave == null) {
            avisar(ID_ERROR, getString(R.string.motor_sin_clave), abrirApp = true)
            cerrarServicio()
            return false
        }
        if (Fallos.demasiados(this)) {
            avisar(ID_ERROR, getString(R.string.motor_fallo_repetido), abrirApp = true)
            cerrarServicio()
            return false
        }
        nodeArrancado = true
        arranque = SystemClock.elapsedRealtime()
        val contexto = applicationContext
        // Si Node se cae, cierra el proceso con exit() y no vuelve acá: todo arranque cuenta como fallo
        // hasta que el motor responda pasado el primer minuto (ver revisar()).
        Fallos.anotar(contexto)
        // Node necesita una pila grande: el hilo principal de Node en una compu tiene 8 MB.
        Thread(null, {
            val registro = Gravity.registro(contexto)
            try {
                if (registro.length() > 2_000_000) registro.delete()
                registro.appendText("\n=== Gravity arranca: ${Date()} ===\n")
                val servidor = instalarMotor(contexto)
                val datos = prepararEntorno(contexto, proveedor, clave, respaldo)
                val codigo = NodeNativo.iniciar(arrayOf("node", servidor.absolutePath), registro.absolutePath, datos.absolutePath)
                registro.appendText("=== El motor terminó (código $codigo) ===\n")
            } catch (t: Throwable) {
                try {
                    registro.appendText("=== No se pudo arrancar el motor: $t ===\n")
                } catch (e: Exception) {
                    // Sin registro no queda nada más que hacer.
                }
            }
            // Node no se puede arrancar dos veces en el mismo proceso: se cierra este y Android
            // vuelve a levantar el servicio (salvo que lo hayas apagado).
            Process.killProcess(Process.myPid())
        }, "gravity-node", 8L * 1024 * 1024).start()
        return true
    }

    /** Copia el motor empaquetado (assets/motor) a files/motor cuando cambia la versión de la app. */
    private fun instalarMotor(contexto: Context): File {
        val destino = File(contexto.filesDir, "motor")
        val servidor = File(destino, "gravity/servidor.mjs")
        val info = contexto.packageManager.getPackageInfo(contexto.packageName, 0)
        @Suppress("DEPRECATION")
        val codigo = if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()
        val version = "$codigo-${info.lastUpdateTime}"
        val marca = File(destino, "version")
        if (servidor.exists() && marca.exists() && marca.readText() == version) return servidor
        destino.deleteRecursively()
        copiarAssets(contexto, "motor", destino)
        marca.writeText(version)
        return servidor
    }

    private fun copiarAssets(contexto: Context, ruta: String, destino: File) {
        val hijos = contexto.assets.list(ruta).orEmpty()
        if (hijos.isEmpty()) {
            destino.parentFile?.mkdirs()
            contexto.assets.open(ruta).use { entrada -> destino.outputStream().use { entrada.copyTo(it) } }
            return
        }
        destino.mkdirs()
        for (hijo in hijos) copiarAssets(contexto, "$ruta/$hijo", File(destino, hijo))
    }

    /** Variables que Node lee al arrancar (ver docs/EMBEDDING.md de nodejs-mobile). */
    private fun prepararEntorno(contexto: Context, proveedor: String, clave: String, respaldo: String?): File {
        val datos = File(contexto.filesDir, "gravity").apply { mkdirs() }
        val temporal = File(contexto.cacheDir, "tmp").apply { mkdirs() }
        val cache = File(contexto.cacheDir, "node").apply { mkdirs() }
        // Sin ANTHROPIC_API_KEY el motor usa Gemini y, si se acaba su cupo, el respaldo gratis (Groq o Mistral).
        val claves = buildMap {
            put(if (proveedor == Clave.ANTHROPIC) "ANTHROPIC_API_KEY" else "GEMINI_API_KEY", clave)
            if (!respaldo.isNullOrBlank()) put(if (respaldo.startsWith("gsk_")) "GROQ_API_KEY" else "MISTRAL_API_KEY", respaldo)
        }
        val variables = claves + mapOf(
            "GRAVITY_TOKEN" to Gravity.token(contexto),
            "BOTS_DATOS" to datos.absolutePath,
            "BOTS_HOST" to "127.0.0.1",
            "BOTS_PUERTO" to Gravity.PUERTO.toString(),
            "GRAVITY_SHELL" to "/system/bin/sh",
            "HOME" to contexto.filesDir.absolutePath,
            "TMPDIR" to temporal.absolutePath,
            // Sin esto Node puede quedar en UTC y las rutinas correrían a otra hora.
            "TZ" to TimeZone.getDefault().id,
            "NODE_COMPILE_CACHE" to cache.absolutePath,
            "NODE_COMPILE_CACHE_PORTABLE" to "1",
            // Android cierra la app entera si se pasa de memoria: tope del 25% de la RAM para Node.
            "NODE_OPTIONS" to "--max-old-space-size-percentage=25",
        )
        for ((nombre, valor) in variables) Os.setenv(nombre, valor, true)
        return datos
    }

    /** Cierra el motor guardando lo pendiente (Node escucha SIGTERM) y termina el proceso. */
    private fun terminar() {
        cerrando = true
        vigia.removeCallbacks(revision)
        programarAlarma(null)
        cerrarServicio()
        if (nodeArrancado) {
            // Un momento para que Android registre que el servicio se cerró y no lo levante de nuevo.
            // Hilo propio: el del vigía se termina en onDestroy.
            Thread {
                SystemClock.sleep(300)
                Os.kill(Os.getpid(), OsConstants.SIGTERM)
                SystemClock.sleep(8_000)
                Process.killProcess(Process.myPid())
            }.start()
        }
    }

    private fun cerrarServicio() {
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    // ---------------------------------------------------------------- Vigía

    private val revision = Runnable { revisar() }

    private fun revisarPronto(enMs: Long) {
        if (cerrando) return
        vigia.removeCallbacks(revision)
        vigia.postDelayed(revision, enMs)
    }

    /** Una alarma de rutina: despierto un rato y revisar ya. */
    fun despertar() {
        mantenerDespierto(3 * 60_000L)
        revisarPronto(0)
    }

    fun mantenerDespierto(ms: Long) {
        despiertoAlMenosHasta = maxOf(despiertoAlMenosHasta, System.currentTimeMillis() + ms)
        despierto.acquire(ms)
    }

    private fun revisar() {
        if (cerrando) return
        val estado = consultar()
        val ahora = System.currentTimeMillis()
        if (estado == null) {
            // Todavía arrancando (o reiniciándose): se prueba seguido el primer minuto.
            val reciente = SystemClock.elapsedRealtime() - arranque < 60_000
            revisarPronto(if (reciente) 2_000 else 30_000)
            return
        }
        if (!sano && SystemClock.elapsedRealtime() - arranque >= 60_000) {
            sano = true
            Fallos.olvidar(this)
        }
        val proxima = estado.proximaRutina
        when {
            estado.ocupado -> despierto.acquire(10 * 60_000L)
            proxima != null && proxima - ahora < 90_000 -> mantenerDespierto(3 * 60_000L)
            ahora > despiertoAlMenosHasta && despierto.isHeld -> despierto.release()
        }
        if (cerrando) return
        programarAlarma(if (estado.ocupado) null else proxima)
        actualizarNotificacion(estado)
        avisarAprobaciones(estado.aprobaciones)
        revisarPronto(30_000)
    }

    private class Estado(val ocupado: Boolean, val trabajando: Int, val aprobaciones: Int, val proximaRutina: Long?)

    private fun consultar(): Estado? = try {
        // Antes de mandar el token se comprueba que del otro lado esté nuestro motor y no otra app.
        if (!Gravity.motorAutentico(this)) throw IllegalStateException("no es el motor")
        val conexion = URL("${Gravity.DIRECCION}/api/motor").openConnection() as HttpURLConnection
        conexion.connectTimeout = 3_000
        conexion.readTimeout = 5_000
        conexion.setRequestProperty("x-gravity-token", Gravity.token(this))
        try {
            if (conexion.responseCode != 200) {
                null
            } else {
                val json = JSONObject(conexion.inputStream.bufferedReader().use { it.readText() })
                Estado(
                    ocupado = json.optBoolean("ocupado"),
                    trabajando = json.optInt("trabajando"),
                    aprobaciones = json.optInt("aprobaciones"),
                    proximaRutina = if (json.isNull("proximaRutina")) null else json.optLong("proximaRutina"),
                )
            }
        } finally {
            conexion.disconnect()
        }
    } catch (e: Exception) {
        null
    }

    /** Alarma que despierta al celular un poco antes de la próxima rutina. null = ninguna. */
    private fun programarAlarma(cuando: Long?) {
        val alarmas = getSystemService(AlarmManager::class.java)
        val pedido = PendingIntent.getBroadcast(
            this,
            0,
            Intent(this, DespertadorRutina::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        if (cuando == null) {
            if (alarmaProgramada != 0L) alarmas.cancel(pedido)
            alarmaProgramada = 0L
            return
        }
        val momento = maxOf(cuando - 45_000, System.currentTimeMillis() + 60_000)
        if (momento == alarmaProgramada) return
        alarmaProgramada = momento
        // Exacta si Android lo permite (Ajustes > Alarmas y recordatorios); si no, aproximada.
        if (Build.VERSION.SDK_INT < 31 || alarmas.canScheduleExactAlarms()) {
            alarmas.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, momento, pedido)
        } else {
            alarmas.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, momento, pedido)
        }
    }

    // ---------------------------------------------------------------- Notificaciones

    private fun actualizarNotificacion(estado: Estado) {
        val texto = when {
            estado.trabajando == 1 -> getString(R.string.motor_trabajando_uno)
            estado.trabajando > 1 -> getString(R.string.motor_trabajando, estado.trabajando)
            estado.ocupado -> getString(R.string.motor_ocupado)
            estado.proximaRutina != null -> getString(
                R.string.motor_proxima,
                DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(estado.proximaRutina)),
            )
            else -> getString(R.string.motor_en_espera)
        }
        if (texto == ultimoTexto) return
        ultimoTexto = texto
        getSystemService(NotificationManager::class.java).notify(ID_MOTOR, notificacion(texto))
    }

    private fun avisarAprobaciones(cantidad: Int) {
        val gestor = getSystemService(NotificationManager::class.java)
        if (cantidad == 0) {
            if (avisadas > 0) gestor.cancel(ID_APROBACIONES)
            avisadas = 0
            return
        }
        if (cantidad > avisadas && !Gravity.pantallaVisible(this)) {
            val texto = if (cantidad == 1) getString(R.string.aprobacion_una) else getString(R.string.aprobaciones, cantidad)
            avisar(ID_APROBACIONES, texto, abrirApp = true)
        }
        avisadas = cantidad
    }

    private fun abrirApp(): PendingIntent = PendingIntent.getActivity(
        this,
        0,
        Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun notificacion(texto: String): Notification {
        val apagar = PendingIntent.getForegroundService(
            this,
            1,
            Intent(this, Motor::class.java).setAction(ACCION_APAGAR),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val aviso = Notification.Builder(this, CANAL_MOTOR)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setContentTitle(getString(R.string.motor_titulo))
            .setContentText(texto)
            .setContentIntent(abrirApp())
            .setOngoing(true)
            .setShowWhen(false)
            .addAction(Notification.Action.Builder(null as Icon?, getString(R.string.motor_apagar), apagar).build())
        if (Build.VERSION.SDK_INT >= 31) aviso.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        return aviso.build()
    }

    private fun avisar(id: Int, texto: String, abrirApp: Boolean) {
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        val aviso = Notification.Builder(this, CANAL_AVISOS)
            .setSmallIcon(R.drawable.ic_notificacion)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(texto)
            .setAutoCancel(true)
        if (abrirApp) aviso.setContentIntent(abrirApp())
        getSystemService(NotificationManager::class.java).notify(id, aviso.build())
    }

    // ---------------------------------------------------------------- Arranques fallidos

    /** Si el motor se cae enseguida varias veces seguidas, no se insiste: se avisa y se espera a que abras la app. */
    private object Fallos {
        private fun archivo(contexto: Context) = File(contexto.noBackupFilesDir, "fallos")

        private fun recientes(contexto: Context): List<Long> {
            val limite = System.currentTimeMillis() - 10 * 60_000
            return archivo(contexto).takeIf { it.exists() }?.readLines()
                ?.mapNotNull { it.trim().toLongOrNull() }?.filter { it > limite }.orEmpty()
        }

        fun anotar(contexto: Context) {
            Gravity.escribir(archivo(contexto), (recientes(contexto) + System.currentTimeMillis()).joinToString("\n"))
        }

        fun demasiados(contexto: Context): Boolean = recientes(contexto).size >= 3

        fun olvidar(contexto: Context) {
            archivo(contexto).delete()
        }
    }

    companion object {
        const val ACCION_INICIAR = "ar.gravity.app.INICIAR"
        const val ACCION_DESPERTAR = "ar.gravity.app.DESPERTAR"
        const val ACCION_REINICIAR = "ar.gravity.app.REINICIAR"
        const val ACCION_APAGAR = "ar.gravity.app.APAGAR"

        private const val CANAL_MOTOR = "motor"
        private const val CANAL_AVISOS = "avisos"
        private const val ID_MOTOR = 1
        private const val ID_APROBACIONES = 2
        private const val ID_ERROR = 3

        @Volatile
        private var nodeArrancado = false

        @Volatile
        private var arranque = 0L

        /** El servicio, si está vivo en este proceso. */
        @Volatile
        var instancia: Motor? = null
            private set

        fun enviar(contexto: Context, accion: String) {
            contexto.startForegroundService(Intent(contexto, Motor::class.java).setAction(accion))
        }

        fun crearCanales(contexto: Context) {
            val gestor = contexto.getSystemService(NotificationManager::class.java)
            gestor.createNotificationChannel(
                NotificationChannel(CANAL_MOTOR, contexto.getString(R.string.canal_motor), NotificationManager.IMPORTANCE_LOW).apply {
                    description = contexto.getString(R.string.canal_motor_descripcion)
                    setShowBadge(false)
                },
            )
            gestor.createNotificationChannel(
                NotificationChannel(CANAL_AVISOS, contexto.getString(R.string.canal_avisos), NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = contexto.getString(R.string.canal_avisos_descripcion)
                },
            )
        }
    }
}
