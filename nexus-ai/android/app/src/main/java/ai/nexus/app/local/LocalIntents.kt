package ai.nexus.app.local

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.text.Normalizer
import java.time.Duration
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

/*
 * Port fiel de backend/app/jarvis/timeparse.py e intents.py (modo local, sin servidor).
 * Clasificador determinista: las órdenes frecuentes se resuelven sin llamar a un modelo.
 */

val ISO_FMT: DateTimeFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX")
fun ZonedDateTime.iso(): String = format(ISO_FMT)
private val HM = DateTimeFormatter.ofPattern("HH:mm")
private val DMY = DateTimeFormatter.ofPattern("dd/MM/yyyy")
private val DM = DateTimeFormatter.ofPattern("dd/MM")

private fun rx(p: String) = Regex(p)
private fun Regex.lookingAt(s: String): java.util.regex.Matcher? = toPattern().matcher(s).let { if (it.lookingAt()) it else null }
private fun Regex.findM(s: String): java.util.regex.Matcher? = toPattern().matcher(s).let { if (it.find()) it else null }
private fun java.util.regex.Matcher.g(name: String): String? = try { group(name) } catch (_: IllegalArgumentException) { null }
private fun java.util.regex.Matcher.span(): Pair<Int, Int> = start() to end()

// ------------------------------------------------------------------ timeparse

private val NUM = linkedMapOf(
    "un" to 1, "una" to 1, "uno" to 1, "dos" to 2, "tres" to 3, "cuatro" to 4, "cinco" to 5, "seis" to 6, "siete" to 7, "ocho" to 8,
    "nueve" to 9, "diez" to 10, "once" to 11, "doce" to 12, "trece" to 13, "catorce" to 14, "quince" to 15, "veinte" to 20,
    "veinticinco" to 25, "treinta" to 30, "cuarenta" to 40, "cuarenta y cinco" to 45, "cincuenta" to 50, "sesenta" to 60, "noventa" to 90,
)
private val NUM_RE = NUM.keys.sortedByDescending { it.length }.joinToString("|")
private val MONTHS = linkedMapOf("enero" to 1, "febrero" to 2, "marzo" to 3, "abril" to 4, "mayo" to 5, "junio" to 6, "julio" to 7, "agosto" to 8,
    "septiembre" to 9, "setiembre" to 9, "octubre" to 10, "noviembre" to 11, "diciembre" to 12)
private val WEEKDAYS = mapOf("lunes" to 0, "martes" to 1, "miercoles" to 2, "jueves" to 3, "viernes" to 4, "sabado" to 5, "domingo" to 6)

private val REL_RE = rx("""\b(?:en|dentro de)\s+(\d+|$NUM_RE|media)\s+(minutos?|mins?|horas?|hs|dias?|semanas?)\b""")
private val REL_HALF_HOUR_RE = rx("""\b(?:en|dentro de)\s+media\s+hora\b""")
private val TIME_RE = rx(
    """\b(?:a\s+las|a\s+la|para\s+las|tipo|las)\s+(\d{1,2}|$NUM_RE)(?:\s*(?::|\.|h)\s*(\d{2}))?(?:\s*(?:hs|h|horas)\b)?""" +
        """(\s+y\s+media|\s+y\s+cuarto|\s+menos\s+cuarto)?""" +
        """(\s+(?:de\s+la|a\s+la|por\s+la|en\s+la)\s+(?:manana|tarde|noche|madrugada)|\s*(?:am|pm|a\.m\.|p\.m\.))?""")
private val NOON_RE = rx("""\b(?:al|a)\s+(mediodia|medianoche)\b""")
private val DAY_RE = rx("""\b(pasado\s+manana|hoy|esta\s+noche|esta\s+tarde|esta\s+manana)\b|(?<!la )(?<!de la )\bmanana\b""")
private val WEEKDAY_RE = rx("""\b(?:el|este|el\s+proximo|proximo)\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b""")
private val DATE_TEXT_RE = rx("""\b(?:el\s+)?(\d{1,2})\s+de\s+(${MONTHS.keys.joinToString("|")})(?:\s+(?:de|del)\s+(\d{4}))?\b""")
private val DATE_NUM_RE = rx("""\b(?:el\s+)?(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b""")
private val PART_RE = rx("""\b(?:a|por|en)\s+la\s+(manana|tarde|noche)\b""")

class When {
    var dt: ZonedDateTime? = null
    var day: LocalDate? = null
    var hasTime = false
    val spans = mutableListOf<Pair<Int, Int>>()
    val assumptions = mutableListOf<String>()
    val found get() = dt != null || day != null
}

private fun num(token: String): Int = token.toIntOrNull() ?: NUM.getValue(token)

fun parseDurationSeconds(norm: String): Pair<Int?, Pair<Int, Int>?> {
    rx("""\b(?:de|por)?\s*media\s+hora\b""").findM(norm)?.let { return 1800 to it.span() }
    val m = rx("""\b(\d+|$NUM_RE)\s+(segundos?|segs?|minutos?|mins?|horas?|hs)\b(?:\s+y\s+media)?""").findM(norm) ?: return null to null
    val n = num(m.group(1))
    val unit = m.group(2)
    var secs = if (unit.startsWith("seg")) n else if (unit.startsWith("min")) n * 60 else n * 3600
    if (m.group(0).contains("y media")) secs += if (unit.startsWith("seg")) 30 else if (unit.startsWith("min")) 30 * 60 else 1800
    return secs to m.span()
}

private fun hourFrom(m: java.util.regex.Matcher): Triple<Int, Int, Boolean> {
    var hour = num(m.group(1))
    var minute = m.group(2)?.toInt() ?: 0
    when ((m.group(3) ?: "").trim()) {
        "y media" -> minute = 30
        "y cuarto" -> minute = 15
        "menos cuarto" -> { hour = Math.floorMod(hour - 1, 24); minute = 45 }
    }
    val qual = (m.group(4) ?: "").trim().replace(".", "")
    val explicit = qual.isNotEmpty()
    if (qual.endsWith("tarde") || qual == "pm") { if (hour < 12) hour += 12 }
    else if (qual.endsWith("noche")) { if (hour == 12) hour = 0 else if (hour in 6..11) hour += 12 }
    else if (qual.endsWith("manana") || qual.endsWith("madrugada") || qual == "am") { if (hour == 12) hour = 0 }
    return Triple(hour, minute, explicit)
}

