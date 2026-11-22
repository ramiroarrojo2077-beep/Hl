package ai.nexus.app.local

import ai.nexus.app.core.network.NexusJson
import ai.nexus.app.data.model.*
import ai.nexus.app.whatsapp.PhoneNormalizer
import kotlinx.coroutines.launch
import kotlinx.coroutines.isActive
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import java.time.Instant
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

/* JARVIS CORE, Action Registry, WhatsApp y voz en modo local (port de backend/app/jarvis y app/actions). */

private val ALWAYS_CONFIRM = setOf("EXTERNAL_COMMUNICATION", "SENSITIVE", "IRREVERSIBLE")
private val FORCE_CONFIRM = setOf("mission.create", "automation.create")
private val SUCCESS_STATES = setOf("WHATSAPP_OPENED", "DIALER_OPENED", "SHARE_SHEET_OPENED", "APP_OPENED", "SETTINGS_OPENED", "MAPS_OPENED", "ALARM_SET",
    "TIMER_SET", "CALENDAR_OPENED", "CONTACTS_OPENED", "BROWSER_OPENED", "SCREEN_OPENED", "WHATSAPP_REPLY_HANDED")
private val PROGRESS_STATES = setOf("DRAFT_CREATED", "CONTACT_RESOLVED", "AWAITING_CONFIRMATION", "READY_TO_OPEN")
private val RESULT_KEYS = setOf("recipient_masked", "contact_label", "app_label", "package", "error", "text_chars", "edited", "tone", "panel", "destination")
private const val CONFIRMATION_TTL_MIN = 30L
private const val READY_TTL_MIN = 10L
private const val PENDING_TTL_MIN = 15L
private val HM = DateTimeFormatter.ofPattern("HH:mm")
private val DM = DateTimeFormatter.ofPattern("dd/MM")

internal class ActionDef(val o: JsonObject) {
    val key get() = o.str("key")!!
    val name get() = o.str("name")!!
    val category get() = o.str("category")!!
    val risk get() = o.str("risk")!!
    val operation get() = o.str("operation")
    val executor get() = o.str("executor")!!
    val params get() = o["params"]!!.jsonObject
    val required get() = o["required"]!!.jsonArray.map { it.jsonPrimitive.content }
    val resultStates get() = o["result_states"]!!.jsonArray.map { it.jsonPrimitive.content }
    fun needsConfirmation(confirmLocal: Boolean) = risk in ALWAYS_CONFIRM || (risk == "LOCAL_REVERSIBLE" && confirmLocal) || key in FORCE_CONFIRM
}

internal fun LocalBackend.actionDefs(): Map<String, ActionDef> = seed["actions"]!!.jsonArray.associate { it.jsonObject.str("key")!! to ActionDef(it.jsonObject) }

private fun isoWithZone(v: JsonElement?): Boolean = (v as? JsonPrimitive)?.contentOrNull?.let { runCatching { ZonedDateTime.parse(it.replace("Z", "+00:00")) }.isSuccess } ?: false

internal fun validateParams(d: ActionDef, params: JsonObject): String? {
    for (req in d.required) {
        val v = params[req]
        if (v == null || v is JsonNull || (v as? JsonPrimitive)?.contentOrNull == "" || (v as? JsonArray)?.isEmpty() == true) return "Falta el parámetro «$req»"
    }
    for ((name, value) in params) {
        val spec = d.params[name]?.jsonObject ?: return "Parámetro desconocido «$name»"
        if (value is JsonNull) continue
        val ok = when (spec.str("type")) {
            "string" -> value is JsonPrimitive && value.isString
            "integer" -> value is JsonPrimitive && !value.isString && value.longOrNull != null && value.booleanOrNull == null
            "boolean" -> value is JsonPrimitive && value.booleanOrNull != null
            "array" -> value is JsonArray
            "object" -> value is JsonObject
            else -> true
        }
        if (!ok) return "El parámetro «$name» debe ser ${spec.str("type")}"
        spec["enum"]?.jsonArray?.let { e -> if (e.none { it.jsonPrimitive.content == value.jsonPrimitive.content }) return "«$name» debe ser uno de: ${e.joinToString { it.jsonPrimitive.content }}" }
        spec.int("maxLength")?.let { max -> if (value is JsonPrimitive && value.isString && value.content.length > max) return "«$name» supera $max caracteres" }
    }
    return when (d.key) {
        "device.set_alarm" -> {
            val h = params.int("hour"); val m = params.int("minute") ?: 0
            if (h == null || h !in 0..23) "La hora debe estar entre 0 y 23" else if (m !in 0..59) "Los minutos deben estar entre 0 y 59" else null
        }
        "device.set_timer" -> params.int("seconds").let { if (it == null || it !in 1..86_400) "El temporizador debe durar entre 1 segundo y 24 horas" else null }
        "device.calendar_event" -> if (!isoWithZone(params["start"])) "El inicio del evento debe ser una fecha ISO 8601 con zona horaria"
            else if (params["end"] != null && params["end"] !is JsonNull && !isoWithZone(params["end"])) "El fin del evento debe ser una fecha ISO 8601 con zona horaria" else null
        "reminder.create" -> if (!isoWithZone(params["at"])) "La fecha del recordatorio debe ser ISO 8601 con zona horaria" else null
        "device.open_url" -> if (params.str("url")?.startsWith("https://") != true) "Solo se abren direcciones https://" else null
        "whatsapp.open_chat", "device.dial" -> {
            val phone = params.str("phone")
            if (!phone.isNullOrEmpty() && !Regex("""^\+?[0-9]{6,16}$""").matches(phone)) "Número de teléfono inválido"
            else if (phone.isNullOrEmpty() && params.str("recipient_query").isNullOrEmpty()) "Falta el destinatario" else null
        }
        else -> null
    }
}

// ------------------------------------------------------------ ciclo de vida de acciones

internal fun LocalBackend.actions() = store.all(C.ACTIONS, ActionRec.serializer())
internal fun LocalBackend.actionRec(id: String) = store.get(C.ACTIONS, id, ActionRec.serializer()) ?: throw notFound("Acción no encontrada")
private fun LocalBackend.saveAction(r: ActionRec) = store.put(C.ACTIONS, r.a.id, ActionRec.serializer(), r)

/** Parámetros completos para ejecutar en el teléfono (con el número descifrado). */
internal fun LocalBackend.executionParams(r: ActionRec): JsonObject {
    val p = r.a.params.filterKeys { it !in setOf("recipient_masked", "phone_status") }.toMutableMap()
    r.phoneEnc?.let { enc -> crypto.decrypt(enc)?.let { p["phone"] = JsonPrimitive(it) } }
    return JsonObject(p)
}

internal fun LocalBackend.withDevice(r: ActionRec) = r.a.copy(deviceParams = executionParams(r))

private fun LocalBackend.publishAction(r: ActionRec) {
    emit("action.updated", JsonObject(NexusJson.encodeToJsonElement(ActionDto.serializer(), r.a).jsonObject + ("entity" to buildJsonObject {
        put("type", "action"); put("id", r.a.id) })))
}

private fun LocalBackend.sanitize(d: ActionDef, params: JsonObject): Pair<JsonObject, String?> {
    val clean = params.filter { (k, v) -> k in d.params && v !is JsonNull && (v as? JsonPrimitive)?.contentOrNull != "" }.toMutableMap()
    var enc: String? = null
    clean.remove("phone")?.let { el ->
        val phone = el.jsonPrimitive.content
        val res = PhoneNormalizer.normalize(phone)
        enc = crypto.encrypt(phone)
        clean["recipient_masked"] = JsonPrimitive(res.masked ?: "número sin validar")
        clean["phone_status"] = JsonPrimitive(res.status)
        val digits = phone.filter { it.isDigit() }
        val label = clean["contact_label"]?.jsonPrimitive?.contentOrNull
        if (label != null && digits.length >= 6 && label.filter { it.isDigit() }.contains(digits.takeLast(6))) clean["contact_label"] = clean["recipient_masked"]!!
    }
    return JsonObject(clean) to enc
}

