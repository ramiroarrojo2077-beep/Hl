package ai.nexus.app

import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.printToString
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.github.takahirom.roborazzi.captureRoboImage
import ai.nexus.app.local.LOCAL_URL
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** La app real sin ningún servidor: se entra en modo local y NEXUS responde desde el teléfono. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(application = TestNexusApp::class, sdk = [35], qualifiers = "w411dp-h891dp-xxhdpi")
class LocalUiTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Before fun setUp() {
        val app = ApplicationProvider.getApplicationContext<TestNexusApp>()
        app.deleteDatabase("nexus_local.db")
        runBlocking {
            app.container.session.clear()
            app.container.session.setAnimations(false)
        }
    }

    private fun waitForText(text: String, timeout: Long = 15_000) {
        try {
            compose.waitUntil(timeout) { compose.onAllNodes(hasText(text, substring = true, ignoreCase = true)).fetchSemanticsNodes().isNotEmpty() }
        } catch (e: Throwable) {
            runCatching { println(compose.onAllNodes(isRoot())[0].printToString(maxDepth = 10)) }
            throw e
        }
    }

    private fun shot(name: String) {
        val roots = compose.onAllNodes(isRoot())
        roots[roots.fetchSemanticsNodes().size - 1].captureRoboImage("build/screenshots/$name.png")
    }

    private fun say(text: String) {
        compose.onAllNodes(hasSetTextAction()).onFirst().performTextInput(text)
        val send = SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.ContentDescription, listOf("Enviar"))
        compose.waitUntil(5_000) { compose.onAllNodes(send).fetchSemanticsNodes().isNotEmpty() }
        compose.onAllNodes(send).onFirst().performClick()
        compose.waitForIdle()
    }

    @Test fun startsWithoutServerAndWorksOnThePhone() {
        ActivityScenario.launch(MainActivity::class.java).use {
            waitForText("Empezar en este teléfono")
            compose.onAllNodes(hasSetTextAction()).onFirst().performTextInput("Ana")
            shot("v3_01_local_login")
            compose.onAllNodes(hasTestTag("use_local")).onFirst().apply { runCatching { performScrollTo() } }.performClick()
            waitForText("Modo local activo")
            waitForText(", Ana.")
            waitForText("MODO LOCAL")
            compose.waitUntil(10_000) { compose.onAllNodes(hasText("sin conexión", substring = true, ignoreCase = true)).fetchSemanticsNodes().isEmpty() }
            val app = ApplicationProvider.getApplicationContext<TestNexusApp>()
            assertEquals(LOCAL_URL, runBlocking { app.container.session.serverUrl() })
            shot("v3_02_local_home")

            // Acción directa resuelta en el teléfono, sin modelo ni servidor.
            say("Recordame mañana a las 9 llamar al médico")
            waitForText("te lo recuerdo mañana a las 09:00")
            // Pedido que necesita IA: NEXUS explica cómo configurarla (gratis) en vez de inventar.
            say("¿Cuál es la capital de Australia?")
            waitForText("Para eso necesito un modelo de IA")
            shot("v3_03_local_conversation")

            // Pantalla de proveedores en modo local: arranca en Gemini y explica la clave gratis.
            compose.onAllNodesWithText("Más").onFirst().performClick()
            compose.waitForIdle()
            compose.onAllNodesWithText("Configuración").onFirst().apply { runCatching { performScrollTo() } }.performClick()
            waitForText("Proveedores de IA")
            compose.onAllNodesWithText("Proveedores de IA").onFirst().apply { runCatching { performScrollTo() } }.performClick()
            waitForText("Google Gemini (tiene plan gratis)")
            waitForText("Claves gratis")
            shot("v3_04_local_providers")
        }
    }
}