fun parseWhen(norm: String, now: ZonedDateTime, preferPm: Boolean = true, defaultDay: LocalDate? = null): When {
    val w = When()
    REL_HALF_HOUR_RE.findM(norm)?.let { w.dt = now.plusMinutes(30); w.hasTime = true; w.spans += it.span(); return w }
    REL_RE.findM(norm)?.let { m ->
        val unit = m.group(2)
        val d: Duration = if (m.group(1) == "media") {
            if (unit.startsWith("min")) Duration.ofSeconds(30) else if (unit.startsWith("hora") || unit.startsWith("hs")) Duration.ofMinutes(30)
            else if (unit.startsWith("dia")) Duration.ofHours(12) else Duration.ofDays(3).plusHours(12)
        } else {
            val n = num(m.group(1)).toLong()
            if (unit.startsWith("min")) Duration.ofMinutes(n) else if (unit.startsWith("hora") || unit.startsWith("hs")) Duration.ofHours(n)
            else if (unit.startsWith("dia")) Duration.ofDays(n) else Duration.ofDays(7 * n)
        }
        w.dt = now.plus(d); w.hasTime = true; w.spans += m.span(); return w
    }
    var base: LocalDate? = null
    var defaultHour: Int? = null
    val dt = DATE_TEXT_RE.findM(norm)
    val dn = if (dt == null) DATE_NUM_RE.findM(norm) else null
    if (dt != null) {
        val year = dt.group(3)?.toInt() ?: now.year
        base = runCatching { LocalDate.of(year, MONTHS.getValue(dt.group(2)), dt.group(1).toInt()) }.getOrNull()
        if (base != null && dt.group(3) == null && base.isBefore(now.toLocalDate())) base = base.withYear(year + 1)
        if (base != null) w.spans += dt.span()
    } else if (dn != null && dn.group(2).toInt() <= 12) {
        var year = dn.group(3)?.toInt() ?: now.year
        if (year < 100) year += 2000
        base = runCatching { LocalDate.of(year, dn.group(2).toInt(), dn.group(1).toInt()) }.getOrNull()
        if (base != null && dn.group(3) == null && base.isBefore(now.toLocalDate())) base = base.withYear(year + 1)
        if (base != null) w.spans += dn.span()
    }
    if (base == null) WEEKDAY_RE.findM(norm)?.let { m ->
        val target = WEEKDAYS.getValue(m.group(1))
        val today = now.dayOfWeek.value - 1
        val ahead = Math.floorMod(target - today, 7).let { if (it == 0) 7 else it }
        base = now.toLocalDate().plusDays(ahead.toLong())
        w.spans += m.span()
    }
    if (base == null) DAY_RE.findM(norm)?.let { m ->
        val word = (m.group(1) ?: "manana").replace("  ", " ")
        when {
            word.startsWith("pasado") -> base = now.toLocalDate().plusDays(2)
            word == "manana" -> base = now.toLocalDate().plusDays(1)
            else -> {
                base = now.toLocalDate()
                defaultHour = when (word) { "esta noche" -> 21; "esta tarde" -> 16; "esta manana" -> 9; else -> null }
            }
        }
        w.spans += m.span()
    }
    if (base == null && defaultDay != null) base = defaultDay
    var hour: Int? = null
    var minute: Int? = null
    var explicit = false
    val tm = TIME_RE.findM(norm)
    if (tm != null) {
        val (h, mi, ex) = hourFrom(tm)
        if (h in 0..23 && mi in 0..59) { hour = h; minute = mi; explicit = ex; w.spans += tm.span() }
    } else NOON_RE.findM(norm)?.let { m ->
        hour = if (m.group(1) == "mediodia") 12 else 0; minute = 0; explicit = true; w.spans += m.span()
    }
    if (hour == null) PART_RE.findM(norm)?.let { m ->
        defaultHour = mapOf("manana" to 9, "tarde" to 16, "noche" to 21).getValue(m.group(1)); w.spans += m.span()
    }
    if (hour == null && defaultHour != null) {
        hour = defaultHour; minute = 0
        w.assumptions += "Tomé las %02d:00 como horario aproximado.".format(hour)
    }
    val b = base
    if (hour != null) {
        var h = hour!!
        val mi = minute ?: 0
        if (b == null) {
            var candidate = now.withHour(h).withMinute(mi).withSecond(0).withNano(0)
            if (preferPm && !explicit && h in 1..7) {
                candidate = candidate.withHour(h + 12)
                w.assumptions += "Entendí las %02d:%02d (de la tarde).".format(h + 12, mi)
            } else if (preferPm && !candidate.isAfter(now) && !explicit && h < 12 && candidate.withHour(h + 12).isAfter(now)) {
                candidate = candidate.withHour(h + 12)
                w.assumptions += "Entendí las %02d:%02d.".format(h + 12, mi)
            }
            if (!candidate.isAfter(now)) {
                candidate = candidate.plusDays(1)
                w.assumptions += "Como esa hora ya pasó hoy, lo puse para mañana."
            }
            w.dt = candidate
        } else {
            if (preferPm && !explicit && h in 1..7) {
                h += 12
                w.assumptions += "Entendí las %02d:%02d (de la tarde).".format(h, mi)
            }
            w.dt = ZonedDateTime.of(b, LocalTime.of(h, mi), now.zone)
        }
        w.hasTime = true
    } else if (b != null) {
        w.day = b
    }
    return w
}

fun removeSpans(text: String, spans: List<Pair<Int, Int>>): String {
    var out = text
    for ((s, e) in spans.sortedByDescending { it.first }) {
        if (s <= out.length && e <= out.length) out = out.substring(0, s) + " " + out.substring(e)
    }
    return out.replace(Regex("""\s{2,}"""), " ").trim(' ', ',', '.', ';', ':')
}

// ------------------------------------------------------------------ intents

val STYLE = mapOf(
    "conversation" to Triple("breve: 1 o 2 frases, natural y cálido", 500, "chat"),
    "information" to Triple("directa: primero la respuesta en 1-3 frases; ampliá solo si la pregunta lo exige", 1500, "general"),
    "research" to Triple("informe: hallazgos clave, fuentes citadas y conclusión. Separá hechos de hipótesis", 4000, "research"),
    "programming" to Triple("técnica y precisa; incluí código solo cuando aporte", 4000, "code"),
    "productivity" to Triple("concreta y lista para usar", 2500, "writing"),
    "organization" to Triple("ordenada en pasos o prioridades, sin relleno", 2000, "planning"),
    "automation" to Triple("breve: qué rutina proponés, cuándo se dispara y qué hace", 1200, "general"),
    "project_management" to Triple("breve: estado y próximos pasos", 1500, "general"),
    "memory_query" to Triple("breve, citando la procedencia de cada recuerdo", 1000, "simple"),
    "communication" to Triple("breve; nunca digas que un mensaje se envió si solo se preparó", 800, "writing"),
    "phone_control" to Triple("muy breve: qué acción preparaste", 400, "simple"),
)

private val TONES = mapOf("formal" to "formal", "informal" to "informal", "amistoso" to "amistoso", "amistosa" to "amistoso", "cordial" to "amistoso",
    "breve" to "breve", "corto" to "breve", "corta" to "breve", "profesional" to "profesional", "explicativo" to "explicativo",
    "explicativa" to "explicativo", "detallado" to "explicativo")
private val SETTINGS_WORDS = listOf(
    "wi fi" to "wifi", "wifi" to "wifi", "internet" to "wifi", "bluetooth" to "bluetooth", "pantalla" to "display",
    "brillo" to "display", "sonido" to "sound", "volumen" to "sound", "bateria" to "battery", "ubicacion" to "location",
    "gps" to "location", "aplicaciones" to "apps", "apps" to "apps", "notificaciones" to "notifications",
    "datos" to "data", "modo avion" to "airplane", "avion" to "airplane", "nfc" to "nfc", "accesibilidad" to "accessibility",
    "fecha" to "date", "hora" to "date", "idioma" to "language", "seguridad" to "security", "almacenamiento" to "storage",
)
private val SCREEN_WORDS = listOf("automatizaciones" to "automations", "rutinas" to "automations", "aprobaciones" to "approvals",
    "misiones" to "missions", "memoria" to "memory", "recuerdos" to "memory", "agentes" to "agents",
    "reuniones" to "meetings", "proyectos" to "projects", "configuracion de nexus" to "settings")
private val SPECIALISTS = mapOf("research" to "atlas", "programming" to "cipher", "creative" to "nova", "analysis" to "oracle", "security" to "guardian")

class Intent(
    val category: String,
    val confidence: Double,
    val rule: String,
    var actionKey: String? = null,
    var params: MutableMap<String, Any?> = mutableMapOf(),
    var summary: String? = null,
    val missing: List<String> = emptyList(),
    val question: String? = null,
    val control: String? = null,
    val needsModel: Boolean = false,
    val specialists: List<String> = emptyList(),
    val assumptions: MutableList<String> = mutableListOf(),
    val extra: MutableMap<String, Any?> = mutableMapOf(),
) {
    val style get() = STYLE[category] ?: STYLE.getValue("information")
    val handler: String get() = when {
        control != null -> "control"
        question != null -> "clarification"
        actionKey != null -> "action"
        extra.containsKey("memory_lookup") -> "memory_lookup"
        extra["memory_forget"] != null -> "memory_forget"
        else -> "model"
    }

    fun route(): JsonObject = JsonObject(mapOf(
        "task_type" to JsonPrimitive(style.third), "response_style" to JsonPrimitive(style.first), "max_tokens" to JsonPrimitive(style.second),
        "specialists" to JsonArray(specialists.map { JsonPrimitive(it) }), "handler" to JsonPrimitive(handler)))

    fun toJson(): JsonObject = JsonObject(mapOf(
        "category" to JsonPrimitive(category), "confidence" to JsonPrimitive(confidence), "rule" to JsonPrimitive(rule),
        "action_key" to (actionKey?.let { JsonPrimitive(it) } ?: JsonNull), "params" to toJsonElement(params),
        "summary" to (summary?.let { JsonPrimitive(it) } ?: JsonNull), "missing" to JsonArray(missing.map { JsonPrimitive(it) }),
        "question" to (question?.let { JsonPrimitive(it) } ?: JsonNull), "control" to (control?.let { JsonPrimitive(it) } ?: JsonNull),
        "needs_model" to JsonPrimitive(needsModel), "specialists" to JsonArray(specialists.map { JsonPrimitive(it) }),
        "assumptions" to JsonArray(assumptions.map { JsonPrimitive(it) }), "route" to route()))
}

