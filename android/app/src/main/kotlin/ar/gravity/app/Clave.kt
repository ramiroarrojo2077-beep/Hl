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
 * La clave de la API de Anthropic. Se guarda cifrada (AES-256-GCM) con una llave del
 * Android Keystore, que no se puede sacar del celular; el archivo queda fuera de las copias de seguridad.
 */
object Clave {
    private const val ALIAS = "gravity_clave_anthropic"
    private const val ARCHIVO = "clave.bin"

    private fun archivo(contexto: Context) = File(contexto.noBackupFilesDir, ARCHIVO)

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

    fun existe(contexto: Context): Boolean = archivo(contexto).exists()

    fun guardar(contexto: Context, clave: String) {
        val cifrador = Cipher.getInstance("AES/GCM/NoPadding")
        cifrador.init(Cipher.ENCRYPT_MODE, llave())
        val cifrado = cifrador.doFinal(clave.toByteArray(Charsets.UTF_8))
        val iv = cifrador.iv
        val datos = byteArrayOf(iv.size.toByte()) + iv + cifrado
        val temporal = File(contexto.noBackupFilesDir, "$ARCHIVO.tmp")
        temporal.writeBytes(datos)
        if (!temporal.renameTo(archivo(contexto))) {
            archivo(contexto).writeBytes(datos)
            temporal.delete()
        }
    }

    /** null si no hay clave o si no se puede descifrar (por ejemplo, si se borró la llave del Keystore). */
    fun leer(contexto: Context): String? {
        val datos = archivo(contexto).takeIf { it.exists() }?.readBytes() ?: return null
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

    /** Revisión liviana: la clave de verdad la valida la API la primera vez que un compañero trabaja. */
    fun revisar(texto: String): Int? {
        val limpia = texto.trim()
        return when {
            limpia.isEmpty() -> R.string.clave_vacia
            limpia.any { it.isWhitespace() } || limpia.length < 20 -> R.string.clave_invalida
            else -> null
        }
    }
}
