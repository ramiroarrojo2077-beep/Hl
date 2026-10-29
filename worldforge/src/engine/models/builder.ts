import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Vector3 } from "three";

/**
 * Acumulador de geometría por clave de material. Todas las primitivas generan
 * triángulos no indexados con posición, normal y UV (en metros / 4), lo que
 * permite fusionarlas en BatchedMesh o InstancedMesh sin incompatibilidades.
 */

interface Buffers {
  pos: number[];
  nor: number[];
  uv: number[];
}

export const UV_TILE = 4; // metros por repetición de textura

const _v = new Vector3();
const _n = new Vector3();

export class MeshBuilder {
  private buffers = new Map<string, Buffers>();
  private matrix = new Matrix4();
  private normalMatrix = new Matrix3();
  private stack: Matrix4[] = [];

  private buf(key: string): Buffers {
    let b = this.buffers.get(key);
    if (!b) {
      b = { pos: [], nor: [], uv: [] };
      this.buffers.set(key, b);
    }
    return b;
  }

  /** Aplica una transformación a todas las primitivas agregadas dentro de `fn`. */
  with(m: Matrix4, fn: () => void) {
    this.stack.push(this.matrix.clone());
    this.matrix = this.matrix.clone().multiply(m);
    this.normalMatrix.getNormalMatrix(this.matrix);
    fn();
    this.matrix = this.stack.pop()!;
    this.normalMatrix.getNormalMatrix(this.matrix);
  }

  translateRotate(x: number, y: number, z: number, rotY: number, fn: () => void) {
    const m = new Matrix4().makeRotationY(rotY).setPosition(x, y, z);
    this.with(m, fn);
  }

  private pushVertex(b: Buffers, x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) {
    _v.set(x, y, z).applyMatrix4(this.matrix);
    _n.set(nx, ny, nz).applyMatrix3(this.normalMatrix).normalize();
    b.pos.push(_v.x, _v.y, _v.z);
    b.nor.push(_n.x, _n.y, _n.z);
    b.uv.push(u, v);
  }

  /** Triángulo con normal plana. Vértices en sentido antihorario visto desde el frente. */
  tri(key: string, a: number[], b: number[], c: number[], uva = [0, 0], uvb = [1, 0], uvc = [0, 1]) {
    const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!;
    const vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const buf = this.buf(key);
    this.pushVertex(buf, a[0]!, a[1]!, a[2]!, nx, ny, nz, uva[0]!, uva[1]!);
    this.pushVertex(buf, b[0]!, b[1]!, b[2]!, nx, ny, nz, uvb[0]!, uvb[1]!);
    this.pushVertex(buf, c[0]!, c[1]!, c[2]!, nx, ny, nz, uvc[0]!, uvc[1]!);
  }

  /** Cuadrilátero p0-p1-p2-p3 antihorario; UV calculado en metros. */
  quad(key: string, p0: number[], p1: number[], p2: number[], p3: number[]) {
    const w = Math.hypot(p1[0]! - p0[0]!, p1[1]! - p0[1]!, p1[2]! - p0[2]!) / UV_TILE;
    const h = Math.hypot(p3[0]! - p0[0]!, p3[1]! - p0[1]!, p3[2]! - p0[2]!) / UV_TILE;
    const u0 = (p0[0]! + p0[2]!) / UV_TILE;
    const v0 = p0[1]! / UV_TILE;
    this.tri(key, p0, p1, p2, [u0, v0], [u0 + w, v0], [u0 + w, v0 + h]);
    this.tri(key, p0, p2, p3, [u0, v0], [u0 + w, v0 + h], [u0, v0 + h]);
  }

