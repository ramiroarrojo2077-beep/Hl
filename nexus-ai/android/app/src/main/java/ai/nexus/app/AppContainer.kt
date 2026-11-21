package ai.nexus.app

import ai.nexus.app.core.network.ApiClient
import ai.nexus.app.core.network.ApiException
import ai.nexus.app.core.network.NexusJson
import ai.nexus.app.core.network.TokenProvider
import ai.nexus.app.core.realtime.RealtimeClient
import ai.nexus.app.core.session.CryptoBox
import ai.nexus.app.core.session.SecretBox
import ai.nexus.app.core.session.SessionStore
import ai.nexus.app.data.api.NexusApi
import ai.nexus.app.data.cache.CacheDb
import ai.nexus.app.data.cache.CachedResponse
import ai.nexus.app.voice.TtsManager
import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.serialization.KSerializer
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/** Inyección de dependencias manual: un único grafo para toda la app. */
class AppContainer(context: Context, crypto: SecretBox = CryptoBox()) {
    val appContext: Context = context.applicationContext
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val session = SessionStore(appContext, scope, crypto)

    private val _sessionExpired = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val sessionExpired: SharedFlow<Unit> = _sessionExpired

    val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(60, TimeUnit.SECONDS)
        .pingInterval(20, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val tokens = object : TokenProvider {
        override suspend fun baseUrl() = session.serverUrl()
        override suspend fun accessToken() = session.current()?.accessToken
        override suspend fun refreshToken() = session.current()?.refreshToken
        override suspend fun onTokens(access: String, refresh: String) = session.updateTokens(access, refresh).let { }
        override suspend fun onSessionExpired() {
            session.clear()
            _sessionExpired.tryEmit(Unit)
        }
    }

    val apiClient = ApiClient(http, tokens, NexusJson)
    val api = NexusApi(apiClient)
    val cacheDb = CacheDb.create(appContext)

    val realtime = RealtimeClient(
        http = http,
        scope = scope,
        baseUrl = { session.serverUrl() },
        accessToken = { session.current()?.accessToken },
        refreshAccess = {
            try {
                api.settings() // cualquier llamada autenticada fuerza la renovación del token
                true
            } catch (e: ApiException) {
                !e.isUnauthorized
            }
        },
    )

    val tts by lazy { TtsManager(appContext) }

    /** Lee de la caché local (para mostrar algo de inmediato o sin conexión). */
    suspend fun <T> cached(key: String, serializer: KSerializer<T>): T? = try {
        cacheDb.cache().get(key)?.let { NexusJson.decodeFromString(serializer, it.json) }
    } catch (_: Exception) {
        null
    }

    suspend fun <T> store(key: String, serializer: KSerializer<T>, value: T) {
        cacheDb.cache().put(CachedResponse(key, NexusJson.encodeToString(serializer, value), System.currentTimeMillis()))
    }
}
