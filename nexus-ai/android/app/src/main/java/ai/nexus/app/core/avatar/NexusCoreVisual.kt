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
import androidx.compose.ui.graphics.drawscope.rotate
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
    CoreState.IDLE -> NexusColors.Accent
    CoreState.LISTENING -> NexusColors.Cyan
    CoreState.THINKING -> NexusColors.Violet
    CoreState.SPEAKING -> NexusColors.Accent
    CoreState.EXECUTING -> NexusColors.Amber
    CoreState.COLLABORATING -> NexusColors.Cyan
    CoreState.WAITING_CONFIRMATION -> NexusColors.Amber
    CoreState.ERROR -> NexusColors.Red
    CoreState.OFFLINE -> NexusColors.TextMuted
}

/**
 * Núcleo visual de NEXUS dibujado en Canvas: esfera con iluminación y profundidad, anillos
 * orbitales, partículas con perspectiva y ondas de actividad.
 * - LISTENING reacciona al nivel REAL del micrófono (`audioLevel`).
 * - SPEAKING late con el avance REAL de la voz (`speechPulse` cambia con cada palabra).
 * - Con movimiento reducido no hay animaciones continuas: solo color y forma por estado.
 */
@Composable
fun NexusCoreVisual(
    state: CoreState,
    modifier: Modifier = Modifier,
    size: Dp = 220.dp,
    audioLevel: Float = 0f,
    speechPulse: Int = 0,
    specialists: Int = 0,
) {
    val animate = LocalVisualPrefs.current.animations
    val color by animateColorAsState(coreColor(state), tween(450), label = "coreColor")
    val level by animateFloatAsState(if (state == CoreState.LISTENING) audioLevel else 0f, spring(dampingRatio = 0.6f, stiffness = 300f), label = "lvl")
    // Pulso de habla: cada palabra pronunciada (evento real del TTS) dispara un impulso que decae.
    val pulseTarget = if (state == CoreState.SPEAKING) (if (speechPulse % 2 == 0) 1f else 0.35f) else 0f
    val pulse by animateFloatAsState(pulseTarget, tween(140), label = "pulse")

    val t = if (animate && state != CoreState.OFFLINE) {
        val transition = rememberInfiniteTransition(label = "core")
        val period = when (state) {
            CoreState.THINKING, CoreState.COLLABORATING -> 2600
            CoreState.EXECUTING -> 1800
            CoreState.LISTENING, CoreState.SPEAKING -> 5200
            CoreState.ERROR -> 3600
            else -> 14000 // reposo: movimiento muy sutil, sin simular procesamiento
        }
        transition.animateFloat(0f, 1f, infiniteRepeatable(tween(period, easing = LinearEasing)), label = "t").value
    } else 0f
    val particles = remember { List(26) { i -> Particle(seed = i) } }

    Box(
        modifier.size(size).semantics {
            contentDescription = "Núcleo de NEXUS"
            stateDescription = state.label
        },
        contentAlignment = Alignment.Center,
    ) {
        Canvas(Modifier.size(size)) {
            val c = center
            val r = this.size.minDimension / 2f
            val core = r * 0.38f * (1f + level * 0.18f + pulse * 0.08f)
            drawGlow(c, r, color, state, level, pulse)
            drawOrbits(c, r, color, state, t, animate)
            if (state == CoreState.COLLABORATING) drawSatellites(c, r, color, t, specialists.coerceIn(1, 5))
            drawParticles(c, r, color, particles, t, state, animate)
            drawSphere(c, core, color, state)
            when (state) {
                CoreState.LISTENING -> drawWaves(c, core, color, t, level, animate)
                CoreState.SPEAKING -> drawVoiceBars(c, core, color, pulse, t)
                CoreState.EXECUTING -> drawSweep(c, core * 1.35f, color, t)
                CoreState.WAITING_CONFIRMATION -> drawConfirmMark(c, core, color, t, animate)
                CoreState.ERROR -> drawErrorMark(c, core, color)
                CoreState.OFFLINE -> drawOfflineMark(c, core)
                else -> Unit
            }
        }
    }
}

