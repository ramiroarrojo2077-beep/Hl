package ai.nexus.app

import ai.nexus.app.core.network.ApiClient
import ai.nexus.app.core.network.NexusJson
import ai.nexus.app.core.network.TokenProvider
import ai.nexus.app.data.api.NexusApi
import ai.nexus.app.data.model.ActionDto
import ai.nexus.app.data.model.ConversationCreate
import ai.nexus.app.data.model.JarvisMessageBody
import ai.nexus.app.data.model.MeetingCreate
import ai.nexus.app.data.model.MissionCreate
import ai.nexus.app.data.model.ModelCreate
import ai.nexus.app.data.model.ProviderCreate
import ai.nexus.app.data.model.ScheduleDto
import ai.nexus.app.local.ClassifyContext
import ai.nexus.app.local.LOCAL_URL
import ai.nexus.app.local.LocalBackend
import ai.nexus.app.local.LocalInterceptor
import ai.nexus.app.local.LocalLlm
import ai.nexus.app.local.LocalStore
import ai.nexus.app.local.classify
import ai.nexus.app.local.tick
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import java.io.File
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.concurrent.CopyOnWriteArrayList

/** El clasificador local (Kotlin) responde exactamente lo mismo que el del backend (Python) para las mismas frases. */
class LocalIntentParityTest {
    @Test fun sameDecisionsAsBackend() {
        val file = listOf(File("../../shared/intent_vectors.json"), File("../shared/intent_vectors.json")).first { it.exists() }
        val root = NexusJson.parseToJsonElement(file.readText()).jsonObject
        val now = ZonedDateTime.parse(root["now"]!!.jsonPrimitive.content).withZoneSameInstant(ZoneId.of(root["timezone"]!!.jsonPrimitive.content))
        val failures = mutableListOf<String>()
        for (c in root["cases"]!!.jsonArray.map { it.jsonObject }) {
            val text = c["text"]!!.jsonPrimitive.content
            val pending = (c["pending"] as? JsonObject)?.mapValues { (it.value as? JsonPrimitive)?.contentOrNull }
            val i = classify(text, ClassifyContext(now, now.zone.id, "Respuesta anterior de NEXUS", false, pending))
            val got = i.toJson()
            for (k in listOf("category", "rule", "action_key", "question", "control")) {
                val exp = c[k]?.takeIf { it !is JsonNull }?.jsonPrimitive?.content
                val act = got[k]?.takeIf { it !is JsonNull }?.jsonPrimitive?.content
                if (exp != act) failures += "«$text» $k: esperado=$exp obtenido=$act"
            }
            val expParams = c["params"]!!.jsonObject
            val actParams = got["params"]!!.jsonObject
            if (normalizeJson(expParams) != normalizeJson(actParams)) failures += "«$text» params: esperado=$expParams obtenido=$actParams"
            if (c["handler"]!!.jsonPrimitive.content != i.handler) failures += "«$text» handler: ${c["handler"]} vs ${i.handler}"
        }
        assertTrue("Diferencias con el backend:\n" + failures.joinToString("\n"), failures.isEmpty())
    }

    /** Las fechas pueden venir con o sin segundos según el lenguaje; se comparan como instantes. */
    private fun normalizeJson(o: JsonObject): Map<String, String> = o.mapValues { (_, v) ->
        val s = if (v is JsonPrimitive) v.content else v.toString()
        runCatching { ZonedDateTime.parse(s).toInstant().toString() }.getOrDefault(s)
    }
}

private object PlainBox : ai.nexus.app.core.session.SecretBox {
    override fun encrypt(plain: String) = "enc:" + plain.reversed()
    override fun decrypt(encoded: String) = encoded.removePrefix("enc:").reversed()
}

/**
 * Backend local de punta a punta: se usa la misma API (NexusApi + ApiClient) que en modo servidor, pero las llamadas las
 * atiende el teléfono. El proveedor de IA se emula con un servidor que habla el protocolo de OpenAI con streaming real.
 */
