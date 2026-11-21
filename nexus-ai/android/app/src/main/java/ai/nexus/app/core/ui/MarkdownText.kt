package ai.nexus.app.core.ui

import ai.nexus.app.core.design.Mono
import ai.nexus.app.core.design.NexusColors
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp

sealed interface MdBlock {
    data class Heading(val level: Int, val text: String) : MdBlock
    data class Paragraph(val text: String) : MdBlock
    data class Bullet(val text: String, val ordered: String? = null) : MdBlock
    data class Code(val text: String) : MdBlock
    data class Quote(val text: String) : MdBlock
}

/** Parser mínimo de Markdown para informes de agentes (encabezados, listas, código, citas). */
fun parseMarkdown(src: String): List<MdBlock> {
    val out = mutableListOf<MdBlock>()
    val lines = src.lines()
    var i = 0
    val para = StringBuilder()
    fun flush() { if (para.isNotBlank()) out += MdBlock.Paragraph(para.toString().trim()); para.clear() }
    while (i < lines.size) {
        val line = lines[i]
        val trimmed = line.trim()
        when {
            trimmed.startsWith("```") -> {
                flush()
                val code = StringBuilder()
                i++
                while (i < lines.size && !lines[i].trim().startsWith("```")) { code.appendLine(lines[i]); i++ }
                out += MdBlock.Code(code.toString().trimEnd())
            }
            trimmed.startsWith("#") -> {
                flush()
                val level = trimmed.takeWhile { it == '#' }.length.coerceAtMost(4)
                out += MdBlock.Heading(level, trimmed.drop(level).trim())
            }
            trimmed.startsWith("- ") || trimmed.startsWith("* ") -> { flush(); out += MdBlock.Bullet(trimmed.drop(2)) }
            Regex("^\\d+[.)] ").containsMatchIn(trimmed) -> {
                flush()
                val num = trimmed.substringBefore(" ")
                out += MdBlock.Bullet(trimmed.substringAfter(" "), num)
            }
            trimmed.startsWith(">") -> { flush(); out += MdBlock.Quote(trimmed.drop(1).trim()) }
            trimmed.isEmpty() -> flush()
            else -> { if (para.isNotEmpty()) para.append(' '); para.append(trimmed) }
        }
        i++
    }
    flush()
    return out
}

fun inlineMarkdown(text: String, accent: Color = NexusColors.Cyan): AnnotatedString = buildAnnotatedString {
    var i = 0
    while (i < text.length) {
        when {
            text.startsWith("**", i) && text.indexOf("**", i + 2) > 0 -> {
                val end = text.indexOf("**", i + 2)
                withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { append(text.substring(i + 2, end)) }
                i = end + 2
            }
            text[i] == '`' && text.indexOf('`', i + 1) > 0 -> {
                val end = text.indexOf('`', i + 1)
                withStyle(SpanStyle(fontFamily = Mono, color = accent, background = Color(0x2200D9FF))) { append(text.substring(i + 1, end)) }
                i = end + 1
            }
            else -> { append(text[i]); i++ }
        }
    }
}

@Composable
fun MarkdownText(text: String, modifier: Modifier = Modifier, color: Color = NexusColors.TextPrimary) {
    SelectionContainer(modifier) {
        Column {
            parseMarkdown(text).forEach { block ->
                when (block) {
                    is MdBlock.Heading -> Text(
                        inlineMarkdown(block.text),
                        style = when (block.level) { 1 -> MaterialTheme.typography.titleLarge; 2 -> MaterialTheme.typography.titleMedium; else -> MaterialTheme.typography.titleSmall },
                        color = if (block.level <= 2) NexusColors.Cyan else color,
                        modifier = Modifier.padding(top = 10.dp, bottom = 4.dp),
                    )
                    is MdBlock.Paragraph -> Text(inlineMarkdown(block.text), style = MaterialTheme.typography.bodyMedium, color = color,
                        modifier = Modifier.padding(vertical = 3.dp))
                    is MdBlock.Bullet -> Row(Modifier.padding(vertical = 2.dp)) {
                        Text(block.ordered ?: "•", color = NexusColors.Cyan, modifier = Modifier.padding(end = 8.dp))
                        Text(inlineMarkdown(block.text), style = MaterialTheme.typography.bodyMedium, color = color)
                    }
                    is MdBlock.Code -> Text(
                        block.text,
                        Modifier.fillMaxWidth().padding(vertical = 6.dp).clip(RoundedCornerShape(8.dp)).background(Color(0xFF0B0F18))
                            .horizontalScroll(rememberScrollState()).padding(10.dp),
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = Mono), color = NexusColors.Green,
                    )
                    is MdBlock.Quote -> Text(inlineMarkdown(block.text), style = MaterialTheme.typography.bodyMedium, color = NexusColors.TextSecondary,
                        modifier = Modifier.padding(start = 10.dp, top = 4.dp, bottom = 4.dp))
                }
            }
        }
    }
}
