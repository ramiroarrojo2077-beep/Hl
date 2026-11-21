package ai.nexus.app.core.avatar

import ai.nexus.app.core.design.LocalVisualPrefs
import ai.nexus.app.core.design.NexusColors
import ai.nexus.app.core.design.parseHex
import ai.nexus.app.data.model.Appearance
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.lerp
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

private fun Color.darker(f: Float = 0.7f) = Color(red * f, green * f, blue * f, alpha)
private fun Color.lighter(f: Float = 0.25f) = lerp(this, Color.White, f)

/**
 * Personaje holográfico de cuerpo completo, dibujado a partir de la apariencia configurada.
 * La animación refleja el estado real recibido del backend; sin animaciones se dibuja estático.
 */
@Composable
fun AgentFigure(
    appearance: Appearance,
    status: String,
    modifier: Modifier = Modifier,
    bustOnly: Boolean = false,
    showPlatform: Boolean = true,
) {
    val animate = LocalVisualPrefs.current.animations
    val t by if (animate) {
        rememberInfiniteTransition(label = "figure").animateFloat(0f, 1f, infiniteRepeatable(tween(4000, easing = LinearEasing), RepeatMode.Restart), label = "t")
    } else {
        remember { mutableFloatStateOf(0.25f) }
    }
    val colors = FigureColors(
        skin = parseHex(appearance.skin, Color(0xFFE0B899)),
        hair = parseHex(appearance.hairColor, Color(0xFF4A4F5C)),
        eyes = parseHex(appearance.eyes, NexusColors.Cyan),
        outfit = parseHex(appearance.outfitColor, Color(0xFF1A2433)),
        accent = parseHex(appearance.accent, NexusColors.Cyan),
    )
    Canvas(modifier) {
        val phase = (t * 2 * PI).toFloat()
        if (bustOnly) {
            // Recorte de cabeza y hombros dentro del lienzo.
            val u = size.height / 72f
            translate(left = size.width / 2 - 50f * u, top = -12f * u) {
                drawFigure(appearance, colors, status, phase, u, animate, platform = false)
            }
        } else {
            val u = minOf(size.height / 200f, size.width / 110f)
            translate(left = size.width / 2 - 50f * u, top = (size.height - 200f * u) / 2) {
                drawFigure(appearance, colors, status, phase, u, animate, platform = showPlatform)
            }
        }
    }
}

/** Avatar circular (busto) con anillo de estado. */
@Composable
fun AgentAvatar(appearance: Appearance, status: String, size: Dp = 44.dp, modifier: Modifier = Modifier) {
    val accent = parseHex(appearance.accent)
    val ring = statusColor(status)
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(Brush.radialGradient(listOf(accent.copy(alpha = 0.25f), NexusColors.BackgroundAlt)))
            .border(2.dp, if (isActiveStatus(status) || status == "error" || status == "completed") ring else accent.copy(alpha = 0.5f), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        AgentFigure(appearance, status, Modifier.size(size), bustOnly = true)
    }
}

private data class FigureColors(val skin: Color, val hair: Color, val eyes: Color, val outfit: Color, val accent: Color)