internal fun LocalBackend.propose(key: String, params: JsonObject, summary: String, source: String = "jarvis", conversationId: String? = null): ActionRec {
    val d = actionDefs()[key] ?: throw bad("Acción desconocida: $key")
    validateParams(d, params)?.let { throw bad(it) }
    val st = settings()
    val confirmLocal = st.jarvis["confirm_local_actions"]?.jsonPrimitive?.booleanOrNull == true || source == "automation"
    // Envío automático: solo whatsapp.reply, solo en chats autorizados por el usuario, con tope por hora y sin STOP ALL.
    val auto = key == "whatsapp.reply" && source != "user" && canAutoSend(params.str("chat") ?: "")
    val needs = !auto && d.needsConfirmation(confirmLocal)
    val (stored, enc) = sanitize(d, params)
    val now = Instant.now()
    var r = ActionRec(ActionDto(newId(), key, d.name, d.category, d.executor, d.risk, d.operation, stored, summary.take(2000), "awaiting_confirmation",
        if (needs) "AWAITING_CONFIRMATION" else null, needs, JsonObject(emptyMap()), null, source, conversationId, now.toString(), null,
        now.plus(CONFIRMATION_TTL_MIN, ChronoUnit.MINUTES).toString()), enc, user().id)
    if (st.settings.emergencyStop && source != "user" && d.risk != "READ_ONLY") {
        r = r.copy(a = r.a.copy(status = "blocked", error = "STOP ALL está activo: no se ejecutan acciones propuestas automáticamente.", expiresAt = null))
    } else if (auto) r = autoRun(r, params)
    else if (!needs) r = start(r, d, params)
    saveAction(r)
    activity("action.proposed", "Acción propuesta: ${d.name}", "info", actor = if (source == "user") "user" else "agent")
    publishAction(r)
    return r
}

private fun LocalBackend.start(r: ActionRec, d: ActionDef, params: JsonObject): ActionRec {
    val now = Instant.now()
    if (d.executor == "device") return r.copy(a = r.a.copy(status = "ready", stateDetail = if (d.key == "whatsapp.open_chat") "READY_TO_OPEN" else null,
        expiresAt = now.plus(READY_TTL_MIN, ChronoUnit.MINUTES).toString()))
    return try {
        val result = executeServerAction(r, d, params)
        val ok = result["verified"]?.jsonPrimitive?.booleanOrNull == true
        r.copy(a = r.a.copy(status = if (ok) "completed" else "failed", stateDetail = if (ok) result.str("state") ?: "COMPLETED" else "UNVERIFIED",
            result = result, error = if (ok) null else "No se pudo verificar el resultado de la acción.", completedAt = nowIso(), expiresAt = null))
    } catch (e: LocalError) {
        r.copy(a = r.a.copy(status = "failed", error = e.message, stateDetail = "FAILED", completedAt = nowIso(), expiresAt = null))
    }
}

/** Ejecuta en el teléfono y VERIFICA releyendo lo creado. */
private fun LocalBackend.executeServerAction(r: ActionRec, d: ActionDef, params: JsonObject): JsonObject = when (d.key) {
    "reminder.create" -> {
        val at = ZonedDateTime.parse(params.str("at")!!.replace("Z", "+00:00")).toInstant()
        if (!at.isAfter(Instant.now())) throw bad("La fecha del recordatorio ya pasó")
        val job = createReminder(params.str("title")!!, params.str("body") ?: "", at, r.a.id)
        val check = store.get(C.SCHEDULES, job.id, ScheduleDto.serializer())
        buildJsonObject { put("verified", check != null && check.isEnabled && check.nextRunAt == at.toString()); put("state", "REMINDER_SCHEDULED")
            put("scheduled_job_id", job.id); put("at", at.toString()) }
    }
    "memory.remember" -> {
        val content = params.str("content")!!
        val item = createMemory("user", content, kind = if ("prefer" in content.lowercase()) "preference" else "fact", source = "user",
            sourceRef = "Pedido explícito a NEXUS", category = (params.str("category") ?: "personal").take(30))
        buildJsonObject { put("verified", store.get(C.MEMORY, item.m.id, MemoryRec.serializer()) != null); put("state", "MEMORY_SAVED"); put("memory_id", item.m.id) }
    }
    "memory.forget" -> {
        val ids = params["memory_ids"]?.jsonArray?.map { it.jsonPrimitive.content }.orEmpty()
        var deleted = 0
        ids.forEach { id -> if (store.get(C.MEMORY, id, MemoryRec.serializer()) != null) { store.delete(C.MEMORY, id); deleted++ } }
        buildJsonObject { put("verified", ids.none { store.get(C.MEMORY, it, MemoryRec.serializer()) != null }); put("state", "MEMORY_DELETED"); put("deleted", deleted) }
    }
    "mission.create" -> {
        val m = createMission(params.str("title") ?: params.str("objective")!!.take(80), params.str("objective")!!, null, params.str("project_id"))
        buildJsonObject { put("verified", true); put("state", "MISSION_CREATED"); put("mission_id", m.m.id); put("title", m.m.title) }
    }
    "automation.create" -> {
        val a = createAutomation(params, "nexus")
        buildJsonObject { put("verified", a.a.status == "active"); put("state", "AUTOMATION_ACTIVE"); put("automation_id", a.a.id)
            a.a.nextRunAt?.let { put("next_run_at", it) } }
    }
    "autosend.enable", "autosend.disable", "autosend.limit" -> executeAutosend(d.key, params)
    else -> throw bad("La acción ${d.key} no se ejecuta en el teléfono sin la app")
}

internal fun LocalBackend.confirmAction(id: String, params: JsonObject?): ActionRec {
    var r = actionRec(id)
    val d = actionDefs().getValue(r.a.actionKey)
    if (r.a.status != "awaiting_confirmation") throw bad("La acción no espera confirmación (estado: ${r.a.status})")
    if (r.a.expiresAt != null && Instant.parse(r.a.expiresAt).isBefore(Instant.now())) {
        saveAction(r.copy(a = r.a.copy(status = "expired"))); throw bad("La acción venció: pedila de nuevo")
    }
    if (settings().settings.emergencyStop && d.risk != "READ_ONLY") throw bad("STOP ALL está activo: desactivalo para ejecutar acciones")
    val merged = JsonObject(executionParams(r) + (params ?: JsonObject(emptyMap())).filterKeys { it in d.params })
    validateParams(d, merged)?.let { throw bad(it) }
    val (stored, enc) = sanitize(d, merged)
    r = r.copy(a = r.a.copy(params = stored, result = if (params != null) JsonObject(r.a.result + ("edited_before_confirm" to JsonPrimitive(true))) else r.a.result),
        phoneEnc = enc ?: r.phoneEnc)
    r = start(r, d, merged)
    saveAction(r)
    activity("action.confirmed", "Acción confirmada: ${d.name}", actor = "user")
    publishAction(r)
    if (r.a.executor == "server" && r.a.conversationId != null && r.a.status in setOf("completed", "failed")) serverOutcomeMessage(r)
    if (r.a.status == "completed" && r.a.source != "automation") emitAutomationEvent("action.completed", mapOf("action_key" to r.a.actionKey))
    return r
}

internal fun LocalBackend.cancelAction(id: String, reason: String?): ActionRec {
    val r = actionRec(id)
    if (r.a.status !in setOf("awaiting_confirmation", "ready")) throw bad("La acción ya no se puede cancelar (estado: ${r.a.status})")
    val out = r.copy(a = r.a.copy(status = "cancelled", stateDetail = "CANCELLED", completedAt = nowIso(),
        result = JsonObject(r.a.result + ("cancel_reason" to JsonPrimitive((reason ?: "Cancelada por el usuario").take(300))))))
    saveAction(out); publishAction(out)
    return out
}

internal fun LocalBackend.reportAction(id: String, state: String, result: JsonObject): ActionRec {
    val r = actionRec(id)
    val d = actionDefs().getValue(r.a.actionKey)
    if (r.a.executor != "device") throw bad("Solo las acciones de dispositivo se informan desde la app")
    if (state !in d.resultStates && state !in setOf("ERROR", "CANCELLED")) throw bad("Estado no válido para ${r.a.actionKey}: $state")
    if (r.a.status in setOf("completed", "failed", "cancelled", "expired", "blocked")) {
        if (r.a.stateDetail == state) return r
        throw bad("La acción ya terminó (estado: ${r.a.status})")
    }
    val clean = JsonObject(result.filterKeys { it in RESULT_KEYS })
    if (state in PROGRESS_STATES) {
        if (r.a.status != "awaiting_confirmation") throw bad("Ese estado solo es válido antes de confirmar")
        val out = r.copy(a = r.a.copy(stateDetail = state, result = JsonObject(r.a.result + clean)))
        saveAction(out); publishAction(out); return out
    }
    if (r.a.status != "ready") throw bad("Primero hay que confirmar la acción")
    val status = if (state == "CANCELLED") "cancelled" else if (state in SUCCESS_STATES) "completed" else "failed"
    val out = r.copy(a = r.a.copy(stateDetail = state, result = JsonObject(r.a.result + clean), completedAt = nowIso(), status = status,
        error = if (status == "failed") (clean.str("error") ?: state).take(500) else null))
    saveAction(out)
    activity("action.reported", "${d.name}: $state", if (status == "completed") "success" else "error", actor = "user")
    publishAction(out)
    if (out.a.conversationId != null) recordActionOutcome(out)
    if (status == "completed" && out.a.source != "automation") emitAutomationEvent("action.completed", mapOf("action_key" to out.a.actionKey))
    return out
}