/** Convierte valores Kotlin simples (Map, List, String, Number, Boolean) a JSON. */
fun toJsonElement(v: Any?): JsonElement = when (v) {
    null -> JsonNull
    is JsonElement -> v
    is String -> JsonPrimitive(v)
    is Number -> JsonPrimitive(v)
    is Boolean -> JsonPrimitive(v)
    is Map<*, *> -> JsonObject(v.entries.associate { (k, value) -> k.toString() to toJsonElement(value) })
    is Iterable<*> -> JsonArray(v.map { toJsonElement(it) })
    else -> JsonPrimitive(v.toString())
}

fun normalize(text: String): String = buildString(text.length) {
    for (ch in text) {
        val base = Normalizer.normalize(ch.toString(), Normalizer.Form.NFD)
        val c = base.firstOrNull() ?: ch
        append(c.lowercaseChar())
    }
}

private val WAKE_RE = Regex("""^\s*(?:(?:che|hey|oye|ey|hola)[\s,]+)?nexus[\s,:.!]*""", RegexOption.IGNORE_CASE)
private val FILLER_RE = rx("""^\s*(?:por\s+favor|porfa|dale|bueno|che)[\s,]+""")

fun stripWake(text: String): String {
    var out = WAKE_RE.replaceFirst(text, "")
    out = FILLER_RE.replaceFirst(out, "")
    out = Regex("""[\s,]*(?:por\s+favor|porfa)[.!]*\s*$""", RegexOption.IGNORE_CASE).replace(out, "")
    return out.trim().trimStart('¿', '¡').trim()
}

private fun cap(s: String): String { val t = s.trim(' ', ',', '.', ';', ':'); return if (t.isEmpty()) t else t.substring(0, 1).uppercase() + t.substring(1) }
private fun seg(original: String, m: java.util.regex.Matcher, group: String): String {
    val s = try { m.start(group) } catch (_: IllegalArgumentException) { -1 }
    return if (s >= 0) original.substring(s, m.end(group)) else ""
}

private fun tone(norm: String): Pair<String?, Pair<Int, Int>?> {
    val m = rx("""\s*\b(?:en\s+(?:un\s+)?tono|de\s+forma|de\s+manera|con\s+tono|en\s+plan|bien)\s+(${TONES.keys.joinToString("|")})\b""").findM(norm)
    return if (m != null) TONES[m.group(1)] to m.span() else null to null
}

private fun cleanRecipient(raw: String) =
    Regex("""^(?:a\s+)?(?:mi|mis|el|la|los|las)\s+""", RegexOption.IGNORE_CASE).replace(raw.trim(), "").trim(' ', ',', '.', ';', ':')

private val PHONE_IN_TEXT = rx("""(\+?\d[\d\s\-().]{6,}\d)""")

private val CONTROL_STOP = rx("""^(?:para|pare|stop|basta|callate|silencio|frena|espera|un\s+momento|un\s+segundo|alto|cortala)(?:\s+nexus)?[\s.!]*$""")
private val CONTROL_RESUME = rx("""^(?:segui|continua|dale\s+segui|segui\s+hablando|continua\s+por\s+favor|retoma)(?:\s+nexus)?[\s.!]*$""")
private val CONTROL_REPEAT = rx("""^(?:repeti(?:lo|me)?|repetilo|de\s+nuevo|otra\s+vez)(?:\s+nexus)?[\s.!?]*$""")

private const val WA_CHANNEL = """(?:whatsapp|whats\s*app|wsp|wpp|whats|mensaje|msj|mensajito|mensajes)"""
private const val WA_VERB = """(?:mand(?:a|ale|ales)|envi(?:a|ale|ales)|escrib(?:i|ile|ime)|pas(?:a|ale))"""
private val WA_1 = rx("""^$WA_VERB\s+(?:un\s+|una\s+)?$WA_CHANNEL(?:\s+(?:por|de)\s+(?:whatsapp|wsp|wpp))?\s+(?:a|para)\s+(?<rest>.+)$""")
private val WA_2 = rx("""^(?:mandale|enviale|escribile|pasale)\s+a\s+(?<recipient>.+?)\s+(?:un\s+)?$WA_CHANNEL\b(?:\s+(?:por\s+)?(?:whatsapp|wsp))?(?:\s*(?:que|diciendo(?:le)?|con\s+el\s+texto|:)\s*(?<body>.+))?$""")
private val WA_3 = rx("""^(?:decile|escribile|mandale|avisale|contale|preguntale)\s+(?:a\s+)?(?<recipient>.+?)(?:\s+por\s+(?:whatsapp|wsp|wpp))?\s+(?:que|si|diciendo(?:le)?|:)\s*(?<body>.+)$""")
private val WA_4 = rx("""^$WA_CHANNEL\s+(?:a|para)\s+(?<rest>.+)$""")
private val WA_SPLIT = rx("""^(?<recipient>.+?)(?:\s*[,:]\s*|\s+(?:diciendo(?:le)?(?:\s+que)?|que\s+diga|que\s+dice|con\s+el\s+texto|para\s+decirle|y\s+decile|y\s+decirle|que)\s+)(?<body>.+)$""")
private val CALL_RE = rx("""^(?:llam(?:a|ale|alo|ala)|llamame\s+a|marcale|marca)\s+(?:a\s+)?(?<recipient>.+?)(?:\s+por\s+telefono)?$""")

private val REMINDER_RE = rx(
    """^(?:recorda(?:me|rme)|recordame|recuerdame|acordame|haceme\s+acordar|avisame|""" +
        """(?:cre(?:a|ame)|pon(?:e|eme)|agend(?:a|ame)|program(?:a|ame)|arm(?:a|ame))\s+un\s+recordatorio|quiero\s+(?:crear\s+)?un\s+recordatorio|""" +
        """necesito\s+un\s+recordatorio|recordatorio)\b(?<rest>.*)$""")
