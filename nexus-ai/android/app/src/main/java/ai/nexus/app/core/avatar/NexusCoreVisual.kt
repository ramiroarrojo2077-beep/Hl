package ai.nexus.app.core.avatar

import ai.nexus.app.core.design.LocalVisualPrefs
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.realtime.ConnectionState
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.Shadow
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** Estados del asistente (capítulo 2, zona B). Cada uno proviene de una señal real. */
enum class CoreState(val label: String) {
    IDLE("En reposo"),
    LISTENING("Escuchando"),
    THINKING("Pensando"),
    SPEAKING("Hablando"),
    EXECUTING("Ejecutando una acción"),
    COLLABORATING("Consultando a un especialista"),
    WAITING_CONFIRMATION("Esperando tu confirmación"),
    ERROR("Hubo un problema"),
    OFFLINE("Sin conexión con el servidor"),
}

/** Señales reales con las que se decide el estado visual. */
data class CoreSignals(
    val connection: ConnectionState,
    val serverState: String?,
    val listening: Boolean = false,
    val speaking: Boolean = false,
    val awaitingReply: Boolean = false,
    val executingLocal: Boolean = false,
    val pendingConfirmations: Int = 0,
    val recentError: Boolean = false,
)

fun coreStateOf(s: CoreSignals): CoreState = when {
    s.connection != ConnectionState.Connected -> CoreState.OFFLINE
    s.listening -> CoreState.LISTENING
    s.speaking -> CoreState.SPEAKING
    s.recentError || s.serverState == "error" -> CoreState.ERROR
    s.serverState == "collaborating" -> CoreState.COLLABORATING
    s.awaitingReply || s.serverState == "thinking" -> CoreState.THINKING
    s.executingLocal || s.serverState == "executing" -> CoreState.EXECUTING
    s.pendingConfirmations > 0 || s.serverState == "waiting_confirmation" -> CoreState.WAITING_CONFIRMATION
    else -> CoreState.IDLE
}

fun coreColor(state: CoreState): Color = when (state) {
    CoreState.IDLE -> NexusColors.Cyan
    CoreState.LISTENING -> Color(0xFF39F5D2)
    CoreState.THINKING -> NexusColors.Violet
    CoreState.SPEAKING -> NexusColors.Cyan
    CoreState.EXECUTING -> NexusColors.Amber
    CoreState.COLLABORATING -> Color(0xFF5AB8FF)
    CoreState.WAITING_CONFIRMATION -> NexusColors.Amber
    CoreState.ERROR -> NexusColors.Red
    CoreState.OFFLINE -> NexusColors.TextMuted
}

/**
 * Núcleo holográfico de NEXUS: globo 3D en alambre (meridianos y paralelos proyectados en
 * perspectiva, con profundidad), nodos de datos, anillos orbitales, plataforma radial y título.
 * Cada estado tiene su propia animación y se alimenta de señales reales:
 * LISTENING ← nivel del micrófono; SPEAKING ← avance de la voz; el resto ← estado del backend.
 * Con movimiento reducido se dibuja estático.
 */