internal fun LocalBackend.expireActions() {
    val now = Instant.now()
    actions().filter { it.a.status in setOf("awaiting_confirmation", "ready") && it.a.expiresAt != null && Instant.parse(it.a.expiresAt).isBefore(now) }
        .forEach { val out = it.copy(a = it.a.copy(status = "expired", stateDetail = "EXPIRED")); saveAction(out); publishAction(out) }
}

private fun LocalBackend.recordActionOutcome(r: ActionRec) {
    val p = r.a.params
    val who = p.str("contact_label") ?: p.str("recipient_query") ?: r.a.result.str("contact_label") ?: "el contacto"
    val text = when (r.a.stateDetail) {
        "WHATSAPP_OPENED" -> "Abrí WhatsApp con el mensaje para $who. Todavía no está enviado: el envío lo confirmás vos en WhatsApp."
        "DIALER_OPENED" -> "Abrí el marcador con el número de $who."
        "WHATSAPP_REPLY_HANDED" -> "Le pasé la respuesta a WhatsApp para ${p.str("chat") ?: who}. No puedo confirmar que se haya entregado: revisalo en WhatsApp."
        "APP_NOT_FOUND" -> "No encontré una app instalada llamada «${p.str("app") ?: ""}»."
        else -> when (r.a.status) { "failed" -> "La acción «${r.a.summary.take(100)}» falló: ${r.a.error}"; "cancelled" -> "Listo, lo cancelé."; else -> return }
    }
    recordMessage("chat", r.a.conversationId!!, text, "agent", nexus().d.id, "action_result",
        meta = buildJsonObject { put("kind", "action_result"); put("action_id", r.a.id); r.a.stateDetail?.let { put("state", it) } })
    publishState("idle", r.a.conversationId, stage = "verification")
}

private fun LocalBackend.serverOutcomeMessage(r: ActionRec) {
    val p = r.a.params
    val tz = zone()
    val text = when {
        r.a.status == "failed" -> "No pude completarlo: ${r.a.error}"
        r.a.actionKey == "reminder.create" -> "Listo, te lo recuerdo ${whenLabel(p.str("at"), tz)}: «${p.str("title")}»."
        r.a.actionKey == "memory.remember" -> "Guardado en tu memoria. Lo podés ver o borrar en Memoria → Privacidad."
        r.a.actionKey == "memory.forget" -> "Listo, borré ${r.a.result.int("deleted") ?: 0} recuerdo(s)."
        r.a.actionKey == "mission.create" -> "Misión creada: «${r.a.result.str("title")}». Te aviso cuando haya avances."
        r.a.actionKey == "automation.create" -> "Rutina activada." + (r.a.result.str("next_run_at")?.let { " Próxima ejecución: ${whenLabel(it, tz)}." } ?: "")
        else -> "Listo."
    }
    recordMessage("chat", r.a.conversationId!!, text, "agent", nexus().d.id, "action_result",
        meta = buildJsonObject { put("kind", "action_result"); put("action_id", r.a.id); r.a.stateDetail?.let { put("state", it) } })
}

internal fun whenLabel(iso: String?, tz: java.time.ZoneId): String {
    if (iso == null) return ""
    val dt = runCatching { ZonedDateTime.parse(iso.replace("Z", "+00:00")).withZoneSameInstant(tz) }.getOrNull() ?: return ""
    val days = ChronoUnit.DAYS.between(ZonedDateTime.now(tz).toLocalDate(), dt.toLocalDate())
    val day = when (days) { 0L -> "hoy"; 1L -> "mañana"; 2L -> "pasado mañana"; else -> "el " + dt.format(DM) }
    return "$day a las ${dt.format(HM)}"
}

// ------------------------------------------------------------ estado y respuestas

internal fun LocalBackend.publishState(state: String, conversationId: String?, messageId: String? = null, stage: String? = null, detail: String? = null) {
    emit("jarvis.state", buildJsonObject {
        put("state", state); stage?.let { put("stage", it) }; detail?.let { put("detail", it) }
        conversationId?.let { put("conversation_id", it); put("entity", buildJsonObject { put("type", "conversation"); put("id", it) }) }
        messageId?.let { put("message_id", it) }
    })
}

private fun actionReply(intent: Intent, a: ActionDto, tz: java.time.ZoneId): String {
    val p = a.params
    val waiting = a.status == "awaiting_confirmation"
    if (a.status == "blocked") return "No puedo hacerlo ahora: ${a.error}"
    if (a.status == "failed") return "Lo intenté, pero falló: ${a.error}"
    val who = p.str("contact_label") ?: p.str("recipient_query") ?: "ese contacto"
    return when (a.actionKey) {
        "whatsapp.open_chat" -> if (p.str("text").isNullOrEmpty())
            "Te preparo el WhatsApp para $who. Escribí el mensaje en la vista previa y, cuando confirmes, abro WhatsApp. El envío lo hacés vos."
        else "Te preparé el WhatsApp para $who. Revisá el destinatario y el texto; cuando confirmes abro WhatsApp con el mensaje listo. El envío lo hacés vos desde WhatsApp."
        "autosend.enable" -> "Para activar el envío automático en «${p.str("chat")}»: NEXUS va a responder solo ahí (con tope por hora y pausas entre mensajes, solo cuando lo mencionen o usen !juego, !trivia o !resumen). Podés quitarlo cuando quieras. ¿Lo activo?"
        "autosend.limit" -> "Listo, el tope de envíos automáticos quedó en ${p.int("n")} por hora."
        "autosend.disable" -> "Listo, quité el envío automático."
        "whatsapp.reply" -> if (a.status == "completed") "Le pasé la respuesta a WhatsApp para «${p.str("chat")}». No puedo confirmar que se haya entregado." else "Te preparé la respuesta para «${p.str("chat")}». Al confirmar se la paso a WhatsApp con la respuesta rápida (solo funciona si ese chat acaba de escribir)."
        "device.dial" -> "Te dejo lista la llamada a $who. Al confirmar abro el marcador; la llamada la iniciás vos."
        "device.open_app" -> if (!waiting) "Abriendo ${p.str("app")}." else "¿Abro ${p.str("app")}?"
        "device.open_settings" -> ((intent.extra["note"] as? String)?.let { "$it " } ?: "") + "Te abro la configuración."
        "device.navigate" -> "Te abro la ruta hacia ${p.str("destination")}."
        "device.map_search" -> "Busco «${p.str("query")}» en el mapa."
        "device.set_alarm" -> (if (waiting) "¿Pongo la" else "Pongo la") + " alarma a las %02d:%02d".format(p.int("hour") ?: 0, p.int("minute") ?: 0) + if (waiting) "?" else "."
        "device.set_timer" -> {
            val secs = p.int("seconds") ?: 0
            val label = if (secs >= 60 && secs % 60 == 0) "${secs / 60} minutos" else if (secs < 60) "$secs segundos" else "${secs / 60} min ${secs % 60} s"
            "Temporizador de $label" + if (waiting) " listo para confirmar." else " en marcha."
        }
        "device.calendar_event" -> "Te preparé el evento «${p.str("title")}» ${if (p["all_day"]?.jsonPrimitive?.booleanOrNull == true) "todo el día" else whenLabel(p.str("start"), tz)}. Lo guardás desde tu calendario."
        "device.calendar_view" -> "Te abro el calendario en esa fecha. Aclaración: yo no leo tus eventos, solo abro la agenda."
        "device.contact_create" -> "Te preparo el contacto ${p.str("name")} para que lo guardes en tu agenda."
        "device.share_text", "device.share_file" -> if (waiting) "Al confirmar abro el menú de compartir para que elijas la app." else "Abro el menú de compartir."
        "device.open_url" -> "Abro el enlace."
        "app.open_screen" -> "Abriendo ${p.str("label") ?: "la sección"}."
        "reminder.create" -> if (a.status == "completed") "Listo, te lo recuerdo ${whenLabel(p.str("at"), tz)}: «${p.str("title")}»."
            else "Te armé el recordatorio «${p.str("title")}» para ${whenLabel(p.str("at"), tz)}. ¿Lo confirmo?"
        "memory.remember" -> if (a.status == "completed") "Guardado en tu memoria: «${p.str("content")}»." else "¿Lo guardo en tu memoria? «${p.str("content")}»"
        "memory.forget" -> "Encontré estos recuerdos. Si confirmás, los borro definitivamente."
        "mission.create" -> "Puedo armar una misión: ${p.str("objective")}. Se planifica y la trabaja el equipo en este teléfono (usa tu proveedor de IA). ¿La creo?"
        "automation.create" -> "Te propongo esta rutina: ${a.summary}. ¿La activo?"
        else -> a.summary
    }
}

