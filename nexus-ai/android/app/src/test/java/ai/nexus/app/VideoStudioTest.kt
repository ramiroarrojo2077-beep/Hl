package ai.nexus.app

import ai.nexus.app.core.network.NexusJson
import ai.nexus.app.local.ClassifyContext
import ai.nexus.app.local.VideoStudio
import ai.nexus.app.local.classify
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.ZonedDateTime

@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35])
class VideoStudioTest {
    private val json = """{"background":"#000000","scenes":[{"duration":3,"background":"#000000","elements":[
        {"type":"rect","x":0.5,"y":0.5,"w":0.5,"h":0.2,"color":"#FF0000","anim":"fade","delay":0.5,"dur":0.5},
        {"type":"text","text":"Hola","x":0.5,"y":0.2,"size":0.1,"color":"#FFFFFF","anim":"none"}]},
        {"duration":99,"elements":[]}]}"""

    @Test fun scriptIsLimitedAndFramesAnimate() {
        val s = VideoStudio.parse(NexusJson.parseToJsonElement(json).jsonObject)
        assertEquals(2, s.scenes.size)
        assertTrue("duración tope por escena y total", s.scenes[1].duration <= 12f && s.totalSeconds <= VideoStudio.MAX_SECONDS)
        fun px(t: Float): Int {
            val bmp = Bitmap.createBitmap(180, 320, Bitmap.Config.ARGB_8888)
            VideoStudio.drawScene(Canvas(bmp), s.scenes[0], t, 180, 320)
            return bmp.getPixel(90, 160) // centro del rectángulo
        }
        assertEquals("antes de aparecer: fondo", Color.BLACK, px(0.1f))
        assertNotEquals("tras la animación: rojo visible", Color.BLACK, px(1.5f))
        assertEquals(Color.RED, px(1.5f))
    }

    @Test fun videoRequestIsRecognized() {
        val now = ZonedDateTime.parse("2026-11-22T15:30:00-03:00")
        val i = classify("Hacé un video de bienvenida para mi comunidad", ClassifyContext(now, now.zone.id))
        assertEquals("video", i.rule)
        assertEquals("Bienvenida para mi comunidad", i.params["topic"])
        assertEquals("clarification", classify("armame un video", ClassifyContext(now, now.zone.id)).handler)
    }
}
