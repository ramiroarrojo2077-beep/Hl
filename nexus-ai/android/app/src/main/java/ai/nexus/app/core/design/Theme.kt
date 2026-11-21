package ai.nexus.app.core.design

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

object NexusColors {
    val Background = Color(0xFF080A10)
    val BackgroundAlt = Color(0xFF111522)
    val Surface = Color(0xFF171D2B)
    val SurfaceHigh = Color(0xFF1E2638)
    val Cyan = Color(0xFF00D9FF)
    val Violet = Color(0xFF8A5CFF)
    val Green = Color(0xFF38D99B)
    val Amber = Color(0xFFFFC24B)
    val Red = Color(0xFFFF5C5C)
    val Pink = Color(0xFFFF6FB5)
    val TextPrimary = Color(0xFFF4F6FC)
    val TextSecondary = Color(0xFF8993A8)
    val TextMuted = Color(0xFF5B647A)
    val Border = Color(0x3300D9FF)
}

/** Preferencias visuales que afectan a toda la app (las animaciones nunca son requisito funcional). */
data class VisualPrefs(val animations: Boolean = true, val glow: Boolean = true)

val LocalVisualPrefs = staticCompositionLocalOf { VisualPrefs() }

private val NexusScheme = darkColorScheme(
    primary = NexusColors.Cyan,
    onPrimary = NexusColors.Background,
    secondary = NexusColors.Violet,
    onSecondary = NexusColors.TextPrimary,
    tertiary = NexusColors.Green,
    background = NexusColors.Background,
    onBackground = NexusColors.TextPrimary,
    surface = NexusColors.Surface,
    onSurface = NexusColors.TextPrimary,
    surfaceVariant = NexusColors.BackgroundAlt,
    onSurfaceVariant = NexusColors.TextSecondary,
    surfaceContainer = NexusColors.BackgroundAlt,
    surfaceContainerHigh = NexusColors.SurfaceHigh,
    surfaceContainerHighest = NexusColors.SurfaceHigh,
    outline = NexusColors.Border,
    outlineVariant = Color(0x22FFFFFF),
    error = NexusColors.Red,
    onError = NexusColors.Background,
)

private val Sans = FontFamily.SansSerif
val Mono = FontFamily.Monospace

private val NexusTypography = Typography(
    displaySmall = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Light, fontSize = 34.sp, letterSpacing = 6.sp),
    headlineMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 26.sp, letterSpacing = 1.sp),
    headlineSmall = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 22.sp),
    titleLarge = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 20.sp),
    titleMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 16.sp),
    titleSmall = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Medium, fontSize = 14.sp),
    bodyLarge = TextStyle(fontFamily = Sans, fontSize = 16.sp, lineHeight = 23.sp),
    bodyMedium = TextStyle(fontFamily = Sans, fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontFamily = Sans, fontSize = 12.sp, lineHeight = 16.sp),
    labelLarge = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 14.sp, letterSpacing = 1.sp),
    labelMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, letterSpacing = 1.2.sp),
    labelSmall = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Medium, fontSize = 11.sp, letterSpacing = 1.4.sp),
)

@Composable
fun NexusTheme(prefs: VisualPrefs = VisualPrefs(), content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalVisualPrefs provides prefs) {
        MaterialTheme(colorScheme = NexusScheme, typography = NexusTypography, content = content)
    }
}

fun parseHex(hex: String?, fallback: Color = NexusColors.Cyan): Color = try {
    if (hex == null) fallback else Color(android.graphics.Color.parseColor(hex))
} catch (_: IllegalArgumentException) {
    fallback
}