private fun LocalBackend.memoryLookup(topic: String): Pair<String, JsonArray> {
    val blocked = disabledCategories()
    val items = (if (topic.isNotEmpty()) searchMemory(topic, listOf("user", "shared")).map { it.first }
    else memories().filter { it.m.scope in setOf("user", "shared") && it.m.verificationStatus != "rejected" }.sortedByDescending { it.updatedAt ?: it.m.createdAt })
        .filter { it.category !in blocked }.take(6)
    if (items.isEmpty()) return (if (topic.isNotEmpty()) "No tengo recuerdos guardados sobre eso." else "Todavía no tengo recuerdos personales guardados.") to JsonArray(emptyList())
    val origin = mapOf("user" to "me lo dijiste vos", "agent" to "lo propuso un agente", "document" to "de un documento", "web" to "de la web", "mission" to "de una misión")
    val lines = items.map { i ->
        val date = i.m.createdAt.take(10).split("-").reversed().joinToString("/")
        val stale = runCatching { Instant.parse(i.lastVerifiedAt ?: i.m.createdAt).isBefore(Instant.now().minus(180, ChronoUnit.DAYS)) }.getOrDefault(false)
        "• ${i.m.content.trim().take(300)} (${origin[i.m.source] ?: i.m.source}, $date${if (stale) " — puede estar desactualizado" else ""})"
    }
    val head = if (topic.isNotEmpty()) "Esto es lo que tengo sobre $topic:" else "Esto es lo que tengo guardado de vos:"
    return head + "\n" + lines.joinToString("\n") to JsonArray(items.map { i -> buildJsonObject {
        put("id", i.m.id); put("content", i.m.content.take(500)); put("category", i.category); put("source", i.m.source) } })
}

private fun LocalBackend.lastPending(recent: List<MessageDto>): Map<String, Any?>? {
    val m = recent.firstOrNull() ?: return null
    if (m.senderType == "user") return null
    val pending = m.meta["pending"] as? JsonObject ?: return null
    if (Instant.parse(m.createdAt).isBefore(Instant.now().minus(PENDING_TTL_MIN, ChronoUnit.MINUTES))) return null
    return pending.mapValues { (it.value as? JsonPrimitive)?.contentOrNull }
}

internal fun LocalBackend.jarvisConversation(new: Boolean): ConvRec {
    if (!new) convs().filter { it.kind == "jarvis" }.maxByOrNull { it.c.updatedAt }?.let { return it }
    return newConv(nexus().d.id, null, "NEXUS", "jarvis")
}

internal fun LocalBackend.modelsAvailable() = usableModels(null).isNotEmpty()

private fun stage(name: String, ms: Double) = PipelineStage(name, "done", ms)

internal fun LocalBackend.processMessage(b: JarvisMessageBody): JarvisResponse {
    var t = System.nanoTime()
    val stages = mutableListOf<PipelineStage>()
    fun add(name: String) { val now = System.nanoTime(); stages += stage(name, Math.round((now - t) / 10_000.0) / 100.0); t = now }
    val tz = zone(b.timezone)
    b.timezone?.let { tzName -> if (runCatching { java.time.ZoneId.of(tzName) }.isSuccess && settings().jarvis.str("timezone") != tzName)
        saveSettings(settings().let { it.copy(jarvis = JsonObject(it.jarvis + ("timezone" to JsonPrimitive(tzName)))) }) }
    val conv = if (b.conversationId != null) conv(b.conversationId) else jarvisConversation(b.newConversation)
    val text = b.content.trim()
    if (text.length > 8000) throw bad("El mensaje es demasiado largo (máx. 8000 caracteres)")
    b.interruptedMessageId?.let { id -> store.get(C.MSGS, id, MessageDto.serializer())?.let { m ->
        updateMessage(m.copy(meta = JsonObject(m.meta + mapOf("interrupted" to JsonPrimitive(true), "spoken_chars" to JsonPrimitive(b.spokenChars))))) } }
    add("input")
    val recent = messagesOf("chat", conv.c.id).sortedByDescending { it.createdAt }.take(4)
    val pending = lastPending(recent)
    val lastText = recent.firstOrNull { it.senderType == "agent" && it.messageType == "message" }?.content
    val ctx = ClassifyContext(ZonedDateTime.now(tz), tz.id, lastText, b.attachmentFileIds.isNotEmpty(), pending)
    add("understanding")
    val intent = classify(text, ctx)
    add("intent")
    if (intent.control in setOf("stop", "resume", "repeat", "noop")) {
        if (intent.control == "stop") { cancelInflight(conv.c.id); publishState("idle", conv.c.id, stage = "control", detail = "stop") }
        add("routing")
        return JarvisResponse(conv.c.id, "control", intentDto(intent), stages, control = intent.control)
    }
    val attachments = b.attachmentFileIds.mapNotNull { id -> store.get(C.FILES, id, FileRec.serializer())?.let { buildJsonObject { put("id", id); put("path", it.f.path) } } }
    val userMsg = recordMessage("chat", conv.c.id, text, "user", meta = buildJsonObject {
        put("input_mode", b.inputMode); put("attachments", JsonArray(attachments)); put("source", "app")
        put("intent", buildJsonObject { put("category", intent.category); put("rule", intent.rule); put("confidence", intent.confidence) })
    })
    if (conv.c.title in setOf("NEXUS", "Chat con NEXUS", "Conversación")) store.put(C.CONVS, conv.c.id, ConvRec.serializer(), conv.copy(c = conv.c.copy(title = text.take(60))))
    var handler = intent.handler
    add("routing")
    var replyText: String? = null
    val replyMeta = mutableMapOf<String, JsonElement>("reply_to" to JsonPrimitive(userMsg.id), "category" to JsonPrimitive(intent.category))
    var action: ActionRec? = null
    var deviceParams: JsonObject? = null
    when {
        intent.control == "cancel_pending" -> { replyText = "Listo, lo dejo."; add("response") }
        intent.rule == "video" && intent.actionKey == null && intent.question == null -> {
            replyText = if (!modelsAvailable()) "Para armar el video necesito un modelo de IA que escriba el guion (Más → Ajustes → Proveedores de IA; Gemini y Groq son gratis)."
            else {
                val topic = intent.params["topic"] as String
                val job = scope.launch { createVideo(conv.c.id, topic) }
                running["video:${userMsg.id}"] = job
                job.invokeOnCompletion { running.remove("video:${userMsg.id}") }
                "Dale, estoy armando el video «${topic.take(60)}». Tarda más o menos lo que dura el video; cuando esté te lo dejo listo para mandar."
            }
            add("response")
        }
        handler == "clarification" -> { replyText = intent.question; (intent.extra["pending"] as? Map<*, *>)?.let { replyMeta["pending"] = toJsonElement(it) }; add("response") }
        handler == "memory_lookup" -> {
            add("context")
            val (txt, items) = memoryLookup(intent.extra["memory_lookup"] as? String ?: "")
            replyText = txt; replyMeta["memories"] = items; add("execution"); add("response")
        }
        handler == "memory_forget" -> {
            val topic = intent.extra["memory_forget"] as String
            val hits = searchMemory(topic, listOf("user", "shared"), limit = 5)
            add("context")
            if (hits.isEmpty()) replyText = "No encontré recuerdos sobre «$topic»."
            else {
                intent.actionKey = "memory.forget"
                intent.params = mutableMapOf("memory_ids" to hits.map { it.first.m.id }, "query" to topic)
                intent.summary = "Olvidar ${hits.size} recuerdo(s) sobre «${topic.take(80)}»"
                replyMeta["memories"] = JsonArray(hits.map { h -> buildJsonObject { put("id", h.first.m.id); put("content", h.first.m.content.take(300)) } })
                handler = "action"
            }
        }
    }
    if (handler == "action") {
        (intent.extra["resolve_project"] as? String)?.let { name ->
            val pr = store.all(C.PROJECTS, ProjectDto.serializer()).filter { normalize(it.name).contains(normalize(name)) }.maxByOrNull { it.updatedAt }
            if (pr != null) intent.params = (intent.params + mapOf("entity_id" to pr.id, "label" to pr.name)).toMutableMap()
            else { intent.params = mutableMapOf("screen" to "projects", "label" to "tus proyectos"); intent.assumptions += "No encontré un proyecto llamado «$name»; te muestro la lista." }
        }
        try {
            val params = toJsonElement(intent.params).jsonObject
            deviceParams = params
            action = propose(intent.actionKey!!, params, intent.summary ?: intent.actionKey!!, "jarvis", conv.c.id)
            add("permissions"); add("execution")
            if (action.a.executor == "server" && action.a.status in setOf("completed", "failed")) add("verification")
            replyText = actionReply(intent, action.a, tz) + if (intent.assumptions.isNotEmpty()) " Ojo: " + intent.assumptions.joinToString(" ") else ""
            replyMeta["kind"] = JsonPrimitive("action_proposal"); replyMeta["action_id"] = JsonPrimitive(action.a.id)
            add("response")
            if (action.a.actionKey == "memory.remember" && action.a.status == "completed") add("memory")
        } catch (e: LocalError) {
            replyText = "No pude preparar la acción: ${e.message}"; add("permissions")
        }
    }
    if (replyText != null) {
        replyMeta["pipeline"] = JsonArray(stages.map { NexusJson.encodeToJsonElement(PipelineStage.serializer(), it) })
        val reply = recordMessage("chat", conv.c.id, replyText, "agent", nexus().d.id, meta = JsonObject(replyMeta))
        updateMessage(userMsg.copy(meta = JsonObject(userMsg.meta + ("pipeline" to replyMeta["pipeline"]!!))))
        val st = if (action?.a?.status == "awaiting_confirmation") "waiting_confirmation" else if (action?.a?.status == "ready") "executing" else "idle"
        publishState(st, conv.c.id, userMsg.id, "response")
        return JarvisResponse(conv.c.id, if (action != null) "action" else "direct", intentDto(intent), stages, userMsg, reply,
            action?.let { it.a.copy(deviceParams = executionParams(it)) })
    }
    if (!modelsAvailable()) {
        val reply = recordMessage("chat", conv.c.id, "Para eso necesito un modelo de IA y todavía no configuraste ninguno (Más → Ajustes → Proveedores de IA). " +
            "Podés usar uno gratis, como Google Gemini o Groq. Mientras tanto puedo hacer acciones directas: WhatsApp, llamadas, recordatorios, alarmas, " +
            "abrir apps, mapas, agenda, memoria y rutinas.", "system", messageType = "error",
            meta = JsonObject(replyMeta + ("reason" to JsonPrimitive("no_model_available"))))
        add("execution")
        publishState("idle", conv.c.id, stage = "execution", detail = "no_model_available")
        return JarvisResponse(conv.c.id, "no_model", intentDto(intent), stages, userMsg, reply)
    }
    add("execution")
    val route = intent.route()
    updateMessage(userMsg.copy(meta = JsonObject(userMsg.meta + mapOf("route" to route,
        "pipeline" to JsonArray(stages.map { NexusJson.encodeToJsonElement(PipelineStage.serializer(), it) })))))
    publishState("thinking", conv.c.id, userMsg.id, "execution")
    val job = scope.launch { generateJarvisReply(conv.c.id, userMsg.id) }
    running["reply:${userMsg.id}"] = job
    job.invokeOnCompletion { running.remove("reply:${userMsg.id}") }
    return JarvisResponse(conv.c.id, "model", intentDto(intent), stages, userMsg)
}