@Composable
fun NexusCoreVisual(
    state: CoreState,
    modifier: Modifier = Modifier,
    size: Dp = 220.dp,
    audioLevel: Float = 0f,
    speechPulse: Int = 0,
    specialists: Int = 0,
    title: String = "NEXUS",
    subtitle: String = "AI CORE",
    version: String? = "v2.0.0",
) {
    val animate = LocalVisualPrefs.current.animations
    val color by animateColorAsState(coreColor(state), tween(500), label = "coreColor")
    val level by animateFloatAsState(if (state == CoreState.LISTENING) audioLevel else 0f, spring(dampingRatio = 0.6f, stiffness = 300f), label = "lvl")
    val pulseTarget = if (state == CoreState.SPEAKING) (if (speechPulse % 2 == 0) 1f else 0.35f) else 0f
    val pulse by animateFloatAsState(pulseTarget, tween(140), label = "pulse")
    val t = if (animate && state != CoreState.OFFLINE) {
        val transition = rememberInfiniteTransition(label = "core")
        val period = when (state) {
            CoreState.THINKING, CoreState.COLLABORATING -> 9000
            CoreState.EXECUTING -> 12000
            else -> 30000
        }
        transition.animateFloat(0f, 1f, infiniteRepeatable(tween(period, easing = LinearEasing)), label = "t").value
    } else 0.08f
    val fast = if (animate && state != CoreState.OFFLINE) {
        rememberInfiniteTransition(label = "fast").animateFloat(0f, 1f, infiniteRepeatable(tween(2400, easing = LinearEasing)), label = "f").value
    } else 0f
    val nodes = remember { globeNodes() }
    val brand = MaterialTheme.typography.displaySmall
    val measurer = rememberTextMeasurer()

    Box(
        modifier.size(size).semantics {
            contentDescription = "Núcleo de NEXUS"
            stateDescription = state.label
        },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(size)) {
            val c = Offset(this.size.width / 2, this.size.height * 0.47f)
            val r = this.size.minDimension * 0.33f * (1f + level * 0.10f + pulse * 0.04f)
            val yaw = (t * 2 * PI).toFloat()
            val tilt = 0.38f
            // resplandor
            drawCircle(Brush.radialGradient(listOf(color.copy(alpha = if (state == CoreState.OFFLINE) 0.08f else 0.30f + level * 0.2f), color.copy(alpha = 0.05f), Color.Transparent),
                center = c, radius = r * 1.9f), radius = r * 1.9f, center = c)
            drawPlatform(Offset(c.x, c.y + r * 1.32f), r, color, fast, animate && state != CoreState.OFFLINE)
            // anillos orbitales: mitad trasera detrás del globo
            val rings = listOf(Triple(1.35f, 0.42f, 1f), Triple(1.55f, -0.25f, -0.7f))
            rings.forEach { (k, tiltR, dir) -> drawOrbit(c, r * k, tiltR, yaw * dir * 1.6f, color, back = true) }
            drawGlobe(c, r, yaw, tilt, color, state, nodes, fast, animate)
            rings.forEachIndexed { i, (k, tiltR, dir) ->
                drawOrbit(c, r * k, tiltR, yaw * dir * 1.6f, color, back = false)
                drawOrbitParticle(c, r * k, tiltR, yaw * dir * 1.6f + i * 2.1f + fast * 2 * PI.toFloat() * dir, color)
            }
            when (state) {
                CoreState.LISTENING -> drawRipples(c, r, color, fast, level)
                CoreState.SPEAKING -> drawVoiceBars(c, r, color, pulse, fast)
                CoreState.EXECUTING -> drawSweep(c, r * 1.18f, color, fast)
                CoreState.COLLABORATING -> drawSatellites(c, r * 1.35f, color, fast, specialists.coerceIn(1, 5))
                CoreState.WAITING_CONFIRMATION -> drawConfirmRing(c, r, color, fast, animate)
                CoreState.ERROR -> drawCircle(color.copy(alpha = 0.6f), r * 1.12f, c, style = Stroke(2.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(14f, 10f))))
                else -> Unit
            }
            // título holográfico centrado en el globo
            val titleStyle = brand.copy(color = Color.White, fontSize = (r / 4.2f).toSp(), letterSpacing = (r / 18f).toSp(),
                shadow = Shadow(color.copy(alpha = 0.95f), Offset.Zero, 18f))
            val tl = measurer.measure(title, titleStyle)
            drawText(tl, topLeft = Offset(c.x - tl.size.width / 2f, c.y - tl.size.height * 0.85f))
            val subStyle = titleStyle.copy(fontSize = (r / 9.5f).toSp(), letterSpacing = (r / 30f).toSp(), color = color.copy(alpha = 0.95f))
            val sl = measurer.measure(subtitle, subStyle)
            drawText(sl, topLeft = Offset(c.x - sl.size.width / 2f, c.y + tl.size.height * 0.2f))
            version?.let {
                val vl = measurer.measure(it, subStyle.copy(fontSize = (r / 12f).toSp(), color = Color.White.copy(alpha = 0.7f)))
                drawText(vl, topLeft = Offset(c.x - vl.size.width / 2f, c.y + tl.size.height * 0.2f + sl.size.height * 1.05f))
            }
        }
    }
}

private class GlobeNode(val lat: Float, val lon: Float, val size: Float)

/** Nodos de datos distribuidos de forma uniforme (espiral de Fibonacci). */
private fun globeNodes(n: Int = 70): List<GlobeNode> = List(n) { i ->
    val y = 1f - (i + 0.5f) / n * 2f
    val lon = (i * 2.39996323f) % (2 * PI.toFloat())
    GlobeNode(kotlin.math.asin(y), lon, 1f + ((i * 37) % 5) / 3f)
}

