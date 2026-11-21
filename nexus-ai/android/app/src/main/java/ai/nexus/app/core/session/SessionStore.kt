package ai.nexus.app.core.session

import ai.nexus.app.BuildConfig
import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

private val Context.dataStore by preferencesDataStore(name = "nexus_session")

/** Cifrado de secretos locales. La implementación de producción usa el Android Keystore. */
interface SecretBox {
    fun encrypt(plain: String): String
    fun decrypt(encoded: String): String?
}

/** Cifrado AES-GCM con una clave no exportable del Android Keystore. */
class CryptoBox(private val alias: String = "nexus_session_key") : SecretBox {
    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    override fun encrypt(plain: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val data = cipher.doFinal(plain.toByteArray())
        return Base64.encodeToString(cipher.iv + data, Base64.NO_WRAP)
    }

    override fun decrypt(encoded: String): String? = try {
        val raw = Base64.decode(encoded, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw.copyOfRange(0, 12)))
        String(cipher.doFinal(raw.copyOfRange(12, raw.size)))
    } catch (_: Exception) {
        null
    }
}

data class Session(
    val serverUrl: String,
    val accessToken: String,
    val refreshToken: String,
    val userId: String,
    val email: String,
    val displayName: String,
)

data class LocalPrefs(
    val serverUrl: String,
    val animations: Boolean,
    val glow: Boolean,
    val lastNotificationSeen: String?,
)

/** Sesión y preferencias locales. Los tokens se guardan cifrados; nunca hay credenciales de IA en el APK. */
class SessionStore(private val context: Context, scope: CoroutineScope, private val crypto: SecretBox = CryptoBox()) {
    private object Keys {
        val server = stringPreferencesKey("server_url")
        val access = stringPreferencesKey("access_enc")
        val refresh = stringPreferencesKey("refresh_enc")
        val userId = stringPreferencesKey("user_id")
        val email = stringPreferencesKey("email")
        val name = stringPreferencesKey("display_name")
        val animations = booleanPreferencesKey("animations")
        val glow = booleanPreferencesKey("glow")
        val lastSeen = stringPreferencesKey("last_notification_seen")
    }

    private fun toSession(p: Preferences): Session? {
        val access = p[Keys.access]?.let(crypto::decrypt) ?: return null
        val refresh = p[Keys.refresh]?.let(crypto::decrypt) ?: return null
        return Session(serverUrl(p), access, refresh, p[Keys.userId].orEmpty(), p[Keys.email].orEmpty(), p[Keys.name].orEmpty())
    }

    private fun serverUrl(p: Preferences) = p[Keys.server] ?: BuildConfig.DEFAULT_SERVER_URL

    val session: StateFlow<Session?> = context.dataStore.data.map(::toSession).stateIn(scope, SharingStarted.Eagerly, null)

    val prefs: StateFlow<LocalPrefs> = context.dataStore.data.map {
        LocalPrefs(serverUrl(it), it[Keys.animations] ?: true, it[Keys.glow] ?: true, it[Keys.lastSeen])
    }.stateIn(scope, SharingStarted.Eagerly, LocalPrefs(BuildConfig.DEFAULT_SERVER_URL, true, true, null))

    suspend fun current(): Session? = toSession(context.dataStore.data.first())
    suspend fun serverUrl(): String = serverUrl(context.dataStore.data.first())

    suspend fun saveLogin(serverUrl: String, access: String, refresh: String, userId: String, email: String, name: String) {
        context.dataStore.edit {
            it[Keys.server] = serverUrl.trimEnd('/')
            it[Keys.access] = crypto.encrypt(access)
            it[Keys.refresh] = crypto.encrypt(refresh)
            it[Keys.userId] = userId
            it[Keys.email] = email
            it[Keys.name] = name
        }
    }

    suspend fun updateTokens(access: String, refresh: String) {
        context.dataStore.edit {
            it[Keys.access] = crypto.encrypt(access)
            it[Keys.refresh] = crypto.encrypt(refresh)
        }
    }

    suspend fun updateDisplayName(name: String) = context.dataStore.edit { it[Keys.name] = name }
    suspend fun setServerUrl(url: String) = context.dataStore.edit { it[Keys.server] = url.trimEnd('/') }
    suspend fun setAnimations(enabled: Boolean) = context.dataStore.edit { it[Keys.animations] = enabled }
    suspend fun setGlow(enabled: Boolean) = context.dataStore.edit { it[Keys.glow] = enabled }
    suspend fun setLastNotificationSeen(createdAt: String) = context.dataStore.edit { it[Keys.lastSeen] = createdAt }

    suspend fun clear() {
        context.dataStore.edit {
            it.remove(Keys.access); it.remove(Keys.refresh); it.remove(Keys.userId); it.remove(Keys.email); it.remove(Keys.name)
        }
    }
}
