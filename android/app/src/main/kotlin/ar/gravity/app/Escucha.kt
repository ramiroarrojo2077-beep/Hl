package ar.gravity.app

import android.app.Notification
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.HandlerThread
import android.os.Parcelable
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import org.json.JSONArray
import org.json.JSONObject

/**
 * Lee WhatsApp y las demás apps de mensajería por las notificaciones del celular y, cuando el motor
 * lo pide, responde con la acción "Responder" de la notificación (RemoteInput), como las apps de
 * autorrespuesta. Corre en el proceso ":motor" (el mismo que Node), así comparte el token de Gravity.
 *
 * No hace nada hasta que el usuario activa el acceso a las notificaciones (lo pide [MainActivity]) y el
 * motor marca la mensajería como activa (GET /api/mensajeria/estado). Todo lo que sale de las
 * notificaciones es dato que se le pasa al motor; nunca se interpreta como una orden acá.
 */
class Escucha : NotificationListenerService() {

    /** Apps de mensajería conocidas y su nombre lindo; el motor decide cuáles escuchar. */
    private val nombres = mapOf(
        "com.whatsapp" to "WhatsApp",
        "com.whatsapp.w4b" to "WhatsApp Business",
        "com.instagram.android" to "Instagram",
        "com.facebook.orca" to "Messenger",
        "com.facebook.katana" to "Facebook",
        "com.zhiliaoapp.musically" to "TikTok",
        "com.ss.android.ugc.trill" to "TikTok",
        "com.google.android.youtube" to "YouTube",
        "org.telegram.messenger" to "Telegram",
    )

    /** Acción "Responder" de la última notificación de cada conversación (clave = "paquete|conversacion"). */
    private class Responder(val pendiente: PendingIntent, val entradas: Array<RemoteInput>)

    // La usan el hilo de las notificaciones y el de salientes.
    private val acciones: MutableMap<String, Responder> = java.util.Collections.synchronizedMap(LinkedHashMap())

