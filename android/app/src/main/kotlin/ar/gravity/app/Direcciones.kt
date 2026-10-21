package ar.gravity.app

import android.content.Context
import android.net.Uri
import java.util.Locale

/** Guarda y valida la dirección del Gravity que corre en la compu. */
object Direcciones {
    private const val ARCHIVO = "gravity"
    private const val CLAVE_DIRECCION = "direccion"
    private const val CLAVE_MANIJA = "manija_posicion"

    sealed interface Revision {
        data class Valida(val url: String) : Revision
        data class Invalida(val mensaje: Int) : Revision
    }

    private fun preferencias(contexto: Context) =
        contexto.getSharedPreferences(ARCHIVO, Context.MODE_PRIVATE)

    fun leer(contexto: Context): String? =
        preferencias(contexto).getString(CLAVE_DIRECCION, null)?.takeIf { it.isNotBlank() }

    fun guardar(contexto: Context, url: String) {
        preferencias(contexto).edit().putString(CLAVE_DIRECCION, url).apply()
    }

    fun leerPosicionManija(contexto: Context): Float =
        preferencias(contexto).getFloat(CLAVE_MANIJA, 0.42f)

    fun guardarPosicionManija(contexto: Context, fraccion: Float) {
        preferencias(contexto).edit().putFloat(CLAVE_MANIJA, fraccion).apply()
    }

    /**
     * Acepta "http://..." o "https://...". Si falta el esquema (por ejemplo "192.168.0.10:3001")
     * agrega "http://". Devuelve la dirección lista para cargar o el mensaje de error.
     */
    fun revisar(texto: String): Revision {
        var limpio = texto.trim()
        if (limpio.isEmpty()) return Revision.Invalida(R.string.error_vacia)
        if (limpio.any { it.isWhitespace() }) return Revision.Invalida(R.string.error_invalida)

        val tieneEsquema = Regex("^[A-Za-z][A-Za-z0-9+.-]*://").containsMatchIn(limpio)
        if (!tieneEsquema) {
            // "mailto:x", "javascript:x"... no son direcciones de Gravity.
            if (Regex("^[A-Za-z][A-Za-z0-9+.-]*:[^0-9]").containsMatchIn(limpio)) {
                return Revision.Invalida(R.string.error_esquema)
            }
            limpio = "http://$limpio"
        }

        val uri = Uri.parse(limpio)
        val esquema = uri.scheme?.lowercase(Locale.ROOT)
        if (esquema != "http" && esquema != "https") return Revision.Invalida(R.string.error_esquema)
        val host = uri.host
        if (host.isNullOrBlank() || host.contains("..")) return Revision.Invalida(R.string.error_invalida)
        if (uri.port != -1 && uri.port !in 1..65535) return Revision.Invalida(R.string.error_invalida)

        // "http://compu:3001/" -> "http://compu:3001"
        if (uri.path == "/" && uri.query == null && uri.fragment == null) limpio = limpio.dropLast(1)
        return Revision.Valida(limpio)
    }

    /** Host de la dirección, en minúsculas, para decidir qué enlaces quedan dentro de la app. */
    fun host(url: String): String? = Uri.parse(url).host?.lowercase(Locale.ROOT)
}
