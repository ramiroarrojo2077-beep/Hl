package ai.nexus.app.local

import ai.nexus.app.core.network.NexusJson
import ai.nexus.app.core.network.await
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

data class ChatMsg(val role: String, val content: String)
data class LlmResult(val text: String, val tokensIn: Int, val tokensOut: Int, val estimated: Boolean)

class LlmError(val status: Int, override val message: String, val transient: Boolean) : Exception(message)

/** Tipos de proveedor del modo local. Groq y OpenRouter hablan el protocolo de OpenAI. */
object LocalKinds {
    val OPENAI_LIKE = setOf("openai", "openai_compatible", "groq", "openrouter")
    val list = listOf(
        Triple("gemini", "Google Gemini (tiene plan gratis)", "https://generativelanguage.googleapis.com/v1beta"),
        Triple("groq", "Groq (tiene plan gratis)", "https://api.groq.com/openai/v1"),
        Triple("openrouter", "OpenRouter (modelos :free)", "https://openrouter.ai/api/v1"),
        Triple("openai_compatible", "Compatible con OpenAI", "https://"),
        Triple("openai", "OpenAI", "https://api.openai.com/v1"),
        Triple("anthropic", "Anthropic", "https://api.anthropic.com"),
        Triple("ollama", "Ollama (en tu red)", "http://192.168.0.10:11434"),
    )
    fun requiresKey(kind: String) = kind !in setOf("ollama", "openai_compatible")
    fun defaultUrl(kind: String) = list.firstOrNull { it.first == kind }?.third ?: ""
}

/** Llamadas directas del teléfono a la API del proveedor elegido (sin servidor intermedio). */
class LocalLlm(private val http: OkHttpClient) {
    private val jsonType = "application/json".toMediaType()

    private fun base(kind: String, url: String?) = (url?.takeIf { it.isNotBlank() } ?: LocalKinds.defaultUrl(kind)).trimEnd('/')

    private fun errorFor(code: Int, body: String): LlmError {
        val detail = runCatching {
            val o = NexusJson.parseToJsonElement(body).jsonObject
            (o["error"] as? JsonObject)?.get("message")?.jsonPrimitive?.contentOrNull ?: o["error"]?.jsonPrimitive?.contentOrNull
                ?: o["message"]?.jsonPrimitive?.contentOrNull
        }.getOrNull()
        val msg = when (code) {
            401, 403 -> "La API key no es válida o no tiene permiso (${detail ?: code})."
            404 -> "El proveedor no encontró ese modelo o esa dirección (${detail ?: code})."
            429 -> "Se alcanzó el límite del plan del proveedor. Probá en un rato o usá otro modelo."
            in 500..599 -> "El proveedor tuvo un error ($code)."
            else -> "Error del proveedor ($code): ${detail ?: body.take(200)}"
        }
        return LlmError(code, msg, code == 429 || code >= 500)
    }

    suspend fun listModels(kind: String, url: String?, key: String?): List<String> = withContext(Dispatchers.IO) {
        val b = base(kind, url)
        val req = Request.Builder().apply {
            when (kind) {
                "gemini" -> url("$b/models?pageSize=200").header("x-goog-api-key", key.orEmpty())
                "anthropic" -> url("$b/v1/models?limit=100").header("x-api-key", key.orEmpty()).header("anthropic-version", "2023-06-01")
                "ollama" -> url("$b/api/tags")
                else -> { url("$b/models"); if (!key.isNullOrBlank()) header("authorization", "Bearer $key") }
            }
        }.build()
        val resp = try { http.newCall(req).await() } catch (e: IOException) { throw LlmError(0, "No se pudo conectar con el proveedor (${e.javaClass.simpleName}).", true) }
        resp.use { r ->
            val text = r.body?.string().orEmpty()
            if (!r.isSuccessful) throw errorFor(r.code, text)
            val o = NexusJson.parseToJsonElement(text).jsonObject
            when (kind) {
                "gemini" -> o["models"]?.jsonArray.orEmpty().map { it.jsonObject }
                    .filter { m -> m["supportedGenerationMethods"]?.jsonArray?.any { it.jsonPrimitive.content == "generateContent" } != false }
                    .map { it["name"]!!.jsonPrimitive.content.removePrefix("models/") }
                "ollama" -> o["models"]?.jsonArray.orEmpty().map { it.jsonObject["name"]!!.jsonPrimitive.content }
                else -> o["data"]?.jsonArray.orEmpty().map { it.jsonObject["id"]!!.jsonPrimitive.content }
            }.sorted()
        }
    }

