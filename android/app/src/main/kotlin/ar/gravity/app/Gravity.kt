package ar.gravity.app

import android.content.Context
import java.io.File
import java.io.RandomAccessFile
import java.security.SecureRandom

/**
 * Lo que comparten la pantalla (proceso principal) y el motor (proceso ":motor").
 * Todo va en archivos chicos: SharedPreferences no se lleva bien entre dos procesos.
 */
object Gravity {
    /** Puerto local del motor. Solo escucha en 127.0.0.1: desde afuera del celular no se llega. */
    const val PUERTO = 38471
    const val DIRECCION = "http://127.0.0.1:$PUERTO"

    private fun carpeta(contexto: Context): File = contexto.noBackupFilesDir

    /**
     * Secreto que la app le pasa al motor al arrancarlo. La WebView lo manda en la cookie
     * gravity_app: así ninguna otra app del celular puede usar el puerto local.
     */
    @Synchronized
    fun token(contexto: Context): String {
        val archivo = File(carpeta(contexto), "token")
        archivo.takeIf { it.exists() }?.readText()?.trim()?.takeIf { it.length >= 32 }?.let { return it }
        val bytes = ByteArray(32).also { SecureRandom().nextBytes(it) }
        val nuevo = bytes.joinToString("") { "%02x".format(it) }
        escribir(archivo, nuevo)
        return nuevo
    }

    fun escribir(archivo: File, texto: String) {
        val temporal = File(archivo.parentFile, archivo.name + ".tmp")
        temporal.writeText(texto)
        if (!temporal.renameTo(archivo)) {
            archivo.writeText(texto)
            temporal.delete()
        }
    }

    /** Lo que imprime el motor (console.log y errores). */
    fun registro(contexto: Context): File = File(carpeta(contexto), "motor.log")

    /** Últimas líneas del registro, para mostrar si el motor no arranca. */
    fun finDelRegistro(contexto: Context, lineas: Int = 25): String {
        val archivo = registro(contexto)
        if (!archivo.exists()) return ""
        return try {
            RandomAccessFile(archivo, "r").use { r ->
                val desde = (r.length() - 16_384).coerceAtLeast(0)
                r.seek(desde)
                val bytes = ByteArray((r.length() - desde).toInt())
                r.readFully(bytes)
                String(bytes, Charsets.UTF_8).lines().filter { it.isNotBlank() }.takeLast(lineas).joinToString("\n")
            }
        } catch (e: Exception) {
            ""
        }
    }

    /** Lo apagaste desde la app: no se vuelve a prender solo (al reiniciar el celu o por una rutina). */
    fun apagadoAMano(contexto: Context): Boolean = File(carpeta(contexto), "apagado").exists()

    fun marcarApagado(contexto: Context, apagado: Boolean) {
        val archivo = File(carpeta(contexto), "apagado")
        if (apagado) archivo.writeText("1") else archivo.delete()
    }

    /** La pantalla de Gravity está a la vista: el motor no avisa aprobaciones con notificaciones. */
    fun pantallaVisible(contexto: Context): Boolean = File(carpeta(contexto), "visible").exists()

    fun marcarVisible(contexto: Context, visible: Boolean) {
        val archivo = File(carpeta(contexto), "visible")
        try {
            if (visible) archivo.writeText("1") else archivo.delete()
        } catch (e: Exception) {
            // No es grave: a lo sumo llega una notificación de más.
        }
    }
}