    /** Firmas (de|texto|hora) ya mandadas por conversación, para no repetir al actualizarse la notificación. */
    private val vistos = object : LinkedHashMap<String, LinkedHashSet<String>>() {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, LinkedHashSet<String>>) = size > 200
    }

    @Volatile
    private var activa = false

    @Volatile
    private var escuchadas: Set<String> = emptySet()
    private var estadoAl = 0L

    private lateinit var hilo: HandlerThread
    private lateinit var red: Handler
    // Hilo aparte para esperar las respuestas: el pedido queda abierto hasta 25 s y no tiene que frenar
    // el envío de los mensajes que llegan.
    private lateinit var hiloSalida: HandlerThread
    private lateinit var salida: Handler

    @Volatile
    private var sondeoProgramado = false

    /** Envíos hechos que esperan ver un cambio en la notificación de esa conversación (clave -> id del saliente). */
    private val sinConfirmar = java.util.concurrent.ConcurrentHashMap<String, String>()

    override fun onCreate() {
        super.onCreate()
        hilo = HandlerThread("escucha-red").apply { start() }
        red = Handler(hilo.looper)
        hiloSalida = HandlerThread("escucha-salientes").apply { start() }
        salida = Handler(hiloSalida.looper)
    }

    override fun onDestroy() {
        if (this::hilo.isInitialized) {
            red.removeCallbacksAndMessages(null)
            hilo.quitSafely()
            salida.removeCallbacksAndMessages(null)
            hiloSalida.quitSafely()
        }
        super.onDestroy()
    }

    override fun onListenerConnected() {
        refrescarEstado(forzar = true)
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification) {
        // Tras contestar desde la notificación, WhatsApp la actualiza o la saca: eso confirma el envío.
        red.post { claveDe(sbn)?.let { confirmar(it) } }
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        // El trabajo pesado (leer extras, red) va al hilo aparte: acá solo se agenda.
        red.post { procesar(sbn) }
    }

    // ---------------------------------------------------------------- Entrada

    private fun procesar(sbn: StatusBarNotification) {
        try {
            refrescarEstado(forzar = false)
            if (!activa) return
            val paquete = sbn.packageName ?: return
            if (paquete == packageName || paquete !in escuchadas) return
            val notif = sbn.notification ?: return
            // Resumen de grupo (la notificación "paraguas"): los mensajes vienen en las hijas.
            if (notif.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
            val extras = notif.extras ?: return

            val estilo = extraerConversacion(extras)
            val conversacion = limpiarTitulo(estilo.conversacion).ifBlank { nombres[paquete] ?: paquete }
            val clave = "$paquete|$conversacion"
            confirmar(clave)

            guardarAccion(clave, notif)
            val puedeResponder = acciones.containsKey(clave)

            val yaVistos = vistos.getOrPut(clave) { LinkedHashSet() }
            val nuevos = JSONArray()
            for (m in estilo.mensajes) {
                if (m.propio) continue
                val texto = m.texto.trim()
                if (texto.isEmpty()) continue
                val firma = "${m.de}\u0000$texto\u0000${m.hora}"
                if (!yaVistos.add(firma)) continue
                nuevos.put(
                    JSONObject()
                        .put("de", m.de)
                        .put("texto", texto)
                        .put("hora", m.hora)
                        .put("propio", false),
                )
            }
            // Que el set no crezca sin fin en conversaciones largas.
            while (yaVistos.size > 80) yaVistos.remove(yaVistos.iterator().next())
            if (nuevos.length() == 0) {
                // Igual puede haber quedado una acción nueva para responder lo que ya estaba pendiente.
                if (puedeResponder) sondearSalientes()
                return
            }

            val cuerpo = JSONObject()
                .put("app", paquete)
                .put("appNombre", nombreApp(paquete))
                .put("clave", clave)
                .put("conversacion", conversacion)
                .put("esGrupo", estilo.esGrupo)
                .put("puedeResponder", puedeResponder)
                .put("mensajes", nuevos)
            MotorLocal.pedir(this, "POST", "/api/mensajeria/entrante", cuerpo)
            sondearSalientes()
        } catch (e: Exception) {
            // Una notificación rara no debe tirar abajo el servicio.
        }
    }

    /** WhatsApp pone el título como "Juan (3 mensajes)": sin el contador la clave de la conversación no cambia. */
    private fun limpiarTitulo(t: String): String =
        t.replace(Regex("\\s*\\(\\d+\\s*(mensajes?|messages?|nuevos?|new)[^)]*\\)\\s*$", RegexOption.IGNORE_CASE), "").trim()

    private fun claveDe(sbn: StatusBarNotification): String? {
        val paquete = sbn.packageName ?: return null
        if (paquete !in escuchadas) return null
        val extras = sbn.notification?.extras ?: return null
        val conversacion = limpiarTitulo(extraerConversacion(extras).conversacion).ifBlank { nombres[paquete] ?: paquete }
        return "$paquete|$conversacion"
    }

    private fun confirmar(clave: String) {
        val id = sinConfirmar.remove(clave) ?: return
        informarResultado(id, true, null)
    }

    private class Mensaje(val de: String, val texto: String, val hora: Long, val propio: Boolean)
    private class Conversacion(val conversacion: String, val esGrupo: Boolean, val mensajes: List<Mensaje>)

    /** Saca conversación, si es grupo y los mensajes del estilo de mensajería o, si no, del título/texto. */
    private fun extraerConversacion(extras: Bundle): Conversacion {
        val yo = extras.getCharSequence(Notification.EXTRA_SELF_DISPLAY_NAME)?.toString()
        val titulo = extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)?.toString()
            ?: extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() ?: ""
        val esGrupo = extras.getBoolean(Notification.EXTRA_IS_GROUP_CONVERSATION, false)

        val crudos = mensajesDelBundle(extras)
        if (crudos.isNotEmpty()) {
            val mensajes = crudos.map { b ->
                val de = b.getCharSequence(KEY_SENDER)?.toString()
                    ?: (b.getBundle(KEY_SENDER_PERSON)?.getCharSequence("name")?.toString())
                val texto = b.getCharSequence(KEY_TEXT)?.toString() ?: ""
                val hora = b.getLong(KEY_TIMESTAMP, System.currentTimeMillis())
                // En MessagingStyle, los mensajes propios no traen remitente (o es el nombre propio).
                val propio = de.isNullOrBlank() || (yo != null && de == yo)
                Mensaje(de?.takeIf { it.isNotBlank() } ?: (yo ?: ""), texto, hora, propio)
            }
            return Conversacion(titulo, esGrupo, mensajes)
        }

        // Sin estilo de mensajería: un único mensaje con el título como remitente y el texto como cuerpo.
        val texto = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() ?: ""
        if (texto.isBlank()) return Conversacion(titulo, esGrupo, emptyList())
        // Si el título trae "Juan: hola", separo remitente de texto para los grupos.
        return Conversacion(titulo, esGrupo, listOf(Mensaje(titulo, texto, System.currentTimeMillis(), false)))
    }

    /** Lista de bundles de EXTRA_MESSAGES (o la que arme el extractor oculto si está). */
    private fun mensajesDelBundle(extras: Bundle): List<Bundle> {
        @Suppress("DEPRECATION")
        val arreglo: Array<Parcelable>? = extras.getParcelableArray(Notification.EXTRA_MESSAGES)
        if (arreglo == null || arreglo.isEmpty()) return emptyList()
        return arreglo.filterIsInstance<Bundle>()
    }

    private fun nombreApp(paquete: String): String {
        nombres[paquete]?.let { return it }
        return try {
            val pm = packageManager
            pm.getApplicationLabel(pm.getApplicationInfo(paquete, 0)).toString()
        } catch (e: Exception) {
            paquete
        }
    }

    /** Guarda (o reemplaza) la acción de responder de la conversación, si la notificación trae una. */
    private fun guardarAccion(clave: String, notif: Notification) {
        val acciones = (notif.actions ?: return).sortedBy {
            // La acción "Responder" de verdad primero (WhatsApp tiene también "Marcar como leído", etc.).
            if (Build.VERSION.SDK_INT >= 28 && it.semanticAction == Notification.Action.SEMANTIC_ACTION_REPLY) 0 else 1
        }
        for (accion in acciones) {
            if (Build.VERSION.SDK_INT >= 29 && accion.isContextual) continue
            val entradas = accion.remoteInputs ?: continue
            if (entradas.isEmpty()) continue
            val pendiente = accion.actionIntent ?: continue
            this.acciones[clave] = Responder(pendiente, entradas)
            synchronized(this.acciones) {
                while (this.acciones.size > 100) {
                    val vieja = this.acciones.keys.iterator().next()
                    this.acciones.remove(vieja)
                }
            }
            return
        }
    }

    // ---------------------------------------------------------------- Salientes

    /**
     * Mientras haya acciones de responder guardadas, deja un pedido abierto al motor: la respuesta de un
     * compañero sale apenas está lista, sin esperar a la próxima vuelta de un sondeo.
     */
    private fun sondearSalientes() {
        if (sondeoProgramado) return
        sondeoProgramado = true
        salida.post { bucleSalientes() }
    }

    private fun bucleSalientes() {
        sondeoProgramado = false
        if (acciones.isEmpty() || !activa) return
        val bien = procesarSalientes()
        if (acciones.isNotEmpty()) {
            sondeoProgramado = true
            if (bien) salida.post { bucleSalientes() } else salida.postDelayed({ bucleSalientes() }, 2_000)
        }
    }

    /** false si el motor no respondió (se reintenta en un rato). */
    private fun procesarSalientes(): Boolean {
        val respuesta = MotorLocal.pedir(this, "GET", "/api/mensajeria/salientes?esperar=25", esperaMs = 30_000) ?: return false
        if (!respuesta.ok) return false
        val lista = try {
            JSONArray(respuesta.cuerpo)
        } catch (e: Exception) {
            return false
        }
        for (i in 0 until lista.length()) {
            val item = lista.optJSONObject(i) ?: continue
            val id = item.optString("id").takeIf { it.isNotEmpty() } ?: continue
            val clave = item.optString("clave")
            val texto = item.optString("texto")
            enviarRespuesta(id, clave, texto)
        }
        return true
    }

    /** Toma la acción de la notificación que está hoy en la barra: una guardada de antes puede ser letra muerta. */
    private fun refrescarAccion(clave: String) {
        try {
            for (sbn in activeNotifications ?: return) {
                if (claveDe(sbn) != clave) continue
                val notif = sbn.notification ?: continue
                if (notif.flags and Notification.FLAG_GROUP_SUMMARY != 0) continue
                guardarAccion(clave, notif)
                return
            }
            // Ya no hay notificación de esa conversación: la acción guardada no sirve.
            acciones.remove(clave)
        } catch (e: Exception) {
            // Si no se puede consultar la barra, se intenta con la que había.
        }
    }

    private fun enviarRespuesta(id: String, clave: String, texto: String) {
        refrescarAccion(clave)
        val responder = acciones[clave]
        if (responder == null) {
            informarResultado(id, false, getString(R.string.msj_sin_accion))
            return
        }
        // Android 12+: para completar un RemoteInput la acción tiene que ser mutable; si es inmutable
        // el texto se ignora en silencio, así que mejor avisarlo.
        if (Build.VERSION.SDK_INT >= 31 && responder.pendiente.isImmutable) {
            acciones.remove(clave)
            informarResultado(id, false, getString(R.string.msj_sin_accion))
            return
        }
        try {
            val relleno = Intent()
            val resultados = Bundle()
            for (entrada in responder.entradas) resultados.putCharSequence(entrada.resultKey, texto)
            RemoteInput.addResultsToIntent(responder.entradas, relleno, resultados)
            if (Build.VERSION.SDK_INT >= 28) {
                RemoteInput.setResultsSource(relleno, RemoteInput.SOURCE_FREE_FORM_INPUT)
            }
            sinConfirmar[clave] = id
            responder.pendiente.send(this, 0, relleno)
            // El ok recién se informa cuando la notificación cambia; si no pasa nada, se avisa y se reintenta.
            salida.postDelayed({
                if (sinConfirmar.remove(clave, id)) informarResultado(id, false, getString(R.string.msj_sin_confirmar))
            }, 12_000)
        } catch (e: PendingIntent.CanceledException) {
            // La conversación ya no está abierta en la barra: no sirve más esta acción.
            sinConfirmar.remove(clave, id)
            acciones.remove(clave)
            informarResultado(id, false, getString(R.string.msj_sin_accion))
        } catch (e: Exception) {
            sinConfirmar.remove(clave, id)
            informarResultado(id, false, getString(R.string.msj_envio_fallo))
        }
    }

    private fun informarResultado(id: String, ok: Boolean, error: String?) {
        val cuerpo = JSONObject().put("ok", ok)
        if (!ok && error != null) cuerpo.put("error", error)
        MotorLocal.pedir(this, "POST", "/api/mensajeria/salientes/$id/resultado", cuerpo)
    }

    // ---------------------------------------------------------------- Estado

    /** Consulta cada tanto qué apps escuchar y si la mensajería está activa. */
    private fun refrescarEstado(forzar: Boolean) {
        val ahora = System.currentTimeMillis()
        if (!forzar && ahora - estadoAl < 20_000) return
        estadoAl = ahora
        val respuesta = MotorLocal.pedir(this, "GET", "/api/mensajeria/estado") ?: return
        if (!respuesta.ok) return
        try {
            val json = JSONObject(respuesta.cuerpo)
            activa = json.optBoolean("activa", false)
            val apps = json.optJSONArray("apps")
            val set = HashSet<String>()
            if (apps != null) {
                for (i in 0 until apps.length()) {
                    val app = apps.optJSONObject(i) ?: continue
                    if (app.optBoolean("activa", true)) {
                        app.optString("paquete").takeIf { it.isNotEmpty() }?.let { set.add(it) }
                    }
                }
            }
            escuchadas = set
        } catch (e: Exception) {
            // Respuesta ilegible: se mantiene el último estado conocido.
        }
    }

    private companion object {
        // Claves del Bundle de cada mensaje de MessagingStyle (API 24+); estables y públicas en el SDK.
        // Claves de los mensajes de MessagingStyle: Message.KEY_TEXT es oculta en el SDK público.
        const val KEY_TEXT = "text"
        const val KEY_TIMESTAMP = "time"
        const val KEY_SENDER = "sender"
        const val KEY_SENDER_PERSON = "sender_person"
    }
}
