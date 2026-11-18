import { describe, expect, it } from "vitest";
import { inverse, direct, polygonArea, haversine, interpolateGeodesic, pathLength, pointInRing } from "../src/geo/geodesy.ts";

describe("Vincenty", () => {
  it("Flinders Peak → Buninyong (ejemplo clásico de Vincenty)", () => {
    const a = { lat: -(37 + 57 / 60 + 3.7203 / 3600), lon: 144 + 25 / 60 + 29.5244 / 3600 };
    const b = { lat: -(37 + 39 / 60 + 10.1561 / 3600), lon: 143 + 55 / 60 + 35.3839 / 3600 };
    const r = inverse(a, b);
    expect(r.distance).toBeCloseTo(54972.271, 2);
    expect(r.initialBearing).toBeCloseTo(306 + 52 / 60 + 5.37 / 3600, 4);
    expect(r.method).toBe("vincenty");
  });
  it("Buenos Aires → Madrid = 10 020.3196 km (geographiclib)", () => {
    const d = inverse({ lat: -34.6037, lon: -58.3816 }, { lat: 40.4168, lon: -3.7038 }).distance;
    expect(d / 1000).toBeCloseTo(10020.3196, 3);
  });
  it("directo inverso consistente", () => {
    const a = { lat: 10, lon: 20 };
    const p = direct(a, 45, 1_000_000);
    const r = inverse(a, p);
    expect(r.distance).toBeCloseTo(1_000_000, 3);
    expect(r.initialBearing).toBeCloseTo(45, 6);
  });
  it("casi antípodas no se cuelga", () => {
    const r = inverse({ lat: 0, lon: 0 }, { lat: 0.5, lon: 179.7 });
    expect(r.distance).toBeGreaterThan(19_900_000);
  });
  it("mismo punto", () => expect(inverse({ lat: 1, lon: 1 }, { lat: 1, lon: 1 }).distance).toBe(0));
  it("haversine ~ vincenty (<0.5%)", () => {
    const a = { lat: 51.5, lon: -0.12 };
    const b = { lat: 40.71, lon: -74 };
    expect(Math.abs(haversine(a, b) / inverse(a, b).distance - 1)).toBeLessThan(0.005);
  });
});

describe("áreas", () => {
  it("cuadrado de 1° en el ecuador ≈ 12 309 km²", () => {
    const a = polygonArea([{ lat: 0, lon: 0 }, { lat: 0, lon: 1 }, { lat: 1, lon: 1 }, { lat: 1, lon: 0 }]);
    expect(a / 1e6).toBeCloseTo(12308.78, -1);
  });
  it("octante = 1/8 de la superficie terrestre", () => {
    const a = polygonArea([{ lat: 0, lon: 0 }, { lat: 0, lon: 90 }, { lat: 90, lon: 0 }]);
    expect(a / 1e6 / 63_758_000).toBeCloseTo(1, 2);
  });
  it("independiente de orientación y cierre", () => {
    const ring = [{ lat: -34.6, lon: -58.4 }, { lat: -34.6, lon: -58.39 }, { lat: -34.59, lon: -58.39 }];
    expect(polygonArea(ring)).toBeCloseTo(polygonArea([...ring].reverse()), 3);
    expect(polygonArea([...ring, ring[0]!])).toBeCloseTo(polygonArea(ring), 3);
  });
  it("hectárea (100 m × 100 m)", () => {
    const o = { lat: -34.6, lon: -58.4 };
    const e = direct(o, 90, 100);
    const ne = direct(e, 0, 100);
    const n = direct(o, 0, 100);
    expect(polygonArea([o, e, ne, n])).toBeGreaterThan(9990);
    expect(polygonArea([o, e, ne, n])).toBeLessThan(10010);
  });
});

describe("utilidades", () => {
  it("interpolación geodésica", () => {
    const pts = interpolateGeodesic({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }, 11);
    expect(pts).toHaveLength(11);
    expect(pts[5]!.lon).toBeCloseTo(5, 6);
    expect(pathLength(pts)).toBeCloseTo(inverse({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }).distance, 0);
  });
  it("punto en polígono", () => {
    const ring = [{ lat: 0, lon: 0 }, { lat: 0, lon: 2 }, { lat: 2, lon: 2 }, { lat: 2, lon: 0 }];
    expect(pointInRing({ lat: 1, lon: 1 }, ring)).toBe(true);
    expect(pointInRing({ lat: 3, lon: 1 }, ring)).toBe(false);
  });
});
