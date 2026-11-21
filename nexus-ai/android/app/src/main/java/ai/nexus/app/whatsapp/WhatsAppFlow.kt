package ai.nexus.app.whatsapp

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** Estados del Messaging Engine (capítulo 4). No existe un estado "enviado": no es verificable. */
enum class WaState { DRAFT_CREATED, CONTACT_RESOLVED, AWAITING_CONFIRMATION, READY_TO_OPEN, WHATSAPP_OPENED, CANCELLED, ERROR }

interface ContactSource {
    fun resolve(query: String): Resolution
    fun save(contact: SavedContact)
    fun markUsed(id: String)
}

data class WaDraft(
    val actionId: String? = null,
    val recipientQuery: String? = null,
    val contact: SavedContact? = null,
    val candidates: List<SavedContact> = emptyList(),
    val phone: PhoneResult? = null,
    val text: String = "",
    val tone: String? = null,
    val state: WaState = WaState.DRAFT_CREATED,
    val needsPick: Boolean = false,
    val assumptionsAccepted: Boolean = false,
    val error: String? = null,
    val preferBusiness: Boolean = false,
) {
    val recipientName: String? get() = contact?.label ?: recipientQuery
    val readyToConfirm: Boolean get() = phone?.usable == true && (phone.status == "ok" || assumptionsAccepted) &&
        state in setOf(WaState.CONTACT_RESOLVED, WaState.AWAITING_CONFIRMATION)
}

/**
 * Flujo: borrador → resolver contacto (local) → validar número → vista previa → confirmar →
 * abrir WhatsApp. Cancelar y volver a preparar es posible en cualquier punto previo a abrir.
 */
class WhatsAppFlow(private val contacts: ContactSource, private val defaultAreaCode: () -> String? = { null }) {
    private val _draft = MutableStateFlow(WaDraft())
    val draft: StateFlow<WaDraft> = _draft
    private fun set(f: (WaDraft) -> WaDraft) { _draft.value = f(_draft.value) }

    fun start(actionId: String?, recipientQuery: String?, phone: String?, text: String, tone: String? = null, contactLabel: String? = null) {
        _draft.value = WaDraft(actionId = actionId, recipientQuery = recipientQuery ?: contactLabel, text = text, tone = tone)
        when {
            !phone.isNullOrBlank() -> setPhone(phone, contactLabel)
            !recipientQuery.isNullOrBlank() -> resolve(recipientQuery)
            else -> set { it.copy(needsPick = true) }
        }
    }

    private fun resolve(query: String) {
        when (val r = contacts.resolve(query)) {
            is Resolution.Resolved -> choose(r.contact)
            is Resolution.Ambiguous -> set { it.copy(candidates = r.candidates, needsPick = false) }
            Resolution.NotFound -> set { it.copy(needsPick = true, error = null) }
        }
    }

    fun choose(contact: SavedContact) {
        val phone = PhoneNormalizer.normalize(contact.phone, defaultAreaCode())
        set { it.copy(contact = contact, candidates = emptyList(), needsPick = false, phone = phone, state = stateFor(phone), error = errorFor(phone)) }
    }

    /** Contacto elegido en el selector nativo. Si el usuario lo pidió, se guarda con alias (local, cifrado). */
    fun picked(name: String, number: String, saveAlias: String?) {
        val contact = SavedContact(id = "pick-${number.filter { it.isDigit() }}", label = name.ifBlank { number }, phone = number,
            aliases = listOfNotNull(saveAlias?.trim()?.takeIf { it.isNotEmpty() }))
        if (saveAlias != null) contacts.save(contact)
        choose(contact)
    }

    fun setPhone(input: String, label: String? = null) {
        val phone = PhoneNormalizer.normalize(input, defaultAreaCode())
        val contact = SavedContact(id = "manual-${input.filter { it.isDigit() }}", label = label ?: phone.masked ?: input, phone = input)
        set { it.copy(contact = contact, needsPick = false, candidates = emptyList(), phone = phone, state = stateFor(phone), error = errorFor(phone)) }
    }

    fun withAreaCode(area: String) {
        val current = _draft.value.contact ?: return
        val phone = PhoneNormalizer.normalize(current.phone, area)
        set { it.copy(phone = phone, state = stateFor(phone), error = errorFor(phone)) }
    }

    fun acceptAssumptions() = set { it.copy(assumptionsAccepted = true, state = if (it.phone?.usable == true) WaState.AWAITING_CONFIRMATION else it.state) }
    fun setText(text: String) = set { it.copy(text = text.take(4000)) }
    fun setTone(tone: String?) = set { it.copy(tone = tone) }
    fun setBusiness(prefer: Boolean) = set { it.copy(preferBusiness = prefer) }

    private fun stateFor(p: PhoneResult) = when {
        p.status == "ok" -> WaState.AWAITING_CONFIRMATION
        p.usable -> WaState.CONTACT_RESOLVED
        p.status == "invalid" -> WaState.ERROR
        else -> WaState.DRAFT_CREATED
    }

    private fun errorFor(p: PhoneResult) = if (p.status == "invalid" || p.status == "needs_area_code") p.message else null

    /** Tras confirmar en el servidor (o sin servidor, en una acción rápida): listo para abrir. */
    fun confirmed(): Boolean {
        val d = _draft.value
        if (!d.readyToConfirm) return false
        set { it.copy(state = WaState.READY_TO_OPEN) }
        return true
    }

    fun opened() {
        _draft.value.contact?.let { if (!it.id.startsWith("manual-") && !it.id.startsWith("pick-")) contacts.markUsed(it.id) }
        set { it.copy(state = WaState.WHATSAPP_OPENED) }
    }

    fun failed(message: String) = set { it.copy(state = WaState.ERROR, error = message) }
    fun cancel() = set { it.copy(state = WaState.CANCELLED) }

    /** Volver a preparar después de cancelar: conserva destinatario y texto. */
    fun reprepare() = set {
        it.copy(actionId = null, state = when {
            it.phone?.status == "ok" -> WaState.AWAITING_CONFIRMATION
            it.phone?.usable == true -> WaState.CONTACT_RESOLVED
            else -> WaState.DRAFT_CREATED
        }, error = null)
    }

    /** Lo que se le dice al usuario en cada estado. Nunca afirma que el mensaje se envió. */
    fun statusMessage(): String = when (_draft.value.state) {
        WaState.DRAFT_CREATED -> "Elegí el destinatario."
        WaState.CONTACT_RESOLVED -> "Revisá el número antes de seguir."
        WaState.AWAITING_CONFIRMATION -> "Revisá el mensaje y confirmá para abrir WhatsApp."
        WaState.READY_TO_OPEN -> "Abriendo WhatsApp…"
        WaState.WHATSAPP_OPENED -> "WhatsApp quedó abierto con el mensaje listo. Para mandarlo, tocá Enviar en WhatsApp."
        WaState.CANCELLED -> "Cancelado. No se abrió WhatsApp."
        WaState.ERROR -> _draft.value.error ?: "No se pudo preparar el mensaje."
    }
}
