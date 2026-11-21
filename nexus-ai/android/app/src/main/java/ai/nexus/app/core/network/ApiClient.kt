package ai.nexus.app.core.network

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class ApiException(val status: Int, val code: String, override val message: String) : Exception(message) {
    val isNetwork get() = status == 0
    val isUnauthorized get() = status == 401
}

/** Origen de credenciales; la implementación real usa SessionStore. */
interface TokenProvider {
    suspend fun baseUrl(): String
    suspend fun accessToken(): String?
    suspend fun refreshToken(): String?
    suspend fun onTokens(access: String, refresh: String)
    suspend fun onSessionExpired()
}

val NexusJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
    coerceInputValues = true
}

private val JSON_TYPE = "application/json; charset=utf-8".toMediaType()

suspend fun Call.await(): Response = suspendCancellableCoroutine { cont ->
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) { if (!cont.isCancelled) cont.resumeWithException(e) }
        override fun onResponse(call: Call, response: Response) = cont.resume(response)
    })
    cont.invokeOnCancellation { runCatching { cancel() } }
}

class ApiClient(val http: OkHttpClient, private val tokens: TokenProvider, val json: Json = NexusJson) {
    private val refreshMutex = Mutex()

    suspend fun raw(
        method: String,
        path: String,
        body: String? = null,
        query: Map<String, String?> = emptyMap(),
        auth: Boolean = true,
        requestBody: RequestBody? = null,
    ): String {
        val first = execute(method, path, body, query, auth, requestBody, tokens.accessToken())
        if (first.first != 401 || !auth) return handle(first)
        val usedToken = first.third
        val refreshed = refreshMutex.withLock {
            val current = tokens.accessToken()
            if (current != null && current != usedToken) return@withLock current // otro hilo ya renovó
            refresh()
        } ?: throw ApiException(401, "session_expired", "Tu sesión expiró. Iniciá sesión de nuevo.")
        return handle(execute(method, path, body, query, auth, requestBody, refreshed))
    }

    private suspend fun refresh(): String? {
        val refreshToken = tokens.refreshToken() ?: run { tokens.onSessionExpired(); return null }
        val payload = """{"refresh_token":${JsonPrimitive(refreshToken)}}"""
        val (status, text, _) = execute("POST", "/auth/refresh", payload, emptyMap(), false, null, null)
        if (status != 200) {
            tokens.onSessionExpired()
            return null
        }
        val obj = json.parseToJsonElement(text).jsonObject
        val access = obj["access_token"]!!.jsonPrimitive.content
        tokens.onTokens(access, obj["refresh_token"]!!.jsonPrimitive.content)
        return access
    }

    private suspend fun execute(
        method: String, path: String, body: String?, query: Map<String, String?>, auth: Boolean,
        requestBody: RequestBody?, token: String?,
    ): Triple<Int, String, String?> {
        val base = tokens.baseUrl().trimEnd('/')
        val url = ("$base/api/v1$path").toHttpUrlOrNull()?.newBuilder()?.apply {
            query.forEach { (k, v) -> if (v != null) addQueryParameter(k, v) }
        }?.build() ?: throw ApiException(0, "invalid_url", "La dirección del servidor no es válida: $base")
        val reqBody = requestBody ?: body?.toRequestBody(JSON_TYPE)
            ?: if (method in setOf("POST", "PUT", "PATCH")) "{}".toRequestBody(JSON_TYPE) else null
        val request = Request.Builder().url(url).method(method, reqBody).apply {
            header("accept", "application/json")
            if (auth && token != null) header("authorization", "Bearer $token")
        }.build()
        return try {
            http.newCall(request).await().use { resp -> Triple(resp.code, resp.body?.string().orEmpty(), token) }
        } catch (e: IOException) {
            throw ApiException(0, "network", "No se pudo conectar con el servidor NEXUS (${e.javaClass.simpleName}).")
        }
    }

    private fun handle(result: Triple<Int, String, String?>): String {
        val (status, text, _) = result
        if (status in 200..299) return text.ifBlank { "{}" }
        throw parseError(status, text)
    }

    fun parseError(status: Int, text: String): ApiException {
        val fallback = when (status) {
            401 -> "Sesión inválida."
            403 -> "No tenés permiso para esta operación."
            404 -> "No encontrado."
            429 -> "Demasiadas solicitudes. Esperá un momento."
            in 500..599 -> "Error del servidor ($status)."
            else -> "Error ($status)."
        }
        return try {
            val obj = json.parseToJsonElement(text).jsonObject
            val code = obj["error"]?.jsonPrimitive?.contentOrNull ?: "http_$status"
            val message = obj["message"]?.jsonPrimitive?.contentOrNull
                ?: when (val detail = obj["detail"]) {
                    is JsonPrimitive -> detail.contentOrNull
                    is JsonArray -> detail.firstOrNull()?.jsonObject?.get("msg")?.jsonPrimitive?.contentOrNull
                    is JsonObject -> detail.toString()
                    else -> null
                }
            ApiException(status, code, message ?: fallback)
        } catch (_: Exception) {
            ApiException(status, "http_$status", fallback)
        }
    }

    suspend inline fun <reified T> get(path: String, query: Map<String, String?> = emptyMap()): T =
        json.decodeFromString(raw("GET", path, query = query))

    suspend inline fun <reified B, reified T> post(path: String, body: B, auth: Boolean = true): T =
        json.decodeFromString(raw("POST", path, json.encodeToString(body), auth = auth))

    suspend inline fun <reified T> postEmpty(path: String, query: Map<String, String?> = emptyMap()): T =
        json.decodeFromString(raw("POST", path, query = query))

    suspend inline fun <reified B, reified T> patch(path: String, body: B): T =
        json.decodeFromString(raw("PATCH", path, json.encodeToString(body)))

    suspend inline fun <reified B, reified T> put(path: String, body: B): T =
        json.decodeFromString(raw("PUT", path, json.encodeToString(body)))

    suspend fun delete(path: String, query: Map<String, String?> = emptyMap()) {
        raw("DELETE", path, query = query)
    }

    /** Verifica que la URL apunte a un servidor NEXUS (sin autenticación). */
    suspend fun health(baseUrl: String): Pair<Boolean, Long> {
        val started = System.currentTimeMillis()
        val url = "${baseUrl.trimEnd('/')}/health".toHttpUrlOrNull() ?: return false to 0
        return try {
            http.newCall(Request.Builder().url(url).build()).await().use { resp ->
                (resp.isSuccessful && resp.body?.string().orEmpty().contains("\"ok\"")) to (System.currentTimeMillis() - started)
            }
        } catch (_: IOException) {
            false to 0
        }
    }
}
