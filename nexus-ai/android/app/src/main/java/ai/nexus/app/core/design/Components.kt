package ai.nexus.app.core.design

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.Inbox
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import kotlin.math.sin

val PanelShape = RoundedCornerShape(14.dp)

/** Fondo de la app: degradado profundo con retícula tenue. */
@Composable
fun HudBackground(modifier: Modifier = Modifier, content: @Composable BoxScope.() -> Unit) {
    Box(
        modifier
            .fillMaxSize()
            .background(Brush.verticalGradient(listOf(NexusColors.Background, Color(0xFF0A0F1C), NexusColors.Background)))
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val step = 48.dp.toPx()
            val grid = Color(0x0D00D9FF)
            var x = 0f
            while (x < size.width) {
                drawLine(grid, Offset(x, 0f), Offset(x, size.height), 1f); x += step
            }
            var y = 0f
            while (y < size.height) {
                drawLine(grid, Offset(0f, y), Offset(size.width, y), 1f); y += step
            }
            drawCircle(
                Brush.radialGradient(listOf(Color(0x1400D9FF), Color.Transparent), center = Offset(size.width * 0.5f, size.height * 0.2f), radius = size.width),
                radius = size.width, center = Offset(size.width * 0.5f, size.height * 0.2f),
            )
        }
        content()
    }
}

/** Panel translúcido con borde luminoso y esquinas tipo HUD. */
@Composable
fun HudPanel(
    modifier: Modifier = Modifier,
    title: String? = null,
    accent: Color = NexusColors.Cyan,
    action: (@Composable () -> Unit)? = null,
    onClick: (() -> Unit)? = null,
    contentPadding: Dp = 14.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val glow = LocalVisualPrefs.current.glow
    Column(
        modifier
            .clip(PanelShape)
            .background(Brush.verticalGradient(listOf(NexusColors.Surface.copy(alpha = 0.92f), NexusColors.BackgroundAlt.copy(alpha = 0.92f))))
            .border(BorderStroke(1.dp, Brush.linearGradient(listOf(accent.copy(alpha = if (glow) 0.45f else 0.25f), NexusColors.Violet.copy(alpha = 0.12f), accent.copy(alpha = 0.2f)))), PanelShape)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .drawCornerBrackets(accent)
            .padding(contentPadding),
    ) {
        if (title != null || action != null) {
            Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                if (title != null) {
                    Box(Modifier.size(6.dp).clip(CircleShape).background(accent))
                    Spacer(Modifier.width(8.dp))
                    Text(title.uppercase(), style = MaterialTheme.typography.labelMedium, color = NexusColors.TextPrimary, modifier = Modifier.weight(1f))
                } else {
                    Spacer(Modifier.weight(1f))
                }
                action?.invoke()
            }
        }
        content()
    }
}

private fun Modifier.drawCornerBrackets(color: Color): Modifier =
    this.drawWithContent {
        drawContent()
        val l = 10.dp.toPx()
        val w = 1.5.dp.toPx()
        val c = color.copy(alpha = 0.8f)
        val i = 3.dp.toPx()
        drawLine(c, Offset(i, i), Offset(i + l, i), w); drawLine(c, Offset(i, i), Offset(i, i + l), w)
        drawLine(c, Offset(size.width - i, size.height - i), Offset(size.width - i - l, size.height - i), w)
        drawLine(c, Offset(size.width - i, size.height - i), Offset(size.width - i, size.height - i - l), w)
    }

data class StatusStyle(val label: String, val color: Color)

