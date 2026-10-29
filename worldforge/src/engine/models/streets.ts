import { BufferAttribute, BufferGeometry } from "three";
import { heightAt, type TerrainLike } from "../generation/terrain";
import type { EntityOf, Intersection, Vec2 } from "../types";

/**
 * Geometría de calles (cinta que sigue el terreno) y manzanas (veredas,
 * parques, plazas). Todo se fusiona por material para dibujarlo en pocas
 * llamadas; `ranges` permite saber a qué entidad pertenece cada triángulo.
 */

export type StreetPart = "asphalt" | "dirt" | "marking" | "curbRed" | "curbWhite" | "sidewalk" | "grass" | "plaza" | "parking" | "curb";

interface Acc {
  pos: number[];
  nor: number[];
  uv: number[];
  owners: { start: number; count: number; id: string }[];
}

export interface StreetsGeometry {
  parts: Map<StreetPart, { geometry: BufferGeometry; owners: { start: number; count: number; id: string }[] }>;
}

class StreetBuilder {
  acc = new Map<StreetPart, Acc>();
  private owner = "";

  setOwner(id: string) {
    this.owner = id;
  }

  private get(part: StreetPart): Acc {
    let a = this.acc.get(part);
    if (!a) {
      a = { pos: [], nor: [], uv: [], owners: [] };
      this.acc.set(part, a);
    }
    return a;
  }

  /** Triángulo con mapeo planar en XZ (UV = metros / 4): coherente entre cintas superpuestas. */
  tri(part: StreetPart, a: number[], b: number[], c: number[], up = true) {
    const acc = this.get(part);
    const tri = (pts: number[][]) => {
      const startVertex = acc.pos.length / 3;
      for (const p of pts) {
        acc.pos.push(p[0]!, p[1]!, p[2]!);
        acc.uv.push(p[0]! / 4, p[2]! / 4);
      }
      const ux = pts[1]![0]! - pts[0]![0]!, uy = pts[1]![1]! - pts[0]![1]!, uz = pts[1]![2]! - pts[0]![2]!;
      const vx = pts[2]![0]! - pts[0]![0]!, vy = pts[2]![1]! - pts[0]![1]!, vz = pts[2]![2]! - pts[0]![2]!;
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      for (let i = 0; i < 3; i++) acc.nor.push(nx, ny, nz);
      const last = acc.owners[acc.owners.length - 1];
      if (last && last.id === this.owner && last.start + last.count === startVertex) last.count += 3;
      else acc.owners.push({ start: startVertex, count: 3, id: this.owner });
    };
    // Asegura la orientación hacia arriba en superficies horizontales.
    const ny = (b[2]! - a[2]!) * (c[0]! - a[0]!) - (b[0]! - a[0]!) * (c[2]! - a[2]!);
    if (up && ny < 0) tri([a, c, b]);
    else tri([a, b, c]);
  }

  quad(part: StreetPart, a: number[], b: number[], c: number[], d: number[], up = true) {
    this.tri(part, a, b, c, up);
    this.tri(part, a, c, d, up);
  }

  /** Cara vertical (bordes de veredas). */
  wall(part: StreetPart, a: number[], b: number[], h: number) {
    this.tri(part, a, b, [b[0]!, b[1]! + h, b[2]!], false);
    this.tri(part, a, [b[0]!, b[1]! + h, b[2]!], [a[0]!, a[1]! + h, a[2]!], false);
  }

  build(): StreetsGeometry {
    const parts: StreetsGeometry["parts"] = new Map();
    for (const [key, a] of this.acc) {
      if (!a.pos.length) continue;
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(new Float32Array(a.pos), 3));
      g.setAttribute("normal", new BufferAttribute(new Float32Array(a.nor), 3));
      g.setAttribute("uv", new BufferAttribute(new Float32Array(a.uv), 2));
      g.computeBoundingBox();
      g.computeBoundingSphere();
      parts.set(key, { geometry: g, owners: a.owners });
    }
    return { parts };
  }
}

/** Densifica una polilínea para que siga el terreno. */
function densify(points: readonly Vec2[], closed: boolean, step: number): Vec2[] {
  const out: Vec2[] = [];
  const n = points.length;
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = points[i]!, b = points[(i + 1) % n]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < k; j++) out.push([a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k]);
  }
  if (!closed) out.push([points[n - 1]![0], points[n - 1]![1]]);
  return out;
}

