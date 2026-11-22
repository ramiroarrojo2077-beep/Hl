package ai.nexus.app.local

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import kotlin.math.PI
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sin

/*
 * Videos 2D programados: la IA escribe un guion de escenas en JSON y acá se dibuja cuadro por cuadro
 * (Canvas) y se exporta a MP4 (MediaCodec + MediaMuxer). Todo en el teléfono, sin servidor.
 *
 * Guion: {"background":"#0A1A2E","scenes":[{"duration":3,"background":"#...","elements":[
 *   {"type":"text","text":"Hola","x":0.5,"y":0.4,"size":0.09,"color":"#FFF","bold":true,"anim":"slide_up","delay":0.2,"dur":0.8},
 *   {"type":"rect","x":0.5,"y":0.7,"w":0.6,"h":0.02,"color":"#1ED6FF","radius":0.01,"anim":"grow_x"},
 *   {"type":"circle","x":0.5,"y":0.5,"r":0.1,"color":"#FF5FB0","anim":"pulse"}]}]}
 * x, y, w, h, r y size son proporciones del ancho/alto del cuadro; los tiempos están en segundos.
 */
data class VElement(val type: String, val text: String, val x: Float, val y: Float, val w: Float, val h: Float, val r: Float, val size: Float,
                    val color: Int, val bold: Boolean, val radius: Float, val anim: String, val delay: Float, val dur: Float, val align: String)
data class VScene(val duration: Float, val background: Int, val elements: List<VElement>)
data class VScript(val width: Int, val height: Int, val fps: Int, val scenes: List<VScene>) {
    val totalSeconds get() = scenes.sumOf { it.duration.toDouble() }.toFloat()
}

object VideoStudio {
    const val MAX_SCENES = 12
    const val MAX_SECONDS = 45f
    const val MAX_ELEMENTS = 20

