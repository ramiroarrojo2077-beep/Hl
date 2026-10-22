package ar.gravity.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.provider.OpenableColumns
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.util.Locale

/**
 * Recibe lo que compartís a Gravity desde otras apps (texto, enlaces, imágenes, videos, PDF) y se lo
 * pasa al motor: los archivos se copian a la computadora compartida (mismo proceso/UID) y después la
 * web los muestra en /#/compartido/<id>. Pantalla translúcida: no se ve, solo trabaja y abre Gravity.
 */
class Compartir : Activity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val entrante = intent
        if (entrante == null) {
            finish()
            return
        }
        Thread {
            val id = try {
                compartir(entrante)
            } catch (e: Exception) {
                null
            }
            runOnUiThread {
                if (id != null) {
                    abrirGravity(id)
                } else {
                    Toast.makeText(applicationContext, getString(R.string.compartir_fallo), Toast.LENGTH_LONG).show()
                }
                finish()
            }
        }.start()
    }

    /** Devuelve el id del primer elemento compartido con éxito, o null si no se pudo nada. */
    private fun compartir(entrante: Intent): String? {
        if (!asegurarMotor()) return null
        return when (entrante.action) {
            Intent.ACTION_SEND -> {
                val uri = sacarStream(entrante, Intent.EXTRA_STREAM)
                if (uri != null) {
                    compartirArchivo(uri)
                } else {
                    compartirTexto(entrante.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString())
                }
            }
            Intent.ACTION_SEND_MULTIPLE -> {
                val uris = sacarStreams(entrante)
                var primero: String? = null
                for (uri in uris) {
                    val id = compartirArchivo(uri)
                    if (primero == null) primero = id
                }
                primero ?: compartirTexto(entrante.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString())
            }
            else -> null
        }
    }

    // ---------------------------------------------------------------- Texto y enlaces

    private fun compartirTexto(texto: String?): String? {
        val limpio = texto?.trim().orEmpty()
        if (limpio.isEmpty()) return null
        val cuerpo = JSONObject()
        if (esEnlace(limpio)) {
            cuerpo.put("tipo", "enlace").put("url", limpio)
        } else {
            cuerpo.put("tipo", "texto").put("texto", limpio.take(100_000))
        }
        return postear(cuerpo)
    }

    private fun esEnlace(texto: String): Boolean {
        val uri = try {
            Uri.parse(texto)
        } catch (e: Exception) {
            return false
        }
        val esquema = uri.scheme?.lowercase(Locale.ROOT)
        return (esquema == "http" || esquema == "https") && !texto.any { it == ' ' || it == '\n' }
    }

    // ---------------------------------------------------------------- Archivos

    private fun compartirArchivo(uri: Uri): String? {
        val nombre = sanearNombre(nombreDeUri(uri))
        val carpeta = File(File(File(filesDir, "gravity"), "computadora"), "compartidos").apply { mkdirs() }
        val destino = archivoLibre(carpeta, nombre)
        val copiados = copiar(uri, destino)
        if (copiados <= 0L) {
            destino.delete()
            return null
        }
        val cuerpo = JSONObject()
            .put("tipo", "archivo")
            .put("ruta", "compartidos/${destino.name}")
            .put("nombre", nombre)
            .put("mime", contentResolver.getType(uri) ?: "application/octet-stream")
        val id = postear(cuerpo)
        if (id == null) destino.delete()
        return id
    }

    /** Copia el contenido de la uri al destino. Devuelve los bytes copiados, o 0 si falló o se pasó del tope. */
    private fun copiar(uri: Uri, destino: File): Long {
        return try {
            contentResolver.openInputStream(uri)?.use { entrada ->
                destino.outputStream().use { salida ->
                    val buffer = ByteArray(64 * 1024)
                    var total = 0L
                    while (true) {
                        val leidos = entrada.read(buffer)
                        if (leidos < 0) break
                        total += leidos
                        if (total > MAX_BYTES) return 0L
                        salida.write(buffer, 0, leidos)
                    }
                    total
                }
            } ?: 0L
        } catch (e: Exception) {
            0L
        }
    }

    private fun nombreDeUri(uri: Uri): String {
        if (uri.scheme == "content") {
            try {
                contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                    if (c.moveToFirst() && c.columnCount > 0) {
                        val nombre = c.getString(0)
                        if (!nombre.isNullOrBlank()) return nombre
                    }
                }
            } catch (e: Exception) {
                // Sin nombre: se usa el del final de la uri.
            }
        }
        return uri.lastPathSegment?.substringAfterLast('/') ?: "archivo"
    }

    /** Deja solo letras, números, punto, guion y guion bajo; evita nombres vacíos o de solo puntos. */
    private fun sanearNombre(crudo: String): String {
        val base = crudo.substringAfterLast('/').substringAfterLast('\\').trim()
        val limpio = base.map { if (it.isLetterOrDigit() || it == '.' || it == '-' || it == '_') it else '_' }
            .joinToString("")
            .trimStart('.')
            .take(120)
        return limpio.ifBlank { "archivo" }
    }

    private fun archivoLibre(carpeta: File, nombre: String): File {
        var candidato = File(carpeta, nombre)
        if (!candidato.exists()) return candidato
        val punto = nombre.lastIndexOf('.')
        val raiz = if (punto > 0) nombre.substring(0, punto) else nombre
        val ext = if (punto > 0) nombre.substring(punto) else ""
        var n = 1
        while (candidato.exists() && n < 10_000) {
            candidato = File(carpeta, "$raiz-$n$ext")
            n++
        }
        return candidato
    }

    // ---------------------------------------------------------------- Motor y navegación

    /** Si el motor no está, lo prende y espera a que responda (hasta ~30 s). */
    private fun asegurarMotor(): Boolean {
        if (MotorLocal.disponible(this)) return true
        try {
            Gravity.marcarApagado(this, false)
            Motor.enviar(this, Motor.ACCION_INICIAR)
        } catch (e: Exception) {
            return false
        }
        val hasta = SystemClock.elapsedRealtime() + 30_000
        while (SystemClock.elapsedRealtime() < hasta) {
            MotorLocal.olvidar()
            if (MotorLocal.disponible(this)) return true
            SystemClock.sleep(600)
        }
        return false
    }

    private fun postear(cuerpo: JSONObject): String? {
        val respuesta = MotorLocal.pedir(this, "POST", "/api/compartido", cuerpo, esperaMs = 15_000) ?: return null
        if (!respuesta.ok) return null
        return try {
            JSONObject(respuesta.cuerpo).optString("id").takeIf { it.isNotEmpty() }
        } catch (e: Exception) {
            null
        }
    }

    private fun abrirGravity(id: String) {
        val intent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .putExtra(EXTRA_COMPARTIDO, id)
        startActivity(intent)
    }

    private fun sacarStream(intent: Intent, nombre: String): Uri? {
        @Suppress("DEPRECATION")
        return if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(nombre, Uri::class.java)
        } else {
            intent.getParcelableExtra(nombre)
        }
    }

    private fun sacarStreams(intent: Intent): List<Uri> {
        @Suppress("DEPRECATION")
        val lista: ArrayList<Uri>? = if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
        }
        return lista.orEmpty()
    }

    companion object {
        /** Extra con el id de lo compartido: [MainActivity] abre /#/compartido/<id> cuando lo recibe. */
        const val EXTRA_COMPARTIDO = "ar.gravity.app.COMPARTIDO"
        private const val MAX_BYTES = 200L * 1024 * 1024
    }
}