private fun DrawScope.drawFigure(a: Appearance, c: FigureColors, status: String, phase: Float, u: Float, animate: Boolean, platform: Boolean) {
    fun p(x: Float, y: Float) = Offset(x * u, y * u)
    val cx = 50f
    val wide = a.body != "b"
    val shoulder = if (wide) 21f else 17.5f
    val waist = if (wide) 13.5f else 11.5f
    val hip = if (wide) 15f else 17f
    val breathe = if (animate) sin(phase * 2) * 0.6f else 0f
    val glitch = status == "error" && animate && sin(phase * 9) > 0.7f
    val alphaMul = if (status == "paused") 0.55f else 1f
    val accent = c.accent.copy(alpha = c.accent.alpha * alphaMul)
    val sColor = statusColor(status)

    if (platform) drawPlatform(cx, u, accent, sColor, phase, status, animate)

    val outfitDark = c.outfit.darker(0.75f)
    val outline = Stroke(width = 0.9f * u)

    translate(left = if (glitch) 2.5f * u else 0f) {
        // ---- pelo posterior
        when (a.hair) {
            "long" -> drawPath(Path().apply {
                moveTo(cx - 13f, 30f); quadraticTo(cx - 17f, 60f, cx - 11f, 76f); lineTo(cx + 11f, 76f)
                quadraticTo(cx + 17f, 60f, cx + 13f, 30f); close()
            }.scaled(u), c.hair.darker(0.85f))
            "ponytail" -> drawPath(Path().apply {
                moveTo(cx + 9f, 26f); quadraticTo(cx + 22f, 34f, cx + 17f, 58f); quadraticTo(cx + 14f, 66f, cx + 11f, 58f)
                quadraticTo(cx + 15f, 40f, cx + 5f, 30f); close()
            }.scaled(u), c.hair.darker(0.85f))
        }

        // ---- piernas y botas
        val legTop = 108f
        val legBottom = 178f
        for (side in listOf(-1f, 1f)) {
            val x = cx + side * 7.5f
            val leg = Path().apply {
                moveTo(x - 5.5f, legTop); lineTo(x + 5.5f, legTop); lineTo(x + 4f, legBottom); lineTo(x - 4f, legBottom); close()
            }.scaled(u)
            drawPath(leg, Brush.verticalGradient(listOf(outfitDark, c.outfit.darker(0.55f)), startY = legTop * u, endY = legBottom * u))
            drawPath(leg, accent.copy(alpha = 0.35f), style = outline)
            if (a.outfit == "armor") {
                drawRoundRect(accent.copy(alpha = 0.5f), p(x - 4.5f, 140f), Size(9f * u, 6f * u), androidx.compose.ui.geometry.CornerRadius(2f * u))
            }
            val boot = Path().apply {
                moveTo(x - 4.6f, legBottom - 6f); lineTo(x + 4.6f, legBottom - 6f); lineTo(x + 5.5f, 186f); lineTo(x - 5f, 186f); close()
            }.scaled(u)
            drawPath(boot, Color(0xFF0D1018))
            drawLine(accent.copy(alpha = 0.8f), p(x - 5f, 186f), p(x + 5.5f, 186f), 1.1f * u)
        }

        // ---- torso según vestimenta
        val torsoTop = 50f + breathe * 0.3f
        val torso = Path().apply {
            moveTo(cx - shoulder, torsoTop + 3f)
            quadraticTo(cx - shoulder - 1f, torsoTop, cx - shoulder + 4f, torsoTop - 1f)
            lineTo(cx + shoulder - 4f, torsoTop - 1f)
            quadraticTo(cx + shoulder + 1f, torsoTop, cx + shoulder, torsoTop + 3f)
            lineTo(cx + waist, 96f); lineTo(cx + hip, 110f); lineTo(cx - hip, 110f); lineTo(cx - waist, 96f); close()
        }.scaled(u)
        val outfitBrush = Brush.verticalGradient(listOf(c.outfit.lighter(0.12f), c.outfit, outfitDark), startY = torsoTop * u, endY = 110f * u)
        when (a.outfit) {
            "coat", "robe" -> {
                val hem = if (a.outfit == "robe") 184f else 158f
                val flare = if (a.outfit == "robe") 24f else 21f
                val coat = Path().apply {
                    moveTo(cx - shoulder, torsoTop + 3f); lineTo(cx + shoulder, torsoTop + 3f)
                    lineTo(cx + waist + 1f, 96f); lineTo(cx + flare, hem); lineTo(cx - flare, hem); lineTo(cx - waist - 1f, 96f); close()
                }.scaled(u)
                drawPath(coat, Brush.verticalGradient(listOf(c.outfit.lighter(0.1f), outfitDark), startY = torsoTop * u, endY = hem * u))
                drawPath(coat, accent.copy(alpha = 0.45f), style = outline)
                if (a.outfit == "coat") {
                    drawLine(accent.copy(alpha = 0.6f), p(cx, 56f), p(cx, hem), 0.8f * u)
                    drawLine(accent.copy(alpha = 0.9f), p(cx - waist, 96f), p(cx + waist, 96f), 1.6f * u)
                } else {
                    drawLine(accent.copy(alpha = 0.85f), p(cx - waist - 1, 98f), p(cx + waist + 1, 94f), 2.2f * u)
                    drawPath(Path().apply { moveTo(cx - 6f, 50f); lineTo(cx, 70f); lineTo(cx + 6f, 50f) }.scaled(u), accent.copy(alpha = 0.6f), style = outline)
                }
            }
            else -> {
                drawPath(torso, outfitBrush)
                drawPath(torso, accent.copy(alpha = 0.45f), style = outline)
            }
        }
        when (a.outfit) {
            "suit" -> {
                drawPath(Path().apply { moveTo(cx - 7f, torsoTop); lineTo(cx, 76f); lineTo(cx + 7f, torsoTop) }.scaled(u), c.outfit.lighter(0.25f), style = Stroke(1.4f * u))
                drawLine(accent.copy(alpha = 0.9f), p(cx, 58f), p(cx, 80f), 1.2f * u)
                drawLine(accent.copy(alpha = 0.5f), p(cx - waist, 96f), p(cx + waist, 96f), 0.8f * u)
            }
            "armor" -> {
                val chest = Path().apply {
                    moveTo(cx - shoulder + 4, torsoTop + 4); lineTo(cx + shoulder - 4, torsoTop + 4); lineTo(cx + waist, 80f)
                    lineTo(cx, 86f); lineTo(cx - waist, 80f); close()
                }.scaled(u)
                drawPath(chest, c.outfit.lighter(0.2f))
                drawPath(chest, accent.copy(alpha = 0.85f), style = Stroke(1.1f * u))
                for (i in 0..2) drawLine(accent.copy(alpha = 0.5f), p(cx - waist + 1, 89f + i * 6), p(cx + waist - 1, 89f + i * 6), 0.8f * u)
                drawCircle(accent.copy(alpha = 0.9f), 2.2f * u, p(cx, 66f))
                for (side in listOf(-1f, 1f)) {
                    drawOval(c.outfit.lighter(0.18f), p(cx + side * shoulder - 7f, torsoTop - 3f), Size(14f * u, 9f * u))
                    drawOval(accent.copy(alpha = 0.7f), p(cx + side * shoulder - 7f, torsoTop - 3f), Size(14f * u, 9f * u), style = Stroke(0.9f * u))
                }
            }
            "jacket" -> {
                drawLine(accent.copy(alpha = 0.95f), p(cx, 54f), p(cx, 104f), 1.3f * u)
                drawPath(Path().apply { moveTo(cx - 8f, torsoTop - 1); lineTo(cx - 3f, 60f); moveTo(cx + 8f, torsoTop - 1); lineTo(cx + 3f, 60f) }.scaled(u),
                    c.outfit.lighter(0.3f), style = Stroke(1.6f * u))
                for (side in listOf(-1f, 1f)) drawLine(accent.copy(alpha = 0.55f), p(cx + side * 4, 70f), p(cx + side * (waist - 1), 66f), 0.9f * u)
                drawLine(accent.copy(alpha = 0.7f), p(cx - hip + 1, 104f), p(cx + hip - 1, 104f), 1f * u)
            }
        }

        // ---- brazos y manos
        for (side in listOf(-1f, 1f)) {
            val sx = cx + side * (shoulder - 2f)
            val ex = cx + side * (shoulder + 3.5f)
            val hx = cx + side * (shoulder + 1.5f)
            val swing = if (animate && isActiveStatus(status)) sin(phase * 2 + side) * 1.5f else 0f
            val arm = Path().apply {
                moveTo(sx - 3.8f, torsoTop + 3); lineTo(sx + 3.8f, torsoTop + 3)
                lineTo(ex + 3.2f, 90f); lineTo(hx + 2.8f + swing, 122f); lineTo(hx - 2.8f + swing, 122f); lineTo(ex - 3.2f, 90f); close()
            }.scaled(u)
            drawPath(arm, Brush.verticalGradient(listOf(c.outfit.lighter(0.08f), outfitDark), startY = torsoTop * u, endY = 122f * u))
            drawPath(arm, accent.copy(alpha = 0.35f), style = outline)
            drawCircle(c.skin, 3.6f * u, p(hx + swing, 125f))
            if (a.outfit == "armor" || a.outfit == "jacket") drawLine(accent.copy(alpha = 0.7f), p(hx - 3 + swing, 116f), p(hx + 3 + swing, 116f), 1f * u)
        }

        // ---- cuello y cabeza
        val headY = 31f + breathe * 0.4f
        drawRect(c.skin.darker(0.85f), p(cx - 3.6f, 42f), Size(7.2f * u, 9f * u))
        drawOval(c.skin, p(cx - 10.5f, headY - 13f), Size(21f * u, 25.5f * u))
        drawOval(Brush.radialGradient(listOf(Color.Transparent, c.skin.darker(0.75f).copy(alpha = 0.35f)), center = p(cx, headY), radius = 13f * u),
            p(cx - 10.5f, headY - 13f), Size(21f * u, 25.5f * u))
        // ojos
        for (side in listOf(-1f, 1f)) {
            drawOval(Color.White.copy(alpha = 0.9f), p(cx + side * 4.2f - 2.2f, headY - 0.6f), Size(4.4f * u, 2.6f * u))
            drawCircle(c.eyes, 1.25f * u, p(cx + side * 4.2f, headY + 0.7f))
            drawCircle(c.eyes.copy(alpha = 0.35f), 2.2f * u, p(cx + side * 4.2f, headY + 0.7f))
        }
        drawArc(c.skin.darker(0.55f), 20f, 140f, false, p(cx - 2.6f, headY + 4.5f), Size(5.2f * u, 2.6f * u), style = Stroke(0.7f * u, cap = StrokeCap.Round))

        // ---- pelo frontal / casco
        when (a.hair) {
            "helmet" -> {
                val helmet = Path().apply {
                    moveTo(cx - 12f, headY + 8f); quadraticTo(cx - 13f, headY - 16f, cx, headY - 16f)
                    quadraticTo(cx + 13f, headY - 16f, cx + 12f, headY + 8f); lineTo(cx + 8f, headY + 9f)
                    lineTo(cx + 8f, headY - 3f); lineTo(cx - 8f, headY - 3f); lineTo(cx - 8f, headY + 9f); close()
                }.scaled(u)
                drawPath(helmet, Brush.verticalGradient(listOf(c.hair.lighter(0.2f), c.hair.darker(0.8f)), startY = (headY - 16) * u, endY = (headY + 9) * u))
                drawPath(helmet, accent.copy(alpha = 0.8f), style = Stroke(1f * u))
                drawLine(accent, p(cx - 8f, headY - 3f), p(cx + 8f, headY - 3f), 1.2f * u)
            }
            "buzz" -> drawArc(c.hair.copy(alpha = 0.85f), 180f, 180f, true, p(cx - 10.8f, headY - 13.5f), Size(21.6f * u, 16f * u))
            "mohawk" -> {
                drawArc(c.hair.darker(0.6f).copy(alpha = 0.6f), 180f, 180f, true, p(cx - 10.6f, headY - 13f), Size(21.2f * u, 14f * u))
                drawPath(Path().apply {
                    moveTo(cx - 3.5f, headY - 9f); lineTo(cx - 4f, headY - 19f); lineTo(cx - 1f, headY - 14f); lineTo(cx + 1f, headY - 21f)
                    lineTo(cx + 2.5f, headY - 14f); lineTo(cx + 5f, headY - 18f); lineTo(cx + 3.5f, headY - 8f); close()
                }.scaled(u), Brush.verticalGradient(listOf(c.hair.lighter(0.3f), c.hair), startY = (headY - 21) * u, endY = (headY - 8) * u))
            }
            else -> {
                val cap = Path().apply {
                    moveTo(cx - 11.5f, headY + 2f); quadraticTo(cx - 13f, headY - 16f, cx, headY - 15.5f)
                    quadraticTo(cx + 13f, headY - 16f, cx + 11.5f, headY + 2f); quadraticTo(cx + 8f, headY - 8f, cx, headY - 8f)
                    quadraticTo(cx - 8f, headY - 8f, cx - 11.5f, headY + 2f); close()
                }.scaled(u)
                drawPath(cap, Brush.verticalGradient(listOf(c.hair.lighter(0.25f), c.hair), startY = (headY - 16) * u, endY = (headY + 2) * u))
                if (a.hair == "asymmetric") {
                    drawPath(Path().apply {
                        moveTo(cx + 4f, headY - 10f); quadraticTo(cx - 9f, headY - 6f, cx - 12.5f, headY + 12f)
                        quadraticTo(cx - 9f, headY + 2f, cx - 4f, headY - 2f); quadraticTo(cx, headY - 7f, cx + 4f, headY - 10f); close()
                    }.scaled(u), c.hair.lighter(0.1f))
                }
                if (a.hair == "long") {
                    for (side in listOf(-1f, 1f)) drawPath(Path().apply {
                        moveTo(cx + side * 10f, headY - 4f); quadraticTo(cx + side * 13.5f, headY + 12f, cx + side * 11f, headY + 26f)
                        lineTo(cx + side * 8.5f, headY + 24f); quadraticTo(cx + side * 10f, headY + 8f, cx + side * 8.6f, headY - 2f); close()
                    }.scaled(u), c.hair)
                }
            }
        }

        // ---- accesorios
        when (a.accessory) {
            "visor" -> {
                drawRoundRect(accent.copy(alpha = 0.55f), p(cx - 9.5f, headY - 2.4f), Size(19f * u, 4.6f * u), androidx.compose.ui.geometry.CornerRadius(2f * u))
                drawLine(Color.White.copy(alpha = 0.7f), p(cx - 7f, headY - 1.2f), p(cx + 2f, headY - 1.2f), 0.6f * u)
            }
            "glasses" -> for (side in listOf(-1f, 1f)) drawRoundRect(accent.copy(alpha = 0.9f), p(cx + side * 4.2f - 3.3f, headY - 2f),
                Size(6.6f * u, 4.4f * u), androidx.compose.ui.geometry.CornerRadius(1.5f * u), style = Stroke(0.8f * u))
            "headset" -> {
                drawArc(accent.copy(alpha = 0.85f), 190f, 160f, false, p(cx - 12.5f, headY - 17f), Size(25f * u, 26f * u), style = Stroke(1.2f * u))
                drawCircle(accent, 2.6f * u, p(cx + 11.5f, headY + 1f))
                drawLine(accent.copy(alpha = 0.8f), p(cx + 11.5f, headY + 2f), p(cx + 5f, headY + 7f), 0.9f * u)
            }
            "halo" -> {
                val pulse = if (animate) 0.6f + 0.4f * sin(phase) else 0.8f
                drawOval(accent.copy(alpha = pulse), p(cx - 11f, headY - 22f), Size(22f * u, 5f * u), style = Stroke(1.4f * u))
                drawOval(accent.copy(alpha = 0.18f * pulse), p(cx - 13f, headY - 23f), Size(26f * u, 7f * u), style = Stroke(3f * u))
            }
        }

        drawStatusEffects(cx, headY, u, status, phase, animate, sColor)
    }

    // líneas de barrido holográfico
    if (!platform) return
    clipRect(top = 0f, bottom = 190f * u) {
        var y = 0f
        while (y < 190f * u) {
            drawLine(accent.copy(alpha = 0.04f), Offset(15f * u, y), Offset(85f * u, y), 1f)
            y += 3f * u
        }
    }
}