fun statusStyle(status: String?): StatusStyle = when (status) {
    "idle" -> StatusStyle("En reposo", NexusColors.TextSecondary)
    "thinking" -> StatusStyle("Pensando", NexusColors.Violet)
    "working", "running" -> StatusStyle(if (status == "working") "Trabajando" else "En ejecución", NexusColors.Cyan)
    "collaborating" -> StatusStyle("Colaborando", NexusColors.Pink)
    "completed", "succeeded" -> StatusStyle("Completado", NexusColors.Green)
    "error", "failed" -> StatusStyle(if (status == "error") "Error" else "Fallida", NexusColors.Red)
    "paused" -> StatusStyle("Pausado", NexusColors.Amber)
    "planning" -> StatusStyle("Planificando", NexusColors.Violet)
    "awaiting_approval" -> StatusStyle("Espera aprobación", NexusColors.Amber)
    "reviewing" -> StatusStyle("En revisión", NexusColors.Violet)
    "consolidating" -> StatusStyle("Consolidando", NexusColors.Violet)
    "blocked" -> StatusStyle("Bloqueada", NexusColors.Red)
    "cancelled" -> StatusStyle("Cancelada", NexusColors.TextMuted)
    "pending" -> StatusStyle("Pendiente", NexusColors.TextSecondary)
    "ready" -> StatusStyle("En cola", NexusColors.Cyan)
    "skipped" -> StatusStyle("Omitida", NexusColors.TextMuted)
    "scheduled" -> StatusStyle("Programada", NexusColors.TextSecondary)
    "summarizing" -> StatusStyle("Redactando acta", NexusColors.Violet)
    "approved" -> StatusStyle("Aprobada", NexusColors.Green)
    "rejected" -> StatusStyle("Rechazada", NexusColors.Red)
    "expired" -> StatusStyle("Vencida", NexusColors.TextMuted)
    "ok" -> StatusStyle("Conectado", NexusColors.Green)
    "unknown" -> StatusStyle("Sin probar", NexusColors.TextSecondary)
    "verified" -> StatusStyle("Verificado", NexusColors.Green)
    "unverified" -> StatusStyle("Sin verificar", NexusColors.Amber)
    "success" -> StatusStyle("OK", NexusColors.Green)
    "failure" -> StatusStyle("Error", NexusColors.Red)
    "info" -> StatusStyle("Info", NexusColors.Cyan)
    else -> StatusStyle(status ?: "—", NexusColors.TextSecondary)
}

@Composable
fun StatusChip(status: String?, modifier: Modifier = Modifier, label: String? = null) {
    val style = statusStyle(status)
    Row(
        modifier
            .clip(RoundedCornerShape(50))
            .background(style.color.copy(alpha = 0.12f))
            .border(1.dp, style.color.copy(alpha = 0.35f), RoundedCornerShape(50))
            .padding(horizontal = 8.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(6.dp).clip(CircleShape).background(style.color))
        Spacer(Modifier.width(5.dp))
        Text(label ?: style.label, style = MaterialTheme.typography.labelSmall, color = style.color, maxLines = 1)
    }
}

@Composable
fun Tag(text: String, color: Color = NexusColors.TextSecondary, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier
            .clip(RoundedCornerShape(6.dp))
            .background(color.copy(alpha = 0.1f))
            .padding(horizontal = 6.dp, vertical = 2.dp),
        style = MaterialTheme.typography.labelSmall,
        color = color,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, icon: ImageVector? = null, loading: Boolean = false) {
    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        modifier = modifier.height(46.dp),
        shape = RoundedCornerShape(12.dp),
        colors = ButtonDefaults.buttonColors(containerColor = NexusColors.Cyan, contentColor = NexusColors.Background,
            disabledContainerColor = NexusColors.Cyan.copy(alpha = 0.25f)),
    ) {
        if (loading) {
            CircularProgressIndicator(Modifier.size(18.dp), color = NexusColors.Background, strokeWidth = 2.dp)
        } else {
            if (icon != null) { Icon(icon, null, Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)) }
            Text(text.uppercase(), style = MaterialTheme.typography.labelLarge)
        }
    }
}

@Composable
fun GhostButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, color: Color = NexusColors.Cyan, icon: ImageVector? = null) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.height(42.dp),
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, color.copy(alpha = if (enabled) 0.6f else 0.2f)),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = color),
    ) {
        if (icon != null) { Icon(icon, null, Modifier.size(16.dp)); Spacer(Modifier.width(6.dp)) }
        Text(text.uppercase(), style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
fun NexusTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
    minLines: Int = 1,
    password: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
    supporting: String? = null,
    isError: Boolean = false,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        modifier = modifier.fillMaxWidth(),
        singleLine = singleLine,
        minLines = minLines,
        isError = isError,
        supportingText = supporting?.let { { Text(it) } },
        visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboardType),
        shape = RoundedCornerShape(12.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = NexusColors.Cyan,
            unfocusedBorderColor = Color(0x3300D9FF),
            focusedLabelColor = NexusColors.Cyan,
            cursorColor = NexusColors.Cyan,
            focusedContainerColor = Color(0x22111522),
            unfocusedContainerColor = Color(0x22111522),
        ),
    )
}

