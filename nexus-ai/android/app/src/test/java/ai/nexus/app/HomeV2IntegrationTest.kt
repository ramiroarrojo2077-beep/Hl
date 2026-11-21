package ai.nexus.app

import ai.nexus.app.core.avatar.CoreState
import ai.nexus.app.core.avatar.NexusCoreVisual
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.NexusTheme
import ai.nexus.app.core.design.VisualPrefs
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.printToString
import androidx.compose.ui.unit.dp
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.github.takahirom.roborazzi.captureRoboImage
import kotlinx.coroutines.runBlocking
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.concurrent.CopyOnWriteArrayList

/**
 * NEXUS 2.0 de punta a punta: la app real contra respuestas reales exportadas del backend
 * (tests/test_contract_fixtures.py). Incluye el flujo de WhatsApp del capítulo 16.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(application = TestNexusApp::class, sdk = [35], qualifiers = "w411dp-h891dp-xxhdpi")
class HomeV2IntegrationTest {
    @get:Rule val compose = createEmptyComposeRule()
    private lateinit var server: MockWebServer
    private val requests = CopyOnWriteArrayList<String>()
    private val bodies = CopyOnWriteArrayList<Pair<String, String>>()
    private val jarvisConv = JSONObject(fixture("jarvis_context")).getString("conversation_id")
    private val waAction = JSONObject(fixture("jarvis_message_whatsapp")).getJSONObject("action")

    private val gets: List<Pair<Regex, String>> = listOf(
        "/api/v1/jarvis/context" to "jarvis_context", "/api/v1/jarvis/state" to "jarvis_state", "/api/v1/jarvis/settings" to "jarvis_settings",
        "/api/v1/actions" to "actions", "/api/v1/actions/catalog" to "actions_catalog", "/api/v1/automations" to "automations",
        "/api/v1/automations/events" to "automation_events", "/api/v1/voice/settings" to "voice_settings",
        "/api/v1/integrations/whatsapp/status" to "whatsapp_status", "/api/v1/memory/privacy" to "memory_privacy",
        "/api/v1/conversations/$jarvisConv/messages" to "jarvis_conversation_messages", "/api/v1/conversations/[^/]+/messages" to "conversation_messages",
        "/api/v1/conversations" to "conversations", "/api/v1/dashboard" to "dashboard", "/api/v1/system/status" to "system_status",
        "/api/v1/agents" to "agents", "/api/v1/approvals" to "approvals", "/api/v1/notifications" to "notifications", "/api/v1/settings" to "settings",
        "/api/v1/projects" to "projects", "/api/v1/missions" to "missions", "/api/v1/memory" to "memory", "/api/v1/plugins" to "plugins",
    ).map { (p, n) -> Regex("^$p$") to n }

    @Before fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path!!.substringBefore("?")
                requests += "${request.method} $path"
                val body = request.body.readUtf8()
                if (body.isNotEmpty()) bodies += path to body
                if (path == "/api/v1/ws") return MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                    override fun onMessage(webSocket: WebSocket, text: String) {
                        if (text.contains("\"auth\"")) webSocket.send("""{"type":"ready","user_id":"u"}""")
                    }
                    override fun onOpen(webSocket: WebSocket, response: Response) = Unit
                })
                if (request.getHeader("authorization") != "Bearer test-access") return MockResponse().setResponseCode(401).setBody("{}")
                val name = when {
                    request.method == "POST" && path == "/api/v1/jarvis/message" -> when {
                        body.contains("papá") -> "jarvis_message_whatsapp"
                        body.contains("Recordame") -> "jarvis_message_reminder"
                        body.contains("Spotify") -> "jarvis_message_open_app"
                        body.contains("Pará") -> "jarvis_message_control"
                        else -> "jarvis_message_model"
                    }
                    request.method == "POST" && path == "/api/v1/actions/execute" ->
                        return json(JSONObject(waAction.toString()).put("id", "11111111-2222-3333-4444-555555555555").put("status", "awaiting_confirmation").toString())
                    request.method == "POST" && path.endsWith("/confirm") -> "action_confirm_whatsapp"
                    request.method == "POST" && path.endsWith("/report") -> "action_report_whatsapp"
                    request.method == "GET" && path == "/api/v1/actions/${waAction.getString("id")}" ->
                        return json(waAction.toString())
                    request.method == "POST" && path.endsWith("/cancel") -> return json(waAction.put("status", "cancelled").toString())
                    request.method == "GET" -> gets.firstOrNull { it.first.matches(path) }?.second ?: return json("[]")
                    else -> return json("{}")
                }
                return json(fixture(name))
            }
        }
        server.start()
        val app = ApplicationProvider.getApplicationContext<TestNexusApp>()
        runBlocking {
            app.container.session.setAnimations(false)
            app.container.session.saveLogin(server.url("/").toString().trimEnd('/'), "test-access", "test-refresh", "u", "ana@example.com", "Ana")
        }
        app.container.contacts.clear()
    }

    private fun json(s: String) = MockResponse().setHeader("content-type", "application/json").setBody(s)

    @After fun tearDown() = server.shutdown()

    private fun waitForText(text: String, timeout: Long = 15_000) {
        try {
            compose.waitUntil(timeout) { compose.onAllNodes(hasText(text, substring = true, ignoreCase = true)).fetchSemanticsNodes().isNotEmpty() }
        } catch (e: Throwable) {
            println("=== Esperando «$text». Requests: $requests")
            runCatching { compose.onAllNodes(isRoot()).fetchSemanticsNodes().indices.forEach { i ->
                println(compose.onAllNodes(isRoot())[i].printToString(maxDepth = 8)) } }
            throw e
        }
    }

    private fun tap(text: String) {
        val node = compose.onAllNodesWithText(text, substring = false, ignoreCase = true).onFirst()
        runCatching { node.performScrollTo() }
        node.performClick()
        compose.waitForIdle()
    }

    private fun tapLast(text: String) {
        val nodes = compose.onAllNodesWithText(text, substring = false, ignoreCase = true)
        nodes[nodes.fetchSemanticsNodes().size - 1].performClick()
        compose.waitForIdle()
    }

    private fun say(text: String) {
        compose.onAllNodes(hasSetTextAction()).onFirst().performTextInput(text)
        val send = SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.ContentDescription, listOf("Enviar"))
        compose.waitUntil(5_000) { compose.onAllNodes(send).fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodes(send).onFirst().performClick()
        compose.waitForIdle()
    }

    private fun waitForRequest(what: String, timeout: Long = 10_000) {
        try {
            // Consultar el árbol hace avanzar el looper principal de Robolectric mientras se espera.
            compose.waitUntil(timeout) { compose.onAllNodes(isRoot()).fetchSemanticsNodes(); bodies.any { it.first.endsWith(what) } }
        } catch (e: Throwable) {
            println("=== Esperando request $what. Requests: $requests\nBodies: $bodies")
            throw e
        }
    }

    private fun shot(name: String) {
        val roots = compose.onAllNodes(isRoot())
        roots[roots.fetchSemanticsNodes().size - 1].captureRoboImage("build/screenshots/$name.png")
    }

    @Test fun homeWhatsappActionsMoreAndVoiceSettings() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            // Home 2.0: zonas A-E con datos reales (mensaje contextual derivado del backend)
            waitForText("Buenas tardes, Ana.")
            waitForText("Enviar WhatsApp")
            waitForText("Recordatorio")
            compose.onAllNodes(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.ContentDescription, listOf("Núcleo de NEXUS")))
                .onFirst()
            shot("v2_01_home")

            // WhatsApp: 1) pedirlo en lenguaje natural
            say("Mandale un mensaje a papá diciendo que llego tarde")
            // 2) contacto: «papá» no está guardado → elegir o escribir el número (la agenda no se sube)
            waitForText("No tengo a «papá» guardado")
            shot("v2_02_whatsapp_pick")
            val numberField = compose.onAllNodes(hasSetTextAction() and hasText("Número", substring = true))
            numberField.onFirst().performTextInput("011 15 2345-6789")
            tap("Usar")
            // 3-4) borrador y vista previa con número parcialmente oculto
            waitForText("+54 9 11 ****-6789")
            waitForText("Llego tarde")
            waitForText("Confirmar y abrir WhatsApp")
            shot("v2_03_whatsapp_preview")
            // 5-6) cancelar y volver a preparar
            tapLast("Cancelar")
            waitForText("Cancelado. No se abrió WhatsApp.")
            tap("Volver a preparar")
            // 7-8) confirmar y abrir WhatsApp
            tap("Confirmar y abrir WhatsApp")
            waitForText("WhatsApp quedó abierto con el mensaje listo")
            shot("v2_04_whatsapp_opened")
            scenario.onActivity { activity ->
                val started = shadowOf(activity).nextStartedActivity
                // 9) el texto queda preparado en el enlace oficial Click to Chat
                assertEquals("https://wa.me/5491123456789?text=Llego%20tarde", started.data.toString())
            }
            // 10) NEXUS nunca afirma que se envió
            compose.onAllNodesWithText("Mensaje enviado", substring = true, ignoreCase = true).fetchSemanticsNodes().let { assertTrue(it.isEmpty()) }
            tap("Listo")

            // ACTIONS: confirmaciones, rutinas e historial real
            tap("Acciones")
            waitForText("Rutinas")
            waitForText("Resumen diario")
            waitForText("Aviso de misiones")
            waitForText("el envío lo hiciste vos en WhatsApp")
            shot("v2_05_actions")

            // MORE: herramientas avanzadas, sin perder ninguna pantalla existente
            tap("Más")
            waitForText("Command Center")
            waitForText("Integraciones")
            shot("v2_06_more")
            tap("Integraciones")
            waitForText("API oficial de Meta")
            waitForText("No configurada")
            shot("v2_07_integrations")

            // Ajustes de voz (segundo toque en «Más»: vuelve a la grilla)
            tap("Más")
            tap("Más")
            compose.onAllNodes(androidx.compose.ui.test.hasTestTag("more_grid")).onFirst().performScrollToNode(hasText("Voz"))
            tap("Voz")
            waitForText("Pulsar para hablar")
            waitForText("Palabra de activación")
            waitForText("Nunca")
            shot("v2_08_voice_settings")

            // Command Center (dashboard 1.0) sigue disponible
            tap("Más")
            tap("Más")
            tap("Command Center")
            waitForText("AI Core Overview")
        }
        // Requests reales del flujo
        assertTrue(requests.contains("POST /api/v1/jarvis/message"))
        val confirm = bodies.first { it.first.endsWith("/confirm") }.second
        assertTrue(confirm.contains("Llego tarde"))
        assertFalse("el número personal no viaja al servidor", confirm.contains("2345"))
        val reports = bodies.filter { it.first.endsWith("/report") }.map { it.second }
        assertTrue(reports.any { it.contains("WHATSAPP_OPENED") })
        assertTrue(reports.none { it.contains("23456789") })
        assertTrue(requests.any { it.endsWith("/cancel") })
        // Tras cancelar, volver a preparar crea una acción nueva (la cancelada no se reutiliza)
        assertTrue(requests.contains("POST /api/v1/actions/execute"))
        val created = bodies.first { it.first == "/api/v1/actions/execute" }.second
        assertFalse("la acción rápida tampoco envía el número", created.contains("2345"))
    }

    @Test fun directActionOpensAppAndModelReplyShows() {
        ActivityScenario.launch(MainActivity::class.java).use { scenario ->
            waitForText("Buenas tardes, Ana.")
            say("Abrí Spotify")
            waitForRequest("/report")
            // Spotify no está instalado en el entorno de prueba: se informa APP_NOT_FOUND, no un éxito inventado.
            assertTrue(bodies.first { it.first.endsWith("/report") }.second.contains("APP_NOT_FOUND"))
            waitForText("No encontré una app instalada llamada «Spotify»")
            say("¿Cuál es la capital de Australia?")
            waitForText("Canberra es la capital de Australia.")
            shot("v2_09_home_conversation")
        }
    }
}

/** Captura del núcleo visual en sus nueve estados (modo con movimiento reducido: imagen estable). */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(application = TestNexusApp::class, sdk = [35], qualifiers = "w411dp-h891dp-xxhdpi")
class CoreVisualStatesTest {
    @get:Rule val compose = createComposeRule()

    @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
    @Test fun allNineStates() {
        compose.setContent {
            NexusTheme(VisualPrefs(animations = false)) {
                FlowRow(Modifier.background(NexusColors.Background).padding(8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    CoreState.entries.forEach { st ->
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            NexusCoreVisual(st, size = 120.dp, audioLevel = if (st == CoreState.LISTENING) 0.7f else 0f, speechPulse = 2, specialists = 2)
                            Text(st.name, color = NexusColors.TextSecondary)
                        }
                    }
                }
            }
        }
        compose.onRoot().captureRoboImage("build/screenshots/v2_10_core_states.png")
        CoreState.entries.forEach { st ->
            assertTrue(compose.onAllNodes(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription, st.label))
                .fetchSemanticsNodes().isNotEmpty())
        }
    }
}