private fun DrawScope.drawPlatform(cx: Float, u: Float, accent: Color, sColor: Color, phase: Float, status: String, animate: Boolean) {
    val center = Offset(cx * u, 188f * u)
    drawOval(Brush.radialGradient(listOf(accent.copy(alpha = 0.35f), Color.Transparent), center = center, radius = 34f * u),
        Offset((cx - 34f) * u, 180f * u), Size(68f * u, 16f * u))
    for (i in 0..2) {
        val w = (24f + i * 8f) * u
        drawOval(accent.copy(alpha = 0.55f - i * 0.15f), Offset(center.x - w, center.y - w * 0.22f), Size(w * 2, w * 0.44f), style = Stroke(0.8f * u))
    }
    if (status == "completed") {
        val k = if (animate) (phase / (2 * PI).toFloat()) else 0.5f
        val w = (20f + 30f * k) * u
        drawOval(sColor.copy(alpha = 1f - k), Offset(center.x - w, center.y - w * 0.22f), Size(w * 2, w * 0.44f), style = Stroke(1.5f * u))
    }
    // haz de luz hacia arriba
    drawRect(Brush.verticalGradient(listOf(Color.Transparent, accent.copy(alpha = 0.08f)), startY = 20f * u, endY = 188f * u),
        Offset((cx - 26f) * u, 20f * u), Size(52f * u, 168f * u))
}

