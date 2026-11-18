import { describe, expect, it } from "vitest";
import { sunPosition, sunTimes, moonIllumination, seasons, subsolarPoint, astronomicalSeason, moonPosition } from "../src/geo/astronomy.ts";

const minutesBetween = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / 60000;

describe("Sol", () => {
  it("declinación en el solsticio de junio ≈ +23.44°", () => {
    expect(sunPosition(new Date("2024-06-20T20:51:00Z"), 0, 0).declination).toBeCloseTo(23.44, 1);
  });
  it("Buenos Aires 21/06/2024: salida 08:00 y puesta 17:50 (UTC−3) ±3 min", () => {
    const t = sunTimes(new Date("2024-06-21T15:00:00Z"), -34.6037, -58.3816);
    expect(minutesBetween(t.sunrise!, new Date("2024-06-21T11:00:00Z"))).toBeLessThan(3);
    expect(minutesBetween(t.sunset!, new Date("2024-06-21T20:50:00Z"))).toBeLessThan(3);
    expect(t.dayLengthHours).toBeGreaterThan(9.7);
    expect(t.dayLengthHours).toBeLessThan(9.9);
  });
  it("Londres 01/01/2024: salida 08:06 UTC ±3 min", () => {
    const t = sunTimes(new Date("2024-01-01T12:00:00Z"), 51.5074, -0.1278);
    expect(minutesBetween(t.sunrise!, new Date("2024-01-01T08:06:00Z"))).toBeLessThan(3);
    expect(minutesBetween(t.sunset!, new Date("2024-01-01T16:02:00Z"))).toBeLessThan(3);
  });
  it("sol de medianoche y noche polar", () => {
    expect(sunTimes(new Date("2024-06-21T12:00:00Z"), 78.22, 15.65).regime).toBe("polar-day");
    expect(sunTimes(new Date("2024-12-21T12:00:00Z"), 78.22, 15.65).regime).toBe("polar-night");
  });
  it("altura del Sol al mediodía solar en el ecuador en equinoccio ≈ 90°", () => {
    const t = sunTimes(new Date("2024-03-20T12:00:00Z"), 0, 0);
    expect(sunPosition(t.solarNoon, 0, 0).altitude).toBeGreaterThan(89.4);
  });
  it("acimut del Sol de la mañana hacia el este", () => {
    const p = sunPosition(new Date("2024-03-20T08:00:00Z"), 0, 0);
    expect(p.azimuth).toBeGreaterThan(85);
    expect(p.azimuth).toBeLessThan(95);
  });
  it("punto subsolar", () => {
    const s = subsolarPoint(new Date("2024-06-20T12:00:00Z"));
    expect(s.lat).toBeCloseTo(23.44, 1);
    expect(Math.abs(s.lon)).toBeLessThan(1);
  });
});

describe("estaciones", () => {
  it("equinoccios y solsticios 2024 (±20 min)", () => {
    const s = seasons(2024);
    expect(minutesBetween(s.marchEquinox, new Date("2024-03-20T03:06:00Z"))).toBeLessThan(20);
    expect(minutesBetween(s.juneSolstice, new Date("2024-06-20T20:51:00Z"))).toBeLessThan(20);
    expect(minutesBetween(s.septemberEquinox, new Date("2024-09-22T12:44:00Z"))).toBeLessThan(20);
    expect(minutesBetween(s.decemberSolstice, new Date("2024-12-21T09:20:00Z"))).toBeLessThan(20);
  });
  it("estación por hemisferio", () => {
    expect(astronomicalSeason(new Date("2024-07-15T00:00:00Z"), -34)).toBe("winter");
    expect(astronomicalSeason(new Date("2024-07-15T00:00:00Z"), 40)).toBe("summer");
  });
});

describe("Luna", () => {
  it("luna llena 25/01/2024 17:54 UTC", () => {
    const m = moonIllumination(new Date("2024-01-25T17:54:00Z"));
    expect(m.fraction).toBeGreaterThan(0.99);
    expect(m.name).toBe("full");
  });
  it("luna nueva 11/01/2024 11:57 UTC", () => {
    const m = moonIllumination(new Date("2024-01-11T11:57:00Z"));
    expect(m.fraction).toBeLessThan(0.01);
    expect(m.name).toBe("new");
  });
  it("cuarto creciente 18/01/2024 03:53 UTC ≈ 50%", () => {
    const m = moonIllumination(new Date("2024-01-18T03:53:00Z"));
    expect(m.fraction).toBeGreaterThan(0.45);
    expect(m.fraction).toBeLessThan(0.55);
    expect(m.name).toBe("first-quarter");
  });
  it("posición lunar plausible", () => {
    const p = moonPosition(new Date("2024-01-25T17:54:00Z"), -34.6, -58.4);
    expect(p.distanceKm).toBeGreaterThan(356000);
    expect(p.distanceKm).toBeLessThan(407000);
    expect(p.altitude).toBeGreaterThan(-90);
  });
});