private fun intentDto(i: Intent) = NexusJson.decodeFromJsonElement(IntentDto.serializer(), i.toJson())

private fun LocalBackend.cancelInflight(convId: String) {
    messagesOf("chat", convId).filter { it.senderType == "user" }.forEach { m -> if (running.containsKey("reply:${m.id}")) cancelRequested += m.id }
}

/** Respuesta con modelo (equivale al trabajo «jarvis.reply» del servidor), con streaming y barge-in. */
internal suspend fun LocalBackend.generateJarvisReply(convId: String, msgId: String) {
    val conv = store.get(C.CONVS, convId, ConvRec.serializer()) ?: return
    val userMsg = store.get(C.MSGS, msgId, MessageDto.serializer()) ?: return
    val nexus = nexus()
    val route = userMsg.meta["route"] as? JsonObject ?: JsonObject(emptyMap())
    val voice = userMsg.meta.str("input_mode") == "voice"
    val streamId = newId()
    val streamed = StringBuilder()
    setAgentStatus(nexus.d.id, "thinking", "Respondiendo")
    val tz = zone()
    val now = ZonedDateTime.now(tz)
    val dialect = if (settings().voice.language.startsWith("es-AR")) "es-AR" else "es"
    val persona = seed.str("persona_prompt")!!.replace("{dialect}", seed["dialects"]!!.jsonObject.str(dialect) ?: "")
    val extra = mutableListOf(persona,
        "# Contexto real del usuario (no lo inventes ni lo exageres)\n- Hora local: ${now.format(DateTimeFormatter.ofPattern("EEEE dd/MM/yyyy HH:mm", java.util.Locale("es", "AR")))} (${tz.id}).\n" +
            "- Acciones esperando confirmación: ${actions().count { it.a.status == "awaiting_confirmation" }}. " +
            "Misiones en curso: ${store.all(C.MISSIONS, MissionRec.serializer()).count { it.m.status in LocalBackend.RUNNING_MISSION }}.",
        "# Modo local\nEstás funcionando dentro del teléfono del usuario, sin servidor. Las acciones del teléfono (WhatsApp, alarmas, recordatorios, " +
            "apps, mapas, agenda, memoria, rutinas) las resuelve NEXUS antes de llegar a vos: si el usuario te pide una, explicale cómo pedirla " +
            "(por ejemplo «recordame mañana a las 9 …», «mandale un WhatsApp a …»). No tenés búsqueda web ni ejecución de código: si hace falta, decilo.")
    conv.summary?.let { extra += "# Resumen de la conversación anterior\n$it" }
    route.str("response_style")?.let { extra += "# Formato de esta respuesta\nRespuesta $it." }
    if (voice) extra += seed.str("voice_rules")!!
    val specialists = (route["specialists"] as? JsonArray)?.map { it.jsonPrimitive.content }.orEmpty()
    val collab = mutableListOf<JsonObject>()
    var prompt = userMsg.content
    (userMsg.meta["attachments"] as? JsonArray)?.forEach { a ->
        readFileText(a.jsonObject.str("id") ?: return@forEach)?.let { (name, txt) -> prompt += "\n\n<untrusted_data archivo=\"$name\">\n${txt.take(12000)}\n</untrusted_data>" }
    }
    val history = chatHistory(convId, userMsg)
    var maxTokens = route.int("max_tokens") ?: 1500
    if (voice) maxTokens = maxOf(400, maxTokens / 2)
    val stop = { cancelRequested.contains(msgId) || settings().settings.emergencyStop }
    try {
        // Colaboración real: el especialista sugerido responde primero con su propio rol y modelo.
        val specialist = specialists.firstOrNull()?.let { agentBySlug(it) }
        if (specialist != null && route.str("task_type") in setOf("research", "code", "writing", "general") && !voice) {
            setAgentStatus(specialist.d.id, "collaborating", "Ayudando a NEXUS")
            publishState("collaborating", convId, msgId, "execution")
            val r = runAgent(specialist, "Pedido del usuario a NEXUS:\n$prompt\n\nAportá tu análisis experto para que NEXUS responda. Sé concreto.", emptyList(),
                maxTokens = 1500, purpose = "collaboration", shouldStop = stop)
            setAgentStatus(specialist.d.id, "idle")
            collab += buildJsonObject { put("from", specialist.d.slug); put("to", "nexus"); put("type", "answer"); put("content", r.first.text.take(3000)); put("model", r.second) }
            extra += "# Aporte de ${specialist.d.name} (${specialist.d.role})\n${r.first.text.take(6000)}\nUsalo si mejora la respuesta y mencioná en una línea qué aportó."
        }
        val result = runAgent(nexus, prompt, history, maxTokens = maxTokens, purpose = "chat", extraSystem = extra.joinToString("\n\n"), shouldStop = stop,
            onDelta = { d ->
                streamed.append(d)
                emit("chat.delta", buildJsonObject { put("conversation_id", convId); put("stream_id", streamId); put("agent_id", nexus.d.id); put("delta", d); put("reply_to", msgId) })
            })
        val interrupted = stop()
        recordMessage("chat", convId, result.first.text.ifBlank { if (interrupted) "(respuesta detenida)" else "(sin respuesta)" }, "agent", nexus.d.id, model = result.second,
            meta = buildJsonObject {
                put("reply_to", msgId); put("stream_id", streamId); put("tokens", result.first.tokensIn + result.first.tokensOut); put("cost_usd", "0")
                put("models", JsonArray(listOf(JsonPrimitive(result.second)))); put("tools_used", JsonArray(emptyList()))
                put("consulted_agents", JsonArray(collab.mapNotNull { it["from"] })); put("collaboration", JsonArray(collab))
                if (interrupted) { put("interrupted", true); put("reason", "interrumpido por el usuario") }
                userMsg.meta["intent"]?.jsonObject?.str("category")?.let { put("category", it) }
            })
        setAgentStatus(nexus.d.id, "idle")
        val waiting = actions().count { it.a.status == "awaiting_confirmation" && it.a.conversationId == convId }
        publishState(if (waiting > 0) "waiting_confirmation" else "idle", convId, msgId, "response", if (interrupted) "interrupted" else null)
        if (messagesOf("chat", convId).size > 60) summarizeConversation(convId)
    } catch (e: Exception) {
        val msg = (e as? LlmError)?.message ?: (e as? LocalError)?.message ?: "${e.javaClass.simpleName}: ${e.message}"
        recordMessage("chat", convId, "No pude responder: $msg", "system", messageType = "error", meta = buildJsonObject { put("reply_to", msgId); put("stream_id", streamId) })
        setAgentStatus(nexus.d.id, "error", "Error al responder")
        publishState("error", convId, msgId, "execution", msg.take(200))
    } finally {
        cancelRequested.remove(msgId)
    }
}

