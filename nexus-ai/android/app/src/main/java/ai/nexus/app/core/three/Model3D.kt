package ai.nexus.app.core.three

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import kotlin.math.max
import kotlin.math.roundToInt

/** Bitmap y rasterizador reutilizados entre cuadros (sin asignaciones por cuadro). */
class RenderTarget {
    val renderer = Renderer3D()
    private var bitmap: Bitmap? = null

    fun ensure(w: Int, h: Int): Bitmap {
        val b = bitmap
        if (b != null && b.width == w && b.height == h) return b
        b?.recycle()
        return Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also { bitmap = it }
    }
}

/**
 * Dibuja una malla 3D. `supersample` > 1 renderiza a mayor resolución y reduce con filtrado
 * (bordes suaves). La resolución se limita para cuidar memoria y batería.
 */
fun DrawScope.drawModel(target: RenderTarget, mesh: Mesh, camera: Camera, lighting: Lighting = Lighting(), supersample: Float = 1.4f,
                        maxSide: Int = 1300, alpha: Float = 1f) {
    if (size.width < 2f || size.height < 2f) return
    val scale = minOf(supersample, maxSide / max(size.width, size.height))
    val w = (size.width * scale).roundToInt().coerceAtLeast(2)
    val h = (size.height * scale).roundToInt().coerceAtLeast(2)
    val bmp = target.ensure(w, h)
    target.renderer.render(mesh, bmp, camera, lighting, alpha = alpha)
    drawImage(bmp.asImageBitmap(), srcOffset = IntOffset.Zero, srcSize = IntSize(w, h), dstOffset = IntOffset.Zero,
        dstSize = IntSize(size.width.roundToInt(), size.height.roundToInt()), filterQuality = FilterQuality.High)
}

@Composable
fun Model3D(mesh: Mesh, camera: Camera, modifier: Modifier = Modifier, lighting: Lighting = Lighting(), supersample: Float = 1.4f) {
    val target = remember { RenderTarget() }
    Canvas(modifier) { drawModel(target, mesh, camera, lighting, supersample) }
}