private val REMEMBER_ME_TO_RE = rx("""^acordate\s+de\s+(?!que\b)(?<rest>.+)$""")
private val ALARM_RE = rx("""(?:^|\b)(?:(?:pon(?:e|eme)|program(?:a|ame)|cre(?:a|ame)|activ(?:a|ame)|arm(?:a|ame))\s+(?:una\s+)?alarma|despertame|alarma\s+(?:a|para)\s+las)\b""")
private val TIMER_RE = rx("""\b(?:pon(?:e|eme)|inici(?:a|ame)|arranc(?:a|ame)|program(?:a|ame)|activ(?:a|ame))\s+(?:un\s+)?(?:timer|temporizador|cronometro|cuenta\s+regresiva)\b|^(?:timer|temporizador)\s+(?:de|por)\b""")
private val EVENT_RE = rx("""^(?:agend(?:a|ame)|cre(?:a|ame)|prepar(?:a|ame)|anot(?:a|ame)|pon(?:e|eme)|arm(?:a|ame)|program(?:a|ame))\s+(?:un|una)\s+(?<kind>evento|reunion|cita|turno|cumpleanos|llamada)\b(?<rest>.*)$""")
private val AGENDA_RE = rx("""^(?:que\s+tengo|que\s+hay)(?:\s+(?:para|en|el))?\s*(?<rest>.*?)(?:\s+(?:en\s+(?:la|mi)\s+agenda|en\s+(?:el|mi)\s+calendario|agendado))?\s*\??$|^(?:consult(?:a|ame)|mostrame|abr(?:i|ime)|revis(?:a|ame)|ver)\s+(?:la\s+|mi\s+|el\s+)?(?:agenda|calendario)\b(?<rest2>.*)$""")
private val SETTINGS_RE = rx("""^(?:abr(?:i|ime|e|ir)|mostrame|and(?:a|e)\s+a|llevame\s+a|entr(?:a|e)\s+a|ir\s+a)\s+(?:la\s+|el\s+|los\s+|las\s+)?(?:configuracion|ajustes|opciones|preferencias)(?:\s+(?:de|del)\s+(?:la\s+|el\s+|los\s+)?(?<panel>.+))?$""")
private val TOGGLE_RE = rx("""^(?:prend(?:e|eme)|activ(?:a|ame)|encend(?:e|eme)|apag(?:a|ame)|desactiv(?:a|ame)|conect(?:a|ame))\s+(?:el\s+|la\s+)?(?<panel>wi\s?fi|bluetooth|gps|ubicacion|datos|modo\s+avion|nfc)\b""")
private val NAV_RE = rx("""\b(?:como\s+(?:llego|voy|hago\s+para\s+ir)|llevame|naveg(?:a|ar)|indicaciones|ruta|guiame)\s+(?:a|al|hasta|hacia|para\s+ir\s+a)\s+(?<dest>.+?)(?:\s+(?<mode>caminando|a\s+pie|en\s+auto|en\s+bici|en\s+colectivo|en\s+transporte\s+publico))?$""")
private val MAP_RE = rx("""^(?:busc(?:a|ame)|mostrame|ubic(?:a|ame))\s+(?<q>.+?)\s+en\s+(?:el\s+)?(?:mapa|maps|google\s+maps)$|^donde\s+queda\s+(?<q2>.+?)\??$""")
private val OPEN_URL_RE = rx("""^(?:abr(?:i|ime)|and(?:a|e)\s+a|entr(?:a|e)\s+a)\s+(?<url>https://\S+)$""")
private val OPEN_PROJECT_RE = rx("""^(?:abr(?:i|ime)|mostrame|and(?:a|e)\s+a|entr(?:a|e)\s+a|ir\s+a)\s+(?:el\s+)?proyecto\s+(?<name>.+)$""")
private val OPEN_SCREEN_RE = rx("""^(?:abr(?:i|ime)|mostrame|and(?:a|e)\s+a|ir\s+a|ver)\s+(?:la\s+|el\s+|las\s+|los\s+|mis\s+|mi\s+)?(?<what>automatizaciones|rutinas|aprobaciones(?:\s+pendientes)?|misiones|memoria|recuerdos|agentes|reuniones|proyectos)$""")
private val OPEN_APP_RE = rx("""^(?:abr(?:i|ime|e|ir|ilo)|lanz(?:a|ame)|inici(?:a|ame)|ejecut(?:a|ame)|pon(?:e|eme)|arranc(?:a|ame))\s+(?:la\s+app\s+(?:de\s+)?|la\s+aplicacion\s+(?:de\s+)?|el\s+|la\s+)?(?<app>[\w .+&-]{2,40}?)[\s.!]*$""")
private val CONTACT_CREATE_RE = rx("""^(?:agend(?:a|ame)|guard(?:a|ame)|cre(?:a|ame))\s+(?:el\s+|un\s+)?(?:numero|contacto|telefono)\s+(?<phone>[+\d][\d \-]{5,}\d)\s+(?:como|a\s+nombre\s+de|de)\s+(?<name>.+)$""")
private val SHARE_LAST_RE = rx("""^(?:compart(?:i|ir|ime)|mand(?:a|ame)|pasame)\s+(?:esto|eso|tu\s+(?:ultima\s+)?respuesta|la\s+(?:ultima\s+)?respuesta|lo\s+que\s+(?:dijiste|escribiste))\b""")
private val SHARE_FILE_RE = rx("""^compart(?:i|ir|ime)\s+(?:este|un|el|ese)\s+(?:documento|archivo|pdf|foto)\b""")
private val MEMORY_SAVE_RE = rx("""^(?:acordate|record(?:a|ar)|guard(?:a|ame)(?:\s+en\s+(?:la|tu)\s+memoria)?|anot(?:a|ate)|toma\s+nota(?:\s+de)?|tene\s+en\s+cuenta|no\s+te\s+olvides)\s+(?:de\s+)?que\s+(?<fact>.+)$""")
private val MEMORY_QUERY_RE = rx("""^(?:que\s+(?:sabes|recordas|te\s+acordas|tenes\s+guardado|guardaste|anotaste|recuerdos\s+tenes)|que\s+(?:informacion|datos)\s+(?:tenes|guardaste))(?:\s+(?:de|sobre|acerca\s+de))?\s*(?<topic>.*?)\??$""")
private val MEMORY_FORGET_RE = rx("""^(?:olvidate|borra(?:\s+de\s+(?:la|tu)\s+memoria)?|elimina\s+(?:el|los)\s+recuerdos?)\s+(?:de\s+)?(?:que\s+|lo\s+de\s+|sobre\s+)?(?<topic>.+)$""")
private val MISSION_RE = rx("""^(?:cre(?:a|ame)|arm(?:a|ame)|lanz(?:a|ame)|ejecut(?:a|ame)|inici(?:a|ame)|empez(?:a|ame)|nueva)\s+(?:una\s+)?mision\s*(?:para|de|que|sobre|:)?\s*(?<obj>.+)$""")
private val DEEP_RESEARCH_RE = rx("""\b(?:a\s+fondo|en\s+profundidad|informe\s+completo|investigacion\s+(?:profunda|completa)|analisis\s+completo|comparativa\s+completa)\b""")
private val SCHEDULE_AUTO_RE = rx("""^(?:todos\s+los|todas\s+las|cada)\s+(?<freq>dias|dia|mananas|noches|tardes|lunes|martes|miercoles|jueves|viernes|sabados|domingos|semana|semanas|hora|\d+\s+horas|mes)\b(?<rest>.*)$""")
private val EVENT_AUTO_RE = rx("""^(?:avisame|notificame|mandame\s+un\s+aviso|decime|alertame)\s+(?:siempre\s+)?(?:que|cuando|cada\s+vez\s+que)\s+(?<cond>.+)$""")
private val RESEARCH_RE = rx("""^(?:investig(?:a|ame)|averigu(?:a|ame)|busc(?:a|ame)\s+(?:info|informacion|datos|noticias|precios|opciones|alternativas)|fijate\s+(?:que\s+onda|si|como|cuanto|cual|donde|cuando|en\s+internet)|buscame\s+(?:una\s+)?soluci|hace(?:me)?\s+una\s+investigacion|research)""")
private val PROGRAMMING_RE = rx("""\b(?:codigo|programa(?:r|cion)|script|funcion|bug|debug|compil\w*|stack\s?trace|excepcion|python|kotlin|java(?:script)?|typescript|sql|regex|endpoint|refactor\w*|git|docker|gradle|android\s+studio|algoritmo)\b""")
private val CREATIVE_RE = rx("""^(?:escrib(?:i|ime)|redact(?:a|ame)|hace(?:me)?|arm(?:a|ame)|prepar(?:a|ame)|cre(?:a|ame))\s+(?:un|una|el|la)\s+(?:texto|post|carta|poema|mail|correo|email|discurso|slogan|eslogan|logo|guion|historia|cuento|nota|documento|informe|resumen|presentacion|propuesta|cv|curriculum)\b""")
private val ORGANIZE_RE = rx("""^(?:organiz(?:a|ame)|orden(?:a|ame)|planific(?:a|ame)|prioriz(?:a|ame)|arm(?:a|ame)\s+un\s+plan|hace(?:me)?\s+un\s+plan|dejalo\s+preparado|ayudame\s+a\s+organizar)""")
private val ANALYSIS_RE = rx("""^(?:analiz(?:a|ame)|revis(?:a|ame)|evalu(?:a|ame)|compar(?:a|ame)|audit(?:a|ame)|fijate\s+que\s+onda\s+con)""")
private val SECURITY_RE = rx("""\b(?:es\s+seguro|seguridad|vulnerab\w*|contrasena|phishing|estafa|hackeo|malware|virus)\b""")
private val GREETING_RE = rx("""^(?:hola|buenas|buen\s+dia|buenos\s+dias|buenas\s+tardes|buenas\s+noches|que\s+tal|como\s+(?:andas|estas|va)|gracias|muchas\s+gracias|genial|perfecto|joya|de\s+una|todo\s+bien|chau|hasta\s+luego)\b""")
private val QUESTION_RE = rx("""^(?:que|cual|cuales|cuando|donde|como|por\s+que|cuanto|cuanta|cuantos|quien|quienes|es\s+verdad|sabes)\b|\?$""")

