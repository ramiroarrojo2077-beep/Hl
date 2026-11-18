import { describe, expect, it } from "vitest";
import { parseOsmLength, estimateHeight, parseOverpassBuildings, assembleRings, signedRingArea, buildingsQuery } from "../src/geo/osm-buildings.ts";

describe("alturas OSM", () => {
  it("parsea unidades", () => {
    expect(parseOsmLength("12")).toBe(12);
    expect(parseOsmLength("12.5 m")).toBe(12.5);
    expect(parseOsmLength("40'")).toBeCloseTo(12.192);
    expect(parseOsmLength("10 ft")).toBeCloseTo(3.048);
    expect(parseOsmLength("12'6\"")).toBeCloseTo(3.81);
    expect(parseOsmLength("alto")).toBeNull();
  });
  it("clasifica calidad", () => {
    expect(estimateHeight({ building: "yes", height: "67.5" })).toMatchObject({ height: 67.5, quality: "measured" });
    expect(estimateHeight({ building: "apartments", "building:levels": "10" })).toMatchObject({ height: 30, quality: "levels" });
    expect(estimateHeight({ building: "house" })).toMatchObject({ height: 6, quality: "default" });
    expect(estimateHeight({ building: "roof", height: "6" }).minHeight).toBe(5);
    expect(estimateHeight({ "building:part": "yes", height: "20", min_height: "10" }).minHeight).toBe(10);
  });
});

describe("parser Overpass", () => {
  const sq = (x: number, y: number, s: number) => [
    { lat: y, lon: x }, { lat: y, lon: x + s }, { lat: y + s, lon: x + s }, { lat: y + s, lon: x }, { lat: y, lon: x },
  ];
  it("vías cerradas → edificios antihorarios", () => {
    const fs = parseOverpassBuildings({ elements: [{ type: "way", id: 1, tags: { building: "yes", "building:levels": "3" }, geometry: sq(0, 0, 0.001).reverse() }] });
    expect(fs).toHaveLength(1);
    expect(fs[0]!.outer).toHaveLength(4);
    expect(signedRingArea(fs[0]!.outer)).toBeGreaterThan(0);
    expect(fs[0]!.height).toBe(9);
  });
  it("multipolígono con patio y vías partidas", () => {
    const outer = sq(0, 0, 0.002);
    const fs = parseOverpassBuildings({
      elements: [{
        type: "relation", id: 7, tags: { building: "yes", type: "multipolygon", height: "20" },
        members: [
          { type: "way", ref: 1, role: "outer", geometry: outer.slice(0, 3) },
          { type: "way", ref: 2, role: "outer", geometry: outer.slice(2).reverse() },
          { type: "way", ref: 3, role: "inner", geometry: sq(0.0005, 0.0005, 0.0005) },
        ],
      }],
    });
    expect(fs).toHaveLength(1);
    expect(fs[0]!.holes).toHaveLength(1);
    expect(fs[0]!.quality).toBe("measured");
  });
  it("oculta contornos con partes", () => {
    const fs = parseOverpassBuildings({
      elements: [
        { type: "way", id: 1, tags: { building: "yes" }, geometry: sq(0, 0, 0.01) },
        { type: "way", id: 2, tags: { "building:part": "yes", height: "50" }, geometry: sq(0.002, 0.002, 0.002) },
      ],
    });
    expect(fs.map((f) => f.id)).toEqual(["w2"]);
  });
  it("assembleRings descarta anillos abiertos", () => {
    expect(assembleRings([[{ lat: 0, lon: 0 }, { lat: 1, lon: 1 }]])).toHaveLength(0);
  });
  it("consulta", () => expect(buildingsQuery(-34.61, -58.39, -34.6, -58.38)).toContain('way["building"](-34.610000,-58.390000,-34.600000,-58.380000)'));
});