/** Distribución uniforme y determinista (secuencias de baja discrepancia, sin aglomerarse). */
private class Particle(seed: Int) {
    private fun frac(x: Double) = (x - kotlin.math.floor(x)).toFloat()
    val orbit = 0.55f + frac(seed * 0.618033988749) * 0.42f
    val phase = frac(seed * 0.381966011250 + 0.13)
    val tilt = 0.25f + frac(seed * 0.754877666247) * 0.5f
    val speed = if (seed % 2 == 0) 1f else -1f
    val size = 1.2f + frac(seed * 0.569840290998) * 2.2f
}

private fun DrawScope.drawGlow(c: Offset, r: Float, color: Color, state: CoreState, level: Float, pulse: Float) {
    val intensity = when (state) {
        CoreState.OFFLINE -> 0.10f
        CoreState.IDLE -> 0.22f
        else -> 0.34f
    } + level * 0.25f + pulse * 0.15f
    drawCircle(Brush.radialGradient(listOf(color.copy(alpha = intensity), color.copy(alpha = intensity * 0.3f), Color.Transparent),
        center = c, radius = r), radius = r, center = c)
}

private fun DrawScope.drawOrbits(c: Offset, r: Float, color: Color, state: CoreState, t: Float, animate: Boolean) {
    val alpha = if (state == CoreState.OFFLINE) 0.18f else 0.45f
    val rings = listOf(0.62f to 1f, 0.78f to -0.6f, 0.93f to 0.35f)
    rings.forEachIndexed { i, (rad, dir) ->
        val radius = r * rad
        val angle = if (animate) t * 360f * dir else i * 40f
        rotate(angle, c) {
            val sweep = when (state) {
                CoreState.THINKING -> 70f
                CoreState.EXECUTING -> 110f
                else -> 150f
            }
            drawArc(color.copy(alpha = alpha * (1f - i * 0.22f)), 0f, sweep, false, Offset(c.x - radius, c.y - radius), Size(radius * 2, radius * 2),
                style = Stroke(width = (2.2f - i * 0.5f).dp.toPx(), cap = StrokeCap.Round))
            drawArc(color.copy(alpha = alpha * 0.35f), 180f, sweep * 0.5f, false, Offset(c.x - radius, c.y - radius), Size(radius * 2, radius * 2),
                style = Stroke(width = 1.dp.toPx(), cap = StrokeCap.Round))
        }
    }
    if (state == CoreState.THINKING) {
        // Anillo segmentado: actividad de procesamiento (solo cuando el servidor está procesando).
        val radius = r * 0.5f
        for (k in 0 until 12) {
            val a = (k / 12f + t) * 2 * PI
            val on = ((k + (t * 12).toInt()) % 3 == 0)
            drawCircle(color.copy(alpha = if (on) 0.9f else 0.25f), 2.4f.dp.toPx(), Offset(c.x + cos(a).toFloat() * radius, c.y + sin(a).toFloat() * radius))
        }
    }
}

private fun DrawScope.drawParticles(c: Offset, r: Float, color: Color, ps: List<Particle>, t: Float, state: CoreState, animate: Boolean) {
    if (state == CoreState.OFFLINE) return
    val speedK = when (state) { CoreState.THINKING, CoreState.COLLABORATING, CoreState.EXECUTING -> 2.2f; CoreState.IDLE -> 0.6f; else -> 1.2f }
    for (p in ps) {
        val a = ((p.phase + (if (animate) t * speedK * p.speed else 0f)) % 1f) * 2 * PI
        val x = cos(a).toFloat() * r * p.orbit
        val z = sin(a).toFloat()
        val y = z * r * p.orbit * p.tilt
        val depth = (z + 1f) / 2f // 0 = atrás, 1 = adelante
        drawCircle(color.copy(alpha = 0.15f + depth * 0.6f), (p.size * (0.6f + depth * 0.8f)).dp.toPx(), Offset(c.x + x, c.y + y))
    }
}

