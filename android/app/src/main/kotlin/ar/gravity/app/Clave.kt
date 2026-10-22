package ar.gravity.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Las claves de los modelos (Gemini, Anthropic y el respaldo gratis de Mistral). Se guardan cifradas
 * (AES-256-GCM) con una llave del Android Keystore, que no se puede sacar del celular; los archivos
 * quedan fuera de las copias de seguridad.
 */
object Clave {
    const val GEMINI = "gemini"
    const val ANTHROPIC = "anthropic"
    const val MISTRAL = "mistral"

    private const val ALIAS = "gravity_clave_anthropic"

    private fun archivo(contexto: Context, nombre: String) =
        File(contexto.noBackupFilesDir, if (nombre == ANTHROPIC) "clave.bin" else "clave-$nombre.bin")

    private fun llave(): SecretKey {
        val almacen = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (almacen.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generador = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generador.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generador.generateKey()
    }

    /** Qué modelo usan los compañeros: Gemini (gratis, por defecto) o Claude de Anthropic. */
    fun proveedor(contexto: Context): String {
        val elegido = File(contexto.noBackupFilesDir, "proveedor").takeIf { it.exists() }?.readText()?.trim()
        if (elegido == GEMINI || elegido == ANTHROPIC) return elegido
        // Instalaciones de antes de poder elegir: si ya había clave de Anthropic, sigue con esa.
        return if (existe(contexto, ANTHROPIC)) ANTHROPIC else GEMINI
    }

    fun elegirProveedor(contexto: Context, proveedor: String) {
        Gravity.escribir(File(contexto.noBackupFilesDir, "proveedor"), proveedor)
    }

    /** Hay clave para el modelo elegido: el motor puede arrancar. */
    fun lista(contexto: Context): Boolean = existe(contexto, proveedor(contexto))

    fun existe(contexto: Context, nombre: String): Boolean = archivo(contexto, nombre).exists()

    fun guardar(contexto: Context, nombre: String, clave: String) {
        val cifrador = Cipher.getInstance("AES/GCM/NoPadding")
        cifrador.init(Cipher.ENCRYPT_MODE, llave())
        val cifrado = cifrador.doFinal(clave.toByteArray(Charsets.UTF_8))
        val iv = cifrador.iv
        val datos = byteArrayOf(iv.size.toByte()) + iv + cifrado
        val destino = archivo(contexto, nombre)
        val temporal = File(destino.parentFile, "${destino.name}.tmp")
        temporal.writeBytes(datos)
        if (!temporal.renameTo(destino)) {
            destino.writeBytes(datos)
            temporal.delete()
        }
    }

    /** null si no hay clave o si no se puede descifrar (por ejemplo, si se borró la llave del Keystore). */
    fun leer(contexto: Context, nombre: String): String? {
        val datos = archivo(contexto, nombre).takeIf { it.exists() }?.readBytes() ?: return null
        return try {
            val largoIv = datos[0].toInt()
            val iv = datos.copyOfRange(1, 1 + largoIv)
            val cifrador = Cipher.getInstance("AES/GCM/NoPadding")
            cifrador.init(Cipher.DECRYPT_MODE, llave(), GCMParameterSpec(128, iv))
            String(cifrador.doFinal(datos, 1 + largoIv, datos.size - 1 - largoIv), Charsets.UTF_8)
        } catch (e: Exception) {
            null
        }
    }

    /** Revisión liviana: la clave de verdad la valida el proveedor la primera vez que un compañero trabaja. */
    fun revisar(texto: String): Int? {
        val limpia = texto.trim()
        return when {
            limpia.isEmpty() -> R.string.clave_vacia
            limpia.any { it.isWhitespace() } || limpia.length < 20 -> R.string.clave_invalida
            else -> null
        }
    }
}
