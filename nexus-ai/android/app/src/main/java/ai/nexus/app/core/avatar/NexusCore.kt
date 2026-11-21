package ai.nexus.app.core.avatar

import ai.nexus.app.core.design.LocalVisualPrefs
import ai.nexus.app.core.design.NexusColors
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/**
 * Núcleo de NEXUS: esfera wireframe con órbitas. La velocidad depende de la cantidad real de
 * agentes activos; se tiñe de rojo con STOP ALL y de ámbar sin conexión.
 */
@Composable
fun NexusCore(activeAgents: Int, emergency: Boolean, connected: Boolean, subtitle: String, modifier: Modifier = Modifier) {
    val animate = LocalVisualPrefs.current.animations
    val period = when {
        emergency -> 60000
        activeAgents == 0 -> 26000
        else -> (14000 / activeAgents.coerceAtMost(4)).coerceAtLeast(4500)
    }
    val rot by if (animate) {
        rememberInfiniteTransition(label = "core").animateFloat(0f, 360f, infiniteRepeatable(tween(period, easing = LinearEasing), RepeatMode.Restart), label = "rot")
    } else remember { mutableFloatStateOf(20f) }
    val pulse by if (animate && activeAgents > 0) {
        rememberInfiniteTransition(label = "pulse").animateFloat(0.85f, 1f, infiniteRepeatable(tween(1600), RepeatMode.Reverse), label = "p")
    } else remember { mutableFloatStateOf(0.9f) }
    val color = when {
        emergency -> NexusColors.Red
        !connected -> NexusColors.Amber
        else -> NexusColors.Cyan
    }
    val points = remember { List(70) { Random(it).let { r -> Triple(r.nextFloat() * 2 * PI.toFloat(), (r.nextFloat() - 0.5f) * PI.toFloat(), r.nextFloat()) } } }

    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val c = Offset(size.width / 2, size.height * 0.46f)
            val r = minOf(size.width, size.height) * 0.30f
            val theta = rot * PI.toFloat() / 180f
            drawCircle(Brush.radialGradient(listOf(color.copy(alpha = 0.28f * pulse), Color.Transparent), c, r * 1.9f), r * 1.9f, c)
            drawCircle(Brush.radialGradient(listOf(color.copy(alpha = 0.18f), NexusColors.Background.copy(alpha = 0.4f)), c, r), r, c)
            // latitudes
            for (i in -3..3) {
                val lat = i / 4f * (PI / 2).toFloat()
                val ry = r * cos(lat)
                val y = c.y + r * sin(lat)
                drawOval(color.copy(alpha = 0.22f), Offset(c.x - ry, y - ry * 0.12f), Size(ry * 2, ry * 0.24f), style = Stroke(1f))
            }
            // longitudes (rotan)
            for (i in 0 until 8) {
                val lon = theta + i * PI.toFloat() / 8f
                val w = r * abs(sin(lon))
                drawOval(color.copy(alpha = 0.16f + 0.2f * abs(cos(lon))), Offset(c.x - w, c.y - r), Size(w * 2, r * 2), style = Stroke(1f))
            }
            // puntos sobre la superficie
            points.forEach { (lon0, lat, b) ->
                val lon = lon0 + theta
                val z = cos(lat) * cos(lon)
                if (z > -0.2f) {
                    val p = Offset(c.x + r * cos(lat) * sin(lon), c.y + r * sin(lat))
                    drawCircle(color.copy(alpha = (0.35f + 0.65f * z.coerceAtLeast(0f)) * (0.5f + b / 2)), 1.2f + 1.6f * b * z.coerceAtLeast(0f), p)
                }
            }
            drawCircle(color.copy(alpha = 0.6f), r, c, style = Stroke(1.4f))
            // órbitas inclinadas con satélites
            listOf(-18f to 1.25f, 24f to 1.45f, 70f to 1.12f).forEachIndexed { idx, (tilt, scale) ->
                rotate(tilt, c) {
                    val rx = r * scale * 1.25f
                    val ry = r * scale * 0.32f
                    drawOval(color.copy(alpha = 0.35f), Offset(c.x - rx, c.y - ry), Size(rx * 2, ry * 2), style = Stroke(1.1f))
                    val a = theta * (1.4f + idx * 0.5f) + idx
                    drawCircle(color, 2.6f, Offset(c.x + rx * cos(a), c.y + ry * sin(a)))
                }
            }
            // plataforma
            for (i in 0..3) {
                val w = r * (0.9f + i * 0.28f)
                drawOval(color.copy(alpha = 0.32f - i * 0.07f), Offset(c.x - w, c.y + r * 1.32f - w * 0.1f), Size(w * 2, w * 0.2f), style = Stroke(1f))
            }
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.align(Alignment.Center)) {
            Text("NEXUS", style = MaterialTheme.typography.displaySmall.copy(fontWeight = FontWeight.Light, letterSpacing = 10.sp), color = color)
            Text("AI CORE", style = MaterialTheme.typography.labelMedium.copy(letterSpacing = 6.sp), color = NexusColors.TextPrimary.copy(alpha = 0.85f))
            Text(subtitle, style = MaterialTheme.typography.labelSmall, color = NexusColors.TextSecondary)
        }
    }
}
