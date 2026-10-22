package ar.gravity.app

import android.content.Context
import android.os.SystemClock
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Pedidos de la app al motor local (http://127.0.0.1) con el header x-gravity-token. Antes de mandar el
 * token se verifica que del otro lado esté nuestro motor ([Gravity.motorAutentico]); el resultado se
 * recuerda un rato para no repetir el reto en cada consulta, y se olvida apenas falla un pedido.
 */
object MotorLocal {
    class Respuesta(val codigo: Int, val cuerpo: String) {
        val ok: Boolean get() = codigo in 200..299
    }

    private const val VIGENCIA_MS = 60_000L

    @Volatile
    private var verificadoEn = 0L

    /** true si el motor responde y es el nuestro. */
    fun disponible(contexto: Context): Boolean {
        if (verificadoEn != 0L && SystemClock.elapsedRealtime() - verificadoEn < VIGENCIA_MS) return true
        val ok = Gravity.motorAutentico(contexto)
        verificadoEn = if (ok) SystemClock.elapsedRealtime() else 0L
        return ok
    }

    fun olvidar() {
        verificadoEn = 0L
    }

    /** null si el motor no está (o no es el nuestro) o se cortó la conexión. */
    fun pedir(contexto: Context, metodo: String, ruta: String, cuerpo: JSONObject? = null, esperaMs: Int = 8_000): Respuesta? {
        if (!disponible(contexto)) return null
        return try {
            val conexion = URL("${Gravity.DIRECCION}$ruta").openConnection() as HttpURLConnection
            try {
                conexion.requestMethod = metodo
                conexion.connectTimeout = 2_000
                conexion.readTimeout = esperaMs
                conexion.useCaches = false
                conexion.instanceFollowRedirects = false
                conexion.setRequestProperty("x-gravity-token", Gravity.token(contexto))
                conexion.setRequestProperty("Accept", "application/json")
                if (cuerpo != null) {
                    val bytes = cuerpo.toString().toByteArray(Charsets.UTF_8)
                    conexion.doOutput = true
                    // El motor exige JSON en todo pedido que no sea GET (defensa contra CSRF).
                    conexion.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    conexion.setFixedLengthStreamingMode(bytes.size)
                    conexion.outputStream.use { it.write(bytes) }
                }
                val codigo = conexion.responseCode
                val flujo = if (codigo in 200..299) conexion.inputStream else conexion.errorStream
                val texto = flujo?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }.orEmpty()
                Respuesta(codigo, texto)
            } finally {
                conexion.disconnect()
            }
        } catch (e: Exception) {
            olvidar()
            null
        }
    }
}