private fun DrawScope.drawSphere(c: Offset, radius: Float, color: Color, state: CoreState) {
    val base = if (state == CoreState.OFFLINE) NexusColors.SurfaceHigh else color
    drawCircle(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.85f), base, base.copy(alpha = 0.55f), NexusColors.Background),
        center = Offset(c.x - radius * 0.35f, c.y - radius * 0.4f), radius = radius * 1.6f), radius = radius, center = c)
    drawCircle(base.copy(alpha = 0.7f), radius, c, style = Stroke(1.5f.dp.toPx()))
    drawCircle(Brush.radialGradient(listOf(Color.Transparent, NexusColors.Background.copy(alpha = 0.55f)), center = c, radius = radius),
        radius = radius, center = c)
}

private fun DrawScope.drawWaves(c: Offset, core: Float, color: Color, t: Float, level: Float, animate: Boolean) {
    for (i in 0 until 3) {
        val phase = if (animate) ((t * 3f + i / 3f) % 1f) else i / 3f
        val radius = core * (1.1f + phase * (0.7f + level * 0.9f))
        drawCircle(color.copy(alpha = (1f - phase) * (0.25f + level * 0.6f)), radius, c, style = Stroke(2.dp.toPx()))
    }
}

private fun DrawScope.drawVoiceBars(c: Offset, core: Float, color: Color, pulse: Float, t: Float) {
    val bars = 9
    val w = core * 0.11f
    for (i in 0 until bars) {
        val x = c.x + (i - bars / 2) * w * 1.6f
        val shape = 1f - kotlin.math.abs(i - bars / 2) / (bars / 2f + 1)
        val h = core * (0.18f + shape * (0.25f + pulse * 0.55f) * (0.7f + 0.3f * sin((t * 20 + i) .toDouble()).toFloat()))
        drawLine(Color.White.copy(alpha = 0.9f), Offset(x, c.y - h / 2), Offset(x, c.y + h / 2), strokeWidth = w, cap = StrokeCap.Round)
    }
}

private fun DrawScope.drawSweep(c: Offset, radius: Float, color: Color, t: Float) {
    drawArc(color, -90f, 360f * t, false, Offset(c.x - radius, c.y - radius), Size(radius * 2, radius * 2), style = Stroke(3.dp.toPx(), cap = StrokeCap.Round))
}

private fun DrawScope.drawSatellites(c: Offset, r: Float, color: Color, t: Float, n: Int) {
    for (k in 0 until n) {
        val a = (k.toFloat() / n + t * 0.5f) * 2 * PI
        val p = Offset(c.x + cos(a).toFloat() * r * 0.8f, c.y + sin(a).toFloat() * r * 0.8f)
        drawLine(color.copy(alpha = 0.35f), c, p, strokeWidth = 1.dp.toPx())
        drawCircle(color, 5.dp.toPx(), p)
        drawCircle(Color.White.copy(alpha = 0.8f), 2.dp.toPx(), p)
    }
}

private fun DrawScope.drawConfirmMark(c: Offset, core: Float, color: Color, t: Float, animate: Boolean) {
    val a = if (animate) 0.55f + 0.45f * sin(t * 2 * PI * 4).toFloat() else 1f
    drawCircle(color.copy(alpha = a), core * 1.25f, c, style = Stroke(3.dp.toPx()))
    drawLine(Color.White, Offset(c.x, c.y - core * 0.45f), Offset(c.x, c.y + core * 0.12f), strokeWidth = 5.dp.toPx(), cap = StrokeCap.Round)
    drawCircle(Color.White, 3.dp.toPx(), Offset(c.x, c.y + core * 0.38f))
}

private fun DrawScope.drawErrorMark(c: Offset, core: Float, color: Color) {
    val d = core * 0.32f
    drawLine(Color.White, Offset(c.x - d, c.y - d), Offset(c.x + d, c.y + d), strokeWidth = 4.dp.toPx(), cap = StrokeCap.Round)
    drawLine(Color.White, Offset(c.x + d, c.y - d), Offset(c.x - d, c.y + d), strokeWidth = 4.dp.toPx(), cap = StrokeCap.Round)
    drawCircle(color, core * 1.2f, c, style = Stroke(2.dp.toPx()))
}

private fun DrawScope.drawOfflineMark(c: Offset, core: Float) {
    val w = core * 0.5f
    drawLine(NexusColors.TextSecondary, Offset(c.x - w, c.y), Offset(c.x + w, c.y), strokeWidth = 4.dp.toPx(), cap = StrokeCap.Round)
}