  /** Caja alineada a los ejes (en el espacio actual). */
  box(key: string, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, opts: { top?: boolean; bottom?: boolean } = {}) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2;
    const y0 = cy - sy / 2, y1 = cy + sy / 2;
    const z0 = cz - sz / 2, z1 = cz + sz / 2;
    // Frente (+Z), atrás (-Z), derecha (+X), izquierda (-X)
    this.quadUV(key, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], x0, y0, sx, sy);
    this.quadUV(key, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], -x1, y0, sx, sy);
    this.quadUV(key, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], -z1, y0, sz, sy);
    this.quadUV(key, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], z0, y0, sz, sy);
    if (opts.top !== false) this.quadUV(key, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], x0, -z1, sx, sz);
    if (opts.bottom !== false) this.quadUV(key, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], x0, z0, sx, sz);
  }

  private quadUV(key: string, p0: number[], p1: number[], p2: number[], p3: number[], u: number, v: number, w: number, h: number) {
    const u0 = u / UV_TILE, v0 = v / UV_TILE, u1 = (u + w) / UV_TILE, v1 = (v + h) / UV_TILE;
    this.tri(key, p0, p1, p2, [u0, v0], [u1, v0], [u1, v1]);
    this.tri(key, p0, p2, p3, [u0, v0], [u1, v1], [u0, v1]);
  }

  /** Cilindro o tronco de cono con normales suaves. */
  cylinder(
    key: string,
    cx: number,
    cy: number,
    cz: number,
    rTop: number,
    rBottom: number,
    h: number,
    segments = 12,
    opts: { top?: boolean; bottom?: boolean; flat?: boolean } = {},
  ) {
    const buf = this.buf(key);
    const y0 = cy - h / 2, y1 = cy + h / 2;
    const slope = (rBottom - rTop) / h;
    const circ = 2 * Math.PI * Math.max(rTop, rBottom);
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const c0 = Math.sin(a0), s0 = Math.cos(a0), c1 = Math.sin(a1), s1 = Math.cos(a1);
      const am = (a0 + a1) / 2;
      const n0 = opts.flat ? [Math.sin(am), slope, Math.cos(am)] : [c0, slope, s0];
      const n1 = opts.flat ? n0 : [c1, slope, s1];
      const u0 = (i / segments) * (circ / UV_TILE), u1 = ((i + 1) / segments) * (circ / UV_TILE);
      const v0 = y0 / UV_TILE, v1 = y1 / UV_TILE;
      const pA = [cx + c0 * rBottom, y0, cz + s0 * rBottom];
      const pB = [cx + c1 * rBottom, y0, cz + s1 * rBottom];
      const pC = [cx + c1 * rTop, y1, cz + s1 * rTop];
      const pD = [cx + c0 * rTop, y1, cz + s0 * rTop];
      this.pushVertex(buf, pA[0]!, pA[1]!, pA[2]!, n0[0]!, n0[1]!, n0[2]!, u0, v0);
      this.pushVertex(buf, pB[0]!, pB[1]!, pB[2]!, n1[0]!, n1[1]!, n1[2]!, u1, v0);
      this.pushVertex(buf, pC[0]!, pC[1]!, pC[2]!, n1[0]!, n1[1]!, n1[2]!, u1, v1);
      this.pushVertex(buf, pA[0]!, pA[1]!, pA[2]!, n0[0]!, n0[1]!, n0[2]!, u0, v0);
      this.pushVertex(buf, pC[0]!, pC[1]!, pC[2]!, n1[0]!, n1[1]!, n1[2]!, u1, v1);
      this.pushVertex(buf, pD[0]!, pD[1]!, pD[2]!, n0[0]!, n0[1]!, n0[2]!, u0, v1);
      if (opts.top !== false && rTop > 0) this.tri(key, [cx, y1, cz], pD, pC, [cx / UV_TILE, cz / UV_TILE], [pD[0]! / UV_TILE, pD[2]! / UV_TILE], [pC[0]! / UV_TILE, pC[2]! / UV_TILE]);
      if (opts.bottom !== false && rBottom > 0) this.tri(key, [cx, y0, cz], pB, pA);
    }
  }

  /** Pirámide de base rectangular (techos a cuatro aguas, chapiteles). */
  pyramid(key: string, cx: number, cy: number, cz: number, sx: number, sz: number, h: number, ridge = 0) {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    const top = cy + h;
    if (ridge > 0) {
      // Cumbrera a lo largo del eje más largo.
      if (sx >= sz) {
        const r = Math.min(ridge, sx / 2 - 0.01);
        const a = [cx - r, top, cz], b = [cx + r, top, cz];
        this.quad(key, [x0, cy, z1], [x1, cy, z1], b, a);
        this.quad(key, [x1, cy, z0], [x0, cy, z0], a, b);
        this.tri(key, [x1, cy, z1], [x1, cy, z0], b);
        this.tri(key, [x0, cy, z0], [x0, cy, z1], a);
      } else {
        const r = Math.min(ridge, sz / 2 - 0.01);
        const a = [cx, top, cz - r], b = [cx, top, cz + r];
        this.quad(key, [x1, cy, z1], [x1, cy, z0], a, b);
        this.quad(key, [x0, cy, z0], [x0, cy, z1], b, a);
        this.tri(key, [x0, cy, z1], [x1, cy, z1], b);
        this.tri(key, [x1, cy, z0], [x0, cy, z0], a);
      }
      return;
    }
    const apex = [cx, top, cz];
    this.tri(key, [x0, cy, z1], [x1, cy, z1], apex);
    this.tri(key, [x1, cy, z1], [x1, cy, z0], apex);
    this.tri(key, [x1, cy, z0], [x0, cy, z0], apex);
    this.tri(key, [x0, cy, z0], [x0, cy, z1], apex);
  }

  /** Techo a dos aguas: cumbrera paralela a X si sx >= sz. Devuelve las caras hastiales en `gableKey`. */
  gable(roofKey: string, gableKey: string, cx: number, cy: number, cz: number, sx: number, sz: number, h: number, overhang = 0.4) {
    const alongX = sx >= sz;
    const L = (alongX ? sx : sz) / 2 + overhang;
    const W = (alongX ? sz : sx) / 2 + overhang;
    const wallW = (alongX ? sz : sx) / 2;
    const m = new Matrix4().makeRotationY(alongX ? 0 : Math.PI / 2).setPosition(cx, cy, cz);
    this.with(m, () => {
      const dropY = -(overhang / wallW) * h; // el alero continúa la pendiente
      // Faldones
      this.quad(roofKey, [-L, dropY, W], [L, dropY, W], [L, h, 0], [-L, h, 0]);
      this.quad(roofKey, [L, dropY, -W], [-L, dropY, -W], [-L, h, 0], [L, h, 0]);
      // Caras inferiores del alero (para que no se vea a través)
      this.quad(roofKey, [L, dropY, W], [-L, dropY, W], [-L, h, 0], [L, h, 0]);
      this.quad(roofKey, [-L, dropY, -W], [L, dropY, -W], [L, h, 0], [-L, h, 0]);
      // Hastiales
      const Lw = L - overhang;
      this.tri(gableKey, [Lw, 0, wallW], [Lw, 0, -wallW], [Lw, h, 0]);
      this.tri(gableKey, [-Lw, 0, -wallW], [-Lw, 0, wallW], [-Lw, h, 0]);
    });
  }

  /** Semiesfera (cúpulas). */
  dome(key: string, cx: number, cy: number, cz: number, r: number, segments = 16, rings = 8) {
    const buf = this.buf(key);
    for (let j = 0; j < rings; j++) {
      const t0 = (j / rings) * (Math.PI / 2), t1 = ((j + 1) / rings) * (Math.PI / 2);
      for (let i = 0; i < segments; i++) {
        const p0 = (i / segments) * Math.PI * 2, p1 = ((i + 1) / segments) * Math.PI * 2;
        const pt = (t: number, p: number) => [Math.cos(t) * Math.sin(p), Math.sin(t), Math.cos(t) * Math.cos(p)];
        const a = pt(t0, p0), b = pt(t0, p1), c = pt(t1, p1), d = pt(t1, p0);
        for (const v of [a, b, c, a, c, d]) this.pushVertex(buf, cx + v[0]! * r, cy + v[1]! * r, cz + v[2]! * r, v[0]!, v[1]!, v[2]!, (v[0]! * r) / UV_TILE, (v[1]! * r + v[2]! * r) / UV_TILE);
      }
    }
  }

  /** Icosfera deformada (copas de árboles, rocas, arbustos). */
  blob(key: string, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, jitter: (x: number, y: number, z: number) => number, detail = 1) {
    const base = icosphere(detail);
    for (let k = 0; k < base.length; k += 9) {
      const pts: number[][] = [];
      for (let v = 0; v < 3; v++) {
        const x = base[k + v * 3]!, y = base[k + v * 3 + 1]!, z = base[k + v * 3 + 2]!;
        const f = 1 + jitter(x, y, z);
        pts.push([cx + x * rx * f, cy + y * ry * f, cz + z * rz * f]);
      }
      this.tri(key, pts[0]!, pts[1]!, pts[2]!, [pts[0]![0]! / UV_TILE, pts[0]![1]! / UV_TILE], [pts[1]![0]! / UV_TILE, pts[1]![1]! / UV_TILE], [pts[2]![0]! / UV_TILE, pts[2]![1]! / UV_TILE]);
    }
  }

  isEmpty(key?: string): boolean {
    if (key) return !this.buffers.get(key)?.pos.length;
    for (const b of this.buffers.values()) if (b.pos.length) return false;
    return true;
  }

  keys(): string[] {
    return [...this.buffers.keys()].filter((k) => this.buffers.get(k)!.pos.length > 0);
  }

  /** Una geometría por clave de material. */
  buildParts(): Map<string, BufferGeometry> {
    const out = new Map<string, BufferGeometry>();
    for (const [key, b] of this.buffers) {
      if (!b.pos.length) continue;
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(b.pos), 3));
      g.setAttribute("normal", new BufferAttribute(new Float32Array(b.nor), 3));
      g.setAttribute("uv", new BufferAttribute(new Float32Array(b.uv), 2));
      g.computeBoundingBox();
      g.computeBoundingSphere();
      out.set(key, g);
    }
    return out;
  }

  /** Todo junto en una geometría con grupos (para mallas individuales). */
  buildMerged(order: string[]): { geometry: BufferGeometry; keys: string[] } {
    const pos: number[] = [], nor: number[] = [], uv: number[] = [];
    const g = new BufferGeometry();
    const keys: string[] = [];
    for (const key of order) {
      const b = this.buffers.get(key);
      if (!b || !b.pos.length) continue;
      const start = pos.length / 3;
      for (const v of b.pos) pos.push(v);
      for (const v of b.nor) nor.push(v);
      for (const v of b.uv) uv.push(v);
      g.addGroup(start, b.pos.length / 3, keys.length);
      keys.push(key);
    }
    g.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute("normal", new BufferAttribute(new Float32Array(nor), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return { geometry: g, keys };
  }
}

const icoCache = new Map<number, number[]>();
/** Triángulos de una icosfera unitaria (lista plana x,y,z). */
export function icosphere(detail: number): number[] {
  const cached = icoCache.get(detail);
  if (cached) return cached;
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map((v) => {
    const l = Math.hypot(v[0]!, v[1]!, v[2]!);
    return [v[0]! / l, v[1]! / l, v[2]! / l];
  });
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ].map((f) => f.map((i) => verts[i]!));
  for (let d = 0; d < detail; d++) {
    const next: number[][][] = [];
    for (const [a, b, c] of faces) {
      const mid = (p: number[], q: number[]) => {
        const m = [(p[0]! + q[0]!) / 2, (p[1]! + q[1]!) / 2, (p[2]! + q[2]!) / 2];
        const l = Math.hypot(m[0]!, m[1]!, m[2]!);
        return [m[0]! / l, m[1]! / l, m[2]! / l];
      };
      const ab = mid(a!, b!), bc = mid(b!, c!), ca = mid(c!, a!);
      next.push([a!, ab, ca], [b!, bc, ab], [c!, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  const out: number[] = [];
  for (const f of faces) for (const v of f) out.push(v[0]!, v[1]!, v[2]!);
  icoCache.set(detail, out);
  return out;
}