internal fun LocalBackend.chatHistory(convId: String, before: MessageDto, limit: Int = 30): List<ChatMsg> =
    messagesOf("chat", convId).filter { it.createdAt < before.createdAt && it.messageType !in setOf("question", "answer") && it.senderType != "system" }
        .sortedBy { it.createdAt }.takeLast(limit).map { ChatMsg(if (it.senderType == "user") "user" else "assistant", it.content) }

private suspend fun LocalBackend.summarizeConversation(convId: String) {
    val c = store.get(C.CONVS, convId, ConvRec.serializer()) ?: return
    val old = messagesOf("chat", convId).filter { it.messageType == "message" }.sortedBy { it.createdAt }.dropLast(30).takeLast(80)
    if (old.isEmpty()) return
    val transcript = old.joinToString("\n") { "${if (it.senderType == "user") "Usuario" else "NEXUS"}: ${it.content.take(600)}" }
    val prev = c.summary?.let { "Resumen previo:\n$it\n\n" } ?: ""
    runCatching {
        val (r, _) = complete("Resumí conversaciones de forma fiel y breve. No agregues nada que no esté.",
            listOf(ChatMsg("user", "${prev}Conversación:\n$transcript\n\nResumen (máx. 12 líneas):")), 700, "summary", null)
        store.put(C.CONVS, convId, ConvRec.serializer(), c.copy(summary = r.text.trim().take(4000)))
    }
}

// ------------------------------------------------------------ rutas

internal fun LocalBackend.registerJarvis() {
    route("POST", "/jarvis/message") { r, _ -> j(processMessage(r.parse())) }
    route("POST", "/jarvis/intent") { r, _ ->
        val b = r.obj()
        val tz = zone(b.str("timezone"))
        j(classify(b.str("content") ?: "", ClassifyContext(ZonedDateTime.now(tz), tz.id)).toJson())
    }
    route("GET", "/jarvis/state") { _, _ -> j(jarvisState()) }
    route("GET", "/jarvis/context") { r, _ -> j(jarvisContext(r.q("timezone"))) }
    route("GET", "/jarvis/settings") { _, _ ->
        val s = settings()
        j(JarvisSettingsDto(NexusJson.decodeFromJsonElement(JarvisPrefs.serializer(), s.jarvis), NexusJson.decodeFromJsonElement(PrivacyPrefs.serializer(), s.privacy)))
    }
    route("GET", "/jarvis/messages/{id}/trace") { _, p ->
        val m = store.get(C.MSGS, p.getValue("id"), MessageDto.serializer()) ?: throw notFound("Mensaje no encontrado")
        val user = if (m.senderType == "user") m else m.meta.str("reply_to")?.let { store.get(C.MSGS, it, MessageDto.serializer()) }
        val reply = if (m.senderType != "user") m else messagesOf("chat", m.channelId).firstOrNull { it.meta.str("reply_to") == m.id }
        j(JarvisTraceDto(m.id, user?.meta?.get("intent") as? JsonObject,
            (user?.meta?.get("route") as? JsonObject)?.let { NexusJson.decodeFromJsonElement(IntentRoute.serializer(), it) },
            ((user?.meta?.get("pipeline") ?: reply?.meta?.get("pipeline")) as? JsonArray)?.map { NexusJson.decodeFromJsonElement(PipelineStage.serializer(), it) },
            reply?.let { rp -> JarvisTraceReply(rp.id, rp.modelUsed, emptyList(), (rp.meta["consulted_agents"] as? JsonArray)?.map { it.jsonPrimitive.content }.orEmpty(),
                rp.meta.int("tokens"), "0", null, listOf(rp.modelUsed), 0, rp.meta["interrupted"]?.jsonPrimitive?.booleanOrNull == true, rp.meta.str("action_id")) },
            (reply?.meta?.get("collaboration") as? JsonArray)?.map { NexusJson.decodeFromJsonElement(TraceCollab.serializer(), it) }.orEmpty()))
    }
    route("POST", "/jarvis/messages/{id}/feedback") { r, p ->
        val m = store.get(C.MSGS, p.getValue("id"), MessageDto.serializer()) ?: throw notFound("Mensaje no encontrado")
        updateMessage(m.copy(meta = JsonObject(m.meta + ("feedback" to JsonPrimitive(r.parse<FeedbackBody>().rating))))); "{}"
    }
    route("POST", "/jarvis/voice/session") { r, _ -> j(buildJsonObject { put("session_id", r.obj().str("session_id") ?: newId()); put("ok", true) }) }
    route("DELETE", "/jarvis/history") { r, _ ->
        if (r.q("confirm") != "true") throw bad("Confirmá el borrado con confirm=true")
        var n = 0
        convs().filter { it.kind == "jarvis" }.forEach { c -> messagesOf("chat", c.c.id).forEach { store.delete(C.MSGS, it.id); n++ }; store.delete(C.CONVS, c.c.id) }
        j(buildJsonObject { put("messages_deleted", n) })
    }

    route("GET", "/actions/catalog") { _, _ -> j(JsonArray(seed["actions"]!!.jsonArray)) }
    route("GET", "/actions") { r, _ ->
        expireActions()
        j(actions().filter { r.q("status") == null || it.a.status == r.q("status") }.sortedByDescending { it.a.createdAt }.take(50).map { it.a })
    }
    route("POST", "/actions/execute") { r, _ ->
        val b = r.parse<ActionExecuteBody>()
        j(withDevice(propose(b.actionKey, b.params, b.summary ?: b.actionKey, "user", b.conversationId)))
    }
    route("GET", "/actions/{id}") { _, p -> j(withDevice(actionRec(p.getValue("id")))) }
    route("POST", "/actions/{id}/confirm") { r, p -> j(withDevice(confirmAction(p.getValue("id"), r.parse<ActionConfirmBody>().params))) }
    route("POST", "/actions/{id}/cancel") { r, p -> j(cancelAction(p.getValue("id"), r.parse<ActionCancelBody>().reason).a) }
    route("POST", "/actions/{id}/report") { r, p -> val b = r.parse<ActionReportBody>(); j(reportAction(p.getValue("id"), b.state, b.result).a) }

    // WhatsApp (Click to Chat; Business requiere servidor)
    route("GET", "/integrations/whatsapp/status") { _, _ ->
        j(WhatsAppStatusDto(PersonalWaStatus(true, "click_to_chat", false, "NEXUS abre WhatsApp con el texto listo; el envío lo hacés vos y no se puede verificar."),
            BusinessStatusDto(notes = "WhatsApp Business Platform necesita un servidor con webhooks: no está disponible en el modo local."),
            actions().filter { it.a.actionKey == "whatsapp.open_chat" }.sortedByDescending { it.a.createdAt }.take(20).map { it.a }))
    }
    route("POST", "/integrations/whatsapp/draft") { r, _ -> j(composeDraft(r.parse())) }
    route("POST", "/integrations/whatsapp/normalize") { r, _ ->
        val res = PhoneNormalizer.normalize(r.obj().str("phone") ?: r.obj().str("input"), r.obj().str("default_area_code"))
        j(PhoneResultDto(res.input, res.status, res.e164, res.display, res.masked, res.country, res.assumptions, res.message))
    }

    // voz
    route("GET", "/voice/settings") { _, _ -> j(settings().voice) }
    route("PATCH", "/voice/settings") { r, _ ->
        val b = r.parse<VoicePrefsPatch>()
        val cur = settings().voice
        fun range(v: Double?, lo: Double, hi: Double, n: String) = v?.also { if (it !in lo..hi) throw bad("$n debe estar entre $lo y $hi") }
        if (b.wakeWordEnabled == true && cur.wakeWordConsentAt == null && b.wakeWordConsent != true)
            throw bad("Activar la palabra de activación requiere tu consentimiento explícito (wake_word_consent=true)")
        if (b.processing == "remote") throw bad("En el modo local el reconocimiento de voz se hace en el teléfono.")
        if (b.mode != null && b.mode !in setOf("push_to_talk", "continuous")) throw bad("mode debe ser push_to_talk o continuous")
        val v = cur.copy(language = b.language ?: cur.language, voiceName = b.voiceName ?: cur.voiceName, speechRate = range(b.speechRate, 0.5, 2.0, "speech_rate") ?: cur.speechRate,
            pitch = range(b.pitch, 0.5, 2.0, "pitch") ?: cur.pitch, volume = range(b.volume, 0.0, 1.0, "volume") ?: cur.volume, mode = b.mode ?: cur.mode,
            autoSpeak = b.autoSpeak ?: cur.autoSpeak, bargeIn = b.bargeIn ?: cur.bargeIn, wakeWordEnabled = b.wakeWordEnabled ?: cur.wakeWordEnabled,
            wakeWord = b.wakeWord?.also { if (it.trim().length < 3) throw bad("La palabra de activación debe tener al menos 3 letras") } ?: cur.wakeWord,
            wakeWordConsentAt = if (b.wakeWordConsent == true) nowIso() else cur.wakeWordConsentAt, saveTranscripts = b.saveTranscripts ?: cur.saveTranscripts,
            transcriptRetentionDays = b.transcriptRetentionDays?.coerceIn(0, 365) ?: cur.transcriptRetentionDays, subtitles = b.subtitles ?: cur.subtitles,
            processing = "local", storeAudio = false)
        saveSettings(settings().copy(voice = v)); j(v)
    }
    route("POST", "/voice/transcriptions") { _, _ -> throw LocalError(400, "no_stt_model", "En el modo local el reconocimiento de voz se hace en el teléfono.") }
    route("POST", "/voice/synthesis") { _, _ -> throw LocalError(400, "no_tts_model", "En el modo local la voz la genera el teléfono.") }
}

