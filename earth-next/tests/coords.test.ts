import { describe, expect, it } from "vitest";
import { parseCoordinates, lonLatToUtm, utmToLonLat, formatDMS, parseUtm, normalizeLon } from "../src/geo/coords.ts";

describe("parseCoordinates", () => {
  const close = (p: { lat: number; lon: number } | null, lat: number, lon: number, eps = 1e-4) => {
    expect(p).not.toBeNull();
    expect(Math.abs(p!.lat - lat)).toBeLessThan(eps);
    expect(Math.abs(p!.lon - lon)).toBeLessThan(eps);
  };
  it("decimal lat, lon", () => close(parseCoordinates("-34.6037, -58.3816"), -34.6037, -58.3816));
  it("decimal separado por espacio", () => close(parseCoordinates("48.8584 2.2945"), 48.8584, 2.2945));
  it("hemisferios con sufijo", () => close(parseCoordinates("34.6037 S 58.3816 W"), -34.6037, -58.3816));
  it("hemisferio Oeste en español", () => close(parseCoordinates("34.6037S, 58.3816O"), -34.6037, -58.3816));
  it("DMS con símbolos", () => close(parseCoordinates(`34°36'13.3"S 58°22'53.8"W`), -34.60369, -58.38161));
  it("DMS con prefijo", () => close(parseCoordinates("S 34 36 13 W 58 22 54"), -34.60361, -58.38167));
  it("orden lon/lat con hemisferios", () => close(parseCoordinates("58.38W 34.6S"), -34.6, -58.38));
  it("geo: URI", () => close(parseCoordinates("geo:-33.4489,-70.6693"), -33.4489, -70.6693));
  it("rechaza nombres", () => expect(parseCoordinates("Buenos Aires")).toBeNull());
  it("rechaza fuera de rango", () => expect(parseCoordinates("95, 10")).toBeNull());
  it("rechaza minutos inválidos", () => expect(parseCoordinates("34 75 10 S 58 10 10 W")).toBeNull());
  it("UTM", () => close(parseCoordinates("21H 373317 6170033"), -34.6036, -58.3816, 1e-3));
});

describe("UTM", () => {
  it("ida y vuelta Obelisco", () => {
    const u = lonLatToUtm({ lat: -34.60373, lon: -58.38157 })!;
    expect(u.zone).toBe(21);
    expect(u.band).toBe("H");
    const back = utmToLonLat(u)!;
    expect(Math.abs(back.lat + 34.60373)).toBeLessThan(1e-7);
    expect(Math.abs(back.lon + 58.38157)).toBeLessThan(1e-7);
  });
  it("valor de referencia (Torre Eiffel, zona 31U, verificado con PROJ)", () => {
    const u = lonLatToUtm({ lat: 48.85837, lon: 2.294481 })!;
    expect(u.zone).toBe(31);
    expect(u.band).toBe("U");
    expect(u.easting).toBeCloseTo(448250.577, 2);
    expect(u.northing).toBeCloseTo(5411951.588, 2);
  });
  it("excepción de Noruega", () => expect(lonLatToUtm({ lat: 60, lon: 5 })!.zone).toBe(32));
  it("fuera de dominio", () => expect(lonLatToUtm({ lat: 85, lon: 0 })).toBeNull());
  it("parseUtm", () => expect(parseUtm("31U 448252 5411935")?.hemisphere).toBe("N"));
});

describe("formato", () => {
  it("DMS", () => expect(formatDMS({ lat: -34.60373, lon: -58.38157 })).toBe("34°36′13.43″S 058°22′53.65″O"));
  it("normalizeLon", () => {
    expect(normalizeLon(190)).toBe(-170);
    expect(normalizeLon(-190)).toBe(170);
    expect(normalizeLon(180)).toBe(180);
  });
});