    private fun color(s: String?, fallback: Int) = runCatching { Color.parseColor(s) }.getOrDefault(fallback)
    private fun JsonObject.f(k: String, d: Float) = (this[k] as? JsonPrimitive)?.doubleOrNull?.toFloat() ?: d
    private fun JsonObject.s(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** Valida y limita el guion para no gastar batería ni memoria indefinidamente. */
    fun parse(o: JsonObject): VScript {
        val bg = color(o.s("background"), Color.parseColor("#0A1A2E"))
        val scenes = (o["scenes"] as? JsonArray)?.mapNotNull { it as? JsonObject }?.take(MAX_SCENES).orEmpty()
        if (scenes.isEmpty()) throw bad("El guion del video no tiene escenas")
        var budget = MAX_SECONDS
        val out = mutableListOf<VScene>()
        for (sc in scenes) {
            if (budget <= 0.5f) break
            val dur = sc.f("duration", 3f).coerceIn(0.5f, 12f).coerceAtMost(budget)
            budget -= dur
            val els = (sc["elements"] as? JsonArray)?.mapNotNull { it as? JsonObject }?.take(MAX_ELEMENTS).orEmpty().map { e ->
                VElement(e.s("type") ?: "text", (e.s("text") ?: "").take(300), e.f("x", 0.5f), e.f("y", 0.5f), e.f("w", 0.5f), e.f("h", 0.1f), e.f("r", 0.1f),
                    e.f("size", 0.06f).coerceIn(0.015f, 0.3f), color(e.s("color"), Color.WHITE), (e["bold"] as? JsonPrimitive)?.booleanOrNull ?: false,
                    e.f("radius", 0f), e.s("anim") ?: "fade", e.f("delay", 0f).coerceIn(0f, 30f), e.f("dur", 0.7f).coerceIn(0.05f, 10f), e.s("align") ?: "center")
            }
            out += VScene(dur, color(sc.s("background"), bg), els)
        }
        return VScript(720, 1280, 30, out)
    }

    private fun ease(t: Float): Float { val c = t.coerceIn(0f, 1f); return 1f - (1f - c) * (1f - c) * (1f - c) }

    /** Dibuja el instante [t] (segundos desde el inicio de la escena). Pura: sirve para el video y para las pruebas. */
    fun drawScene(canvas: Canvas, sc: VScene, t: Float, w: Int, h: Int) {
        canvas.drawColor(sc.background)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)
        for (e in sc.elements) {
            val p = ease((t - e.delay) / e.dur)
            val appeared = t >= e.delay
            if (!appeared && e.anim != "none") continue
            var alpha = 1f; var scale = 1f; var dx = 0f; var dy = 0f; var grow = 1f
            when (e.anim) {
                "fade" -> alpha = p
                "slide_up" -> { alpha = p; dy = (1f - p) * 0.08f * h }
                "slide_down" -> { alpha = p; dy = -(1f - p) * 0.08f * h }
                "slide_left" -> { alpha = p; dx = (1f - p) * 0.15f * w }
                "slide_right" -> { alpha = p; dx = -(1f - p) * 0.15f * w }
                "zoom" -> { alpha = p; scale = 0.6f + 0.4f * p }
                "grow_x" -> grow = p
                "pulse" -> scale = 1f + 0.06f * sin((t - e.delay) * 2f * PI.toFloat() * 1.2f)
                "bounce" -> { alpha = min(1f, p * 3f); dy = -sin(p * PI.toFloat()) * 0.04f * h * (1f - p) }
            }
            paint.color = e.color
            paint.alpha = (alpha.coerceIn(0f, 1f) * 255).toInt()
            val cx = e.x * w + dx; val cy = e.y * h + dy
            canvas.save()
            canvas.scale(scale, scale, cx, cy)
            when (e.type) {
                "rect" -> {
                    val rw = e.w * w * grow; val rh = e.h * h
                    canvas.drawRoundRect(RectF(cx - rw / 2, cy - rh / 2, cx + rw / 2, cy + rh / 2), e.radius * w, e.radius * w, paint)
                }
                "circle" -> canvas.drawCircle(cx, cy, e.r * w, paint)
                else -> {
                    paint.textSize = e.size * w
                    paint.typeface = if (e.bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
                    paint.textAlign = when (e.align) { "left" -> Paint.Align.LEFT; "right" -> Paint.Align.RIGHT; else -> Paint.Align.CENTER }
                    val shown = if (e.anim == "typewriter") e.text.take((e.text.length * p).toInt()) else e.text
                    // Ajuste de línea simple: el texto largo se parte para no salirse del cuadro.
                    var y = cy
                    for (line in wrap(shown, paint, w * 0.9f)) { canvas.drawText(line, cx, y, paint); y += paint.textSize * 1.25f }
                }
            }
            canvas.restore()
        }
    }

    private fun wrap(text: String, paint: Paint, maxW: Float): List<String> {
        val lines = mutableListOf<String>(); var cur = ""
        for (word in text.split(" ")) {
            val tryLine = if (cur.isEmpty()) word else "$cur $word"
            if (paint.measureText(tryLine) <= maxW || cur.isEmpty()) cur = tryLine else { lines += cur; cur = word }
        }
        if (cur.isNotEmpty()) lines += cur
        return lines.take(8)
    }

    /** Exporta el guion a MP4 (H.264). [onProgress] recibe 0..1. Devuelve el archivo. */
    fun render(script: VScript, out: File, onProgress: (Float) -> Unit = {}, shouldStop: () -> Boolean = { false }): File {
        out.parentFile?.mkdirs(); out.delete()
        val w = script.width; val h = script.height; val fps = script.fps
        val format = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, w, h).apply {
            setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
            setInteger(MediaFormat.KEY_BIT_RATE, 3_000_000); setInteger(MediaFormat.KEY_FRAME_RATE, fps); setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
        }
        val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        val surface = codec.createInputSurface()
        codec.start()
        val muxer = MediaMuxer(out.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        var track = -1; var muxing = false
        val info = MediaCodec.BufferInfo()
        fun drain(end: Boolean) {
            while (true) {
                val i = codec.dequeueOutputBuffer(info, if (end) 10_000 else 0)
                when {
                    i == MediaCodec.INFO_TRY_AGAIN_LATER -> if (!end) return
                    i == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> { track = muxer.addTrack(codec.outputFormat); muxer.start(); muxing = true }
                    i >= 0 -> {
                        val buf = codec.getOutputBuffer(i)!!
                        if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) info.size = 0
                        if (info.size > 0 && muxing) { buf.position(info.offset); buf.limit(info.offset + info.size); muxer.writeSampleData(track, buf, info) }
                        codec.releaseOutputBuffer(i, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return
                    }
                }
            }
        }
        try {
            val total = max(1, (script.totalSeconds * fps).toInt())
            var frame = 0
            val startNs = System.nanoTime()
            for (sc in script.scenes) {
                val n = max(1, (sc.duration * fps).toInt())
                for (k in 0 until n) {
                    if (shouldStop()) throw InterruptedException("Video cancelado")
                    // Con entrada por Surface, el tiempo de cada cuadro lo marca el reloj al publicarlo: se dibuja a ritmo
                    // real (un video de N segundos tarda ~N segundos en generarse) para que no quede acelerado.
                    val due = startNs + frame * 1_000_000_000L / fps
                    val wait = (due - System.nanoTime()) / 1_000_000
                    if (wait > 0) Thread.sleep(wait)
                    val canvas = surface.lockCanvas(null)
                    try { drawScene(canvas, sc, k / fps.toFloat(), w, h) } finally { surface.unlockCanvasAndPost(canvas) }
                    drain(false)
                    frame++; if (frame % 15 == 0) onProgress(frame / total.toFloat())
                }
            }
            codec.signalEndOfInputStream()
            drain(true)
        } finally {
            runCatching { codec.stop() }; runCatching { codec.release() }; runCatching { surface.release() }
            runCatching { if (muxing) muxer.stop() }; runCatching { muxer.release() }
        }
        if (!out.exists() || out.length() < 1000) throw bad("No se pudo generar el video en este teléfono")
        return out
    }
}