private val SCHED_FREQ = mapOf("dias" to "*", "dia" to "*", "mananas" to "*", "noches" to "*", "tardes" to "*", "lunes" to "1", "martes" to "2",
    "miercoles" to "3", "jueves" to "4", "viernes" to "5", "sabados" to "6", "domingos" to "0")
private val EVENT_CONDITIONS = listOf(
    rx("""(?:termine|terminen|se\s+complete|se\s+completen|finalice|este\s+lista)\s+(?:una|la|cada|alguna)?\s*mision""") to "mission.completed",
    rx("""(?:falle|fallen|se\s+caiga)\s+(?:una|la|alguna)?\s*mision""") to "mission.failed",
    rx("""(?:se\s+bloquee|quede\s+bloqueada)\s+(?:una|la|alguna)?\s*mision|mision\s+(?:se\s+)?bloque""") to "mission.blocked",
    rx("""(?:haya|tenga|necesites|requiera)\s+(?:una\s+|mi\s+)?(?:aprobacion|confirmacion)|(?:aprobacion|confirmacion)\s+pendiente""") to "approval.requested",
)

class ClassifyContext(
    val now: ZonedDateTime,
    val timezone: String,
    val lastAssistantText: String? = null,
    val hasAttachments: Boolean = false,
    val pending: Map<String, Any?>? = null,
)

fun classify(text: String, ctx: ClassifyContext): Intent {
    val original = stripWake(text)
    val norm = normalize(original)
    val n = norm.trim()
    if (n.isEmpty()) return Intent("conversation", 1.0, "empty", control = "noop")
    if (CONTROL_STOP.lookingAt(n) != null) return Intent("conversation", 0.99, "control.stop", control = "stop")
    if (CONTROL_RESUME.lookingAt(n) != null) return Intent("conversation", 0.99, "control.resume", control = "resume")
    if (CONTROL_REPEAT.lookingAt(n) != null) return Intent("conversation", 0.95, "control.repeat", control = "repeat")
    if (ctx.pending != null) fillPending(original, norm, ctx)?.let { return it }
    val rules: List<(String, String, ClassifyContext) -> Intent?> = listOf(::video, ::whatsapp, ::call, ::alarm, ::timer, ::reminder, ::event, ::agenda,
        ::contactCreate, ::settings, ::navigation, ::map, ::openUrl, ::openProject, ::openScreen, ::share, ::memorySave, ::memoryQuery,
        ::memoryForget, ::mission, ::automation, ::openApp)
    for (r in rules) r(original, norm, ctx)?.let { return it }
    return modelIntent(norm, ctx)
}

private fun whatsapp(original0: String, norm0: String, ctx: ClassifyContext): Intent? {
    var original = original0
    var norm = norm0
    val (tone, toneSpan) = tone(norm)
    if (toneSpan != null) {
        original = (original.substring(0, toneSpan.first) + original.substring(toneSpan.second)).trim()
        norm = normalize(original)
    }
    var recipient: String? = null
    var body: String? = null
    val m1 = WA_1.lookingAt(norm) ?: WA_4.lookingAt(norm)
    if (m1 != null) {
        val restO = seg(original, m1, "rest")
        val s = WA_SPLIT.lookingAt(normalize(restO))
        if (s != null) { recipient = restO.substring(0, s.end("recipient")); body = restO.substring(s.start("body")) } else { recipient = restO; body = "" }
    } else {
        val m2 = WA_2.lookingAt(norm)
        if (m2 != null) {
            recipient = seg(original, m2, "recipient"); body = if (m2.g("body") != null) seg(original, m2, "body") else ""
        } else {
            val m3 = WA_3.lookingAt(norm)
            if (m3 != null) {
                recipient = seg(original, m3, "recipient"); body = seg(original, m3, "body")
                if (m3.group(0).split(" ").first() == "preguntale" && body.isNotEmpty() && !body.trimEnd().endsWith("?")) body = "¿" + body.trim() + "?"
            }
        }
    }
    if (recipient == null) return null
    val rec = cleanRecipient(recipient)
    if (rec.isEmpty()) return null
    val params = mutableMapOf<String, Any?>("text" to cap(body ?: ""))
    if (tone != null) params["tone"] = tone
    val pm = PHONE_IN_TEXT.findM(rec)
    if (pm != null && pm.group(1).replace(Regex("""\D"""), "").length >= 8) {
        params["phone"] = pm.group(1).replace(Regex("""[^\d+]"""), "")
        val label = rec.replace(pm.group(1), "").trim()
        if (label.isNotEmpty()) params["contact_label"] = label
    } else params["recipient_query"] = rec
    val who = (params["contact_label"] ?: params["recipient_query"] ?: "el número indicado") as String
    val txt = params["text"] as String
    val summary = "WhatsApp para $who" + if (txt.isNotEmpty()) ": «${txt.take(80)}»" else " (sin texto todavía)"
    return Intent("communication", 0.93, "whatsapp", actionKey = "whatsapp.open_chat", params = params, summary = summary)
}

private val VIDEO_RE = rx("""^(?:hace(?:me)?|cre(?:a|ame)|arm(?:a|ame)|anim(?:a|ame)|gener(?:a|ame)|prepar(?:a|ame)|quiero)\s+(?:un\s+|una\s+)?(?:video|animacion|reel|historia animada)\b(?<rest>.*)$""")

/** «Hacé un video de…»: NEXUS escribe el guion de escenas y la app lo dibuja y exporta a MP4. */
private fun video(original: String, norm: String, ctx: ClassifyContext): Intent? {
    val m = VIDEO_RE.lookingAt(norm) ?: return null
    val topic = seg(original, m, "rest").trim(' ', '.', ':').replace(Regex("""^(?:de|sobre|para|que\s+diga|con)\s+""", RegexOption.IGNORE_CASE), "")
    if (topic.length < 3) return Intent("productivity", 0.85, "video", question = "¿Sobre qué querés el video? Contame el tema y el mensaje.", missing = listOf("topic"),
        extra = mutableMapOf("pending" to mapOf("kind" to "video")))
    return Intent("productivity", 0.9, "video", params = mutableMapOf("topic" to cap(topic)), summary = "Video: ${topic.take(80)}", specialists = listOf("nova"))
}

private fun call(original: String, norm: String, ctx: ClassifyContext): Intent? {
    val m = CALL_RE.lookingAt(norm) ?: return null
    val recipient = cleanRecipient(seg(original, m, "recipient"))
    if (recipient.isEmpty() || normalize(recipient) in setOf("me", "luego", "despues")) return null
    val digits = recipient.replace(Regex("""[^\d+]"""), "")
    val params = if (digits.replace(Regex("""\D"""), "").length >= 6) mutableMapOf<String, Any?>("phone" to digits) else mutableMapOf<String, Any?>("recipient_query" to recipient)
    return Intent("communication", 0.9, "call", actionKey = "device.dial", params = params, summary = "Llamar a $recipient")
}

private fun alarm(original: String, norm: String, ctx: ClassifyContext): Intent? {
    if (ALARM_RE.findM(norm) == null) return null
    val w = parseWhen(norm, ctx.now, preferPm = false)
    val dt = w.dt ?: return Intent("productivity", 0.9, "alarm", question = "¿Para qué hora pongo la alarma?", missing = listOf("time"),
        extra = mutableMapOf("pending" to mapOf("kind" to "alarm")))
    val labelM = rx("""\b(?:para|que\s+diga)\s+(?!las\b)(?<label>[a-z].{2,60})$""").findM(removeSpans(norm, w.spans))
    val params = mutableMapOf<String, Any?>("hour" to dt.hour, "minute" to dt.minute)
    if (labelM != null) params["label"] = cap(labelM.group("label"))
    val dayNote = if (dt.toLocalDate() == ctx.now.toLocalDate()) "" else if (dt.toLocalDate() == ctx.now.toLocalDate().plusDays(1)) " (mañana)" else ""
    return Intent("productivity", 0.93, "alarm", actionKey = "device.set_alarm", params = params,
        summary = "Alarma a las ${dt.format(HM)}$dayNote", assumptions = w.assumptions)
}