/** Proyección de un punto de la esfera unitaria (lat, lon) girado y con inclinación. */
private fun project(c: Offset, r: Float, lat: Float, lon: Float, yaw: Float, tilt: Float): Triple<Float, Float, Float> {
    val x0 = cos(lat) * sin(lon + yaw); val y0 = sin(lat); val z0 = cos(lat) * cos(lon + yaw)
    val y1 = y0 * cos(tilt) - z0 * sin(tilt); val z1 = y0 * sin(tilt) + z0 * cos(tilt)
    val persp = 1f / (1f + z1 * 0.18f)
    return Triple(c.x + x0 * r * persp, c.y - y1 * r * persp, z1)
}

private fun DrawScope.drawGlobe(c: Offset, r: Float, yaw: Float, tilt: Float, color: Color, state: CoreState, nodes: List<GlobeNode>, fast: Float, animate: Boolean) {
    val offline = state == CoreState.OFFLINE
    // esfera de vidrio
    drawCircle(Brush.radialGradient(listOf(color.copy(alpha = 0.16f), color.copy(alpha = 0.05f), Color(0x22020A18)), center = Offset(c.x - r * 0.25f, c.y - r * 0.3f),
        radius = r * 1.3f), radius = r, center = c)
    val stroke = 1.1f.dp.toPx()
    val segs = 56
    fun line(points: List<Triple<Float, Float, Float>>, bright: Float) {
        for (k in 0 until points.size - 1) {
            val (x1, y1, z1) = points[k]; val (x2, y2, z2) = points[k + 1]
            val z = (z1 + z2) / 2f // z<0 frente (hacia el observador)
            val front = (-z + 1f) / 2f
            val a = if (offline) 0.18f else (0.06f + 0.55f * front * front) * bright
            drawLine(color.copy(alpha = a.coerceIn(0f, 1f)), Offset(x1, y1), Offset(x2, y2), stroke * (0.6f + 0.7f * front))
        }
    }
    // paralelos
    for (latDeg in -75..75 step 15) {
        val lat = Math.toRadians(latDeg.toDouble()).toFloat()
        val pts = (0..segs).map { project(c, r, lat, it.toFloat() / segs * 2 * PI.toFloat(), yaw, tilt) }
        val scanning = state == CoreState.THINKING && kotlin.math.abs(sin(fast * PI.toFloat()) * 1.4f - lat) < 0.18f
        line(pts, if (latDeg == 0) 1.4f else if (scanning) 2.2f else 1f)
    }
    // meridianos
    for (lonDeg in 0 until 180 step 15) {
        val lon = Math.toRadians(lonDeg.toDouble()).toFloat()
        val pts = (0..segs).map { project(c, r, -PI.toFloat() / 2 + it.toFloat() / segs * 2 * PI.toFloat(), lon, yaw, tilt) }
        line(pts, 1f)
    }
    // nodos de datos (los del frente brillan)
    for ((i, n) in nodes.withIndex()) {
        val (x, y, z) = project(c, r * 1.005f, n.lat, n.lon, yaw, tilt)
        if (z > 0.15f) continue
        val twinkle = if (animate) 0.6f + 0.4f * sin(fast * 2 * PI.toFloat() * 2 + i) else 1f
        val front = (-z + 1f) / 2f
        drawCircle(color.copy(alpha = (0.25f + 0.75f * front) * twinkle * (if (offline) 0.4f else 1f)), n.size.dp.toPx() * (0.6f + 0.6f * front), Offset(x, y))
    }
    // borde de la esfera
    drawCircle(color.copy(alpha = if (offline) 0.25f else 0.55f), r, c, style = Stroke(1.4f.dp.toPx()))
}

private fun DrawScope.drawOrbit(c: Offset, rad: Float, tilt: Float, rot: Float, color: Color, back: Boolean) {
    val segs = 72
    for (k in 0 until segs) {
        val a1 = k.toFloat() / segs * 2 * PI.toFloat(); val a2 = (k + 1).toFloat() / segs * 2 * PI.toFloat()
        val z = sin((a1 + a2) / 2 + rot)
        if (back != (z > 0)) continue
        val p1 = orbitPoint(c, rad, tilt, a1 + rot); val p2 = orbitPoint(c, rad, tilt, a2 + rot)
        drawLine(color.copy(alpha = if (back) 0.18f else 0.55f), p1, p2, (if (back) 1f else 1.6f).dp.toPx())
    }
}

private fun orbitPoint(c: Offset, rad: Float, tilt: Float, a: Float) = Offset(c.x + cos(a) * rad, c.y + sin(a) * rad * 0.28f + cos(a) * rad * tilt * 0.25f)

