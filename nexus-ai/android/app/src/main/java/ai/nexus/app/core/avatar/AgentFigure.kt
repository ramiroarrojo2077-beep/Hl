package ai.nexus.app.core.avatar

import ai.nexus.app.core.design.LocalVisualPrefs
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.parseHex
import ai.nexus.app.core.three.Camera
import ai.nexus.app.core.three.Lighting
import ai.nexus.app.core.three.RenderTarget
import ai.nexus.app.core.three.drawModel
import ai.nexus.app.data.model.Appearance
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.PI
import kotlin.math.sin

/** Color asociado a cada estado real del agente. */
fun statusColor(status: String): Color = when (status) {
    "thinking" -> NexusColors.Violet
    "working" -> NexusColors.Cyan
    "collaborating" -> NexusColors.Pink
    "completed" -> NexusColors.Green
    "error" -> NexusColors.Red
    "paused" -> NexusColors.Amber
    else -> NexusColors.TextSecondary
}

fun isActiveStatus(status: String) = status in setOf("thinking", "working", "collaborating")

private fun Color.argb(): Int = android.graphics.Color.argb((alpha * 255).toInt(), (red * 255).toInt(), (green * 255).toInt(), (blue * 255).toInt())

/** Luz de borde con el color de acento del personaje: el aspecto holográfico de cada agente. */
fun characterLighting(accent: Color, status: String): Lighting = Lighting(
    rimColor = (if (isActiveStatus(status) || status == "error") statusColor(status) else accent).argb(),
    rimStrength = if (status == "paused") 0.45f else 0.95f,
    fillColor = accent.argb(),
)

/**
 * Personaje 3D de cuerpo completo (malla real con iluminación, no un dibujo plano), sobre una
 * plataforma holográfica. Gira suavemente; con `interactive` se rota con el dedo. Las animaciones
 * reflejan el estado real del agente y se desactivan con movimiento reducido.
 */
@Composable
fun AgentFigure(
    appearance: Appearance,
    status: String,
    modifier: Modifier = Modifier,
    bustOnly: Boolean = false,
    showPlatform: Boolean = true,
    interactive: Boolean = false,
    baseYaw: Float = -0.35f,
) {
    val animate = LocalVisualPrefs.current.animations
    val mesh = remember(appearance) { Character3D.mesh(appearance) }
    val target = remember { RenderTarget() }
    var dragYaw by remember { mutableFloatStateOf(0f) }
    val t = if (animate && !bustOnly) {
        rememberInfiniteTransition(label = "figure3d").animateFloat(0f, 1f, infiniteRepeatable(tween(9000, easing = LinearEasing)), label = "t").value
    } else 0.25f
    val accent = parseHex(appearance.accent, NexusColors.Cyan)
    val sColor = statusColor(status)
    val lighting = remember(appearance.accent, status) { characterLighting(accent, status) }
    val dragModifier = if (interactive) Modifier.pointerInput(Unit) {
        detectHorizontalDragGestures { _, dx -> dragYaw += dx / 160f }
    } else Modifier
    Canvas(modifier.then(dragModifier).semantics { contentDescription = "Personaje 3D" }) {
        val phase = (t * 2 * PI).toFloat()
        val sway = if (animate && !bustOnly) sin(phase) * 0.32f else 0f
        val breathe = if (animate && !bustOnly) sin(phase * 5f) * 0.004f else 0f
        val cam = if (bustOnly) Camera(yaw = -0.2f, pitch = 0.04f, distance = 1.25f, targetY = 1.66f, fov = 2.05f)
        else Camera(yaw = baseYaw + sway + dragYaw, pitch = 0.07f, distance = 4.3f, targetY = 0.93f + breathe, fov = 1.9f)
        if (!bustOnly && showPlatform) drawPlatform(cam, accent, sColor, phase, status, animate, behind = true)
        if (!bustOnly) drawAura(accent, sColor, status, phase, animate)
        val flicker = status == "error" && animate && sin(phase * 23) > 0.85f
        drawModel(target, mesh, cam, lighting, supersample = if (bustOnly) 1.6f else 1.35f, alpha = when {
            status == "paused" -> 0.6f
            flicker -> 0.55f
            else -> 1f
        })
        if (!bustOnly && showPlatform) drawPlatform(cam, accent, sColor, phase, status, animate, behind = false)
    }
}

