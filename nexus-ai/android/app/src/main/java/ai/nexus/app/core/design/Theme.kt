package ai.nexus.app.core.design

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import ai.nexus.app.R
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/**
 * Paleta holográfica de NEXUS (fiel a la referencia JARVIS/NOVA): azul marino profundo,
 * cian luminoso como acento principal y verde para estados "activo/conectado".
 * Texto principal sobre superficies con contraste > 12:1; secundario > 6:1 (WCAG AA).
 */
object NexusColors {
    val Background = Color(0xFF030A15)
    val BackgroundAlt = Color(0xFF071426)
    val Surface = Color(0xFF0A1A2E)
    val SurfaceHigh = Color(0xFF0F2541)
    val Accent = Color(0xFF1ED6FF)
    val Cyan = Color(0xFF1ED6FF)
    val Violet = Color(0xFF9B6CFF)
    val Green = Color(0xFF27E39B)
    val Amber = Color(0xFFFFB13B)
    val Red = Color(0xFFFF4D6D)
    val Pink = Color(0xFFFF5FB0)
    val TextPrimary = Color(0xFFEAF6FF)
    val TextSecondary = Color(0xFF8DA6C2)
    val TextMuted = Color(0xFF5B7591)
    val Border = Color(0x5A1ED6FF)
}

/** Preferencias visuales que afectan a toda la app (las animaciones nunca son requisito funcional). */
data class VisualPrefs(val animations: Boolean = true, val glow: Boolean = true)

val LocalVisualPrefs = staticCompositionLocalOf { VisualPrefs() }

private val NexusScheme = darkColorScheme(
    primary = NexusColors.Accent,
    onPrimary = NexusColors.Background,
    secondary = NexusColors.Cyan,
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
    outlineVariant = Color(0x221ED6FF),
    error = NexusColors.Red,
    onError = NexusColors.Background,
)

/** Rajdhani (OFL): tipografía técnica de la interfaz, legible en tamaños chicos. */
val Rajdhani = FontFamily(
    Font(R.font.rajdhani_regular, FontWeight.Normal),
    Font(R.font.rajdhani_medium, FontWeight.Medium),
    Font(R.font.rajdhani_semibold, FontWeight.SemiBold),
    Font(R.font.rajdhani_bold, FontWeight.Bold),
)

/** Orbitron (OFL, fuente variable): marca y títulos holográficos. */
@OptIn(ExperimentalTextApi::class)
val Orbitron = FontFamily(
    Font(R.font.orbitron_var, FontWeight.Medium, variationSettings = FontVariation.Settings(FontVariation.weight(500))),
    Font(R.font.orbitron_var, FontWeight.SemiBold, variationSettings = FontVariation.Settings(FontVariation.weight(600))),
    Font(R.font.orbitron_var, FontWeight.Bold, variationSettings = FontVariation.Settings(FontVariation.weight(700))),
)
private val Sans = Rajdhani
val Mono = FontFamily.Monospace

private val NexusTypography = Typography(
    displaySmall = TextStyle(fontFamily = Orbitron, fontWeight = FontWeight.SemiBold, fontSize = 30.sp, letterSpacing = 8.sp),
    headlineMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Bold, fontSize = 28.sp, letterSpacing = 1.sp),
    headlineSmall = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = 0.5.sp),
    titleLarge = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Bold, fontSize = 21.sp),
    titleMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Bold, fontSize = 17.sp, letterSpacing = 0.3.sp),
    titleSmall = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, letterSpacing = 0.3.sp),
    bodyLarge = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Medium, fontSize = 17.sp, lineHeight = 23.sp),
    bodyMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Medium, fontSize = 15.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Medium, fontSize = 13.sp, lineHeight = 17.sp),
    labelLarge = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Bold, fontSize = 15.sp, letterSpacing = 1.6.sp),
    labelMedium = TextStyle(fontFamily = Sans, fontWeight = FontWeight.Bold, fontSize = 13.sp, letterSpacing = 1.8.sp),
    labelSmall = TextStyle(fontFamily = Sans, fontWeight = FontWeight.SemiBold, fontSize = 12.sp, letterSpacing = 1.6.sp),
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
