package ai.nexus.app.core.three

import android.graphics.Bitmap
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sign
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Motor 3D mínimo y propio (sin dependencias): mallas paramétricas, cámara con perspectiva,
 * iluminación por vértice (luz principal, relleno, borde fresnel y especular Blinn-Phong) y
 * rasterizado por software con z-buffer sobre un bitmap (funciona igual en todas las versiones de
 * Android y en las pruebas). Pensado para personajes estilizados y hologramas, no para escenas grandes.
 */
data class V3(val x: Float, val y: Float, val z: Float) {
    operator fun plus(o: V3) = V3(x + o.x, y + o.y, z + o.z)
    operator fun minus(o: V3) = V3(x - o.x, y - o.y, z - o.z)
    operator fun times(s: Float) = V3(x * s, y * s, z * s)
    infix fun dot(o: V3) = x * o.x + y * o.y + z * o.z
    infix fun cross(o: V3) = V3(y * o.z - z * o.y, z * o.x - x * o.z, x * o.y - y * o.x)
    fun len() = sqrt(x * x + y * y + z * z)
    fun norm(): V3 { val l = len(); return if (l < 1e-6f) V3(0f, 1f, 0f) else V3(x / l, y / l, z / l) }
}

/** Material por parte: color base, brillo especular y emisión (las partes emisivas brillan sin luz). */
data class Mat(val color: Int, val specular: Float = 0.25f, val shininess: Float = 22f, val emissive: Float = 0f, val rim: Float = 1f)

class Mesh {
    var pos = FloatArray(1366 * 3); private set
    var nrm = FloatArray(1366 * 3); private set
    var col = IntArray(1366); private set
    var spec = FloatArray(1366); private set
    var shin = FloatArray(1366); private set
    var emis = FloatArray(1366); private set
    var rimK = FloatArray(1366); private set
    var idx = IntArray(8192); private set
    var vCount = 0; private set
    var iCount = 0; private set

    private fun ensureV(n: Int) {
        if (vCount + n <= col.size) return
        val cap = max(col.size * 2, vCount + n)
        pos = pos.copyOf(cap * 3); nrm = nrm.copyOf(cap * 3); col = col.copyOf(cap); spec = spec.copyOf(cap)
        shin = shin.copyOf(cap); emis = emis.copyOf(cap); rimK = rimK.copyOf(cap)
    }

    private fun ensureI(n: Int) { if (iCount + n > idx.size) idx = idx.copyOf(max(idx.size * 2, iCount + n)) }

    fun addVertex(p: V3, m: Mat): Int {
        ensureV(1)
        val i = vCount++
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z
        col[i] = m.color; spec[i] = m.specular; shin[i] = m.shininess; emis[i] = m.emissive; rimK[i] = m.rim
        return i
    }

    fun vertex(i: Int) = V3(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])

    /** Escala uniforme de los vértices [from, vCount) alrededor de un pivote (las normales no cambian). */
    fun scaleFrom(from: Int, pivot: V3, s: Float) {
        for (i in from until vCount) {
            val k = i * 3
            pos[k] = pivot.x + (pos[k] - pivot.x) * s
            pos[k + 1] = pivot.y + (pos[k + 1] - pivot.y) * s
            pos[k + 2] = pivot.z + (pos[k + 2] - pivot.z) * s
        }
    }

    fun addTri(a: Int, b: Int, c: Int) { ensureI(3); idx[iCount++] = a; idx[iCount++] = b; idx[iCount++] = c }

    fun setNormal(i: Int, n: V3) { nrm[i * 3] = n.x; nrm[i * 3 + 1] = n.y; nrm[i * 3 + 2] = n.z }

    val triangles get() = iCount / 3
}

/**
 * Generador de superficies paramétricas en grilla. `inside` es un punto interior que fija la
 * orientación hacia afuera de cada triángulo (para descartar caras traseras de forma confiable).
 */