    /**
     * Respuesta con streaming. [onDelta] recibe cada fragmento; [shouldStop] permite cortar (barge-in, STOP ALL).
     */
    suspend fun chat(
        kind: String, url: String?, key: String?, model: String, system: String, messages: List<ChatMsg>,
        maxTokens: Int, temperature: Double?, onDelta: (suspend (String) -> Unit)? = null, shouldStop: () -> Boolean = { false },
    ): LlmResult = withContext(Dispatchers.IO) {
        val b = base(kind, url)
        val msgs = mergeRoles(messages)
        val body: JsonObject
        val req = Request.Builder()
        when (kind) {
            "gemini" -> {
                val thinking = model.contains("2.5") || model.contains("3")
                body = buildJsonObject {
                    if (system.isNotBlank()) put("systemInstruction", buildJsonObject { put("parts", buildJsonArray { add(buildJsonObject { put("text", system) }) }) })
                    put("contents", buildJsonArray {
                        msgs.forEach { m -> add(buildJsonObject {
                            put("role", if (m.role == "assistant") "model" else "user")
                            put("parts", buildJsonArray { add(buildJsonObject { put("text", m.content) }) })
                        }) }
                    })
                    put("generationConfig", buildJsonObject {
                        // Los modelos con razonamiento descuentan esos tokens del máximo: se deja margen.
                        put("maxOutputTokens", if (thinking) maxTokens + 2048 else maxTokens)
                        temperature?.let { put("temperature", it) }
                    })
                }
                req.url("$b/models/$model:streamGenerateContent?alt=sse").header("x-goog-api-key", key.orEmpty())
            }
            "anthropic" -> {
                body = buildJsonObject {
                    put("model", model); put("max_tokens", maxTokens); put("stream", true)
                    if (system.isNotBlank()) put("system", system)
                    temperature?.let { put("temperature", it) }
                    put("messages", buildJsonArray { msgs.forEach { m -> add(buildJsonObject { put("role", m.role); put("content", m.content) }) } })
                }
                req.url("$b/v1/messages").header("x-api-key", key.orEmpty()).header("anthropic-version", "2023-06-01")
            }
            "ollama" -> {
                body = buildJsonObject {
                    put("model", model); put("stream", true)
                    put("messages", buildJsonArray {
                        if (system.isNotBlank()) add(buildJsonObject { put("role", "system"); put("content", system) })
                        msgs.forEach { m -> add(buildJsonObject { put("role", m.role); put("content", m.content) }) }
                    })
                    put("options", buildJsonObject { put("num_predict", maxTokens); temperature?.let { put("temperature", it) } })
                }
                req.url("$b/api/chat")
            }
            else -> {
                body = buildJsonObject {
                    put("model", model); put("stream", true); put("max_tokens", maxTokens)
                    temperature?.let { put("temperature", it) }
                    put("messages", buildJsonArray {
                        if (system.isNotBlank()) add(buildJsonObject { put("role", "system"); put("content", system) })
                        msgs.forEach { m -> add(buildJsonObject { put("role", m.role); put("content", m.content) }) }
                    })
                }
                req.url("$b/chat/completions")
                if (!key.isNullOrBlank()) req.header("authorization", "Bearer $key")
                if (kind == "openrouter") req.header("X-Title", "NEXUS AI")
            }
        }
        val call = http.newCall(req.post(body.toString().toRequestBody(jsonType)).build())
        val resp = try { call.await() } catch (e: IOException) { throw LlmError(0, "No se pudo conectar con el proveedor (${e.javaClass.simpleName}).", true) }
        val out = StringBuilder()
        var tin = 0
        var tout = 0
        resp.use { r ->
            if (!r.isSuccessful) throw errorFor(r.code, r.body?.string().orEmpty())
            val source = r.body!!.source()
            while (true) {
                if (shouldStop()) { call.cancel(); break }
                val line = try { source.readUtf8Line() } catch (e: IOException) { if (shouldStop()) null else throw LlmError(0, "Se cortó la conexión con el proveedor.", true) } ?: break
                val data = if (kind == "ollama") line.trim() else if (line.startsWith("data:")) line.removePrefix("data:").trim() else continue
                if (data.isEmpty() || data == "[DONE]") continue
                val o = runCatching { NexusJson.parseToJsonElement(data).jsonObject }.getOrNull() ?: continue
                var delta: String? = null
                when (kind) {
                    "gemini" -> {
                        val parts = o["candidates"]?.jsonArray?.firstOrNull()?.jsonObject?.get("content")?.jsonObject?.get("parts")?.jsonArray
                        delta = parts?.mapNotNull { p -> p.jsonObject.takeIf { it["thought"]?.jsonPrimitive?.contentOrNull != "true" }?.get("text")?.jsonPrimitive?.contentOrNull }
                            ?.joinToString("")
                        o["usageMetadata"]?.jsonObject?.let { u ->
                            tin = u["promptTokenCount"]?.jsonPrimitive?.intOrNull ?: tin
                            tout = u["candidatesTokenCount"]?.jsonPrimitive?.intOrNull ?: tout
                        }
                    }
                    "anthropic" -> when (o["type"]?.jsonPrimitive?.contentOrNull) {
                        "content_block_delta" -> delta = o["delta"]?.jsonObject?.get("text")?.jsonPrimitive?.contentOrNull
                        "message_start" -> tin = o["message"]?.jsonObject?.get("usage")?.jsonObject?.get("input_tokens")?.jsonPrimitive?.intOrNull ?: tin
                        "message_delta" -> tout = o["usage"]?.jsonObject?.get("output_tokens")?.jsonPrimitive?.intOrNull ?: tout
                        "error" -> throw LlmError(500, o["error"]?.jsonObject?.get("message")?.jsonPrimitive?.contentOrNull ?: "Error del proveedor", true)
                    }
                    "ollama" -> {
                        delta = o["message"]?.jsonObject?.get("content")?.jsonPrimitive?.contentOrNull
                        if (o["done"]?.jsonPrimitive?.contentOrNull == "true") {
                            tin = o["prompt_eval_count"]?.jsonPrimitive?.intOrNull ?: tin
                            tout = o["eval_count"]?.jsonPrimitive?.intOrNull ?: tout
                        }
                    }
                    else -> {
                        delta = o["choices"]?.jsonArray?.firstOrNull()?.jsonObject?.get("delta")?.jsonObject?.get("content")?.jsonPrimitive?.contentOrNull
                        (o["usage"] as? JsonObject)?.let { u ->
                            tin = u["prompt_tokens"]?.jsonPrimitive?.intOrNull ?: tin
                            tout = u["completion_tokens"]?.jsonPrimitive?.intOrNull ?: tout
                        }
                        (o["error"] as? JsonObject)?.let { throw LlmError(500, it["message"]?.jsonPrimitive?.contentOrNull ?: "Error del proveedor", true) }
                    }
                }
                if (!delta.isNullOrEmpty()) { out.append(delta); onDelta?.invoke(delta) }
            }
        }
        val estimated = tin == 0 && tout == 0
        if (estimated) {
            // El proveedor no informó consumo: se estima (≈4 caracteres por token) y se marca como estimado.
            tin = (system.length + messages.sumOf { it.content.length }) / 4
            tout = out.length / 4
        }
        LlmResult(out.toString(), tin, tout, estimated)
    }