export function buildStreets(
  terrain: TerrainLike,
  roads: EntityOf<"road">[],
  blocks: EntityOf<"block">[],
  intersections: Intersection[],
): StreetsGeometry {
  const sb = new StreetBuilder();
  const lift = 0.07;
  for (const road of roads) {
    if (!road.visible) continue;
    sb.setOwner(road.id);
    const { width, kind, closed, markings } = road.props;
    const pts = densify(road.props.points, closed, 3);
    const n = pts.length;
    if (n < 2) continue;
    const half = width / 2;
    const surface: StreetPart = kind === "dirt" || kind === "path" ? "dirt" : "asphalt";
    // Normales laterales por vértice (promedio de segmentos adyacentes).
    const left: Vec2[] = [];
    for (let i = 0; i < n; i++) {
      const prev = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)]!;
      const next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)]!;
      const dx = next[0] - prev[0], dz = next[1] - prev[1];
      const l = Math.hypot(dx, dz) || 1;
      left.push([-dz / l, dx / l]);
    }
    const y = (x: number, z: number) => heightAt(terrain, x, z) + lift;
    const edge = (i: number, off: number): number[] => {
      const p = pts[i]!, l = left[i]!;
      const x = p[0] + l[0] * off, z = p[1] + l[1] * off;
      return [x, y(x, z), z];
    };
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % n;
      sb.quad(surface, edge(i, -half), edge(j, -half), edge(j, half), edge(i, half));
    }
    if (markings && surface === "asphalt") {
      const nearIntersection = (p: Vec2) => intersections.some((it) => Math.hypot(it.position[0] - p[0], it.position[1] - p[1]) < it.radius + 3.2);
      const mark = (off: number, w: number, dashed: boolean) => {
        for (let i = 0; i < segs; i++) {
          const j = (i + 1) % n;
          if (dashed && i % 2 === 1) continue;
          if (nearIntersection(pts[i]!) || nearIntersection(pts[j]!)) continue;
          const a0 = edge(i, off - w / 2), a1 = edge(j, off - w / 2), b1 = edge(j, off + w / 2), b0 = edge(i, off + w / 2);
          for (const v of [a0, a1, b1, b0]) v[1]! += 0.012;
          sb.quad("marking", a0, a1, b1, b0);
        }
      };
      if (kind === "track") {
        mark(-half + 0.5, 0.25, false);
        mark(half - 0.5, 0.25, false);
        // Pianos rojos y blancos en los bordes.
        for (let i = 0; i < segs; i++) {
          const j = (i + 1) % n;
          for (const s of [-1, 1]) {
            const a0 = edge(i, s * half), a1 = edge(j, s * half), b1 = edge(j, s * (half + 1.1)), b0 = edge(i, s * (half + 1.1));
            for (const v of [a0, a1, b1, b0]) v[1]! += 0.03;
            sb.quad(i % 2 ? "curbRed" : "curbWhite", a0, a1, b1, b0);
          }
        }
        // Línea de largada a cuadros.
        for (let c = 0; c < 8; c++) {
          for (let r = 0; r < 2; r++) {
            if ((c + r) % 2) continue;
            const o0 = -half + (width / 8) * c, o1 = o0 + width / 8;
            const p = pts[0]!, d = left[0]!;
            const fx = d[1], fz = -d[0]; // dirección de avance
            const z0 = r * 0.9, z1 = z0 + 0.9;
            const P = (o: number, f: number) => {
              const x = p[0] + d[0] * o + fx * f, z = p[1] + d[1] * o + fz * f;
              return [x, y(x, z) + 0.015, z];
            };
            sb.quad("marking", P(o0, z0), P(o1, z0), P(o1, z1), P(o0, z1));
          }
        }
      } else {
        mark(0, 0.18, true);
        if (kind === "avenue" || kind === "highway") {
          mark(-half + 0.4, 0.15, false);
          mark(half - 0.4, 0.15, false);
        }
      }
    }
  }

  // Sendas peatonales en los accesos a intersecciones con calles marcadas.
  for (const it of intersections) {
    sb.setOwner(`intersection:${it.id}`);
    const [ix, iz] = it.position;
    const r = it.radius;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const cx = ix + dx * (r + 1.6), cz = iz + dz * (r + 1.6);
      // Solo si hay calle en esa dirección.
      if (!roads.some((rd) => rd.props.markings && rd.props.kind !== "track" && pointNearPolyline(rd.props.points, [cx, cz], rd.props.width / 2))) continue;
      const stripes = Math.floor((r * 2) / 1.1);
      for (let s = 0; s < stripes; s++) {
        const o = -r + 0.55 + s * 1.1;
        const px = cx + (dz !== 0 ? o : 0), pz = cz + (dx !== 0 ? o : 0);
        const hw = dx !== 0 ? 1.2 : 0.3, hd = dx !== 0 ? 0.3 : 1.2;
        const yy = heightAt(terrain, px, pz) + lift + 0.014;
        sb.quad("marking", [px - hw, yy, pz - hd], [px + hw, yy, pz - hd], [px + hw, yy, pz + hd], [px - hw, yy, pz + hd]);
      }
    }
  }

  // Manzanas: losa de vereda con cordón y contenido según el uso.
  for (const blk of blocks) {
    if (!blk.visible) continue;
    sb.setOwner(blk.id);
    const [cx, by, cz] = blk.transform.position;
    const [w, d] = blk.props.size;
    const sw = blk.props.sidewalk;
    const top = by + 0.18;
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const ix0 = x0 + sw, ix1 = x1 - sw, iz0 = z0 + sw, iz1 = z1 - sw;
    // Anillo de vereda.
    sb.quad("sidewalk", [x0, top, z0], [x1, top, z0], [x1, top, iz0], [x0, top, iz0]);
    sb.quad("sidewalk", [x0, top, iz1], [x1, top, iz1], [x1, top, z1], [x0, top, z1]);
    sb.quad("sidewalk", [x0, top, iz0], [ix0, top, iz0], [ix0, top, iz1], [x0, top, iz1]);
    sb.quad("sidewalk", [ix1, top, iz0], [x1, top, iz0], [x1, top, iz1], [ix1, top, iz1]);
    // Cordón (caras laterales hasta debajo del terreno).
    const bottom = by - 1.2;
    const h = top - bottom;
    sb.wall("curb", [x0, bottom, z1], [x1, bottom, z1], h);
    sb.wall("curb", [x1, bottom, z0], [x0, bottom, z0], h);
    sb.wall("curb", [x1, bottom, z1], [x1, bottom, z0], h);
    sb.wall("curb", [x0, bottom, z0], [x0, bottom, z1], h);
    const inner: StreetPart = blk.props.use === "park" ? "grass" : blk.props.use === "plaza" ? "plaza" : blk.props.use === "parking" ? "parking" : "sidewalk";
    const iy = blk.props.use === "park" ? top + 0.02 : top;
    sb.quad(inner, [ix0, iy, iz0], [ix1, iy, iz0], [ix1, iy, iz1], [ix0, iy, iz1]);
    if (blk.props.use === "park") {
      // Senderos en cruz.
      sb.quad("plaza", [cx - 1.2, iy + 0.01, iz0], [cx + 1.2, iy + 0.01, iz0], [cx + 1.2, iy + 0.01, iz1], [cx - 1.2, iy + 0.01, iz1]);
      sb.quad("plaza", [ix0, iy + 0.012, cz - 1.2], [ix1, iy + 0.012, cz - 1.2], [ix1, iy + 0.012, cz + 1.2], [ix0, iy + 0.012, cz + 1.2]);
    }
    if (blk.props.use === "parking") {
      for (let k = 0; k < Math.floor((ix1 - ix0) / 3); k++) {
        const x = ix0 + 1.5 + k * 3;
        sb.quad("marking", [x - 0.06, iy + 0.01, cz - 6], [x + 0.06, iy + 0.01, cz - 6], [x + 0.06, iy + 0.01, cz + 6], [x - 0.06, iy + 0.01, cz + 6]);
      }
    }
  }
  return sb.build();
}

function pointNearPolyline(pts: readonly Vec2[], p: Vec2, maxD: number): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
    if (Math.hypot(a[0] + dx * t - p[0], a[1] + dz * t - p[1]) <= maxD) return true;
  }
  return false;
}

/** Busca la entidad dueña de un vértice (para la selección por raycast). */
export function ownerOf(owners: { start: number; count: number; id: string }[], vertex: number): string | null {
  let lo = 0, hi = owners.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const o = owners[mid]!;
    if (vertex < o.start) hi = mid - 1;
    else if (vertex >= o.start + o.count) lo = mid + 1;
    else return o.id;
  }
  return null;
}