private fun timer(original: String, norm: String, ctx: ClassifyContext): Intent? {
    if (TIMER_RE.findM(norm) == null) return null
    val (secs, _) = parseDurationSeconds(norm)
    if (secs == null || secs == 0) return Intent("productivity", 0.9, "timer", question = "¿De cuánto tiempo querés el temporizador?",
        missing = listOf("duration"), extra = mutableMapOf("pending" to mapOf("kind" to "timer")))
    val mins = secs / 60; val s = secs % 60
    val label = if (mins > 0) "$mins min" + (if (s > 0) " $s s" else "") else "$s s"
    return Intent("productivity", 0.94, "timer", actionKey = "device.set_timer", params = mutableMapOf("seconds" to secs), summary = "Temporizador de $label")
}

private fun trimPreps(s: String) = Regex("""(?:\s+|^)(?:para|de|del|el|la|a|en|que|por)$""", RegexOption.IGNORE_CASE).replace(s.trim(), "").trim()

fun humanDt(dt: ZonedDateTime, now: ZonedDateTime): String {
    val days = java.time.temporal.ChronoUnit.DAYS.between(now.toLocalDate(), dt.toLocalDate())
    val day = when (days) { 0L -> "hoy"; 1L -> "mañana"; 2L -> "pasado mañana"; else -> "el " + dt.format(DMY) }
    return "$day a las ${dt.format(HM)}"
}

private fun reminderFrom(restO: String, ctx: ClassifyContext, rule: String): Intent {
    val w = parseWhen(normalize(restO), ctx.now)
    var title = removeSpans(restO, w.spans)
    title = Regex("""^(?:que\s+(?:tengo\s+que\s+)?|de\s+(?:que\s+)?|para\s+|a\s+|el\s+recordatorio\s+(?:de\s+)?|un\s+recordatorio\s+(?:de\s+|para\s+)?)""",
        RegexOption.IGNORE_CASE).replaceFirst(title, "")
    title = cap(trimPreps(title))
    val dt = w.dt
    if (dt == null) {
        val pending = mapOf("kind" to "reminder", "title" to title, "day" to w.day?.toString())
        var q = if (w.day != null) "¿A qué hora te lo recuerdo?" else "¿Cuándo te lo recuerdo?"
        if (title.isEmpty()) q = "¿Qué querés que te recuerde y cuándo?"
        return Intent("productivity", 0.9, rule, question = q, missing = listOf("time") + if (title.isEmpty()) listOf("title") else emptyList(),
            extra = mutableMapOf("pending" to pending))
    }
    if (title.isEmpty()) return Intent("productivity", 0.9, rule, question = "¿Qué querés que te recuerde?", missing = listOf("title"),
        extra = mutableMapOf("pending" to mapOf("kind" to "reminder_title", "at" to dt.iso())))
    return Intent("productivity", 0.94, rule, actionKey = "reminder.create", params = mutableMapOf("title" to title.take(200), "at" to dt.iso()),
        summary = "Recordatorio: «${title.take(80)}» ${humanDt(dt, ctx.now)}", assumptions = w.assumptions)
}

private fun reminder(original: String, norm: String, ctx: ClassifyContext): Intent? {
    REMEMBER_ME_TO_RE.lookingAt(norm)?.let { m ->
        val restO = seg(original, m, "rest")
        return if (parseWhen(normalize(restO), ctx.now).found) reminderFrom(restO, ctx, "reminder.acordate_de") else null
    }
    val m = REMINDER_RE.lookingAt(norm) ?: return null
    if (rx("""^avisame\s+(?:siempre\s+)?(?:cuando|cada\s+vez\s+que)\b""").lookingAt(norm) != null) return null
    return reminderFrom(seg(original, m, "rest"), ctx, "reminder")
}

private fun event(original: String, norm: String, ctx: ClassifyContext): Intent? {
    val m = EVENT_RE.lookingAt(norm) ?: return null
    val kind = mapOf("reunion" to "Reunión", "cumpleanos" to "Cumpleaños")[m.group("kind")] ?: cap(seg(original, m, "kind"))
    val restO = seg(original, m, "rest")
    val w = parseWhen(normalize(restO), ctx.now)
    var detail = removeSpans(restO, w.spans)
    detail = trimPreps(Regex("""^(?:para|de|sobre|el|la)(?:\s+|$)""", RegexOption.IGNORE_CASE).replaceFirst(detail.trim(), ""))
    val title = (kind + if (detail.isNotEmpty()) " $detail" else "").trim()
    val params: MutableMap<String, Any?>
    val summary: String
    val dt = w.dt
    val day = w.day
    if (dt != null) {
        params = mutableMapOf("title" to title.take(200), "start" to dt.iso(), "end" to dt.plusHours(1).iso())
        summary = "Evento «${title.take(80)}» ${humanDt(dt, ctx.now)}"
    } else if (day != null) {
        params = mutableMapOf("title" to title.take(200), "start" to ZonedDateTime.of(day, LocalTime.MIDNIGHT, ctx.now.zone).iso(), "all_day" to true)
        summary = "Evento «${title.take(80)}» el ${day.format(DM)} (todo el día)"
    } else return Intent("organization", 0.88, "event", question = "¿Para cuándo preparo «$title»?", missing = listOf("date"),
        extra = mutableMapOf("pending" to mapOf("kind" to "event", "title" to title)))
    return Intent("organization", 0.92, "event", actionKey = "device.calendar_event", params = params, summary = summary, assumptions = w.assumptions)
}

private fun agenda(original: String, norm: String, ctx: ClassifyContext): Intent? {
    val m = AGENDA_RE.lookingAt(norm) ?: return null
    val rest = (m.g("rest")?.takeIf { it.isNotEmpty() } ?: m.g("rest2") ?: "").trim()
    if (m.g("rest") != null && rx("""\b(?:hoy|manana|pasado|lunes|martes|miercoles|jueves|viernes|sabado|domingo|semana|agenda|calendario|\d)""").findM(norm) == null) return null
    val w = parseWhen(rest, ctx.now)
    val day = w.dt?.toLocalDate() ?: w.day ?: ctx.now.toLocalDate()
    return Intent("organization", 0.88, "agenda", actionKey = "device.calendar_view", params = mutableMapOf("date" to day.toString()),
        summary = "Abrir el calendario en ${day.format(DM)}", extra = mutableMapOf("note" to "NEXUS abre tu calendario en esa fecha; no lee tus eventos."))
}

private fun contactCreate(original: String, norm: String, ctx: ClassifyContext): Intent? {
    val m = CONTACT_CREATE_RE.lookingAt(norm) ?: return null
    val phone = seg(original, m, "phone").replace(Regex("""[^\d+]"""), "")
    val name = cap(seg(original, m, "name"))
    return Intent("organization", 0.92, "contact_create", actionKey = "device.contact_create", params = mutableMapOf("name" to name, "phone" to phone),
        summary = "Crear el contacto $name")
}

private fun settings(original: String, norm: String, ctx: ClassifyContext): Intent? {
    val toggled = TOGGLE_RE.lookingAt(norm)
    val m = SETTINGS_RE.lookingAt(norm)
    if (m == null && toggled == null) return null
    val target = (if (toggled != null) toggled.g("panel") else m?.g("panel")) ?: ""
    var panel = "general"
    for ((word, key) in SETTINGS_WORDS) if (target.replace("-", " ").contains(word)) { panel = key; break }
    val extra = if (toggled != null) mutableMapOf<String, Any?>("note" to "Android no permite que una app cambie ese ajuste sola: te abro la pantalla para que lo hagas vos.") else mutableMapOf()
    return Intent("phone_control", 0.93, "settings", actionKey = "device.open_settings", params = mutableMapOf("panel" to panel),
        summary = "Abrir la configuración" + if (panel == "general") "" else " de ${target.trim()}", extra = extra)
}

private fun navigation(original: String, norm: String, ctx: ClassifyContext): Intent? {
    val m = NAV_RE.findM(norm) ?: return null
    val dest = seg(original, m, "dest").trim(' ', '?', '.', '!')
    val mw = m.g("mode") ?: ""
    val mode = if ("pie" in mw || "caminando" in mw) "walking" else if ("bici" in mw) "bicycling" else if ("colectivo" in mw || "transporte" in mw) "transit" else "driving"
    return Intent("phone_control", 0.92, "navigate", actionKey = "device.navigate", params = mutableMapOf("destination" to dest, "mode" to mode),
        summary = "Ruta hacia $dest")
}

