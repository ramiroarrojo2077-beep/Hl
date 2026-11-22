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
import ai.nexus.app.data.model.VoicePrefs
import ai.nexus.app.local.LocalBackend
import ai.nexus.app.local.LocalInterceptor
import ai.nexus.app.local.LocalLlm
import ai.nexus.app.local.LocalScheduler
import ai.nexus.app.local.LocalStore
import ai.nexus.app.local.isLocalUrl
import ai.nexus.app.local.communityIncoming
import ai.nexus.app.local.recover
import ai.nexus.app.local.tick
import ai.nexus.app.push.NotificationHelper
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import ai.nexus.app.voice.AndroidRecognizer
import ai.nexus.app.voice.AndroidSpeaker
import ai.nexus.app.voice.RemoteRecognizer
import ai.nexus.app.voice.TtsManager
import ai.nexus.app.voice.VoiceEngine
import ai.nexus.app.whatsapp.ContactBook
import kotlinx.coroutines.flow.MutableStateFlow
import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.serialization.KSerializer
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/** Frase reconocida por voz (con datos de interrupción si cortó una respuesta). */
data class Utterance(val text: String, val interruptedMessageId: String?, val spokenChars: Int?)

/** Inyección de dependencias manual: un único grafo para toda la app. */
class AppContainer(context: Context, private val crypto: SecretBox = CryptoBox()) {
    val appContext: Context = context.applicationContext
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    val session = SessionStore(appContext, scope, crypto)

    private val _sessionExpired = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val sessionExpired: SharedFlow<Unit> = _sessionExpired

    val http: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(LocalInterceptor { localBackend })
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
        localEvents = { if (isLocalUrl(session.serverUrl())) localBackend.events else null },
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

    // ------------------------------------------------------------ modo local (sin servidor)
    /** Cliente para hablar directo con los proveedores de IA (respuestas largas con streaming). */
    private val llmHttp: OkHttpClient by lazy {
        OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(180, TimeUnit.SECONDS).writeTimeout(60, TimeUnit.SECONDS).build()
    }

    /** Backend completo dentro del teléfono: datos en SQLite local y modelos llamados directo con la clave del usuario. */
    val localBackend: LocalBackend by lazy {
        LocalBackend(appContext, LocalStore(appContext), LocalLlm(llmHttp), crypto, scope).also { b ->
            b.notifier = { n ->
                val foreground = (appContext as? NexusApplication)?.isInForeground == true
                if (n.eventType == "reminder" || !foreground) {
                    NotificationHelper.show(appContext, n)
                    scope.launch { session.setLastNotificationSeen(n.createdAt) }
                }
            }
            b.scheduleWake = { delay -> LocalScheduler.wakeIn(appContext, delay) }
            b.waSender = { chat, text -> ai.nexus.app.actions.WaReplyBridge.reply(appContext, chat, text) }
            ai.nexus.app.actions.WaReplyBridge.onMessage = { chat, text -> b.communityIncoming(chat, text) }
        }
    }

    private var localTicker: Job? = null

    /** Arranca el trabajo del modo local: retoma misiones, programa la revisión periódica y un reloj mientras la app está abierta. */
    fun startLocalRuntime() {
        scope.launch {
            if (!isLocalUrl(session.serverUrl())) return@launch
            runCatching { localBackend.recover() } // también deja listos los puentes de WhatsApp
            realtime.start() // en modo local los eventos salen del propio teléfono: no hay red que cuidar
            LocalScheduler.periodic(appContext)
            if (localTicker?.isActive != true) localTicker = scope.launch {
                while (isActive) { delay(20_000); if (isLocalUrl(session.serverUrl())) runCatching { localBackend.tick() } }
            }
        }
    }

    suspend fun isLocalMode(): Boolean = isLocalUrl(session.serverUrl())

    // ------------------------------------------------------------ NEXUS 2.0
    /** Contactos que el usuario eligió guardar en NEXUS (cifrados, solo en el teléfono). */
    val contacts by lazy { ContactBook(appContext, crypto) }

    /** Señal de la palabra de activación (servicio en primer plano → app). */
    val wakeSignals = MutableSharedFlow<Unit>(extraBufferCapacity = 1)

    /** Preferencias de voz vigentes (se sincronizan con /voice/settings). */
    val voicePrefs = MutableStateFlow(VoicePrefs())

    /** Respuestas habladas y reconocimiento; se crea en el hilo principal la primera vez que se usa. */
    private var _voice: VoiceEngine? = null
    private val utterances = MutableSharedFlow<Utterance>(extraBufferCapacity = 4)
    val voiceUtterances: SharedFlow<Utterance> = utterances
    private val androidRecognizer by lazy { AndroidRecognizer(appContext) }

    fun voice(): VoiceEngine = _voice ?: VoiceEngine(
        recognizer = {
            val p = voicePrefs.value
            if (p.processing == "remote" && p.remote.stt.available) RemoteRecognizer(appContext, api, scope) else androidRecognizer
        },
        speaker = AndroidSpeaker(appContext),
        onUtterance = { text, interrupted, chars -> utterances.tryEmit(Utterance(text, interrupted, chars)) },
    ).also { it.prefs = voicePrefs.value; _voice = it }

    fun onDeviceRecognition(): Boolean = androidRecognizer.onDeviceAvailable()

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