private fun Mesh.grid(rows: Int, cols: Int, closedU: Boolean, mat: Mat, f: (Int, Int) -> V3, inside: (V3) -> V3) {
    val base = vCount
    val nc = if (closedU) cols else cols + 1
    for (r in 0..rows) for (c in 0 until nc) addVertex(f(r, c), mat)
    fun id(r: Int, c: Int) = base + r * nc + (if (closedU) c % cols else c)
    val acc = FloatArray((rows + 1) * nc * 3)
    val colsLoop = if (closedU) cols else cols
    for (r in 0 until rows) for (c in 0 until colsLoop) {
        val a = id(r, c); val b = id(r + 1, c); val d = id(r, c + 1); val e = id(r + 1, c + 1)
        for ((x, y, z) in listOf(Triple(a, b, d), Triple(d, b, e))) {
            val pa = vertex(x); val pb = vertex(y); val pc = vertex(z)
            var n = (pb - pa) cross (pc - pa)
            if (n.len() < 1e-9f) continue
            val centroid = (pa + pb + pc) * (1f / 3f)
            if (n dot (centroid - inside(centroid)) < 0f) { addTri(x, z, y); n = n * -1f } else addTri(x, y, z)
            for (v in intArrayOf(x, y, z)) {
                val k = (v - base) * 3
                acc[k] += n.x; acc[k + 1] += n.y; acc[k + 2] += n.z
            }
        }
    }
    for (v in 0 until (rows + 1) * nc) {
        val k = v * 3
        var n = V3(acc[k], acc[k + 1], acc[k + 2])
        if (n.len() < 1e-9f) n = vertex(base + v) - inside(vertex(base + v))
        setNormal(base + v, n.norm())
    }
}

/** Elipsoide (cabeza, ojos, manos, mechones). */
fun Mesh.ellipsoid(c: V3, r: V3, mat: Mat, segU: Int = 22, segV: Int = 14) = grid(segV, segU, true, mat, { i, j ->
    val v = PI * i / segV; val u = 2 * PI * j / segU
    V3(c.x + r.x * (sin(v) * cos(u)).toFloat(), c.y + r.y * cos(v).toFloat(), c.z + r.z * (sin(v) * sin(u)).toFloat())
}, { c })

private fun spow(v: Double, e: Double) = sign(v) * abs(v).pow(e)

/** Superelipsoide: cajas redondeadas (torso, botas, hombreras, visor). e≈0.2 casi caja, 1 = elipsoide. */
fun Mesh.superquadric(c: V3, r: V3, e1: Float, e2: Float, mat: Mat, segU: Int = 20, segV: Int = 12) = grid(segV, segU, true, mat, { i, j ->
    val v = -PI / 2 + PI * i / segV; val u = -PI + 2 * PI * j / segU
    V3(c.x + r.x * (spow(cos(v), e1.toDouble()) * spow(cos(u), e2.toDouble())).toFloat(),
        c.y - r.y * spow(sin(v), e1.toDouble()).toFloat(),
        c.z + r.z * (spow(cos(v), e1.toDouble()) * spow(sin(u), e2.toDouble())).toFloat())
}, { c })

/** Anillo de una sección del cuerpo: altura y radios en X/Z, con desplazamiento. */
data class Ring(val y: Float, val rx: Float, val rz: Float, val dx: Float = 0f, val dz: Float = 0f)

/** Superficie de revolución libre (torso, falda, abrigo) con tapas. */
fun Mesh.loft(rings: List<Ring>, mat: Mat, seg: Int = 26, power: Float = 1f) {
    val all = buildList {
        add(Ring(rings.first().y, 0.001f, 0.001f, rings.first().dx, rings.first().dz))
        addAll(rings)
        add(Ring(rings.last().y, 0.001f, 0.001f, rings.last().dx, rings.last().dz))
    }
    grid(all.size - 1, seg, true, mat, { i, j ->
        val ring = all[i]; val u = 2 * PI * j / seg
        val cu = cos(u); val su = sin(u)
        V3((ring.dx + ring.rx * spow(cu, power.toDouble())).toFloat(), ring.y, (ring.dz + ring.rz * spow(su, power.toDouble())).toFloat())
    }, { p ->
        // Eje del loft interpolado a la altura del punto.
        val k = all.indices.minBy { abs(all[it].y - p.y) }
        V3(all[k].dx, p.y, all[k].dz)
    })
}