/** Plataforma holográfica proyectada en perspectiva bajo los pies (y = 0 del modelo). */
private fun DrawScope.drawPlatform(cam: Camera, accent: Color, sColor: Color, phase: Float, status: String, animate: Boolean, behind: Boolean) {
    val f = cam.fov * size.height
    val floorY = size.height / 2 + cam.targetY * f / cam.distance
    val cx = size.width / 2
    val rx = 0.36f * f / cam.distance
    val ry = rx * 0.26f
    val ring = if (isActiveStatus(status) || status == "error" || status == "completed") sColor else accent
    if (behind) {
        drawOval(Brush.radialGradient(listOf(ring.copy(alpha = 0.45f), ring.copy(alpha = 0.08f), Color.Transparent), center = Offset(cx, floorY),
            radius = rx * 1.4f), topLeft = Offset(cx - rx * 1.4f, floorY - ry * 1.4f), size = Size(rx * 2.8f, ry * 2.8f))
        drawOval(ring.copy(alpha = 0.35f), Offset(cx - rx * 0.55f, floorY - ry * 0.55f), Size(rx * 1.1f, ry * 1.1f), style = Stroke(1.dp.toPx()))
        // haz de luz vertical tenue
        drawRect(Brush.verticalGradient(listOf(Color.Transparent, ring.copy(alpha = 0.10f)), startY = floorY - rx * 3.5f, endY = floorY),
            topLeft = Offset(cx - rx * 0.75f, floorY - rx * 3.5f), size = Size(rx * 1.5f, rx * 3.5f))
    } else {
        val pulse = if (animate) 0.5f + 0.5f * sin(phase * 3) else 1f
        drawOval(ring.copy(alpha = 0.85f), Offset(cx - rx, floorY - ry), Size(rx * 2, ry * 2), style = Stroke(2.dp.toPx()))
        drawOval(ring.copy(alpha = 0.25f + 0.35f * pulse), Offset(cx - rx * 1.18f, floorY - ry * 1.18f), Size(rx * 2.36f, ry * 2.36f), style = Stroke(1.dp.toPx()))
        for (k in 0 until 12) {
            val a = k / 12f * 2 * PI.toFloat() + (if (animate) phase * 0.5f else 0f)
            val px = cx + kotlin.math.cos(a) * rx * 1.18f; val py = floorY + sin(a) * ry * 1.18f
            if (sin(a) > -0.2f) drawCircle(ring.copy(alpha = 0.8f), 1.6f.dp.toPx(), Offset(px, py))
        }
    }
}

private fun DrawScope.drawAura(accent: Color, sColor: Color, status: String, phase: Float, animate: Boolean) {
    val c = Offset(size.width / 2, size.height * 0.45f)
    val active = isActiveStatus(status)
    val k = if (active && animate) 0.75f + 0.25f * sin(phase * 4) else 0.6f
    val col = if (active || status == "error") sColor else accent
    drawCircle(Brush.radialGradient(listOf(col.copy(alpha = 0.20f * k), Color.Transparent), center = c, radius = size.minDimension * 0.55f),
        radius = size.minDimension * 0.55f, center = c)
}

/** Avatar circular (busto 3D) con anillo de estado. Se dibuja una vez (sin animación) para listas largas. */
@Composable
fun AgentAvatar(appearance: Appearance, status: String, size: Dp = 44.dp, modifier: Modifier = Modifier) {
    val accent = parseHex(appearance.accent)
    val ring = statusColor(status)
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(Brush.radialGradient(listOf(accent.copy(alpha = 0.32f), NexusColors.BackgroundAlt)))
            .border(2.dp, if (isActiveStatus(status) || status == "error" || status == "completed") ring else accent.copy(alpha = 0.55f), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        AgentFigure(appearance, status, Modifier.size(size), bustOnly = true)
    }
}
