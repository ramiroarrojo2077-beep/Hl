package ai.nexus.app.whatsapp

import ai.nexus.app.core.network.NexusJson
import ai.nexus.app.core.session.SecretBox
import android.content.Context
import android.net.Uri
import android.provider.ContactsContract
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.text.Normalizer

/**
 * Contact Manager (local). NEXUS NO lee la agenda completa ni pide READ_CONTACTS:
 * - El usuario elige un contacto con el selector nativo (ACTION_PICK), que solo da acceso
 *   temporal a ESE contacto.
 * - Solo si el usuario lo decide, se guarda en NEXUS con alias ("papá"), cifrado en el
 *   teléfono (Keystore). Nunca se sube al servidor ni se envía a modelos de IA.
 * - "Frecuentes" = conteo local de uso de esos contactos guardados.
 */
@Serializable
data class SavedContact(
    val id: String,
    val label: String,
    val phone: String,
    val aliases: List<String> = emptyList(),
    val favorite: Boolean = false,
    val uses: Int = 0,
    val lastUsedAt: Long = 0,
)

sealed interface Resolution {
    data class Resolved(val contact: SavedContact, val score: Double) : Resolution
    data class Ambiguous(val candidates: List<SavedContact>) : Resolution
    data object NotFound : Resolution
}

object ContactResolver {
    private val SYNONYMS = mapOf(
        "papa" to listOf("papa", "papi", "viejo", "mi viejo", "pa", "padre"),
        "mama" to listOf("mama", "mami", "vieja", "mi vieja", "ma", "madre"),
        "hermano" to listOf("hermano", "brother", "bro", "hermanito"),
        "hermana" to listOf("hermana", "hermanita", "sis"),
        "abuelo" to listOf("abuelo", "abu", "nono", "abuelito"),
        "abuela" to listOf("abuela", "abu", "nona", "abuelita"),
        "novio" to listOf("novio", "amor", "gordo"),
        "novia" to listOf("novia", "amor", "gorda"),
        "esposo" to listOf("esposo", "marido"),
        "esposa" to listOf("esposa", "mujer", "señora"),
        "jefe" to listOf("jefe", "jefa", "boss"),
    )

    fun fold(text: String): String {
        val s = Normalizer.normalize(text, Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "").lowercase().trim()
        return s.replace(Regex("^(?:a\\s+)?(?:mi|mis|el|la|los|las)\\s+"), "").replace(Regex("\\s+"), " ").trim()
    }

    private fun forms(term: String): Set<String> {
        val f = fold(term)
        val out = mutableSetOf(f)
        for ((canon, words) in SYNONYMS) {
            val folded = words.map { fold(it) }
            if (f == canon || f in folded) { out += canon; out += folded }
        }
        return out
    }

    fun score(query: String, contact: SavedContact): Double {
        val q = fold(query)
        val qForms = forms(query)
        var best = 0.0
        for (name in listOf(contact.label) + contact.aliases) {
            val n = fold(name)
            if (n.isEmpty()) continue
            if (n == q) return 1.0
            if (n in qForms) best = maxOf(best, 0.97)
            if (q == n.substringBefore(' ')) best = maxOf(best, 0.9)
            if (q.isNotEmpty() && (n.startsWith("$q ") || n.contains(" $q"))) best = maxOf(best, 0.82)
            best = maxOf(best, similarity(q, n) * 0.85)
        }
        if (contact.favorite) best += 0.02
        return minOf(best, 1.0)
    }

    /** Ratcliff/Obershelp simplificado (equivalente a difflib.SequenceMatcher.ratio). */
    fun similarity(a: String, b: String): Double {
        if (a.isEmpty() && b.isEmpty()) return 1.0
        fun matches(x: String, y: String): Int {
            if (x.isEmpty() || y.isEmpty()) return 0
            var bestLen = 0; var bi = 0; var bj = 0
            for (i in x.indices) for (j in y.indices) {
                var k = 0
                while (i + k < x.length && j + k < y.length && x[i + k] == y[j + k]) k++
                if (k > bestLen) { bestLen = k; bi = i; bj = j }
            }
            if (bestLen == 0) return 0
            return bestLen + matches(x.substring(0, bi), y.substring(0, bj)) + matches(x.substring(bi + bestLen), y.substring(bj + bestLen))
        }
        return 2.0 * matches(a, b) / (a.length + b.length)
    }

    fun resolve(query: String, contacts: List<SavedContact>): Resolution {
        val ranked = contacts.map { it to score(query, it) }.filter { it.second >= 0.6 }.sortedByDescending { it.second }
        if (ranked.isEmpty()) return Resolution.NotFound
        val (top, s) = ranked.first()
        val close = ranked.drop(1).filter { s - it.second < 0.08 }
        if (s >= 0.9 && close.isEmpty()) return Resolution.Resolved(top, s)
        return Resolution.Ambiguous(ranked.take(5).map { it.first })
    }
}

/** Almacenamiento local cifrado de los contactos que el usuario eligió guardar en NEXUS. */
class ContactBook(context: Context, private val crypto: SecretBox) : ContactSource {
    private val prefs = context.getSharedPreferences("nexus_contacts", Context.MODE_PRIVATE)
    private val serializer = ListSerializer(SavedContact.serializer())

    @Synchronized fun all(): List<SavedContact> = try {
        prefs.getString("data", null)?.let { enc -> crypto.decrypt(enc)?.let { NexusJson.decodeFromString(serializer, it) } } ?: emptyList()
    } catch (_: Exception) {
        emptyList()
    }

    @Synchronized private fun write(list: List<SavedContact>) {
        prefs.edit().putString("data", crypto.encrypt(NexusJson.encodeToString(serializer, list))).apply()
    }

    override fun save(contact: SavedContact) = write(all().filter { it.id != contact.id } + contact)
    fun delete(id: String) = write(all().filter { it.id != id })
    fun clear() = prefs.edit().remove("data").apply()

    override fun markUsed(id: String) = write(all().map { if (it.id == id) it.copy(uses = it.uses + 1, lastUsedAt = System.currentTimeMillis()) else it })

    fun frequent(limit: Int = 5): List<SavedContact> =
        all().sortedWith(compareByDescending<SavedContact> { it.favorite }.thenByDescending { it.uses }.thenByDescending { it.lastUsedAt }).take(limit)

    override fun resolve(query: String): Resolution = ContactResolver.resolve(query, all())

    companion object {
        /** Lee nombre y número del contacto que el usuario eligió en el selector nativo (permiso temporal de ese URI). */
        fun readPicked(context: Context, uri: Uri): Pair<String, String>? = runCatching {
            context.contentResolver.query(uri, arrayOf(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER), null, null, null)?.use { c ->
                if (c.moveToFirst()) (c.getString(0) ?: "") to (c.getString(1) ?: "") else null
            }
        }.getOrNull()
    }
}
