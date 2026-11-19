import { describe, expect, it } from "vitest";
import { buildTerrainMesh, octEncode, octDecode, geodeticToEcef } from "../src/geo/terrain-mesh.ts";

function upAt(lon: number, lat: number): [number, number, number] {
  const r = Math.PI / 180;
  return [Math.cos(lat * r) * Math.cos(lon * r), Math.cos(lat * r) * Math.sin(lon * r), Math.sin(lat * r)];
}

describe("codificación octaédrica", () => {
  it("ida y vuelta con error < 1°", () => {
    for (const v of [[0, 0, 1], [1, 0, 0], [0, -1, 0], [0.3, -0.5, -0.81], [-0.6, 0.6, 0.53]] as [number, number, number][]) {
      const l = Math.hypot(...v);
      const n = v.map((x) => x / l) as [number, number, number];
      const d = octDecode(...octEncode(...n));
      const dot = n[0] * d[0] + n[1] * d[1] + n[2] * d[2];
      expect(Math.acos(Math.min(1, dot)) * (180 / Math.PI)).toBeLessThan(1);
    }
  });
});

describe("malla de terreno", () => {
  const size = 16;
  it("terreno plano: normales verticales y alturas cuantizadas", () => {
    const flat = new Float32Array(size * size).fill(100);
    const m = buildTerrainMesh(flat, size, { x: 2, y: 1, z: 2, grid: 9, minHeight: 0 });
    const n = 9;
    expect(m.quantizedVertices.length).toBe(n * n * 3);
    expect(m.indices.length).toBe((n - 1) * (n - 1) * 6);
    expect(m.minimumHeight).toBeCloseTo(100);
    expect(m.westIndices).toHaveLength(n);
    // u del borde oeste = 0, del este = 32767
    expect(m.quantizedVertices[m.westIndices[3]!]).toBe(0);
    expect(m.quantizedVertices[m.eastIndices[3]!]).toBe(32767);
    // v del borde sur = 0, norte = 32767
    expect(m.quantizedVertices[n * n + m.southIndices[2]!]).toBe(0);
    expect(m.quantizedVertices[n * n + m.northIndices[2]!]).toBe(32767);
    // normal en el centro ≈ vertical local
    const k = 4 * n + 4;
    const d = octDecode(m.encodedNormals[k * 2]!, m.encodedNormals[k * 2 + 1]!);
    // tesela z2 x2 y1: lon 0..90, lat 0..66.5 → centro aprox lon 45, lat 35
    const up = upAt(45, 35.1);
    expect(d[0] * up[0] + d[1] * up[1] + d[2] * up[2]).toBeGreaterThan(0.99);
  });

  it("ladera inclinada hacia el este: la normal se inclina hacia el oeste", () => {
    const z = 14;
    const ramp = new Float32Array(size * size).map((_, i) => (i % size) * 50); // sube hacia el este
    const m = buildTerrainMesh(ramp, size, { x: 8000, y: 9000, z, grid: 9, minHeight: null });
    const n = 9;
    const k = 4 * n + 4;
    const d = octDecode(m.encodedNormals[k * 2]!, m.encodedNormals[k * 2 + 1]!);
    // vector este en ECEF en ese punto
    const lon = (8000.5 / 2 ** z) * 360 - 180;
    const r = Math.PI / 180;
    const east = [-Math.sin(lon * r), Math.cos(lon * r), 0];
    expect(d[0] * east[0]! + d[1] * east[1]! + d[2] * east[2]!).toBeLessThan(-0.3);
    expect(m.maximumHeight).toBeGreaterThan(m.minimumHeight);
  });

  it("esfera envolvente contiene todos los vértices", () => {
    const h = new Float32Array(size * size).map((_, i) => Math.sin(i) * 300 + 500);
    const m = buildTerrainMesh(h, size, { x: 5, y: 9, z: 4, grid: 17, minHeight: 0 });
    const [, , , rad] = m.sphere;
    for (let k = 0; k < m.relativePositions.length; k += 3) expect(Math.hypot(m.relativePositions[k]!, m.relativePositions[k + 1]!, m.relativePositions[k + 2]!)).toBeLessThanOrEqual(rad + 1e-6);
    const p = new Float64Array(3);
    geodeticToEcef(0, 0, 0, p, 0);
    expect(p[0]).toBeCloseTo(6378137, 3);
  });
});