    /** Une turnos consecutivos del mismo rol (Gemini y Anthropic exigen alternancia) y garantiza que empiece el usuario. */
    private fun mergeRoles(messages: List<ChatMsg>): List<ChatMsg> {
        val out = mutableListOf<ChatMsg>()
        for (m in messages) {
            val role = if (m.role == "assistant") "assistant" else "user"
            if (out.isNotEmpty() && out.last().role == role) out[out.size - 1] = ChatMsg(role, out.last().content + "\n\n" + m.content)
            else out += ChatMsg(role, m.content)
        }
        if (out.firstOrNull()?.role == "assistant") out.add(0, ChatMsg("user", "(continuación de la conversación)"))
        return out
    }
}

/** Capacidades y calidad sugeridas por nombre (misma tabla que el backend). */
fun suggestCapabilities(name: String): Pair<List<String>, Int> {
    val presets = listOf(
        Regex("embed", RegexOption.IGNORE_CASE) to (listOf("embedding") to 3),
        Regex("claude.*(opus|fable)", RegexOption.IGNORE_CASE) to (listOf("chat", "tools", "reasoning", "code", "vision", "long_context") to 5),
        Regex("claude.*sonnet", RegexOption.IGNORE_CASE) to (listOf("chat", "tools", "reasoning", "code", "vision", "long_context") to 4),
        Regex("claude.*haiku", RegexOption.IGNORE_CASE) to (listOf("chat", "tools", "code", "vision", "long_context") to 3),
        Regex("^(o\\d|gpt-5)", RegexOption.IGNORE_CASE) to (listOf("chat", "tools", "reasoning", "code", "vision", "long_context") to 5),
        Regex("gpt-4\\.1|gpt-4o", RegexOption.IGNORE_CASE) to (listOf("chat", "tools", "code", "vision", "long_context") to 4),
        Regex("mini|nano|flash-lite", RegexOption.IGNORE_CASE) to (listOf("chat", "tools") to 2),
        Regex("gemini.*pro", RegexOption.IGNORE_CASE) to (listOf("chat", "tools", "reasoning", "code", "vision", "long_context") to 4),
        Regex("gemini.*flash", RegexOption.IGNORE_CASE) to (listOf("chat", "tools", "vision", "long_context") to 3),
        Regex("llama-3\\.3-70b|llama-4|qwen.*32b|gpt-oss-120b|kimi", RegexOption.IGNORE_CASE) to (listOf("chat", "tools", "code", "long_context") to 3),
        Regex("coder|codestral|deepseek", RegexOption.IGNORE_CASE) to (listOf("chat", "tools", "code") to 3),
        Regex("whisper|tts|guard|moderation|playai", RegexOption.IGNORE_CASE) to (emptyList<String>() to 1),
    )
    for ((p, v) in presets) if (p.containsMatchIn(name)) return v
    return listOf("chat") to 2
}

private fun JsonArray?.orEmpty(): JsonArray = this ?: JsonArray(emptyList())
@Suppress("unused") private fun prim(s: String) = JsonPrimitive(s)