/** Cápsula cónica entre dos puntos (brazos, piernas, cuello, cabello). */
fun Mesh.tube(a: V3, b: V3, r1: Float, r2: Float, mat: Mat, seg: Int = 14, rows: Int = 10, flatten: Float = 1f) {
    val axis = (b - a); val len = axis.len(); val w = axis.norm()
    val ref = if (abs(w.y) < 0.9f) V3(0f, 1f, 0f) else V3(1f, 0f, 0f)
    val uAx = (w cross ref).norm(); val vAx = (w cross uAx).norm()
    val cap = 4
    val total = rows + 2 * cap
    grid(total, seg, true, mat, { i, j ->
        val (t, rad) = when {
            i <= cap -> { val ang = (PI / 2) * (1 - i.toDouble() / cap); (-r1 * sin(ang)).toFloat() to (r1 * cos(ang)).toFloat() }
            i >= total - cap -> { val ang = (PI / 2) * ((i - (total - cap)).toDouble() / cap); (len + r2 * sin(ang)).toFloat() to (r2 * cos(ang)).toFloat() }
            else -> { val f = (i - cap).toFloat() / rows; (len * f) to (r1 + (r2 - r1) * f) }
        }
        val u = 2 * PI * j / seg
        a + w * t + uAx * (rad * cos(u).toFloat()) + vAx * (rad * flatten * sin(u).toFloat())
    }, { p ->
        val t = ((p - a) dot w).coerceIn(0f, len)
        a + w * t
    })
}

/** Toro (halo, vincha de auriculares, cinturón, anillos). `n` es la normal del plano del aro. */
fun Mesh.torus(c: V3, n: V3, rMajor: Float, rMinor: Float, mat: Mat, segU: Int = 36, segV: Int = 8, arc: Float = 1f) {
    val w = n.norm()
    val ref = if (abs(w.y) < 0.9f) V3(0f, 1f, 0f) else V3(1f, 0f, 0f)
    val uAx = (w cross ref).norm(); val vAx = (w cross uAx).norm()
    val closed = arc >= 1f
    grid(segV, segU, closed, mat, { i, j ->
        val u = 2 * PI * arc * j / segU; val v = 2 * PI * i / segV
        val ringP = c + uAx * (rMajor * cos(u).toFloat()) + vAx * (rMajor * sin(u).toFloat())
        val radial = (ringP - c).norm()
        ringP + radial * (rMinor * cos(v).toFloat()) + w * (rMinor * sin(v).toFloat())
    }, { p ->
        val d = p - c
        val inPlane = (d - w * (d dot w)).norm()
        c + inPlane * rMajor
    })
}

/** Luces de la escena (en espacio de cámara: la cámara mira hacia +Z). */
data class Lighting(
    val ambient: Float = 0.26f,
    val key: V3 = V3(-0.45f, 0.65f, -0.62f).norm(),
    val keyColor: Int = 0xFFE6DCD0.toInt(),
    val fill: V3 = V3(0.75f, 0.05f, -0.45f).norm(),
    val fillColor: Int = 0xFF4FC3F7.toInt(),
    val fillStrength: Float = 0.35f,
    val rimColor: Int = 0xFF2FD8FF.toInt(),
    val rimStrength: Float = 0.9f,
)

data class Camera(val yaw: Float = 0f, val pitch: Float = 0f, val distance: Float = 4f, val targetY: Float = 0.95f, val fov: Float = 1.6f,
                  val offsetX: Float = 0f)

