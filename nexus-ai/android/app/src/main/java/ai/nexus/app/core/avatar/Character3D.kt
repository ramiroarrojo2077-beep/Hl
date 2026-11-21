package ai.nexus.app.core.avatar

import ai.nexus.app.core.three.Mat
import ai.nexus.app.core.three.Mesh
import ai.nexus.app.core.three.Ring
import ai.nexus.app.core.three.V3
import ai.nexus.app.core.three.ellipsoid
import ai.nexus.app.core.three.loft
import ai.nexus.app.core.three.superquadric
import ai.nexus.app.core.three.torus
import ai.nexus.app.core.three.tube
import ai.nexus.app.data.model.Appearance

private fun hex(s: String?, fallback: Int): Int = try {
    if (s == null) fallback else android.graphics.Color.parseColor(s)
} catch (_: IllegalArgumentException) {
    fallback
}

private fun shade(c: Int, f: Float): Int {
    val r = (((c shr 16) and 0xFF) * f).toInt().coerceIn(0, 255)
    val g = (((c shr 8) and 0xFF) * f).toInt().coerceIn(0, 255)
    val b = ((c and 0xFF) * f).toInt().coerceIn(0, 255)
    return (0xFF shl 24) or (r shl 16) or (g shl 8) or b
}

/**
 * Personaje 3D paramétrico construido a partir de la apariencia del agente (cuerpo, cabello,
 * colores, vestimenta y accesorio). El frente mira hacia -Z; mide ~1,8 unidades.
 * Las piezas "emisivas" (ojos, líneas de acento, visor, halo) brillan como un holograma.
 */
object Character3D {
    /** Cabeza levemente más grande que la real: proporción de personaje estilizado (≈7 cabezas). */
    private const val HEAD_SCALE = 1.13f