private fun map(original: String, norm: String, ctx: ClassifyContext): Intent? {
    val m = MAP_RE.lookingAt(norm) ?: return null
    val q = (if (m.g("q") != null) seg(original, m, "q") else seg(original, m, "q2")).trim(' ', '?')
    return Intent("phone_control", 0.9, "map_search", actionKey = "device.map_search", params = mutableMapOf("query" to q), summary = "Buscar «$q» en el mapa")
}

private fun openUrl(original: String, norm: String, ctx: ClassifyContext): Intent? {
    val m = OPEN_URL_RE.lookingAt(norm) ?: return null
    val url = seg(original, m, "url")
    return Intent("information", 0.95, "open_url", actionKey = "device.open_url", params = mutableMapOf("url" to url), summary = "Abrir ${url.take(80)}")
}

private fun openProject(original: String, norm: String, ctx: ClassifyContext): Intent? {
    val m = OPEN_PROJECT_RE.lookingAt(norm) ?: return null
    val name = seg(original, m, "name").trim(' ', '.', '!')
    return Intent("project_management", 0.9, "open_project", actionKey = "app.open_screen", params = mutableMapOf("screen" to "project", "label" to name),
        summary = "Abrir el proyecto $name", extra = mutableMapOf("resolve_project" to name))
}

private fun openScreen(original: String, norm: String, ctx: ClassifyContext): Intent? {
    val m = OPEN_SCREEN_RE.lookingAt(norm) ?: return null
    val what = m.group("what")
    val screen = SCREEN_WORDS.first { what.startsWith(it.first) }.second
    return Intent("project_management", 0.9, "open_screen", actionKey = "app.open_screen", params = mutableMapOf("screen" to screen), summary = "Abrir $what")
}

private fun share(original: String, norm: String, ctx: ClassifyContext): Intent? {
    if (SHARE_FILE_RE.lookingAt(norm) != null) return Intent("communication", 0.9, "share_file", actionKey = "device.share_file", summary = "Compartir un documento")
    if (SHARE_LAST_RE.lookingAt(norm) != null) {
        val last = ctx.lastAssistantText ?: return Intent("communication", 0.85, "share_last",
            question = "No tengo una respuesta anterior para compartir. ¿Qué texto querés compartir?")
        return Intent("communication", 0.9, "share_last", actionKey = "device.share_text", params = mutableMapOf("text" to last.take(8000)),
            summary = "Compartir mi última respuesta")
    }
    return null
}

private fun openApp(original: String, norm: String, ctx: ClassifyContext): Intent? {
    val m = OPEN_APP_RE.lookingAt(norm) ?: return null
    val app = seg(original, m, "app").trim(' ', '.', '!')
    val appN = normalize(app)
    if (app.length < 2 || rx("""^(?:un|una|el|la)\s""").lookingAt(appN) != null || appN in setOf("eso", "esto", "algo", "musica de fondo")) return null
    return Intent("phone_control", 0.88, "open_app", actionKey = "device.open_app", params = mutableMapOf("app" to app), summary = "Abrir $app")
}

fun memoryCategory(n: String): String = when {
    rx("""\b(?:prefiero|me gusta|no me gusta|odio|favorit[oa])\b""").findM(n) != null -> "preferences"
    rx("""\b(?:trabajo|oficina|jefe|cliente|empresa|reunion)\b""").findM(n) != null -> "work"
    rx("""\b(?:medico|alergi\w*|medicamento|salud|turno medico)\b""").findM(n) != null -> "health"
    rx("""\b(?:proyecto)\b""").findM(n) != null -> "projects"
    else -> "personal"
}

private fun memorySave(original: String, norm: String, ctx: ClassifyContext): Intent? {
    val m = MEMORY_SAVE_RE.lookingAt(norm) ?: return null
    val fact = cap(seg(original, m, "fact"))
    if (fact.length < 3) return null
    return Intent("memory_query", 0.93, "memory.save", actionKey = "memory.remember",
        params = mutableMapOf("content" to fact, "category" to memoryCategory(normalize(fact))), summary = "Recordar: «${fact.take(100)}»")
}

private fun memoryQuery(original: String, norm: String, ctx: ClassifyContext): Intent? {
    val m = MEMORY_QUERY_RE.lookingAt(norm) ?: return null
    var topic = if (m.g("topic") != null) seg(original, m, "topic").trim(' ', '?') else ""
    if (normalize(topic) in setOf("", "mi", "mi?", "de mi")) topic = ""
    return Intent("memory_query", 0.9, "memory.query", extra = mutableMapOf("memory_lookup" to topic))
}

private fun memoryForget(original: String, norm: String, ctx: ClassifyContext): Intent? {
    val m = MEMORY_FORGET_RE.lookingAt(norm) ?: return null
    val topic = seg(original, m, "topic").trim(' ', '.')
    if (topic.length < 3) return null
    return Intent("memory_query", 0.88, "memory.forget", extra = mutableMapOf("memory_forget" to topic))
}

private fun mission(original: String, norm: String, ctx: ClassifyContext): Intent? {
    val m = MISSION_RE.lookingAt(norm)
    val deep = if (m == null && RESEARCH_RE.lookingAt(norm) != null && DEEP_RESEARCH_RE.findM(norm) != null) original else null
    if (m == null && deep == null) return null
    val objective = if (m != null) cap(seg(original, m, "obj")) else cap(deep ?: "")
    if (objective.length < 5) return Intent("project_management", 0.85, "mission", question = "¿Cuál es el objetivo de la misión?",
        missing = listOf("objective"), extra = mutableMapOf("pending" to mapOf("kind" to "mission")))
    return Intent("project_management", 0.9, if (m != null) "mission" else "research.deep", actionKey = "mission.create",
        params = mutableMapOf("objective" to objective, "title" to objective.take(80)), summary = "Misión: ${objective.take(120)}",
        specialists = if (deep != null) listOf("atlas") else emptyList())
}

private fun automation(original: String, norm: String, ctx: ClassifyContext): Intent? {
    EVENT_AUTO_RE.lookingAt(norm)?.let { m ->
        val cond = m.group("cond")
        for ((pattern, eventType) in EVENT_CONDITIONS) {
            if (pattern.findM(cond) != null) {
                val label = seg(original, m, "cond").trim(' ', '.')
                val params = mutableMapOf<String, Any?>("name" to "Aviso cuando ${label.take(150)}", "trigger_type" to "event", "event_type" to eventType,
                    "actions" to listOf(mapOf("type" to "notify", "title" to "Aviso: ${label.take(150)}", "body" to "Se cumplió la condición de tu rutina.")),
                    "max_runs_per_day" to 20)
                return Intent("automation", 0.9, "automation.event", actionKey = "automation.create", params = params,
                    summary = "Rutina: avisarte cuando ${cond.take(100)}")
            }
        }
        return Intent("automation", 0.6, "automation.event_unmapped", needsModel = true)
    }
    val m = SCHEDULE_AUTO_RE.lookingAt(norm) ?: return null
    val freq = m.group("freq")
    val restO = seg(original, m, "rest")
    val w = parseWhen(normalize(restO), ctx.now.withHour(0).withMinute(0).withSecond(0).withNano(0))
    var body = removeSpans(restO, w.spans)
    body = Regex("""^(?:a\s+la\s+|por\s+la\s+|que\s+|,\s*)""", RegexOption.IGNORE_CASE).replaceFirst(body.trim(), "")
    var hour: Int? = if (w.dt != null && w.hasTime) w.dt!!.hour else null
    var minute: Int? = if (w.dt != null && w.hasTime) w.dt!!.minute else null
    if (freq in setOf("mananas", "noches", "tardes") && hour == null) { hour = mapOf("mananas" to 9, "tardes" to 16, "noches" to 21).getValue(freq); minute = 0 }
    val cron: String
    val whenLabel: String
    if (freq == "hora" || rx("""\d+\s+horas""").lookingAt(freq) != null) {
        val every = if (freq[0].isDigit()) freq.split(" ")[0].toInt() else 1
        cron = if (every == 1) "0 * * * *" else "0 */$every * * *"
        whenLabel = if (every == 1) "cada hora" else "cada $every horas"
    } else {
        if (hour == null) return Intent("automation", 0.85, "automation.schedule", question = "¿A qué hora querés que se ejecute la rutina?",
            missing = listOf("time"), extra = mutableMapOf("pending" to mapOf("kind" to "automation_time", "freq" to freq, "body" to body)))
        val mi = minute ?: 0
        var dow: String? = null
        if (freq == "semana" || freq == "semanas") { dow = (ctx.now.dayOfWeek.value % 7).toString(); cron = "$mi $hour * * $dow" }
        else if (freq == "mes") cron = "$mi $hour ${ctx.now.dayOfMonth} * *"
        else { dow = SCHED_FREQ[freq] ?: "*"; cron = "$mi $hour * * $dow" }
        whenLabel = (if (dow == "*") "todos los días" else "cada $freq") + " a las %02d:%02d".format(hour, mi)
    }
    if (body.length < 3) return Intent("automation", 0.8, "automation.schedule", question = "¿Qué querés que haga NEXUS en esa rutina?", missing = listOf("action"))
    val rm = rx("""^(?:recordame|recorda(?:me|rme)|avisame|acordame\s+de|acordame)\s+(?:que\s+|de\s+)?(?<what>.+)$""").lookingAt(normalize(body))
    val actions = if (rm != null) {
        val what = cap(body.substring(rm.start("what")))
        listOf(mapOf("type" to "notify", "title" to what.take(200), "body" to "Recordatorio de tu rutina."))
    } else {
        val social = rx("""\b(whatsapp|wsp|wpp|grupo|comunidad|instagram|insta)\b""").findM(normalize(body))
        if (social != null) {
            val n = normalize(body)
            val target = if (n.contains("instagram") || n.contains("insta")) "instagram" else if (n.contains("whatsapp") || n.contains("wsp") || n.contains("wpp") || n.contains("grupo") || n.contains("comunidad")) "whatsapp" else "any"
            listOf(mapOf("type" to "draft_share", "prompt" to cap(body), "target" to target))
        } else listOf(mapOf("type" to "jarvis_prompt", "prompt" to cap(body)))
    }
    val params = mutableMapOf<String, Any?>("name" to cap(body).take(200), "trigger_type" to "schedule", "cron" to cron, "timezone" to ctx.timezone, "actions" to actions)
    return Intent("automation", 0.88, "automation.schedule", actionKey = "automation.create", params = params,
        summary = "Rutina $whenLabel: ${cap(body).take(100)}", assumptions = w.assumptions)
}