@RunWith(AndroidJUnit4::class)
@Config(application = TestNexusApp::class, sdk = [35])
class LocalBackendTest {
    private lateinit var ai: MockWebServer
    private lateinit var backend: LocalBackend
    private lateinit var api: NexusApi
    private lateinit var scope: CoroutineScope
    private val prompts = CopyOnWriteArrayList<String>()

    private fun sse(text: String): MockResponse {
        val chunks = text.chunked(7).joinToString("") { c -> "data: " + buildJsonObject {
            put("choices", kotlinx.serialization.json.JsonArray(listOf(buildJsonObject { put("delta", buildJsonObject { put("content", c) }) })))
        } + "\n\n" }
        val usage = "data: " + buildJsonObject { put("choices", kotlinx.serialization.json.JsonArray(emptyList()))
            put("usage", buildJsonObject { put("prompt_tokens", 120); put("completion_tokens", 40) }) } + "\n\n"
        return MockResponse().setHeader("content-type", "text/event-stream").setBody(chunks + usage + "data: [DONE]\n\n")
    }

    @Before fun setUp() {
        ai = MockWebServer()
        ai.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                if (request.getHeader("authorization") != "Bearer clave-gratis") return MockResponse().setResponseCode(401).setBody("""{"error":{"message":"bad key"}}""")
                if (request.path!!.endsWith("/models")) return MockResponse().setBody("""{"data":[{"id":"llama-3.3-70b-versatile"},{"id":"whisper-large-v3"}]}""")
                val body = request.body.readUtf8()
                prompts += body
                return when {
                    "Diseñá un plan" in body -> sse("""{"analysis":"Comparar y recomendar","tasks":[{"key":"t1","title":"Relevar modelos","description":"Listar opciones","agent":"atlas","task_type":"research","depends_on":[]},{"key":"t2","title":"Recomendar","description":"Elegir el mejor","agent":"oracle","task_type":"analysis","depends_on":["t1"]}]}""")
                    "Revisá con rigor" in body -> sse("""{"approved":true,"score":8,"issues":[],"summary":"Las entregas cumplen el objetivo."}""")
                    "Redactá el acta" in body -> sse("""{"summary":"Acordamos un plan de lanzamiento.","decisions":["Lanzar en marzo"],"action_items":["Preparar el post"]}""")
                    "Consolidá el resultado final" in body -> sse("Resultado final: recomiendo el modelo B por precio y batería.")
                    "Aportá tu análisis experto" in body -> sse("Aporte del especialista.")
                    "Reunión «" in body -> sse("Mi aporte a la reunión.")
                    "capital de Australia" in body -> sse("Canberra es la capital de Australia.")
                    else -> sse("Entrega de la tarea lista.")
                }
            }
        }
        ai.start()
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        ctx.deleteDatabase("nexus_local_test.db")
        scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        backend = LocalBackend(ctx, LocalStore(ctx, "nexus_local_test.db"), LocalLlm(OkHttpClient()), PlainBox, scope)
        val http = OkHttpClient.Builder().addInterceptor(LocalInterceptor { backend }).build()
        api = NexusApi(ApiClient(http, object : TokenProvider {
            override suspend fun baseUrl() = LOCAL_URL
            override suspend fun accessToken() = "local"
            override suspend fun refreshToken() = "local"
            override suspend fun onTokens(access: String, refresh: String) = Unit
            override suspend fun onSessionExpired() = Unit
        }))
        backend.ensureUser("Ana")
    }

    @After fun tearDown() { scope.cancel(); ai.shutdown() }

    private fun configureProvider() = runBlocking {
        val p = api.createProvider(ProviderCreate("openai_compatible", "Groq de prueba", ai.url("/openai/v1").toString().trimEnd('/'), "clave-gratis"))
        val test = api.testProvider(p.id)
        assertTrue(test.error, test.ok)
        assertEquals(listOf("llama-3.3-70b-versatile", "whisper-large-v3"), test.models)
        val m = api.createModel(ModelCreate(p.id, "llama-3.3-70b-versatile"))
        assertTrue("chat" in m.capabilities)
        assertTrue("el primer modelo de chat queda como predeterminado", m.isDefault)
        assertFalse("whisper no es un modelo de chat", "chat" in api.createModel(ModelCreate(p.id, "whisper-large-v3")).capabilities)
        // la clave nunca vuelve a la app, solo una pista
        assertEquals(null, api.providers().first().apiKeyHint?.takeIf { it.contains("clave-gratis") })
    }

    private suspend fun waitFor(timeoutMs: Long = 15_000, cond: suspend () -> Boolean) {
        withTimeout(timeoutMs) { while (!cond()) delay(50) }
    }

    @Test fun teamDirectActionsAndWhatsappWithoutServer() = runBlocking {
        assertEquals(listOf("nexus", "atlas", "cipher", "nova", "oracle", "guardian"), api.agents().map { it.slug })
        val ctx = api.jarvisContext("America/Argentina/Buenos_Aires")
        assertTrue(ctx.headline.endsWith(", Ana."))
        assertTrue("avisa que falta un proveedor", ctx.lines.any { "Modo local activo" in it })

        // Acción directa sin modelo: recordatorio creado y verificado en el teléfono.
        val r = api.jarvisMessage(JarvisMessageBody("Recordame mañana a las 9 llamar al médico", timezone = "America/Argentina/Buenos_Aires"))
        assertEquals("action", r.handled)
        assertEquals("completed", r.action!!.status)
        assertTrue(r.reply!!.content.startsWith("Listo, te lo recuerdo mañana a las 09:00"))
        assertEquals(1, api.schedules().size)

        // WhatsApp: vista previa obligatoria, número solo en el teléfono, nunca «enviado».
        val wa = api.jarvisMessage(JarvisMessageBody("Mandale un mensaje a papá diciendo que llego tarde"))
        val action = wa.action!!
        assertEquals("awaiting_confirmation", action.status)
        assertEquals("Llego tarde", action.params["text"]!!.jsonPrimitive.content)
        val confirmed = api.confirmAction(action.id, buildJsonObject { put("phone", "+5491123456789") })
        assertEquals("ready", confirmed.status)
        assertFalse("el número guardado no queda en claro", NexusJson.encodeToString(ActionDto.serializer(), api.actions().first { it.id == action.id }).contains("1123456789"))
        assertEquals("+5491123456789", confirmed.deviceParams!!["phone"]!!.jsonPrimitive.content)
        api.reportAction(action.id, "WHATSAPP_OPENED", buildJsonObject { put("recipient_masked", "+54 9 11 ****-6789") })
        val msgs = api.conversationMessages(wa.conversationId)
        assertTrue(msgs.last().content.contains("Todavía no está enviado"))
        assertFalse(msgs.any { "enviado." in it.content && "no está enviado" !in it.content })

        // Sin proveedor, NEXUS lo dice (no inventa una respuesta).
        val noModel = api.jarvisMessage(JarvisMessageBody("¿Cuál es la capital de Australia?"))
        assertEquals("no_model", noModel.handled)
        assertTrue(noModel.reply!!.content.contains("Gemini"))

        // STOP ALL bloquea lo nuevo.
        api.emergencyStop("prueba")
        assertEquals("stopped", api.jarvisState().state)
        api.clearEmergencyStop(false)
        assertEquals("idle", api.jarvisState().state)
    }

    @Test fun realModelReplyStreamsAndSpecialistsCollaborate() = runBlocking {
        configureProvider()
        val events = mutableListOf<String>()
        val collector = scope.launch { backend.events.collect { events += it } }
        val r = api.jarvisMessage(JarvisMessageBody("¿Cuál es la capital de Australia?"))
        assertEquals("model", r.handled)
        waitFor { api.conversationMessages(r.conversationId).any { it.senderType == "agent" && it.content == "Canberra es la capital de Australia." } }
        assertTrue("llegó por streaming", events.count { "\"chat.delta\"" in it } >= 3)
        val reply = api.conversationMessages(r.conversationId).last()
        assertEquals("openai_compatible:llama-3.3-70b-versatile", reply.modelUsed)
        val trace = api.jarvisTrace(reply.id)
        assertEquals(160, trace.reply!!.tokens)

        // Investigación: ATLAS aporta primero (llamada real) y NEXUS lo menciona.
        val res = api.jarvisMessage(JarvisMessageBody("Investigá precios de notebooks"))
        val replyTo: (ai.nexus.app.data.model.MessageDto) -> Boolean = { it.meta["reply_to"]?.jsonPrimitive?.content == res.userMessage!!.id }
        waitFor { api.conversationMessages(res.conversationId).any(replyTo) }
        val last = api.conversationMessages(res.conversationId).first(replyTo)
        assertEquals(listOf("atlas"), last.meta["consulted_agents"]!!.jsonArray.map { it.jsonPrimitive.content })
        assertTrue(prompts.any { "Aporte de ATLAS" in it })
        collector.cancel()
        assertTrue(api.usageSummary()["totals"]!!.jsonObject["calls"]!!.jsonPrimitive.content.toInt() >= 3)
    }

    @Test fun missionMeetingAndChatRunOnThePhone() = runBlocking {
        configureProvider()
        val m = api.createMission(MissionCreate("Celulares", "Comparar celulares de gama media y recomendar uno"))
        waitFor(30_000) { api.mission(m.id).status == "completed" }
        val detail = api.mission(m.id)
        assertEquals(listOf("Relevar modelos", "Recomendar"), detail.tasks.map { it.title })
        assertEquals(listOf("completed", "completed"), detail.tasks.map { it.status })
        assertEquals("Resultado final: recomiendo el modelo B por precio y batería.", detail.result)
        assertEquals(true, detail.review["approved"]?.jsonPrimitive?.content?.toBoolean())
        // la segunda tarea recibió el resultado de la primera
        assertTrue(prompts.any { "Insumos de tareas previas" in it && "Entrega de la tarea lista." in it })
        assertTrue(api.notifications().any { it.eventType == "mission_completed" })

        val agents = api.agents()
        val meeting = api.createMeeting(MeetingCreate("Lanzamiento", "Definir el plan", "brainstorm",
            listOf(agents.first { it.slug == "nova" }.id, agents.first { it.slug == "atlas" }.id), 1))
        waitFor(30_000) { api.meeting(meeting.id).status == "completed" }
        val md = api.meeting(meeting.id)
        assertEquals("Acordamos un plan de lanzamiento.", md.summary)
        assertEquals(3, md.messages.size) // 2 aportes + acta

        val conv = api.createConversation(ConversationCreate(agentId = agents.first { it.slug == "cipher" }.id))
        api.sendMessage(conv.id, "Hola CIPHER")
        waitFor { api.conversationMessages(conv.id).any { it.senderType == "agent" } }
        assertTrue(prompts.any { "Sos CIPHER" in it })
    }

    @Test fun routinesFireWithLimitsAndNoLoops() = runBlocking {
        val r = api.jarvisMessage(JarvisMessageBody("todos los días a las 8 recordame tomar agua", timezone = "America/Argentina/Buenos_Aires"))
        assertEquals("awaiting_confirmation", r.action!!.status) // crear rutinas siempre se confirma
        val done = api.confirmAction(r.action!!.id)
        assertEquals("completed", done.status)
        val auto = api.automations().single()
        assertEquals("0 8 * * *", auto.cron)
        assertNotNull(auto.nextRunAt)
        val next = ZonedDateTime.parse(auto.nextRunAt).withZoneSameInstant(ZoneId.of("America/Argentina/Buenos_Aires"))
        assertEquals(8, next.hour)
        val run = api.runAutomation(auto.id)
        assertEquals("succeeded", run["status"]!!.jsonPrimitive.content)
        assertTrue(api.notifications().any { it.title == "Tomar agua" })
        // Recordatorio vencido: el reloj interno lo dispara una sola vez.
        val reminder = api.jarvisMessage(JarvisMessageBody("Recordame en 1 minutos estirar")).action!!
        assertEquals("completed", reminder.status)
        val sched = api.schedules().first { it.payload["title"]?.jsonPrimitive?.content == "Estirar" }
        backend.store.put("schedules", sched.id, ScheduleDto.serializer(), sched.copy(nextRunAt = java.time.Instant.now().minusSeconds(5).toString()))
        backend.tick(); backend.tick()
        assertEquals(1, api.notifications().count { it.title == "Estirar" })
    }
}