/** Slider de rasgo con dos polos, al estilo [Introvertido/Extrovertido] 70%. */
@Composable
fun TraitSlider(left: String, right: String?, value: Int, onChange: (Int) -> Unit, color: Color = NexusColors.Cyan, enabled: Boolean = true) {
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (right != null) "[${left.replaceFirstChar { it.uppercase() }}/${right.replaceFirstChar { it.uppercase() }}]" else "[${left.replaceFirstChar { it.uppercase() }}]",
                style = MaterialTheme.typography.bodySmall, color = NexusColors.TextPrimary, modifier = Modifier.weight(1f))
            Text("$value%", style = MaterialTheme.typography.labelMedium.copy(fontFamily = Mono), color = color)
        }
        Slider(
            value = value.toFloat(),
            onValueChange = { onChange(it.toInt()) },
            valueRange = 0f..100f,
            enabled = enabled,
            colors = SliderDefaults.colors(thumbColor = color, activeTrackColor = color, inactiveTrackColor = color.copy(alpha = 0.18f)),
        )
    }
}

@Composable
fun MetricRing(label: String, percent: Float?, modifier: Modifier = Modifier, color: Color = NexusColors.Cyan, size: Dp = 76.dp) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(size), contentAlignment = Alignment.Center) {
            Canvas(Modifier.fillMaxSize()) {
                val stroke = 6.dp.toPx()
                drawArc(color.copy(alpha = 0.15f), 0f, 360f, false, style = Stroke(stroke))
                if (percent != null) {
                    drawArc(Brush.sweepGradient(listOf(color.copy(alpha = 0.4f), color)), -90f, 360f * (percent / 100f).coerceIn(0f, 1f),
                        false, style = Stroke(stroke, cap = StrokeCap.Round))
                }
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(label, style = MaterialTheme.typography.labelSmall, color = NexusColors.TextSecondary)
                Text(percent?.let { "${it.toInt()}%" } ?: "—", style = MaterialTheme.typography.titleSmall.copy(fontFamily = Mono), color = NexusColors.TextPrimary)
            }
        }
    }
}

@Composable
fun HudProgress(progress: Float, modifier: Modifier = Modifier, color: Color = NexusColors.Cyan) {
    Box(modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).background(color.copy(alpha = 0.12f))) {
        Box(Modifier.fillMaxWidth(progress.coerceIn(0f, 1f)).height(6.dp).clip(RoundedCornerShape(3.dp))
            .background(Brush.horizontalGradient(listOf(color.copy(alpha = 0.5f), color))))
    }
}

/** Onda de actividad: solo se anima cuando el estado real indica actividad. */
@Composable
fun ActivityWave(active: Boolean, color: Color, modifier: Modifier = Modifier) {
    val animate = LocalVisualPrefs.current.animations && active
    val phase by if (animate) {
        rememberInfiniteTransition(label = "wave").animateFloat(0f, (2 * Math.PI).toFloat(),
            infiniteRepeatable(tween(1400, easing = LinearEasing), RepeatMode.Restart), label = "phase")
    } else {
        androidx.compose.runtime.remember { androidx.compose.runtime.mutableFloatStateOf(0f) }
    }
    Canvas(modifier.height(22.dp)) {
        val bars = 22
        val gap = size.width / bars
        for (i in 0 until bars) {
            val amp = if (active) (0.25f + 0.75f * ((sin(phase + i * 0.6f) + 1f) / 2f)) else 0.08f
            val h = size.height * amp
            drawLine(color.copy(alpha = if (active) 0.9f else 0.35f), Offset(i * gap + gap / 2, (size.height - h) / 2),
                Offset(i * gap + gap / 2, (size.height + h) / 2), strokeWidth = gap * 0.45f, cap = StrokeCap.Round)
        }
    }
}