private fun DrawScope.drawOrbitParticle(c: Offset, rad: Float, tilt: Float, a: Float, color: Color) {
    val p = orbitPoint(c, rad, tilt, a)
    drawCircle(Brush.radialGradient(listOf(Color.White, color, Color.Transparent), center = p, radius = 7.dp.toPx()), 7.dp.toPx(), p)
}

/** Plataforma radial en perspectiva bajo el globo (como un holoproyector). */
private fun DrawScope.drawPlatform(c: Offset, r: Float, color: Color, fast: Float, animate: Boolean) {
    for (k in 1..5) {
        val rx = r * (0.35f + k * 0.22f); val ry = rx * 0.22f
        drawOval(color.copy(alpha = 0.32f - k * 0.045f), Offset(c.x - rx, c.y - ry), Size(rx * 2, ry * 2), style = Stroke(1.dp.toPx()))
    }
    for (k in 0 until 24) {
        val a = k / 24f * 2 * PI.toFloat()
        val inner = Offset(c.x + cos(a) * r * 0.5f, c.y + sin(a) * r * 0.11f)
        val outer = Offset(c.x + cos(a) * r * 1.45f, c.y + sin(a) * r * 0.32f)
        drawLine(color.copy(alpha = 0.10f), inner, outer, 1f)
    }
    val sweep = if (animate) fast else 0.2f
    val rx = r * 1.25f
    drawArc(color.copy(alpha = 0.5f), 360f * sweep, 50f, false, Offset(c.x - rx, c.y - rx * 0.22f), Size(rx * 2, rx * 0.44f), style = Stroke(2.dp.toPx(), cap = StrokeCap.Round))
}

private fun DrawScope.drawRipples(c: Offset, r: Float, color: Color, fast: Float, level: Float) {
    for (i in 0 until 3) {
        val phase = (fast * 1.5f + i / 3f) % 1f
        drawCircle(color.copy(alpha = (1f - phase) * (0.3f + level * 0.6f)), r * (1.05f + phase * (0.5f + level * 0.6f)), c, style = Stroke(2.dp.toPx()))
    }
}

private fun DrawScope.drawVoiceBars(c: Offset, r: Float, color: Color, pulse: Float, fast: Float) {
    val bars = 28
    for (i in 0 until bars) {
        val a = i.toFloat() / bars * 2 * PI.toFloat()
        val h = r * (0.08f + 0.22f * pulse * (0.6f + 0.4f * sin(fast * 40 + i * 1.7f)))
        val p1 = Offset(c.x + cos(a) * r * 1.08f, c.y + sin(a) * r * 1.08f)
        val p2 = Offset(c.x + cos(a) * (r * 1.08f + h), c.y + sin(a) * (r * 1.08f + h))
        drawLine(color.copy(alpha = 0.85f), p1, p2, 3.dp.toPx(), StrokeCap.Round)
    }
}

private fun DrawScope.drawSweep(c: Offset, radius: Float, color: Color, t: Float) {
    drawArc(color, -90f, 360f * t, false, Offset(c.x - radius, c.y - radius), Size(radius * 2, radius * 2), style = Stroke(3.dp.toPx(), cap = StrokeCap.Round))
}

private fun DrawScope.drawSatellites(c: Offset, rad: Float, color: Color, t: Float, n: Int) {
    for (k in 0 until n) {
        val a = (k.toFloat() / n + t * 0.25f) * 2 * PI.toFloat()
        val p = orbitPoint(c, rad, 0.42f, a)
        drawLine(color.copy(alpha = 0.35f), c, p, 1.dp.toPx())
        drawCircle(color, 6.dp.toPx(), p)
        drawCircle(Color.White.copy(alpha = 0.9f), 2.5f.dp.toPx(), p)
    }
}

private fun DrawScope.drawConfirmRing(c: Offset, r: Float, color: Color, t: Float, animate: Boolean) {
    val a = if (animate) 0.55f + 0.45f * sin(t * 2 * PI.toFloat() * 2) else 1f
    drawCircle(color.copy(alpha = a), r * 1.16f, c, style = Stroke(3.dp.toPx()))
    val badge = Offset(c.x + r * 0.82f, c.y - r * 0.82f)
    drawCircle(color, 11.dp.toPx(), badge)
    drawLine(Color(0xFF1A1200), Offset(badge.x, badge.y - 5.dp.toPx()), Offset(badge.x, badge.y + 1.5f.dp.toPx()), 2.5f.dp.toPx(), StrokeCap.Round)
    drawCircle(Color(0xFF1A1200), 1.6f.dp.toPx(), Offset(badge.x, badge.y + 5.dp.toPx()))
}
