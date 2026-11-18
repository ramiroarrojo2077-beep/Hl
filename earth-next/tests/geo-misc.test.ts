import { describe, expect, it } from "vitest";
import { decodeTerrarium, encodeTerrarium, resampleHeights, sampleBilinear } from "../src/geo/terrarium.ts";
import { lonLatToTile, tileBBox, tilesAround, lonLatToTilePixel } from "../src/geo/tiles.ts";
import { hornSlope, profileStats, slopeClass } from "../src/geo/slope.ts";
import { lodForHeight } from "../src/geo/lod.ts";
import { formatDistance, formatArea } from "../src/geo/format.ts";

describe("terrarium", () => {
  it("decodifica nivel del mar", () => expect(decodeTerrarium(128, 0, 0)).toBe(0));
  it("ida y vuelta", () => {
    for (const h of [-10994, -32.5, 0, 25.75, 6961.3, 8848]) {
      const [r, g, b] = encodeTerrarium(h);
      expect(decodeTerrarium(r, g, b)).toBeCloseTo(h, 1);
    }
  });
  it("re-muestreo conserva una rampa y recorta batimetría", () => {
    const size = 4;
    const h = new Float32Array(size * size).map((_, i) => (i % size) * 10 - 15);
    const out = resampleHeights(h, size, { outSize: 3, minHeight: 0 });
    expect(out[0]).toBe(0);
    expect(out[2]).toBeCloseTo(15);
    expect(sampleBilinear(h, size, 2, 0.5)).toBeCloseTo(0);
  });
});

describe("teselas", () => {
  it("Obelisco en z15", () => {
    const t = lonLatToTile({ lon: -58.38157, lat: -34.60373 }, 15);
    const b = tileBBox(t);
    expect(b.west).toBeLessThanOrEqual(-58.38157);
    expect(b.east).toBeGreaterThan(-58.38157);
    expect(b.south).toBeLessThanOrEqual(-34.60373);
    expect(b.north).toBeGreaterThan(-34.60373);
  });
  it("píxel fraccionario dentro de [0,256)", () => {
    const r = lonLatToTilePixel({ lon: 2.2945, lat: 48.8584 }, 14);
    expect(r.px).toBeGreaterThanOrEqual(0);
    expect(r.px).toBeLessThan(256);
  });
  it("teselas alrededor ordenadas por cercanía", () => {
    const c = { lon: -58.38, lat: -34.6 };
    const ts = tilesAround(c, 2000, 15, 9);
    expect(ts[0]).toEqual(lonLatToTile(c, 15));
    expect(ts.length).toBeLessThanOrEqual(9);
  });
});

describe("pendientes", () => {
  it("plano inclinado 45° hacia el este (baja al oeste)", () => {
    // sube 10 m por celda de 10 m hacia el este
    const z = [0, 10, 20, 0, 10, 20, 0, 10, 20];
    const r = hornSlope(z, 10, 10);
    expect(r.degrees).toBeCloseTo(45, 6);
    expect(r.aspect).toBeCloseTo(270, 6);
  });
  it("plano horizontal", () => expect(hornSlope(new Array(9).fill(5), 30, 30).aspect).toBeNull());
  it("perfil", () => {
    const s = profileStats([{ distance: 0, elevation: 100 }, { distance: 100, elevation: 110 }, { distance: 200, elevation: 90 }]);
    expect(s.totalAscent).toBe(10);
    expect(s.totalDescent).toBe(20);
    expect(s.maxGradePercent).toBeCloseTo(20);
  });
  it("clases", () => expect(slopeClass(35)).toBe("very-steep"));
});

describe("LOD y formato", () => {
  it("niveles", () => {
    expect(lodForHeight(20_000_000).level).toBe(0);
    expect(lodForHeight(500_000).level).toBe(1);
    expect(lodForHeight(50_000).level).toBe(2);
    expect(lodForHeight(3_000).level).toBe(3);
    expect(lodForHeight(300).level).toBe(4);
    expect(lodForHeight(40).level).toBe(5);
  });
  it("formato", () => {
    expect(formatDistance(1234.5, "metric", "es")).toBe("1,23 km");
    expect(formatArea(25_000, "metric", "es")).toBe("2,5 ha");
  });
});