private fun DrawScope.drawStatusEffects(cx: Float, headY: Float, u: Float, status: String, phase: Float, animate: Boolean, color: Color) {
    when (status) {
        "thinking" -> rotate(if (animate) phase * 57.3f else 0f, pivot = Offset(cx * u, (headY - 2) * u)) {
            drawOval(color.copy(alpha = 0.8f), Offset((cx - 17f) * u, (headY - 9f) * u), Size(34f * u, 12f * u),
                style = Stroke(1f * u, pathEffect = PathEffect.dashPathEffect(floatArrayOf(3f * u, 3f * u))))
            drawCircle(color, 1.6f * u, Offset((cx + 17f) * u, (headY - 3f) * u))
        }
        "working" -> for (i in 0..4) {
            val k = ((phase / (2 * PI).toFloat()) + i / 5f) % 1f
            val side = if (i % 2 == 0) -1f else 1f
            drawCircle(color.copy(alpha = (1f - k) * 0.9f), (1.4f - k) * u, Offset((cx + side * 22f + side * k * 4f) * u, (120f - k * 40f) * u))
        }
        "collaborating" -> for (side in listOf(-1f, 1f)) for (i in 0..2) {
            val k = ((phase / (2 * PI).toFloat()) + i / 3f) % 1f
            drawArc(color.copy(alpha = 1f - k), if (side < 0) 120f else -60f, 120f, false,
                Offset((cx + side * 6f - (10f + k * 14f)) * u, (headY - (10f + k * 14f)) * u), Size((20f + k * 28f) * u, (20f + k * 28f) * u),
                style = Stroke(0.9f * u))
        }
        "error" -> {
            drawRect(color.copy(alpha = if (animate) 0.05f + 0.06f * (sin(phase * 7) + 1f) else 0.08f), Offset(18f * u, 10f * u), Size(64f * u, 178f * u))
            drawCircle(color, 3f * u, Offset((cx + 14f) * u, (headY - 14f) * u))
        }
    }
}

private fun Path.scaled(u: Float): Path = Path().also { out ->
    out.addPath(this)
    out.transform(androidx.compose.ui.graphics.Matrix().apply { scale(u, u) })
}