/** Adaptadores directos del teléfono: formato exacto de Gemini y Anthropic (streaming SSE). */
class LocalLlmAdaptersTest {
    @Test fun geminiAndAnthropicProtocols() = runBlocking {
        val server = MockWebServer()
        val bodies = CopyOnWriteArrayList<RecordedRequest>()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                bodies += request
                val p = request.path!!
                return when {
                    p.startsWith("/v1beta/models?") -> MockResponse().setBody("""{"models":[{"name":"models/gemini-2.5-flash","supportedGenerationMethods":["generateContent"]},{"name":"models/text-embedding-004","supportedGenerationMethods":["embedContent"]}]}""")
                    p.contains(":streamGenerateContent") -> MockResponse().setBody(
                        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"pensando\",\"thought\":true},{\"text\":\"Hola \"}]}}]}\n\n" +
                        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Ana.\"}]}}],\"usageMetadata\":{\"promptTokenCount\":12,\"candidatesTokenCount\":3}}\n\n")
                    p == "/v1/messages" -> MockResponse().setBody(
                        "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":9}}}\n\n" +
                        "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Listo.\"}}\n\n" +
                        "event: message_delta\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":2}}\n\n")
                    else -> MockResponse().setResponseCode(429).setBody("{}")
                }
            }
        }
        server.start()
        val llm = LocalLlm(OkHttpClient())
        val base = server.url("/v1beta").toString().trimEnd('/')
        assertEquals(listOf("gemini-2.5-flash"), llm.listModels("gemini", base, "k-gemini"))
        val deltas = mutableListOf<String>()
        val r = llm.chat("gemini", base, "k-gemini", "gemini-2.5-flash", "Sos NEXUS", listOf(
            ai.nexus.app.local.ChatMsg("assistant", "hola previa"), ai.nexus.app.local.ChatMsg("user", "Saludame")), 500, 0.3, { deltas += it })
        assertEquals("Hola Ana.", r.text) // el razonamiento interno no se muestra
        assertEquals(listOf("Hola ", "Ana."), deltas)
        assertEquals(12, r.tokensIn); assertEquals(3, r.tokensOut)
        val req = bodies.first { it.path!!.contains("stream") }
        assertEquals("k-gemini", req.getHeader("x-goog-api-key"))
        val sent = NexusJson.parseToJsonElement(req.body.readUtf8()).jsonObject
        assertEquals(listOf("user", "model", "user"), sent["contents"]!!.jsonArray.map { it.jsonObject["role"]!!.jsonPrimitive.content })
        assertEquals("Sos NEXUS", sent["systemInstruction"]!!.jsonObject["parts"]!!.jsonArray[0].jsonObject["text"]!!.jsonPrimitive.content)

        val a = llm.chat("anthropic", server.url("/").toString().trimEnd('/'), "k-anth", "claude-haiku", "sys", listOf(ai.nexus.app.local.ChatMsg("user", "hola")), 100, null)
        assertEquals("Listo.", a.text); assertEquals(9, a.tokensIn); assertEquals(2, a.tokensOut)
        assertEquals("k-anth", bodies.last().getHeader("x-api-key"))

        val err = runCatching { llm.chat("groq", server.url("/x").toString(), "k", "m", "", listOf(ai.nexus.app.local.ChatMsg("user", "hola")), 10, null) }.exceptionOrNull()
        assertTrue(err is ai.nexus.app.local.LlmError && err.transient && "límite" in err.message)
        server.shutdown()
    }
}
