import { describe, expect, it } from "vitest";
import { flightBetween, sampleTour, tourDuration, orbitAround, angleDelta, ease, followRoute } from "../src/geo/tour.ts";
import { haversine } from "../src/geo/geodesy.ts";

describe("recorridos", () => {
  const from = { lon: -58.38, lat: -34.6, height: 20_000_000, heading: 0, pitch: -90, roll: 0 };
  it("vuelo empieza y termina donde corresponde", () => {
    const k = flightBetween(from, { lon: 2.2945, lat: 48.8584 }, { arrivalHeight: 800 });
    const total = tourDuration(k);
    expect(total).toBeGreaterThan(4);
    const s0 = sampleTour(k, 0)!.pose;
    expect(s0.lon).toBeCloseTo(-58.38, 6);
    const s1 = sampleTour(k, total)!.pose;
    expect(s1.height).toBeCloseTo(800, 3);
    expect(haversine(s1, { lon: 2.2945, lat: 48.8584 })).toBeLessThan(3000);
  });
  it("la trayectoria es continua (sin saltos grandes)", () => {
    const k = flightBetween({ ...from, height: 3000 }, { lon: -58.37, lat: -34.59 });
    const T = tourDuration(k);
    let prev = sampleTour(k, 0)!.pose;
    for (let t = 0.05; t <= T; t += 0.05) {
      const p = sampleTour(k, t)!.pose;
      expect(haversine(prev, p)).toBeLessThan(500);
      prev = p;
    }
  });
  it("órbita mira al centro", () => {
    const k = orbitAround({ lon: 0, lat: 0 }, { radius: 1000, height: 500 });
    expect(k[0]!.heading).toBe(0);
    expect(k[0]!.pitch).toBeLessThan(0);
  });
  it("ángulos y easing", () => {
    expect(angleDelta(350, 10)).toBe(20);
    expect(angleDelta(10, 350)).toBe(-20);
    expect(ease("smooth", 0.5)).toBeCloseTo(0.5);
    expect(ease("ease-in-out", 1)).toBe(1);
  });
  it("seguimiento de ruta", () => {
    const k = followRoute([{ lon: 0, lat: 0 }, { lon: 0.01, lat: 0 }], { heightAboveGround: 100, speed: 50, maxKeyframes: 5 });
    expect(k.length).toBeGreaterThanOrEqual(5);
    expect(k[0]!.heading).toBeCloseTo(90, 0);
    expect(tourDuration(k)).toBeCloseTo(1113 / 50, 0);
  });
});
