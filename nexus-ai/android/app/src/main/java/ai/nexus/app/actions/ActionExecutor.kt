package ai.nexus.app.actions

import ai.nexus.app.whatsapp.ContactResolver
import ai.nexus.app.whatsapp.PhoneNormalizer
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.AlarmClock
import android.provider.CalendarContract
import android.provider.ContactsContract
import android.provider.MediaStore
import android.provider.Settings
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import java.net.URLEncoder
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId

/** Resultado real de ejecutar una acción en el teléfono (lo que se informa al backend). */
data class ExecResult(val state: String, val info: Map<String, String> = emptyMap()) {
    val ok get() = state != "ERROR" && state != "APP_NOT_FOUND"
}

fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull
fun JsonObject.int(key: String): Int? = (this[key] as? JsonPrimitive)?.intOrNull
fun JsonObject.bool(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull

/**
 * NEXUS Phone Control: ejecuta acciones del Action Registry SOLO con APIs e intents oficiales
 * de Android. No usa servicios de accesibilidad ni simula toques, y no cambia ajustes
 * protegidos: para esos abre la pantalla del sistema y el usuario decide.
 */
object ActionExecutor {
    const val WHATSAPP = "com.whatsapp"
    const val WHATSAPP_BUSINESS = "com.whatsapp.w4b"

    private val SETTINGS = mapOf(
        "general" to Settings.ACTION_SETTINGS, "wifi" to Settings.ACTION_WIFI_SETTINGS, "bluetooth" to Settings.ACTION_BLUETOOTH_SETTINGS,
        "display" to Settings.ACTION_DISPLAY_SETTINGS, "sound" to Settings.ACTION_SOUND_SETTINGS,
        "battery" to Settings.ACTION_BATTERY_SAVER_SETTINGS, "location" to Settings.ACTION_LOCATION_SOURCE_SETTINGS,
        "apps" to Settings.ACTION_APPLICATION_SETTINGS, "notifications" to Settings.ACTION_APP_NOTIFICATION_SETTINGS,
        "data" to Settings.ACTION_DATA_ROAMING_SETTINGS, "airplane" to Settings.ACTION_AIRPLANE_MODE_SETTINGS,
        "nfc" to Settings.ACTION_NFC_SETTINGS, "accessibility" to Settings.ACTION_ACCESSIBILITY_SETTINGS,
        "date" to Settings.ACTION_DATE_SETTINGS, "language" to Settings.ACTION_LOCALE_SETTINGS,
        "security" to Settings.ACTION_SECURITY_SETTINGS, "storage" to Settings.ACTION_INTERNAL_STORAGE_SETTINGS,
    )

    fun settingsIntent(panel: String, packageName: String): Intent {
        val action = SETTINGS[panel] ?: Settings.ACTION_SETTINGS
        return Intent(action).apply {
            if (action == Settings.ACTION_APP_NOTIFICATION_SETTINGS) putExtra(Settings.EXTRA_APP_PACKAGE, packageName)
        }
    }

    /** Apps del sistema por categoría (selectores oficiales), para nombres genéricos. */
    fun genericAppIntent(name: String): Intent? = when (ContactResolver.fold(name)) {
        "camara", "la camara", "camera" -> Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA)
        "contactos", "agenda de contactos" -> Intent(Intent.ACTION_VIEW, ContactsContract.Contacts.CONTENT_URI)
        "calendario", "agenda" -> Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_CALENDAR)
        "configuracion", "ajustes" -> Intent(Settings.ACTION_SETTINGS)
        "telefono", "marcador" -> Intent(Intent.ACTION_DIAL)
        "mensajes", "sms" -> Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_MESSAGING)
        "correo", "mail", "email" -> Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_EMAIL)
        "navegador", "internet" -> Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_BROWSER)
        "musica" -> Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_MUSIC)
        "mapas", "mapa" -> Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_MAPS)
        "calculadora" -> Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_CALCULATOR)
        "galeria", "fotos" -> Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_GALLERY)
        "reloj", "alarmas" -> Intent(AlarmClock.ACTION_SHOW_ALARMS)
        else -> null
    }

    /** Busca una app instalada por su nombre visible (lanzadores visibles por <queries>). */
    fun findLaunchable(context: Context, name: String): Pair<Intent, String>? {
        val pm = context.packageManager
        val target = ContactResolver.fold(name)
        val launchers = pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
        var best: Pair<Intent, String>? = null
        var bestScore = 0.0
        for (info in launchers) {
            val label = info.loadLabel(pm).toString()
            val folded = ContactResolver.fold(label)
            val score = when {
                folded == target -> 1.0
                folded.startsWith(target) || target.startsWith(folded) -> 0.9
                folded.contains(target) -> 0.8
                else -> ContactResolver.similarity(target, folded)
            }
            if (score > bestScore) {
                val launch = pm.getLaunchIntentForPackage(info.activityInfo.packageName) ?: continue
                bestScore = score
                best = launch to label
            }
        }
        return if (bestScore >= 0.75) best else null
    }

    fun whatsappIntent(context: Context, e164: String, text: String, preferBusiness: Boolean = false): Intent {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(PhoneNormalizer.waLink(e164, text)))
        val installed = installedWhatsApps(context)
        val pkg = when {
            preferBusiness && WHATSAPP_BUSINESS in installed -> WHATSAPP_BUSINESS
            WHATSAPP in installed -> WHATSAPP
            WHATSAPP_BUSINESS in installed -> WHATSAPP_BUSINESS
            else -> null
        }
        if (pkg != null) intent.setPackage(pkg)
        return intent
    }

    fun installedWhatsApps(context: Context): List<String> = listOf(WHATSAPP, WHATSAPP_BUSINESS).filter {
        try {
            context.packageManager.getPackageInfo(it, 0); true
        } catch (_: PackageManager.NameNotFoundException) {
            false
        }
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private fun millis(iso: String?): Long? = try {
        iso?.let { OffsetDateTime.parse(it).toInstant().toEpochMilli() }
    } catch (_: Exception) {
        null
    }

    /** Construye el intent oficial de cada acción de dispositivo (sin ejecutarlo). */
    fun buildIntent(context: Context, key: String, p: JsonObject): Pair<Intent?, String> = when (key) {
        "whatsapp.open_chat" -> {
            val phone = PhoneNormalizer.normalize(p.str("phone"))
            if (!phone.usable) null to "ERROR" else whatsappIntent(context, phone.e164!!, p.str("text") ?: "", p.bool("prefer_business") == true) to "WHATSAPP_OPENED"
        }
        "device.dial" -> {
            val number = p.str("phone")?.filter { it.isDigit() || it == '+' }
            if (number.isNullOrEmpty()) null to "ERROR" else Intent(Intent.ACTION_DIAL, Uri.parse("tel:$number")) to "DIALER_OPENED"
        }
        "device.share_text" -> {
            val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, p.str("text") ?: "")
            // Con destino (WhatsApp/Instagram) se abre directo esa app: ahí elegís el grupo o el chat y tocás Enviar.
            val pkg = when (p.str("target")) { "whatsapp" -> "com.whatsapp"; "whatsapp_business" -> "com.whatsapp.w4b"; "instagram" -> "com.instagram.android"; else -> null }
            val installed = pkg != null && runCatching { context.packageManager.getPackageInfo(pkg, 0) }.isSuccess
            if (installed) send.setPackage(pkg)
            (if (installed) send else Intent.createChooser(send, p.str("title") ?: "Compartir")) to "SHARE_SHEET_OPENED"
        }
        "device.open_settings" -> settingsIntent(p.str("panel") ?: "general", context.packageName) to "SETTINGS_OPENED"
        "device.navigate" -> {
            val mode = when (p.str("mode")) { "walking" -> "walking"; "bicycling" -> "bicycling"; "transit" -> "transit"; else -> "driving" }
            Intent(Intent.ACTION_VIEW, Uri.parse("https://www.google.com/maps/dir/?api=1&destination=${enc(p.str("destination") ?: "")}&travelmode=$mode")) to "MAPS_OPENED"
        }
        "device.map_search" -> Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=${enc(p.str("query") ?: "")}")) to "MAPS_OPENED"
        "device.set_alarm" -> Intent(AlarmClock.ACTION_SET_ALARM).apply {
            putExtra(AlarmClock.EXTRA_HOUR, p.int("hour") ?: 0)
            putExtra(AlarmClock.EXTRA_MINUTES, p.int("minute") ?: 0)
            p.str("label")?.let { putExtra(AlarmClock.EXTRA_MESSAGE, it) }
            putExtra(AlarmClock.EXTRA_SKIP_UI, false)
        } to "ALARM_SET"
        "device.set_timer" -> Intent(AlarmClock.ACTION_SET_TIMER).apply {
            putExtra(AlarmClock.EXTRA_LENGTH, p.int("seconds") ?: 60)
            p.str("label")?.let { putExtra(AlarmClock.EXTRA_MESSAGE, it) }
            putExtra(AlarmClock.EXTRA_SKIP_UI, false)
        } to "TIMER_SET"
        "device.calendar_event" -> Intent(Intent.ACTION_INSERT, CalendarContract.Events.CONTENT_URI).apply {
            putExtra(CalendarContract.Events.TITLE, p.str("title") ?: "Evento")
            millis(p.str("start"))?.let { putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, it) }
            millis(p.str("end"))?.let { putExtra(CalendarContract.EXTRA_EVENT_END_TIME, it) }
            if (p.bool("all_day") == true) putExtra(CalendarContract.EXTRA_EVENT_ALL_DAY, true)
            p.str("location")?.let { putExtra(CalendarContract.Events.EVENT_LOCATION, it) }
            p.str("description")?.let { putExtra(CalendarContract.Events.DESCRIPTION, it) }
        } to "CALENDAR_OPENED"
        "device.calendar_view" -> {
            val day = runCatching { LocalDate.parse(p.str("date")) }.getOrNull() ?: LocalDate.now()
            val ms = day.atStartOfDay(ZoneId.systemDefault()).toInstant().toEpochMilli()
            Intent(Intent.ACTION_VIEW, Uri.parse("content://com.android.calendar/time/$ms")) to "CALENDAR_OPENED"
        }
        "device.contact_create" -> Intent(ContactsContract.Intents.Insert.ACTION).apply {
            type = ContactsContract.RawContacts.CONTENT_TYPE
            putExtra(ContactsContract.Intents.Insert.NAME, p.str("name") ?: "")
            p.str("phone")?.let { putExtra(ContactsContract.Intents.Insert.PHONE, it) }
        } to "CONTACTS_OPENED"
        "device.open_url" -> {
            val url = p.str("url") ?: ""
            if (!url.startsWith("https://")) null to "ERROR" else Intent(Intent.ACTION_VIEW, Uri.parse(url)) to "BROWSER_OPENED"
        }
        "device.open_app" -> {
            val name = p.str("app") ?: ""
            val generic = genericAppIntent(name)
            when {
                generic != null -> generic to "APP_OPENED"
                else -> findLaunchable(context, name)?.let { it.first to "APP_OPENED" } ?: (null to "APP_NOT_FOUND")
            }
        }
        else -> null to "ERROR"
    }

    /** Ejecuta la acción desde una Activity y devuelve lo que realmente pasó. */
    fun execute(activity: Activity, key: String, params: JsonObject): ExecResult {
        val (intent, state) = buildIntent(activity, key, params)
        if (intent == null) {
            return ExecResult(state, mapOf("error" to when (state) {
                "APP_NOT_FOUND" -> "No encontré una app instalada llamada «${params.str("app")}»"
                else -> "Faltan datos válidos para ejecutar la acción"
            }))
        }
        return try {
            if (intent.action != Intent.ACTION_CHOOSER) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(intent)
            val info = buildMap {
                if (key == "whatsapp.open_chat") {
                    PhoneNormalizer.normalize(params.str("phone")).masked?.let { put("recipient_masked", it) }
                    put("text_chars", (params.str("text") ?: "").length.toString())
                }
                if (key == "device.open_app") put("app_label", params.str("app") ?: "")
                if (key == "device.open_settings") put("panel", params.str("panel") ?: "general")
            }
            ExecResult(state, info)
        } catch (_: ActivityNotFoundException) {
            ExecResult("ERROR", mapOf("error" to "No hay ninguna app en el teléfono que pueda hacer esto"))
        } catch (e: SecurityException) {
            ExecResult("ERROR", mapOf("error" to (e.message ?: "Android no permitió la acción")))
        }
    }
}