private fun fillPending(original: String, norm: String, ctx: ClassifyContext): Intent? {
    val p = ctx.pending ?: return null
    val kind = p["kind"] as? String
    if (rx("""^(?:no|nada|cancela|cancelar|olvidalo|deja|dejalo)\b""").lookingAt(norm.trim()) != null)
        return Intent("conversation", 0.95, "pending.cancel", control = "cancel_pending")
    if (kind in setOf("reminder", "event", "alarm", "automation_time")) {
        val defaultDay = (p["day"] as? String)?.let { runCatching { LocalDate.parse(it.take(10)) }.getOrNull() }
        val preferPm = kind != "alarm"
        var w = parseWhen(norm, ctx.now, preferPm, defaultDay)
        if (w.dt == null) rx("""^\s*(\d{1,2})(?::(\d{2}))?\s*(?:hs|h)?\s*$""").lookingAt(norm)?.let { m ->
            w = parseWhen("a las ${m.group(1)}" + (m.group(2)?.let { ":$it" } ?: ""), ctx.now, preferPm, defaultDay)
        }
        val dt = w.dt
        when (kind) {
            "reminder" -> {
                val title = (p["title"] as? String).orEmpty()
                if (dt == null || title.isEmpty()) return null
                return Intent("productivity", 0.9, "reminder.filled", actionKey = "reminder.create", params = mutableMapOf("title" to title, "at" to dt.iso()),
                    summary = "Recordatorio: «${title.take(80)}» ${humanDt(dt, ctx.now)}", assumptions = w.assumptions)
            }
            "alarm" -> if (dt != null) return Intent("productivity", 0.9, "alarm.filled", actionKey = "device.set_alarm",
                params = mutableMapOf("hour" to dt.hour, "minute" to dt.minute), summary = "Alarma a las ${dt.format(HM)}", assumptions = w.assumptions)
            "event" -> if (dt != null || w.day != null) {
                val title = (p["title"] as? String) ?: "Evento"
                val params: MutableMap<String, Any?> = if (dt != null) mutableMapOf("title" to title, "start" to dt.iso(), "end" to dt.plusHours(1).iso())
                else mutableMapOf("title" to title, "start" to ZonedDateTime.of(w.day, LocalTime.MIDNIGHT, ctx.now.zone).iso(), "all_day" to true)
                return Intent("organization", 0.9, "event.filled", actionKey = "device.calendar_event", params = params, summary = "Evento «$title»")
            }
            "automation_time" -> if (dt != null) return classify("todos los ${p["freq"] ?: "dias"} a las ${dt.format(HM)} ${p["body"] ?: ""}",
                ClassifyContext(ctx.now, ctx.timezone))
        }
        return null
    }
    if (kind == "reminder_title" && original.trim().length >= 3) {
        val title = cap(original)
        val at = ZonedDateTime.parse(p["at"] as String).withZoneSameInstant(ctx.now.zone)
        return Intent("productivity", 0.9, "reminder.filled", actionKey = "reminder.create", params = mutableMapOf("title" to title, "at" to p["at"]),
            summary = "Recordatorio: «${title.take(80)}» ${humanDt(at, ctx.now)}")
    }
    if (kind == "timer") {
        val (secs, _) = parseDurationSeconds(norm)
        if (secs != null && secs > 0) return Intent("productivity", 0.9, "timer.filled", actionKey = "device.set_timer", params = mutableMapOf("seconds" to secs),
            summary = if (secs >= 60) "Temporizador de ${secs / 60} min" else "Temporizador de $secs s")
    }
    if (kind == "video" && original.trim().length >= 3)
        return Intent("productivity", 0.9, "video", params = mutableMapOf("topic" to cap(original)), summary = "Video: ${original.trim().take(80)}", specialists = listOf("nova"))
    if (kind == "mission" && original.trim().length >= 5) {
        val objective = cap(original)
        return Intent("project_management", 0.9, "mission.filled", actionKey = "mission.create",
            params = mutableMapOf("objective" to objective, "title" to objective.take(80)), summary = "Misión: ${objective.take(120)}")
    }
    return null
}

private fun modelIntent(norm: String, ctx: ClassifyContext): Intent {
    val specialists = mutableListOf<String>()
    val category: String
    val conf: Double
    when {
        RESEARCH_RE.lookingAt(norm) != null -> { category = "research"; conf = 0.8; specialists += SPECIALISTS.getValue("research")
            if (PROGRAMMING_RE.findM(norm) != null) specialists += SPECIALISTS.getValue("programming") }
        PROGRAMMING_RE.findM(norm) != null -> { category = "programming"; conf = 0.75; specialists += SPECIALISTS.getValue("programming") }
        CREATIVE_RE.lookingAt(norm) != null -> { category = "productivity"; conf = 0.75; specialists += SPECIALISTS.getValue("creative") }
        ORGANIZE_RE.lookingAt(norm) != null -> { category = "organization"; conf = 0.75 }
        ANALYSIS_RE.lookingAt(norm) != null || (ctx.hasAttachments && rx("""\b(?:archivo|documento|esto|este)\b""").findM(norm) != null) -> {
            category = if (ctx.hasAttachments) "project_management" else "information"; conf = 0.7; specialists += SPECIALISTS.getValue("analysis") }
        rx("""\b(?:automatiz\w*|rutina)\b""").findM(norm) != null -> { category = "automation"; conf = 0.7 }
        rx("""\b(?:mision(?:es)?|proyecto(?:s)?|tarea(?:s)?\s+pendiente)""").findM(norm) != null -> { category = "project_management"; conf = 0.65 }
        GREETING_RE.lookingAt(norm) != null && norm.split(Regex("""\s+""")).size <= 6 -> { category = "conversation"; conf = 0.85 }
        QUESTION_RE.findM(norm.trim()) != null -> { category = "information"; conf = 0.65 }
        else -> { category = "conversation"; conf = 0.5 }
    }
    if (SECURITY_RE.findM(norm) != null && SPECIALISTS.getValue("security") !in specialists) specialists += SPECIALISTS.getValue("security")
    return Intent(category, conf, "model.$category", needsModel = true, specialists = specialists)
}
