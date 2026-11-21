package ai.nexus.app.whatsapp

/**
 * Normalización de números para WhatsApp (Argentina primero). Misma lógica que
 * backend/app/integrations/whatsapp/phone.py; ambas se prueban con shared/phone_vectors_ar.json.
 *
 * Formato de WhatsApp para celulares argentinos: 54 9 <área sin 0> <número sin 15> (área+número = 10).
 * Si el número es ambiguo, el resultado lo dice y la app pregunta antes de continuar.
 */
data class PhoneResult(
    val input: String,
    val status: String, // ok | needs_confirmation | needs_area_code | invalid
    val e164: String? = null,
    val display: String? = null,
    val masked: String? = null,
    val country: String? = null,
    val assumptions: List<String> = emptyList(),
    val message: String = "",
) {
    val usable get() = (status == "ok" || status == "needs_confirmation") && e164 != null
}

object PhoneNormalizer {
    private val AREA_CODES_3 = setOf(
        "220", "221", "223", "230", "236", "237", "249", "260", "261", "263", "264", "266", "280", "291", "294", "297",
        "298", "299", "336", "341", "342", "343", "345", "348", "351", "353", "358", "362", "364", "370", "376", "379",
        "380", "381", "383", "385", "387", "388",
    )

    fun areaLength(national10: String): Int = when {
        national10.startsWith("11") -> 2
        national10.take(3) in AREA_CODES_3 -> 3
        else -> 4
    }

    fun mask(e164: String): String {
        if (e164.startsWith("549") && e164.length == 13) {
            val national = e164.substring(3)
            val a = areaLength(national)
            return "+54 9 ${national.take(a)} ****-${national.takeLast(4)}"
        }
        return if (e164.length > 6) "+" + "*".repeat(e164.length - 4) + e164.takeLast(4) else "****"
    }

    fun display(e164: String): String {
        if (e164.startsWith("549") && e164.length == 13) {
            val national = e164.substring(3)
            val a = areaLength(national)
            val local = national.substring(a)
            return "+54 9 ${national.take(a)} ${local.dropLast(4)}-${local.takeLast(4)}"
        }
        return "+$e164"
    }

    private fun strip15(national: String): String? {
        for (a in 2..4) {
            val area = national.take(a)
            if (a == 2 && area != "11") continue
            if (a == 3 && area !in AREA_CODES_3) continue
            if (national.length >= a + 2 && national.substring(a, a + 2) == "15") {
                val candidate = area + national.substring(a + 2)
                if (candidate.length == 10) return candidate
            }
        }
        return null
    }

    private fun ok(raw: String, national10: String, assumptions: List<String>): PhoneResult {
        val e164 = "549$national10"
        return PhoneResult(raw, if (assumptions.isEmpty()) "ok" else "needs_confirmation", e164, display(e164), mask(e164), "AR", assumptions,
            if (assumptions.isEmpty()) "" else "Verificá el número antes de seguir.")
    }

    private fun areaNeeded(raw: String, local: String, defaultArea: String?, assumptions: List<String>): PhoneResult {
        val area = (defaultArea ?: "").trimStart('0')
        if (area.isNotEmpty() && area.all { it.isDigit() } && (area + local).length == 10) {
            return ok(raw, area + local, assumptions + "Usé tu código de área predeterminado ($area).")
        }
        return PhoneResult(raw, "needs_area_code", country = "AR", assumptions = assumptions,
            message = "Falta el código de área. ¿De qué ciudad es el número?")
    }

    fun normalize(raw: String?, defaultAreaCode: String? = null): PhoneResult {
        val text = (raw ?: "").trim()
        if (text.isEmpty()) return PhoneResult(raw ?: "", "invalid", message = "No hay número")
        if (text.any { it.isLetter() }) return PhoneResult(text, "invalid", message = "El número tiene letras")
        var plus = text.startsWith("+")
        var digits = text.filter { it.isDigit() }
        if (digits.startsWith("00")) { digits = digits.substring(2); plus = true }
        if (plus || (digits.startsWith("54") && digits.length in 12..14)) {
            if (!digits.startsWith("54")) {
                return if (digits.length in 8..15) PhoneResult(text, "ok", digits, "+$digits", mask(digits), "other",
                    message = "Número internacional: se usa tal cual.")
                else PhoneResult(text, "invalid", message = "Longitud de número internacional inválida")
            }
            var rest = digits.substring(2)
            if (rest.startsWith("9")) {
                rest = rest.substring(1)
                if (rest.length == 10) return ok(text, rest, emptyList())
                if (rest.length == 12) strip15(rest)?.let { return ok(text, it, listOf("Quité el 15: en formato internacional no va.")) }
                if (rest.length == 11 && rest.startsWith("0")) return ok(text, rest.substring(1), listOf("Quité el 0 del código de área."))
                return PhoneResult(text, "invalid", message = "El número argentino no tiene la longitud esperada")
            }
            if (rest.startsWith("0")) rest = rest.substring(1)
            if (rest.length == 12) strip15(rest)?.let { return ok(text, it, listOf("Quité el 15 y agregué el 9 de celular.")) }
            if (rest.length == 10) return ok(text, rest, listOf("Agregué el 9 de celular: WhatsApp lo necesita para móviles argentinos. Si es un fijo, no va a funcionar."))
            return PhoneResult(text, "invalid", message = "El número argentino no tiene la longitud esperada")
        }
        if (digits.startsWith("0")) {
            val national = digits.substring(1)
            if (national.length == 12) strip15(national)?.let { return ok(text, it, emptyList()) }
            if (national.length == 10) return ok(text, national, listOf("No tiene 15: asumí que es un celular."))
            return PhoneResult(text, "invalid", message = "El número nacional no tiene la longitud esperada")
        }
        if (digits.length == 12) strip15(digits)?.let { return ok(text, it, emptyList()) }
        if (digits.length == 10) {
            if (digits.startsWith("15")) return areaNeeded(text, digits.substring(2), defaultAreaCode, listOf("Quité el 15."))
            return ok(text, digits, listOf("Asumí que es un celular con código de área."))
        }
        if (digits.length in 6..8) return areaNeeded(text, digits, defaultAreaCode, emptyList())
        return PhoneResult(text, "invalid", message = "No reconozco el formato del número")
    }

    /** Enlace oficial Click to Chat. */
    fun waLink(e164: String, text: String): String =
        if (text.isBlank()) "https://wa.me/$e164" else "https://wa.me/$e164?text=" + java.net.URLEncoder.encode(text, "UTF-8").replace("+", "%20")
}
