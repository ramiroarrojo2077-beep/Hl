package ai.nexus.app.core.realtime

import ai.nexus.app.core.network.NexusJson
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import kotlin.math.min
import kotlin.random.Random

data class RealtimeEvent(val type: String, val data: JsonObject, val ts: String?, val id: String? = null) {
    fun str(key: String): String? = (data[key] as? JsonPrimitive)?.contentOrNull
}

sealed interface ConnectionState {
    data object Disconnected : ConnectionState
    data object Connecting : ConnectionState
    data object Connected : ConnectionState
    data class Reconnecting(val attempt: Int, val inSeconds: Int) : ConnectionState
    data object Unauthorized : ConnectionState
}

/** Ventana de ids ya entregados: tras una reconexión ningún evento se procesa dos veces. */
class EventDeduplicator(private val capacity: Int = 512) {
    private val seen = LinkedHashSet<String>()

    @Synchronized fun firstTime(id: String?): Boolean {
        if (id == null) return true
        if (!seen.add(id)) return false
        if (seen.size > capacity) seen.remove(seen.first())
        return true
    }
}

/** Calcula la espera de reconexión: exponencial con tope y jitter. */
fun backoffSeconds(attempt: Int, random: Random = Random.Default): Int {
    val base = min(30, 1 shl min(attempt, 5))
    return (base * (0.75 + random.nextDouble() * 0.5)).toInt().coerceAtLeast(1)
}

fun parseEvent(text: String): RealtimeEvent? = try {
    val obj = NexusJson.parseToJsonElement(text).jsonObject
    val type = obj["type"]?.jsonPrimitive?.contentOrNull
    if (type == null) null else RealtimeEvent(type, (obj["data"] as? JsonObject) ?: JsonObject(emptyMap()), obj["ts"]?.jsonPrimitive?.contentOrNull,
        obj["id"]?.jsonPrimitive?.contentOrNull)
} catch (_: Exception) {
    null
}

/**
 * Canal WebSocket con el backend: autentica con el primer mensaje (el token no viaja en la
 * URL), reconecta solo con backoff y publica los eventos reales del servidor.
 */
class RealtimeClient(
    private val http: OkHttpClient,
    private val scope: CoroutineScope,
    private val baseUrl: suspend () -> String,
    private val accessToken: suspend () -> String?,
    private val refreshAccess: suspend () -> Boolean,
    /** Modo local: eventos del backend dentro del teléfono (sin WebSocket). Devuelve null en modo servidor. */
    private val localEvents: suspend () -> SharedFlow<String>? = { null },
) {
    private val dedupe = EventDeduplicator()

    private val _events = MutableSharedFlow<RealtimeEvent>(extraBufferCapacity = 256)
    val events: SharedFlow<RealtimeEvent> = _events
    private val _state = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    val state: StateFlow<ConnectionState> = _state

    private var socket: WebSocket? = null
    private var loop: Job? = null
    private var wanted = false

    fun start() {
        if (wanted && loop?.isActive == true) return
        wanted = true
        loop = scope.launch { runLoop() }
    }

    fun stop() {
        wanted = false
        loop?.cancel()
        socket?.close(1000, "cliente en segundo plano")
        socket = null
        _state.value = ConnectionState.Disconnected
    }

    fun restart() {
        stop(); start()
    }

    private suspend fun runLoop() {
        var attempt = 0
        while (scope.isActive && wanted) {
            val token = accessToken()
            if (token == null) {
                _state.value = ConnectionState.Disconnected
                return
            }
            localEvents()?.let { flow ->
                _state.value = ConnectionState.Connected
                flow.collect { text -> parseEvent(text)?.let { if (dedupe.firstTime(it.id)) _events.tryEmit(it) } }
                return
            }
            _state.value = ConnectionState.Connecting
            val closed = kotlinx.coroutines.CompletableDeferred<Int>()
            val wsUrl = baseUrl().trimEnd('/').replaceFirst("http", "ws") + "/api/v1/ws"
            socket = http.newWebSocket(Request.Builder().url(wsUrl).build(), object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    webSocket.send("""{"type":"auth","token":${JsonPrimitive(token)}}""")
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    val obj = runCatching { NexusJson.parseToJsonElement(text).jsonObject }.getOrNull() ?: return
                    when (obj["type"]?.jsonPrimitive?.contentOrNull) {
                        "ready" -> { attempt = 0; _state.value = ConnectionState.Connected }
                        "pong" -> Unit
                        else -> parseEvent(text)?.let { if (dedupe.firstTime(it.id)) _events.tryEmit(it) }
                    }
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(code, null)
                    closed.complete(code)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    closed.complete(-1)
                }
            })
            val pinger = scope.launch {
                while (isActive) { delay(25_000); socket?.send("""{"type":"ping"}""") }
            }
            val code = closed.await()
            pinger.cancel()
            if (!wanted) return
            if (code == 4401) {
                // Token vencido o sesión cerrada: se intenta renovar una vez.
                if (!refreshAccess()) {
                    _state.value = ConnectionState.Unauthorized
                    return
                }
                continue
            }
            attempt += 1
            val wait = backoffSeconds(attempt)
            _state.value = ConnectionState.Reconnecting(attempt, wait)
            delay(wait * 1000L)
        }
    }
}