private fun ch(c: Int, s: Int) = ((c shr s) and 0xFF) / 255f

/**
 * Rasterizador por software con z-buffer por píxel y sombreado Gouraud: resuelve correctamente
 * las intersecciones entre piezas (cabello sobre la cabeza, hombreras, visor) en cualquier Android.
 */
class Renderer3D {
    private var sx = FloatArray(0); private var sy = FloatArray(0); private var sz = FloatArray(0)
    private var cr = FloatArray(0); private var cg = FloatArray(0); private var cb = FloatArray(0)
    private var zbuf = FloatArray(0); private var pix = IntArray(0)

    fun render(mesh: Mesh, bitmap: Bitmap, cam: Camera, light: Lighting = Lighting(), tint: Int? = null, alpha: Float = 1f) {
        val W = bitmap.width; val H = bitmap.height
        val w = W.toFloat(); val h = H.toFloat()
        val n = mesh.vCount
        if (sx.size < n) { sx = FloatArray(n); sy = FloatArray(n); sz = FloatArray(n); cr = FloatArray(n); cg = FloatArray(n); cb = FloatArray(n) }
        if (pix.size != W * H) { pix = IntArray(W * H); zbuf = FloatArray(W * H) }
        java.util.Arrays.fill(pix, 0)
        java.util.Arrays.fill(zbuf, Float.MAX_VALUE)
        val cy = cos(cam.yaw); val syw = sin(cam.yaw); val cp = cos(cam.pitch); val sp = sin(cam.pitch)
        val f = cam.fov * h
        val pos = mesh.pos; val nrm = mesh.nrm
        val kx = light.key.x; val ky = light.key.y; val kz = light.key.z
        val fx = light.fill.x; val fy = light.fill.y; val fz = light.fill.z
        val kr = ch(light.keyColor, 16); val kg = ch(light.keyColor, 8); val kb = ch(light.keyColor, 0)
        val fr = ch(light.fillColor, 16) * light.fillStrength; val fg = ch(light.fillColor, 8) * light.fillStrength; val fb = ch(light.fillColor, 0) * light.fillStrength
        val rr = ch(light.rimColor, 16) * light.rimStrength; val rg = ch(light.rimColor, 8) * light.rimStrength; val rb = ch(light.rimColor, 0) * light.rimStrength
        for (i in 0 until n) {
            val k = i * 3
            val px = pos[k] - cam.offsetX; val py = pos[k + 1] - cam.targetY; val pz = pos[k + 2]
            val x1 = px * cy + pz * syw; val z1 = -px * syw + pz * cy
            val y2 = py * cp - z1 * sp; val z2 = py * sp + z1 * cp + cam.distance
            val nx0 = nrm[k]; val ny0 = nrm[k + 1]; val nz0 = nrm[k + 2]
            val nx = nx0 * cy + nz0 * syw; val nz1 = -nx0 * syw + nz0 * cy
            val ny = ny0 * cp - nz1 * sp; val nz = ny0 * sp + nz1 * cp
            val zz = max(z2, 0.05f)
            sx[i] = w / 2 + x1 * f / zz; sy[i] = h / 2 - y2 * f / zz; sz[i] = z2
            val il = 1f / sqrt(x1 * x1 + y2 * y2 + z2 * z2)
            val vx = -x1 * il; val vy = -y2 * il; val vz = -z2 * il
            val base = tint ?: mesh.col[i]
            val br = ch(base, 16); val bg = ch(base, 8); val bb = ch(base, 0)
            val dk = max(0f, nx * kx + ny * ky + nz * kz)
            val df = max(0f, nx * fx + ny * fy + nz * fz)
            var hx = kx + vx; var hy = ky + vy; var hz = kz + vz
            val hl = 1f / sqrt(hx * hx + hy * hy + hz * hz); hx *= hl; hy *= hl; hz *= hl
            val sv = max(0f, nx * hx + ny * hy + nz * hz).pow(mesh.shin[i]) * mesh.spec[i]
            val ndv = max(0f, nx * vx + ny * vy + nz * vz)
            val rim = (1f - ndv).pow(3f) * mesh.rimK[i]
            val e = mesh.emis[i]
            var r = br * (light.ambient + dk * kr + df * fr) + sv * kr + rim * rr
            var g = bg * (light.ambient + dk * kg + df * fg) + sv * kg + rim * rg
            var b = bb * (light.ambient + dk * kb + df * fb) + sv * kb + rim * rb
            if (e > 0f) { r = r * (1 - e) + min(1f, br * 1.25f) * e; g = g * (1 - e) + min(1f, bg * 1.25f) * e; b = b * (1 - e) + min(1f, bb * 1.25f) * e }
            cr[i] = min(1f, r) * 255f; cg[i] = min(1f, g) * 255f; cb[i] = min(1f, b) * 255f
        }
        val a8 = ((alpha * 255).toInt().coerceIn(0, 255)) shl 24
        val idx = mesh.idx
        for (tri in 0 until mesh.triangles) {
            val i0 = idx[tri * 3]; val i1 = idx[tri * 3 + 1]; val i2 = idx[tri * 3 + 2]
            if (sz[i0] < 0.06f || sz[i1] < 0.06f || sz[i2] < 0.06f) continue
            val x0 = sx[i0]; val y0 = sy[i0]; val x1 = sx[i1]; val y1 = sy[i1]; val x2 = sx[i2]; val y2 = sy[i2]
            val area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0)
            if (area <= 0f) continue // cara trasera
            val minX = max(0, kotlin.math.floor(min(x0, min(x1, x2))).toInt()); val maxX = min(W - 1, kotlin.math.ceil(max(x0, max(x1, x2))).toInt())
            val minY = max(0, kotlin.math.floor(min(y0, min(y1, y2))).toInt()); val maxY = min(H - 1, kotlin.math.ceil(max(y0, max(y1, y2))).toInt())
            if (minX > maxX || minY > maxY) continue
            val inv = 1f / area
            val z0 = sz[i0]; val z1 = sz[i1]; val z2 = sz[i2]
            // Coeficientes de las funciones de borde: w = A*x + B*y + C (normalizados por el área).
            val a12 = (y1 - y2) * inv; val b12 = (x2 - x1) * inv; val c12 = (x1 * y2 - x2 * y1) * inv
            val a20 = (y2 - y0) * inv; val b20 = (x0 - x2) * inv; val c20 = (x2 * y0 - x0 * y2) * inv
            for (yy in minY..maxY) {
                val pyc = yy + 0.5f
                var px = minX + 0.5f
                var w0 = a12 * px + b12 * pyc + c12
                var w1 = a20 * px + b20 * pyc + c20
                val row = yy * W
                for (xx in minX..maxX) {
                    val w2 = 1f - w0 - w1
                    if (w0 >= -1e-4f && w1 >= -1e-4f && w2 >= -1e-4f) {
                        val z = w0 * z0 + w1 * z1 + w2 * z2
                        val o = row + xx
                        if (z < zbuf[o]) {
                            zbuf[o] = z
                            val r = (w0 * cr[i0] + w1 * cr[i1] + w2 * cr[i2]).toInt()
                            val g = (w0 * cg[i0] + w1 * cg[i1] + w2 * cg[i2]).toInt()
                            val b = (w0 * cb[i0] + w1 * cb[i1] + w2 * cb[i2]).toInt()
                            pix[o] = a8 or (r.coerceIn(0, 255) shl 16) or (g.coerceIn(0, 255) shl 8) or b.coerceIn(0, 255)
                        }
                    }
                    w0 += a12; w1 += a20
                    px += 1f
                }
            }
        }
        bitmap.setPixels(pix, 0, W, 0, 0, W, H)
    }
}
