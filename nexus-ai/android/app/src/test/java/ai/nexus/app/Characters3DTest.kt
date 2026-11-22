package ai.nexus.app

import ai.nexus.app.core.avatar.AgentAvatar
import ai.nexus.app.core.avatar.AgentFigure
import ai.nexus.app.core.avatar.Character3D
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.NexusTheme
import ai.nexus.app.core.design.VisualPrefs
import ai.nexus.app.core.network.NexusJson
import ai.nexus.app.data.model.AgentDto
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.github.takahirom.roborazzi.captureRoboImage
import kotlinx.serialization.builtins.ListSerializer
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Los personajes son mallas 3D reales (con volumen e iluminación), generadas desde su apariencia. */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(application = TestNexusApp::class, sdk = [35], qualifiers = "w411dp-h891dp-xxhdpi")
class Characters3DTest {
    @get:Rule val compose = createComposeRule()
    private val agents = NexusJson.decodeFromString(ListSerializer(AgentDto.serializer()), fixture("agents"))

    @Test fun renderCostIsMeasured() {
        val mesh = Character3D.build(agents.first().profile.appearance)
        val bmp = android.graphics.Bitmap.createBitmap(540, 960, android.graphics.Bitmap.Config.ARGB_8888)
        val r = ai.nexus.app.core.three.Renderer3D()
        repeat(5) { r.render(mesh, bmp, ai.nexus.app.core.three.Camera(yaw = it * 0.1f, distance = 4.3f, targetY = 0.93f, fov = 1.9f)) }
        val n = 30
        val t0 = System.nanoTime()
        repeat(n) { r.render(mesh, bmp, ai.nexus.app.core.three.Camera(yaw = it * 0.05f, distance = 4.3f, targetY = 0.93f, fov = 1.9f)) }
        val ms = (System.nanoTime() - t0) / 1e6 / n
        println("RENDER3D triangles=${mesh.triangles} vertices=${mesh.vCount} bitmap=540x960 avg_ms=${"%.2f".format(ms)}")
        assertTrue("render de referencia en JVM < 60 ms", ms < 60)
    }

    @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
    @Test fun teamRendersAs3DCharacters() {
        agents.forEach { a ->
            val mesh = Character3D.build(a.profile.appearance)
            assertTrue("${a.name}: malla 3D con volumen", mesh.triangles > 3000)
        }
        compose.setContent {
            NexusTheme(VisualPrefs(animations = false)) {
                Column(Modifier.background(NexusColors.Background).padding(6.dp)) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        agents.forEach { a ->
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                AgentFigure(a.profile.appearance, a.status, Modifier.size(128.dp, 240.dp))
                                Text(a.name, color = NexusColors.TextPrimary)
                            }
                        }
                    }
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                        agents.forEach { a -> AgentAvatar(a.profile.appearance, a.status, 52.dp) }
                    }
                }
            }
        }
        compose.onRoot().captureRoboImage("build/screenshots/v2_11_characters_3d.png")
    }
}