private suspend fun LocalBackend.composeDraft(b: DraftBody): DraftDto {
    val text = b.text.trim()
    if (text.isEmpty()) throw bad("No hay texto para mejorar")
    if (text.length > 4000) throw bad("El mensaje supera 4000 caracteres")
    val guide = mapOf("informal" to "informal y cercano, como entre amigos", "formal" to "formal y respetuoso", "amistoso" to "amable y cálido",
        "breve" to "lo más breve posible sin perder el sentido", "profesional" to "profesional, claro y cortés",
        "explicativo" to "claro y explicativo, con el detalle necesario", "original" to "igual al original; solo corregí errores")
    var instruction = when (b.mode) {
        "tone" -> "Reescribí el mensaje con un tono ${guide[b.tone ?: "original"] ?: guide.getValue("original")}."
        "correct" -> "Corregí ortografía, puntuación y gramática sin cambiar el estilo."
        "translate" -> "Traducí el mensaje al idioma ${(b.targetLanguage ?: throw bad("Indicá el idioma de destino")).take(30)} con naturalidad."
        "direct" -> "El texto está en estilo indirecto (lo que el usuario quiere que se le diga a alguien). Convertilo en el mensaje directo que va a recibir el destinatario."
        else -> throw bad("Modo inválido: tone, correct, translate, direct")
    }
    if (b.mode != "translate") instruction += if (settings().voice.language.startsWith("es-AR")) " Español rioplatense con voseo." else " Español neutro."
    val who = b.recipientFirstName?.let { "\nEl destinatario se llama ${it.take(40)} (podés usarlo en el saludo si corresponde)." } ?: ""
    val system = "Sos el redactor de mensajes de NEXUS. Reescribís el mensaje que el usuario quiere mandar.\nReglas estrictas:\n" +
        "- No agregues hechos, fechas, horarios, lugares, montos, nombres ni promesas que no estén en el original.\n- Conservá el significado y la intención.\n" +
        "- Escribís el mensaje tal como lo leerá el destinatario (en primera persona del usuario).\n- Devolvé SOLO el texto final del mensaje, sin comillas ni comentarios."
    val (r, model) = complete(system, listOf(ChatMsg("user", "$instruction$who\n\nMensaje original:\n<<<\n$text\n>>>")), 900, "compose", null)
    val out = r.text.trim().trim('"', '«', '»').trim()
    if (out.isEmpty()) throw bad("El modelo no devolvió texto")
    return DraftDto(out, text, b.mode, b.tone, model)
}

internal fun LocalBackend.jarvisState(): JarvisStateDto {
    expireActions()
    val ag = agents()
    val nexus = ag.firstOrNull { it.d.slug == "nexus" }
    val acts = actions()
    val pending = acts.count { it.a.status == "awaiting_confirmation" }
    val now = Instant.now()
    val executing = acts.count { it.a.status == "executing" || (it.a.status == "ready" && (it.a.expiresAt == null || Instant.parse(it.a.expiresAt).isAfter(now))) }
    val runningTasks = store.all(C.TASKS, TaskDto.serializer()).count { it.status == "running" }
    val collaborating = ag.filter { it.d.slug != "nexus" && it.d.status == "collaborating" }.map { it.d.slug }
    val emergency = settings().settings.emergencyStop
    val recentError = nexus?.d?.status == "error" && nexus.d.lastActivityAt?.let { Instant.parse(it).isAfter(now.minusSeconds(300)) } == true
    val state = when {
        emergency -> "stopped"; nexus?.d?.status == "thinking" -> "thinking"; collaborating.isNotEmpty() -> "collaborating"
        pending > 0 -> "waiting_confirmation"; executing > 0 || runningTasks > 0 -> "executing"; recentError -> "error"; else -> "idle"
    }
    val system = when { emergency -> "STOPPED"; pending > 0 -> "WAITING_USER"; runningTasks > 0 || executing > 0 -> "EXECUTING"; running.isNotEmpty() -> "PROCESSING"; else -> "IDLE" }
    return JarvisStateDto(state, system, emergency, 1, pending, 0, runningTasks, running.size, collaborating,
        ag.filter { it.d.status in setOf("working", "thinking") }.map { it.d.slug }, nexus?.d?.status)
}