    private val cache = object : LinkedHashMap<Appearance, Mesh>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Appearance, Mesh>?) = size > 24
    }

    @Synchronized fun mesh(a: Appearance): Mesh = cache.getOrPut(a) { build(a) }

    fun build(a: Appearance): Mesh {
        val m = Mesh()
        val skinC = hex(a.skin, 0xFFE0B899.toInt())
        val hairC = hex(a.hairColor, 0xFF4A4F5C.toInt())
        val eyeC = hex(a.eyes, 0xFF00D9FF.toInt())
        val outfitC = hex(a.outfitColor, 0xFF1A2433.toInt())
        val accentC = hex(a.accent, 0xFF00D9FF.toInt())
        val skin = Mat(skinC, specular = 0.12f, shininess = 14f, rim = 0.55f)
        val face = Mat(skinC, specular = 0.10f, shininess = 12f, rim = 0.4f)
        val hair = Mat(hairC, specular = 0.45f, shininess = 30f, rim = 0.9f)
        val cloth = Mat(outfitC, specular = 0.22f, shininess = 18f, rim = 1.1f)
        val clothDark = Mat(shade(outfitC, 0.72f), specular = 0.18f, shininess = 16f, rim = 1f)
        val plate = Mat(shade(outfitC, 1.35f), specular = 0.7f, shininess = 48f, rim = 1.2f)
        val glow = Mat(accentC, specular = 0f, emissive = 0.95f, rim = 0f)
        val eyeGlow = Mat(eyeC, specular = 0.6f, shininess = 60f, emissive = 0.85f, rim = 0f)
        val sclera = Mat(0xFFF2F4F8.toInt(), specular = 0.5f, shininess = 50f, rim = 0f)
        val boot = Mat(shade(outfitC, 0.55f), specular = 0.55f, shininess = 40f, rim = 0.9f)
        val lip = Mat(shade(skinC, 0.78f), specular = 0.25f, shininess = 30f, rim = 0.3f)

        val fem = a.body == "b"
        // ---------------------------------------------------------------- cuerpo
        val sh = if (fem) 0.185f else 0.215f // semiancho de hombros
        val torso = if (fem) listOf(
            Ring(0.86f, 0.170f, 0.115f), Ring(0.95f, 0.185f, 0.125f), Ring(1.04f, 0.160f, 0.110f), Ring(1.12f, 0.130f, 0.095f),
            Ring(1.20f, 0.140f, 0.100f), Ring(1.28f, 0.160f, 0.125f, dz = -0.012f), Ring(1.35f, 0.170f, 0.120f, dz = -0.01f),
            Ring(1.42f, 0.178f, 0.105f), Ring(1.475f, 0.160f, 0.090f), Ring(1.515f, 0.110f, 0.070f), Ring(1.54f, 0.062f, 0.055f),
        ) else listOf(
            Ring(0.86f, 0.165f, 0.110f), Ring(0.95f, 0.172f, 0.118f), Ring(1.05f, 0.160f, 0.112f), Ring(1.14f, 0.165f, 0.115f),
            Ring(1.24f, 0.190f, 0.125f), Ring(1.33f, 0.210f, 0.130f), Ring(1.41f, 0.222f, 0.124f), Ring(1.475f, 0.205f, 0.105f),
            Ring(1.515f, 0.130f, 0.078f), Ring(1.545f, 0.068f, 0.060f),
        )
        m.loft(torso, cloth, seg = 28, power = 0.85f)
        // cuello y cabeza
        m.tube(V3(0f, 1.50f, 0.005f), V3(0f, 1.62f, 0.012f), if (fem) 0.050f else 0.058f, if (fem) 0.046f else 0.052f, skin, seg = 16, rows = 4)
        val hc = V3(0f, 1.735f, 0f)
        val headStart = m.vCount
        m.ellipsoid(hc, V3(0.092f, 0.118f, 0.104f), face, segU = 30, segV = 22)
        m.ellipsoid(V3(0f, 1.668f, -0.010f), V3(0.072f, 0.060f, 0.074f), face, segU = 24, segV = 14) // mandíbula
        m.ellipsoid(V3(0f, 1.722f, -0.103f), V3(0.014f, 0.024f, 0.016f), face, segU = 10, segV = 8) // nariz
        m.ellipsoid(V3(0f, 1.656f, -0.088f), V3(0.024f, 0.007f, 0.010f), lip, segU = 12, segV = 6) // boca
        for (s in listOf(-1f, 1f)) {
            m.ellipsoid(V3(s * 0.093f, 1.725f, 0.008f), V3(0.012f, 0.026f, 0.018f), face, segU = 10, segV = 8) // orejas
            // ojos: esclerótica + iris luminoso
            m.ellipsoid(V3(s * 0.036f, 1.748f, -0.086f), V3(0.021f, 0.014f, 0.012f), sclera, segU = 12, segV = 8)
            m.ellipsoid(V3(s * 0.036f, 1.748f, -0.096f), V3(0.012f, 0.0125f, 0.005f), eyeGlow, segU = 10, segV = 8)
            m.tube(V3(s * 0.018f, 1.778f, -0.094f), V3(s * 0.058f, 1.775f, -0.084f), 0.0045f, 0.004f, hair, seg = 6, rows = 3) // cejas
        }
        m.scaleFrom(headStart, V3(0f, 1.60f, 0f), HEAD_SCALE)
        // brazos y manos (pose relajada, levemente separados)
        for (s in listOf(-1f, 1f)) {
            val shoulder = V3(s * (sh - 0.01f), 1.445f, 0.0f)
            val elbow = V3(s * (sh + 0.05f), 1.175f, 0.02f)
            val wrist = V3(s * (sh + 0.075f), 0.93f, -0.015f)
            m.tube(shoulder, elbow, if (fem) 0.048f else 0.056f, if (fem) 0.040f else 0.046f, cloth, seg = 14, rows = 8)
            m.tube(elbow, wrist, if (fem) 0.040f else 0.046f, if (fem) 0.031f else 0.036f, cloth, seg = 14, rows = 8)
            val gloved = a.outfit == "armor" || a.outfit == "jacket"
            m.ellipsoid(wrist + V3(s * 0.006f, -0.058f, 0f), V3(0.026f, 0.052f, 0.034f), if (gloved) clothDark else skin, segU = 12, segV = 10)
            m.tube(wrist + V3(s * 0.012f, -0.035f, -0.022f), wrist + V3(s * 0.006f, -0.07f, -0.036f), 0.010f, 0.008f, if (gloved) clothDark else skin, seg = 8, rows = 3) // pulgar
            m.torus(wrist + V3(0f, 0.012f, 0f), V3(s * 0.08f, 1f, -0.05f), if (fem) 0.033f else 0.038f, 0.006f, glow, segU = 18, segV = 5)
        }
        // piernas y botas
        for (s in listOf(-1f, 1f)) {
            val hip = V3(s * 0.088f, 0.90f, 0f)
            val knee = V3(s * 0.095f, 0.50f, -0.01f)
            val ankle = V3(s * 0.098f, 0.11f, 0.01f)
            m.tube(hip, knee, if (fem) 0.092f else 0.094f, 0.062f, clothDark, seg = 16, rows = 10)
            m.tube(knee, ankle, 0.058f, 0.042f, clothDark, seg = 16, rows = 10)
            m.superquadric(V3(s * 0.098f, 0.115f, 0.0f), V3(0.05f, 0.09f, 0.055f), 0.6f, 0.9f, boot, segU = 14, segV = 8) // caña
            m.superquadric(V3(s * 0.098f, 0.04f, -0.035f), V3(0.052f, 0.042f, 0.11f), 0.45f, 0.8f, boot, segU = 16, segV = 8) // pie
            m.torus(V3(s * 0.096f, 0.20f, 0.005f), V3(0f, 1f, 0f), 0.050f, 0.005f, glow, segU = 18, segV = 5)
        }
        // cinturón luminoso
        m.torus(V3(0f, 0.965f, 0f), V3(0f, 1f, 0f), if (fem) 0.168f else 0.171f, 0.010f, glow, segU = 40, segV = 6)

        // ---------------------------------------------------------------- vestimenta
        when (a.outfit) {
            "armor" -> {
                m.superquadric(V3(0f, 1.30f, -0.065f), V3(sh * 0.85f, 0.15f, 0.07f), 0.5f, 0.6f, plate, segU = 22, segV = 12) // pechera
                for (s in listOf(-1f, 1f)) {
                    m.superquadric(V3(s * (sh + 0.03f), 1.47f, 0f), V3(0.085f, 0.05f, 0.085f), 0.55f, 0.75f, plate, segU = 16, segV = 10)
                    m.superquadric(V3(s * 0.096f, 0.50f, -0.05f), V3(0.05f, 0.055f, 0.03f), 0.5f, 0.6f, plate, segU = 12, segV = 8)
                }
                m.tube(V3(0f, 1.42f, -0.11f), V3(0f, 1.18f, -0.115f), 0.008f, 0.008f, glow, seg = 6, rows = 6)
            }
            "coat" -> {
                m.loft(listOf(Ring(0.42f, 0.24f, 0.17f, dz = 0.01f), Ring(0.62f, 0.21f, 0.15f), Ring(0.86f, 0.185f, 0.13f), Ring(1.0f, 0.18f, 0.128f),
                    Ring(1.04f, 0.17f, 0.12f)), clothDark, seg = 28)
                for (s in listOf(-1f, 1f)) m.tube(V3(s * 0.05f, 1.50f, -0.10f), V3(s * 0.13f, 1.25f, -0.135f), 0.022f, 0.012f, clothDark, seg = 8, rows = 6) // solapas
            }
            "robe" -> {
                m.loft(listOf(Ring(0.06f, 0.30f, 0.26f), Ring(0.40f, 0.25f, 0.20f), Ring(0.75f, 0.20f, 0.15f), Ring(0.98f, 0.18f, 0.13f),
                    Ring(1.02f, 0.17f, 0.12f)), cloth, seg = 30)
                m.torus(V3(0f, 0.10f, 0f), V3(0f, 1f, 0f), 0.295f, 0.007f, glow, segU = 44, segV = 5)
                m.torus(V3(0f, 1.515f, 0.01f), V3(0f, 1f, 0.12f), 0.105f, 0.03f, cloth, segU = 30, segV = 8) // cuello de la túnica
            }
            "jacket" -> {
                m.loft(listOf(Ring(1.08f, 0.19f, 0.13f), Ring(1.22f, 0.20f, 0.14f), Ring(1.36f, 0.225f, 0.145f), Ring(1.44f, 0.23f, 0.13f),
                    Ring(1.48f, 0.20f, 0.11f)), clothDark, seg = 28)
                m.torus(V3(0f, 1.50f, 0f), V3(0f, 1f, 0.15f), 0.075f, 0.022f, clothDark, segU = 24, segV = 6) // cuello alto
                m.tube(V3(0f, 1.47f, -0.135f), V3(0f, 1.10f, -0.14f), 0.006f, 0.006f, glow, seg = 6, rows = 6)
            }
            else -> { // traje: líneas de acento
                for (s in listOf(-1f, 1f)) {
                    m.tube(V3(s * 0.05f, 1.47f, -0.105f), V3(s * 0.11f, 1.02f, -0.11f), 0.0055f, 0.0055f, glow, seg = 6, rows = 6)
                    m.tube(V3(s * (sh + 0.02f), 1.43f, -0.02f), V3(s * (sh + 0.07f), 0.97f, -0.03f), 0.0045f, 0.0045f, glow, seg = 6, rows = 6)
                }
                m.torus(V3(0f, 1.50f, 0f), V3(0f, 1f, 0.1f), 0.066f, 0.013f, clothDark, segU = 24, segV = 6)
            }
        }

        // ---------------------------------------------------------------- cabello
        val hairStart = m.vCount
        when (a.hair) {
            "buzz" -> m.ellipsoid(hc + V3(0f, 0.02f, 0.006f), V3(0.096f, 0.108f, 0.106f), hair, segU = 26, segV = 16)
            "long" -> {
                m.ellipsoid(hc + V3(0f, 0.022f, 0.012f), V3(0.104f, 0.118f, 0.112f), hair, segU = 26, segV = 16)
                m.tube(V3(0f, 1.74f, 0.05f), V3(0f, 1.36f, 0.07f), 0.10f, 0.075f, hair, seg = 18, rows = 10, flatten = 0.55f)
                for (s in listOf(-1f, 1f)) m.tube(V3(s * 0.088f, 1.75f, 0.02f), V3(s * 0.105f, 1.47f, 0.045f), 0.028f, 0.02f, hair, seg = 10, rows = 8)
            }
            "asymmetric" -> {
                m.ellipsoid(hc + V3(0f, 0.022f, 0.012f), V3(0.102f, 0.116f, 0.11f), hair, segU = 26, segV = 16)
                m.tube(V3(0.06f, 1.83f, -0.088f), V3(-0.075f, 1.725f, -0.104f), 0.03f, 0.012f, hair, seg = 12, rows = 8, flatten = 0.5f) // mechón
                m.tube(V3(-0.06f, 1.80f, -0.05f), V3(-0.1f, 1.63f, -0.04f), 0.03f, 0.012f, hair, seg = 10, rows = 6)
            }
            "ponytail" -> {
                m.ellipsoid(hc + V3(0f, 0.02f, 0.01f), V3(0.1f, 0.114f, 0.108f), hair, segU = 26, segV = 16)
                m.tube(V3(0f, 1.80f, 0.10f), V3(0f, 1.50f, 0.15f), 0.035f, 0.018f, hair, seg = 12, rows = 8)
                m.torus(V3(0f, 1.79f, 0.105f), V3(0f, 0.3f, 1f), 0.024f, 0.007f, Mat(hex(a.accent, 0xFF00D9FF.toInt()), emissive = 0.9f, rim = 0f), segU = 14, segV = 5)
            }
            "mohawk" -> {
                m.ellipsoid(hc + V3(0f, 0.012f, 0.004f), V3(0.094f, 0.106f, 0.104f), Mat(shade(hairC, 0.6f), specular = 0.2f), segU = 24, segV = 14)
                m.superquadric(hc + V3(0f, 0.10f, 0.02f), V3(0.022f, 0.06f, 0.11f), 0.8f, 0.8f, hair, segU = 12, segV = 10)
            }
            "helmet" -> {
                m.superquadric(hc + V3(0f, 0.012f, 0.004f), V3(0.118f, 0.135f, 0.125f), 0.75f, 0.85f, plate, segU = 28, segV = 18)
                m.superquadric(hc + V3(0f, 0.005f, -0.108f), V3(0.092f, 0.032f, 0.028f), 0.4f, 0.6f, Mat(hex(a.accent, 0xFF00D9FF.toInt()), specular = 0.9f, shininess = 70f, emissive = 0.7f, rim = 0f), segU = 18, segV = 8)
            }
            else -> { // corto
                m.ellipsoid(hc + V3(0f, 0.024f, 0.012f), V3(0.100f, 0.112f, 0.108f), hair, segU = 26, segV = 16)
                m.tube(V3(-0.07f, 1.84f, -0.08f), V3(0.05f, 1.83f, -0.095f), 0.028f, 0.024f, hair, seg = 10, rows = 6, flatten = 0.6f) // flequillo
            }
        }

        // ---------------------------------------------------------------- accesorios
        val accentMat = Mat(hex(a.accent, 0xFF00D9FF.toInt()), specular = 0.8f, shininess = 60f, emissive = 0.75f, rim = 0f)
        when (a.accessory) {
            "visor" -> m.superquadric(V3(0f, 1.748f, -0.098f), V3(0.098f, 0.022f, 0.02f), 0.35f, 0.5f, accentMat, segU = 18, segV = 8)
            "glasses" -> for (s in listOf(-1f, 1f)) m.torus(V3(s * 0.037f, 1.748f, -0.104f), V3(0f, 0f, 1f), 0.022f, 0.004f, plate, segU = 18, segV = 5)
            "headset" -> {
                m.torus(hc + V3(0f, 0.01f, 0.005f), V3(0f, 0f, 1f), 0.112f, 0.008f, plate, segU = 30, segV = 6, arc = 0.5f)
                for (s in listOf(-1f, 1f)) m.ellipsoid(V3(s * 0.104f, 1.725f, 0.008f), V3(0.022f, 0.036f, 0.034f), plate, segU = 12, segV = 8)
                m.tube(V3(-0.104f, 1.70f, -0.01f), V3(-0.045f, 1.66f, -0.10f), 0.005f, 0.004f, plate, seg = 6, rows = 4)
                m.ellipsoid(V3(-0.04f, 1.658f, -0.104f), V3(0.009f, 0.009f, 0.009f), accentMat, segU = 8, segV = 6)
            }
            "halo" -> m.torus(hc + V3(0f, 0.19f, 0.01f), V3(0f, 1f, 0.08f), 0.085f, 0.009f, accentMat, segU = 36, segV = 6)
        }
        m.scaleFrom(hairStart, V3(0f, 1.60f, 0f), HEAD_SCALE)
        return m
    }
}