@Composable
fun EmptyState(title: String, message: String, modifier: Modifier = Modifier, icon: ImageVector = Icons.Outlined.Inbox, action: (@Composable () -> Unit)? = null) {
    Column(modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Box(Modifier.size(64.dp).clip(CircleShape).background(NexusColors.Cyan.copy(alpha = 0.08f)).border(1.dp, NexusColors.Border, CircleShape),
            contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = NexusColors.Cyan, modifier = Modifier.size(30.dp))
        }
        Spacer(Modifier.height(14.dp))
        Text(title, style = MaterialTheme.typography.titleMedium, color = NexusColors.TextPrimary, textAlign = TextAlign.Center)
        Spacer(Modifier.height(6.dp))
        Text(message, style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextSecondary, textAlign = TextAlign.Center)
        if (action != null) { Spacer(Modifier.height(16.dp)); action() }
    }
}

@Composable
fun ErrorState(message: String, onRetry: (() -> Unit)?, modifier: Modifier = Modifier) {
    EmptyState("No se pudo cargar", message, modifier, Icons.Outlined.CloudOff, action = onRetry?.let { { GhostButton("Reintentar", it) } })
}

@Composable
fun LoadingState(modifier: Modifier = Modifier, label: String = "Sincronizando con NEXUS…") {
    Column(modifier.fillMaxWidth().padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        CircularProgressIndicator(color = NexusColors.Cyan, strokeWidth = 2.dp)
        Spacer(Modifier.height(12.dp))
        Text(label, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary)
    }
}

@Composable
fun ConfirmDialog(title: String, message: String, confirm: String, onConfirm: () -> Unit, onDismiss: () -> Unit, danger: Boolean = false) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = NexusColors.Surface,
        title = { Text(title) },
        text = { Text(message, color = NexusColors.TextSecondary) },
        confirmButton = {
            TextButton(onClick = { onConfirm(); onDismiss() }) { Text(confirm.uppercase(), color = if (danger) NexusColors.Red else NexusColors.Cyan, fontWeight = FontWeight.Bold) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("CANCELAR", color = NexusColors.TextSecondary) } },
    )
}

@Composable
fun SelectChips(options: List<Pair<String, String>>, selected: String?, onSelect: (String) -> Unit, modifier: Modifier = Modifier, color: Color = NexusColors.Cyan) {
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (value, label) ->
            val active = value == selected
            Text(
                label,
                Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (active) color.copy(alpha = 0.18f) else NexusColors.BackgroundAlt)
                    .border(1.dp, if (active) color else Color(0x22FFFFFF), RoundedCornerShape(10.dp))
                    .clickable { onSelect(value) }
                    .padding(horizontal = 12.dp, vertical = 7.dp),
                style = MaterialTheme.typography.labelMedium,
                color = if (active) color else NexusColors.TextSecondary,
            )
        }
    }
}

@Composable
fun MultiSelectChips(options: List<Pair<String, String>>, selected: Set<String>, onToggle: (String) -> Unit, modifier: Modifier = Modifier, color: Color = NexusColors.Cyan) {
    FlowRow(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        options.forEach { (value, label) ->
            val active = value in selected
            Text(
                (if (active) "✓ " else "") + label,
                Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (active) color.copy(alpha = 0.18f) else NexusColors.BackgroundAlt)
                    .border(1.dp, if (active) color else Color(0x22FFFFFF), RoundedCornerShape(10.dp))
                    .clickable { onToggle(value) }
                    .padding(horizontal = 12.dp, vertical = 7.dp),
                style = MaterialTheme.typography.labelMedium,
                color = if (active) color else NexusColors.TextSecondary,
            )
        }
    }
}

@Composable
fun KeyValue(label: String, value: String, modifier: Modifier = Modifier, valueColor: Color = NexusColors.TextPrimary) {
    Row(modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = NexusColors.TextSecondary, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodySmall.copy(fontFamily = Mono), color = valueColor, textAlign = TextAlign.End)
    }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(text.uppercase(), modifier.padding(top = 14.dp, bottom = 6.dp), style = MaterialTheme.typography.labelSmall, color = NexusColors.TextSecondary)
}