private fun LocalBackend.jarvisContext(timezone: String?): JarvisContextDto {
    val s = settings()
    val tz = zone(timezone)
    val nowLocal = ZonedDateTime.now(tz)
    val now = Instant.now()
    val pending = actions().count { it.a.status == "awaiting_confirmation" && (it.a.expiresAt == null || Instant.parse(it.a.expiresAt).isAfter(now)) }
    val missions = store.all(C.MISSIONS, MissionRec.serializer())
    val running = missions.count { it.m.status in LocalBackend.RUNNING_MISSION }
    val blocked = missions.count { it.m.status == "blocked" }
    val since = s.lastSeenAt ?: now.minus(24, ChronoUnit.HOURS).toString()
    val finished = missions.filter { it.m.status == "completed" && (it.m.completedAt ?: "") > since }.sortedByDescending { it.m.completedAt }.take(3)
    val endOfDay = nowLocal.withHour(23).withMinute(59).withSecond(59).toInstant().toString()
    val reminders = store.all(C.SCHEDULES, ScheduleDto.serializer()).filter { it.kind == "reminder" && it.isEnabled && it.nextRunAt != null &&
        it.nextRunAt > now.toString() && it.nextRunAt <= endOfDay }.sortedBy { it.nextRunAt }.take(3)
    val unread = store.all(C.NOTIFS, NotificationDto.serializer()).count { it.readAt == null }
    val autos = store.all(C.AUTOS, AutomationRec.serializer()).count { it.a.status == "active" }
    val hour = nowLocal.hour
    val greeting = if (hour in 5..12) "Buen día" else if (hour in 13..19) "Buenas tardes" else "Buenas noches"
    val first = user().name.split(" ").first().takeIf { it.isNotBlank() && it != "Usuario" }
    val lines = mutableListOf<String>()
    if (s.settings.emergencyStop) lines += "STOP ALL está activo: los agentes y las rutinas están detenidos."
    if (pending > 0) lines += "Tenés $pending ${if (pending == 1) "acción" else "acciones"} esperando tu confirmación."
    if (finished.isNotEmpty()) lines += if (finished.size == 1) "Terminé «${finished[0].m.title}»." else "Terminé ${finished.size} misiones desde tu última visita."
    if (blocked > 0) lines += "$blocked ${if (blocked == 1) "misión quedó bloqueada y necesita" else "misiones quedaron bloqueadas y necesitan"} revisión."
    if (running > 0) lines += "Estoy trabajando en $running ${if (running == 1) "misión" else "misiones"}."
    reminders.firstOrNull()?.let { r -> lines += "Hoy a las ${ZonedDateTime.parse(r.nextRunAt!!.replace("Z", "+00:00")).withZoneSameInstant(tz).format(HM)}: ${r.payload.str("title") ?: r.name}." }
    if (!modelsAvailable()) lines += "Modo local activo. Para conversar conmigo configurá un proveedor de IA (hay opciones gratis) en Más → Ajustes."
    val headline = "$greeting${first?.let { ", $it" } ?: ""}."
    saveSettings(s.copy(lastSeenAt = now.toString()))
    val conv = convs().filter { it.kind == "jarvis" }.maxByOrNull { it.c.updatedAt }
    return JarvisContextDto(headline, headline + (lines.firstOrNull()?.let { " $it" } ?: " ¿Qué hacemos hoy?"), lines, tz.id,
        ContextCounts(pending, 0, running, blocked, finished.size, reminders.size, unread, autos),
        finished.map { IdTitle(it.m.id, it.m.title) }, reminders.map { ReminderItem(it.id, it.payload.str("title") ?: it.name, it.nextRunAt!!) },
        conv?.c?.id, NexusJson.decodeFromJsonElement(JarvisPrefs.serializer(), s.jarvis))
}

// ------------------------------------------------------------ STOP ALL

internal fun LocalBackend.emergencyStop(reason: String?): JsonObject {
    val s = settings()
    saveSettings(s.copy(settings = s.settings.copy(emergencyStop = true, emergencyStopReason = reason ?: "Detenido por el usuario")))
    var cancelled = 0
    actions().filter { it.a.status in setOf("awaiting_confirmation", "ready") }.forEach {
        store.put(C.ACTIONS, it.a.id, ActionRec.serializer(), it.copy(a = it.a.copy(status = "cancelled", stateDetail = "CANCELLED", completedAt = nowIso(), error = "Cancelada por STOP ALL")))
        cancelled++
    }
    running.keys.filter { it.startsWith("reply:") }.forEach { cancelRequested += it.removePrefix("reply:") }
    val jobs = running.values.toList()
    jobs.forEach { it.cancel() }
    var paused = 0
    store.all(C.MISSIONS, MissionRec.serializer()).filter { it.m.status in LocalBackend.RUNNING_MISSION || it.m.status == "pending" }.forEach {
        store.put(C.MISSIONS, it.m.id, MissionRec.serializer(), it.copy(m = it.m.copy(status = "paused", statusReason = "STOP ALL"), updatedAt = nowIso())); paused++
    }
    store.all(C.AUTOS, AutomationRec.serializer()).filter { it.a.status == "active" }.forEach {
        store.put(C.AUTOS, it.a.id, AutomationRec.serializer(), it.copy(a = it.a.copy(status = "paused", pausedByStop = true)))
    }
    agents().forEach { setAgentStatus(it.d.id, "paused", "STOP ALL") }
    activity("system.emergency_stop", "STOP ALL activado", "info", actor = "user")
    emit("system.emergency_stop", buildJsonObject { put("active", true) })
    return buildJsonObject { put("emergency_stop", true); put("missions_paused", paused); put("actions_cancelled", cancelled); put("jobs_cancelled", jobs.size) }
}

internal fun LocalBackend.clearEmergencyStop(resume: Boolean): JsonObject {
    val s = settings()
    saveSettings(s.copy(settings = s.settings.copy(emergencyStop = false, emergencyStopReason = null)))
    agents().forEach { setAgentStatus(it.d.id, "idle") }
    store.all(C.AUTOS, AutomationRec.serializer()).filter { it.a.pausedByStop }.forEach {
        store.put(C.AUTOS, it.a.id, AutomationRec.serializer(), it.copy(a = it.a.copy(status = "active", pausedByStop = false, nextRunAt = nextRunFor(it.a))))
    }
    var resumed = 0
    if (resume) store.all(C.MISSIONS, MissionRec.serializer()).filter { it.m.status == "paused" && it.m.statusReason == "STOP ALL" }.forEach { resumeMission(it.m.id); resumed++ }
    emit("system.emergency_stop", buildJsonObject { put("active", false) })
    return buildJsonObject { put("emergency_stop", false); put("missions_resumed", resumed) }
}


private val VIDEO_SYSTEM = """Sos NOVA, directora de arte de NEXUS. Escribís guiones de videos 2D animados verticales (9:16) que se dibujan con código.
Devolvé SOLO un JSON con esta forma, sin explicaciones:
{"background":"#0A1A2E","scenes":[{"duration":3,"background":"#0A1A2E","elements":[
 {"type":"text","text":"...","x":0.5,"y":0.4,"size":0.08,"color":"#FFFFFF","bold":true,"anim":"slide_up","delay":0.2,"dur":0.8},
 {"type":"rect","x":0.5,"y":0.7,"w":0.6,"h":0.01,"color":"#1ED6FF","radius":0.005,"anim":"grow_x","delay":0.5,"dur":0.6},
 {"type":"circle","x":0.5,"y":0.2,"r":0.08,"color":"#FF5FB0","anim":"pulse"}]}]}
Reglas: x, y, w, h, r y size son proporciones (0 a 1) del ancho/alto; el texto se dibuja con su línea base en y (usá y entre 0.15 y 0.85).
Animaciones: fade, slide_up, slide_down, slide_left, slide_right, zoom, grow_x, pulse, bounce, typewriter, none.
Entre 3 y 8 escenas de 2 a 5 segundos (máximo 40 s en total). Textos cortos y legibles (size entre 0.05 y 0.11), buen contraste, paleta coherente.
Primera escena: gancho. Última: cierre o llamado a la acción. No inventes datos que el usuario no dio."""

/** Escribe el guion con el modelo, lo dibuja y exporta a MP4, y deja el envío listo (con confirmación). */
internal suspend fun LocalBackend.createVideo(convId: String, topic: String) {
    val nexus = nexus()
    val nova = agentBySlug("nova") ?: nexus
    setAgentStatus(nova.d.id, "working", "Armando un video")
    publishState("executing", convId, stage = "execution", detail = "video")
    try {
        val (r, model) = complete(VIDEO_SYSTEM, listOf(ChatMsg("user", "Tema y mensaje del video: $topic")), 3500, "video", nova)
        val script = VideoStudio.parse(extractJson(r.text) ?: throw bad("El modelo no devolvió un guion válido; probá de nuevo."))
        val dir = java.io.File(context.cacheDir, "videos").apply { mkdirs() }
        dir.listFiles()?.sortedBy { it.lastModified() }?.dropLast(5)?.forEach { it.delete() } // no acumular videos viejos
        val file = java.io.File(dir, "nexus_${System.currentTimeMillis()}.mp4")
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.Default) {
            val job = coroutineContext[kotlinx.coroutines.Job]
            VideoStudio.render(script, file, shouldStop = { settings().settings.emergencyStop || job?.isActive == false })
        }
        val a = propose("device.share_video", buildJsonObject { put("path", file.absolutePath); put("title", topic.take(60)); put("target", "any") },
            "Compartir video: ${topic.take(80)}", "jarvis", convId)
        recordMessage("chat", convId, "Listo el video «${topic.take(60)}» (${script.scenes.size} escenas, ${script.totalSeconds.toInt()} s). " +
            "Confirmá para abrir el menú de compartir y mandarlo por WhatsApp, Instagram o donde quieras.", "agent", nova.d.id, model = model,
            meta = buildJsonObject { put("kind", "action_proposal"); put("action_id", a.a.id); put("video", file.name) })
        notify("video", "Tu video está listo", topic.take(80), mapOf("route" to "home"))
    } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Throwable) {
        recordMessage("chat", convId, "No pude armar el video: ${e.message ?: e.javaClass.simpleName}", "system", messageType = "error")
    } finally {
        setAgentStatus(nova.d.id, "idle")
        publishState("idle", convId, stage = "response")
    }
}
