package ai.nexus.app

import ai.nexus.app.core.session.SecretBox
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.printToString
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.performScrollToNode
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.util.concurrent.CopyOnWriteArrayList

/** Cifrado trivial SOLO para tests: Robolectric no implementa el Android Keystore. */
object TestBox : SecretBox {
    override fun encrypt(plain: String) = "t:$plain"
    override fun decrypt(encoded: String) = encoded.removePrefix("t:")
}

class TestNexusApp : NexusApplication() {
    override fun createContainer() = AppContainer(this, TestBox)
}

fun fixture(name: String): String =
    requireNotNull(UiIntegrationTest::class.java.getResource("/fixtures/$name.json")) { "falta fixture $name" }.readText()

/**
 * Prueba de UI de punta a punta: la app real (actividad, navegación, ViewModels, cliente HTTP y
 * WebSocket) contra un servidor que sirve respuestas reales exportadas del backend.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(application = TestNexusApp::class, sdk = [35], qualifiers = "w411dp-h891dp-xxhdpi")
class UiIntegrationTest {
    @get:Rule val compose = createEmptyComposeRule()
    private lateinit var server: MockWebServer
    private val requests = CopyOnWriteArrayList<String>()
    private val ids = JSONObject(fixture("ids"))

    private val routes: List<Pair<Regex, String>> by lazy {
        listOf(
            "/api/v1/dashboard" to "dashboard", "/api/v1/system/status" to "system_status", "/api/v1/agents" to "agents",
            "/api/v1/agents/persona-catalog" to "persona_catalog", "/api/v1/agents/[^/]+/tasks" to "agent_tasks",
            "/api/v1/agents/[^/]+/instructions" to "agent_instructions", "/api/v1/agents/[^/]+" to "agent_detail",
            "/api/v1/missions" to "missions", "/api/v1/missions/[^/]+/messages" to "mission_messages", "/api/v1/missions/[^/]+" to "mission_detail",
            "/api/v1/meetings" to "meetings", "/api/v1/meetings/[^/]+" to "meeting_detail", "/api/v1/memory" to "memory",
            "/api/v1/activity" to "activity", "/api/v1/notifications" to "notifications", "/api/v1/approvals" to "approvals",
            "/api/v1/settings" to "settings", "/api/v1/providers" to "providers", "/api/v1/providers/kinds" to "provider_kinds",
            "/api/v1/models" to "models", "/api/v1/tools" to "tools", "/api/v1/plugins" to "plugins", "/api/v1/projects" to "projects",
            "/api/v1/projects/[^/]+/files" to "project_files", "/api/v1/projects/[^/]+" to "project_detail",
            "/api/v1/conversations" to "conversations", "/api/v1/conversations/[^/]+/messages" to "conversation_messages",
            "/api/v1/schedules" to "schedules", "/api/v1/usage/summary" to "usage_summary", "/api/v1/memory/stats" to "memory_stats",
        ).map { (pattern, name) -> Regex("^$pattern$") to name }
    }

    @Before fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path!!.substringBefore("?")
                requests += "${request.method} $path"
                if (path == "/api/v1/ws") return MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
                    override fun onMessage(webSocket: WebSocket, text: String) {
                        if (text.contains("\"auth\"") && text.contains("test-access")) webSocket.send("""{"type":"ready","user_id":"u"}""")
                    }
                    override fun onOpen(webSocket: WebSocket, response: Response) = Unit
                })
                if (request.getHeader("authorization") != "Bearer test-access") return MockResponse().setResponseCode(401).setBody("{}")
                val name = routes.firstOrNull { it.first.matches(path) }?.second
                    ?: return MockResponse().setBody(if (request.method == "GET") "[]" else "{}")
                return MockResponse().setHeader("content-type", "application/json").setBody(fixture(name))
            }
        }
        server.start()
        val app = ApplicationProvider.getApplicationContext<TestNexusApp>()
        runBlocking {
            app.container.session.setAnimations(false)
            app.container.session.saveLogin(server.url("/").toString().trimEnd('/'), "test-access", "test-refresh", "u", "ana@example.com", "Ana")
        }
    }

    @After fun tearDown() = server.shutdown()

    private fun waitForText(text: String, timeout: Long = 15_000) {
        try {
            compose.waitUntil(timeout) { compose.onAllNodes(hasText(text, substring = true, ignoreCase = true)).fetchSemanticsNodes().isNotEmpty() }
        } catch (e: Throwable) {
            runCatching { compose.onRoot().captureRoboImage("build/screenshots/FAIL_${text.filter { it.isLetterOrDigit() }}.png") }
            println("=== Esperando «$text». Requests: $requests")
            runCatching { println(compose.onRoot(useUnmergedTree = true).printToString(maxDepth = 6)) }
            throw e
        }
    }

    private fun tap(text: String) {
        val node = compose.onAllNodesWithText(text, substring = false, ignoreCase = true).onFirst()
        runCatching { node.performScrollTo() }
        node.performClick()
    }

    @Test fun navigatesTheRealAppWithBackendData() {
        ActivityScenario.launch(MainActivity::class.java).use {
            // Dashboard con datos reales del backend
            waitForText("AI Core Overview")
            waitForText("Ana")
            compose.onRoot().captureRoboImage("build/screenshots/01_dashboard_phone.png")
            waitForText("Crear app de gestión de videojuegos")

            // Agent Center
            tap("Agents")
            waitForText("Agent Center")
            waitForText("CIPHER")
            compose.onRoot().captureRoboImage("build/screenshots/02_agents.png")

            // Detalle y editor de personaje (NOVA está más abajo en la grilla)
            compose.onAllNodes(hasScrollAction()).onFirst().performScrollToNode(hasText("NOVA"))
            waitForText("Creativo")
            compose.onRoot().captureRoboImage("build/screenshots/02b_agents_nova.png")
            compose.onAllNodesWithText("NOVA").onFirst().performClick()
            waitForText("Editar personaje")
            compose.onRoot().captureRoboImage("build/screenshots/03_agent_detail.png")
            tap("Editar personaje")
            waitForText("[APARIENCIA]")
            waitForText("Peinado")
            compose.onRoot().captureRoboImage("build/screenshots/04_character_editor_appearance.png")
            tap("[PERSONALIDAD]")
            waitForText("[Analítico/Creativo]")
            compose.onRoot().captureRoboImage("build/screenshots/05_character_editor_personality.png")
            tap("[VOZ]")
            waitForText("Tono de voz", 5_000)
            compose.onRoot().captureRoboImage("build/screenshots/06_character_editor_voice.png")
            tap("Presets")
            waitForText("Galería de personajes")
            compose.onRoot().captureRoboImage("build/screenshots/07_character_gallery.png")
            tap("CERRAR")

            // Misiones: lista, detalle y vista de flujo
            tap("Missions")
            waitForText("Mission Center")
            waitForText("Investigar motores de física")
            compose.onRoot().captureRoboImage("build/screenshots/08_missions.png")
            compose.onAllNodesWithText("Crear app de gestión de videojuegos").onFirst().performClick()
            waitForText("Investigar tecnologías")
            compose.onRoot().captureRoboImage("build/screenshots/09_mission_detail.png")
            tap("Flujo")
            waitForText("Flujo de ejecución")
            compose.onRoot().captureRoboImage("build/screenshots/10_mission_flow.png")
            tap("Resultado")
            waitForText("Informe final")

            // Chat
            tap("Chat")
            waitForText("Hola NEXUS")
            compose.onRoot().captureRoboImage("build/screenshots/11_chat.png")

            // Reuniones
            tap("Meetings")
            waitForText("Arquitectura del simulador")
            compose.onAllNodesWithText("Arquitectura del simulador").onFirst().performClick()
            waitForText("Conclusiones")
            compose.onRoot().captureRoboImage("build/screenshots/12_meeting.png")
        }
        // La app pidió datos reales (no hay datos de muestra embebidos en el APK)
        assertTrue(requests.any { it == "GET /api/v1/dashboard" })
        assertTrue(requests.any { it.startsWith("GET /api/v1/missions/") })
        assertTrue(requests.any { it == "GET /api/v1/ws" })
    }
}

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(application = TestNexusApp::class, sdk = [35], qualifiers = "w1280dp-h800dp-xhdpi")
class TabletLayoutTest {
    @get:Rule val compose = createEmptyComposeRule()
    private lateinit var server: MockWebServer

    @Before fun setUp() {
        server = MockWebServer()
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse {
                val path = request.path!!.substringBefore("?")
                val name = when {
                    path == "/api/v1/dashboard" -> "dashboard"
                    path == "/api/v1/system/status" -> "system_status"
                    else -> return MockResponse().setBody("[]")
                }
                return MockResponse().setBody(fixture(name))
            }
        }
        server.start()
        val app = ApplicationProvider.getApplicationContext<TestNexusApp>()
        runBlocking {
            app.container.session.setAnimations(false)
            app.container.session.saveLogin(server.url("/").toString().trimEnd('/'), "test-access", "test-refresh", "u", "ana@example.com", "Ana")
        }
    }

    @After fun tearDown() = server.shutdown()

    @Test fun commandCenterOnTablet() {
        ActivityScenario.launch(MainActivity::class.java).use {
            compose.waitUntil(15_000) { compose.onAllNodes(hasText("LLM Status", substring = true, ignoreCase = true)).fetchSemanticsNodes().isNotEmpty() }
            compose.waitUntil(15_000) { compose.onAllNodes(hasText("COMMAND CENTER")).fetchSemanticsNodes().isNotEmpty() }
            compose.onRoot().captureRoboImage("build/screenshots/20_dashboard_tablet.png")
        }
    }
}
