import type { Obb2 } from "../math";
import { pointInObb } from "../math";
import type { Rng } from "../rng";
import type { Terrain, Vec2, WorldDoc } from "../types";
import type { Layout } from "./layout";
import type { WorldPlan } from "./plan";
import { heightAt, slopeAt, type Site } from "./terrain";

export interface GenContext {
  plan: WorldPlan;
  doc: WorldDoc;
  rng: Rng;
  site: Site;
  layout: Layout;
  id: (prefix: string) => string;
  log: (message: string) => void;
  occupancy: Occupancy;
  /** Huellas de edificios colocados (para evitar superposiciones). */
  footprints: Obb2[];
}

/** Grilla de ocupación de 2 m para distribuir objetos sin superponerlos. */
export class Occupancy {
  readonly cell = 2;
  readonly n: number;
  readonly half: number;
  private cells: Uint8Array;

  constructor(readonly size: number) {
    this.n = Math.ceil(size / this.cell);
    this.half = size / 2;
    this.cells = new Uint8Array(this.n * this.n);
  }

  private idx(x: number, z: number): number {
    const i = Math.floor((x + this.half) / this.cell);
    const j = Math.floor((z + this.half) / this.cell);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }

  isFree(x: number, z: number): boolean {
    const k = this.idx(x, z);
    return k >= 0 && this.cells[k] === 0;
  }

  /** Libre en un radio (aprox. por muestreo de celdas). */
  isFreeRadius(x: number, z: number, r: number): boolean {
    for (let dz = -r; dz <= r; dz += this.cell) for (let dx = -r; dx <= r; dx += this.cell) if (!this.isFree(x + dx, z + dz)) return false;
    return true;
  }

  mark(x: number, z: number, value = 1) {
    const k = this.idx(x, z);
    if (k >= 0) this.cells[k] = value;
  }

  markRadius(x: number, z: number, r: number) {
    for (let dz = -r; dz <= r; dz += this.cell) for (let dx = -r; dx <= r; dx += this.cell) if (dx * dx + dz * dz <= r * r + 1) this.mark(x + dx, z + dz);
  }

  markObb(o: Obb2) {
    const r = Math.hypot(o.hx, o.hz);
    for (let z = o.cz - r; z <= o.cz + r; z += this.cell / 2) {
      for (let x = o.cx - r; x <= o.cx + r; x += this.cell / 2) {
        if (pointInObb(x, z, o, 0.5)) this.mark(x, z);
      }
    }
  }
}

export function groundY(terrain: Terrain, x: number, z: number): number {
  return heightAt(terrain, x, z);
}

/** Altura mínima bajo una huella rectangular: el edificio se apoya sin flotar. */
export function footprintBaseY(terrain: Terrain, center: Vec2, w: number, d: number, rot: number): number {
  const c = Math.cos(rot), s = Math.sin(rot);
  let min = Infinity;
  for (const [lx, lz] of [
    [0, 0],
    [w / 2, d / 2],
    [-w / 2, d / 2],
    [w / 2, -d / 2],
    [-w / 2, -d / 2],
  ] as const) {
    const x = center[0] + lx * c + lz * s;
    const z = center[1] - lx * s + lz * c;
    min = Math.min(min, heightAt(terrain, x, z));
  }
  return min;
}

export function isBuildable(terrain: Terrain, x: number, z: number, maxSlope = 25): boolean {
  if (terrain.waterEnabled && heightAt(terrain, x, z) < terrain.waterLevel + 0.6) return false;
  return slopeAt(terrain, x, z) <= maxSlope;
}
