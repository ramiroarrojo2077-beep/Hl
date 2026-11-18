/**
 * Astronomía de posición para iluminación:
 * - Sol: algoritmo de la NOAA (basado en Meeus), precisión ~0.01° en posición y ~1 min en salida/puesta.
 * - Luna: teoría abreviada de Meeus (términos principales), precisión ~0.2° — suficiente para visualización.
 * Todas las fechas son instantes absolutos (Date en UTC).
 */

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J1970 = 2440587.5;
const J2000 = 2451545;

export function toJulian(date: Date): number {
  return date.getTime() / DAY_MS + J1970;
}

export function fromJulian(jd: number): Date {
  return new Date((jd - J1970) * DAY_MS);
}

function norm360(x: number): number {
  return ((x % 360) + 360) % 360;
}

export interface SunState {
  /** Declinación (°) */
  declination: number;
  /** Ascensión recta (°) */
  rightAscension: number;
  /** Longitud eclíptica aparente (°) */
  eclipticLongitude: number;
  /** Ecuación del tiempo (minutos) */
  equationOfTime: number;
  /** Distancia Tierra–Sol (UA) */
  distanceAU: number;
}

export function sunState(date: Date): SunState {
  const T = (toJulian(date) - J2000) / 36525;
  const L0 = norm360(280.46646 + T * (36000.76983 + T * 0.0003032));
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * RAD;
  const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
  const trueLong = L0 + C;
  const trueAnomaly = M + C;
  const distanceAU = (1.000001018 * (1 - e * e)) / (1 + e * Math.cos(trueAnomaly * RAD));
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) / RAD;
  const ra = norm360(Math.atan2(Math.cos(eps * RAD) * Math.sin(lambda * RAD), Math.cos(lambda * RAD)) / RAD);
  const y = Math.tan((eps * RAD) / 2) ** 2;
  const L0r = L0 * RAD;
  const eot =
    4 *
    (y * Math.sin(2 * L0r) -
      2 * e * Math.sin(Mr) +
      4 * e * y * Math.sin(Mr) * Math.cos(2 * L0r) -
      0.5 * y * y * Math.sin(4 * L0r) -
      1.25 * e * e * Math.sin(2 * Mr)) /
    RAD;
  return { declination: decl, rightAscension: ra, eclipticLongitude: norm360(lambda), equationOfTime: eot, distanceAU };
}

export interface HorizontalPosition {
  /** Acimut desde el norte, sentido horario (°) */
  azimuth: number;
  /** Altura sobre el horizonte (°), con refracción atmosférica estándar */
  altitude: number;
}

/** Corrección de refracción atmosférica (Sæmundsson / NOAA), en grados. */
function refraction(altDeg: number): number {
  if (altDeg > 85) return 0;
  const te = Math.tan(altDeg * RAD);
  let r: number;
  if (altDeg > 5) r = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (altDeg > -0.575) r = 1735 + altDeg * (-518.2 + altDeg * (103.4 + altDeg * (-12.79 + altDeg * 0.711)));
  else r = -20.772 / te;
  return r / 3600;
}

export function sunPosition(date: Date, lat: number, lon: number): HorizontalPosition & SunState {
  const s = sunState(date);
  const minutesUTC = (date.getTime() % DAY_MS) / 60000;
  const trueSolarTime = norm360((minutesUTC + s.equationOfTime + 4 * lon) / 4) * 4; // minutos en [0,1440)
  let ha = trueSolarTime / 4 - 180;
  if (ha < -180) ha += 360;
  const latR = lat * RAD;
  const decR = s.declination * RAD;
  const cosZ = Math.sin(latR) * Math.sin(decR) + Math.cos(latR) * Math.cos(decR) * Math.cos(ha * RAD);
  const zenith = Math.acos(Math.max(-1, Math.min(1, cosZ))) / RAD;
  const alt = 90 - zenith;
  const az = norm360(Math.atan2(Math.sin(ha * RAD), Math.cos(ha * RAD) * Math.sin(latR) - Math.tan(decR) * Math.cos(latR)) / RAD + 180);
  return { ...s, azimuth: az, altitude: alt + refraction(alt) };
}

export interface SunTimes {
  solarNoon: Date;
  sunrise: Date | null;
  sunset: Date | null;
  civilDawn: Date | null;
  civilDusk: Date | null;
  nauticalDawn: Date | null;
  nauticalDusk: Date | null;
  astronomicalDawn: Date | null;
  astronomicalDusk: Date | null;
  /** Duración del día (sol sobre el horizonte), en horas */
  dayLengthHours: number;
  /** "normal" | "polar-day" (sol de medianoche) | "polar-night" */
  regime: "normal" | "polar-day" | "polar-night";
}

function hourAngleFor(altitude: number, lat: number, decl: number): number | "always" | "never" {
  const cosH = (Math.sin(altitude * RAD) - Math.sin(lat * RAD) * Math.sin(decl * RAD)) / (Math.cos(lat * RAD) * Math.cos(decl * RAD));
  if (cosH < -1) return "always"; // siempre por encima
  if (cosH > 1) return "never"; // siempre por debajo
  return Math.acos(cosH) / RAD;
}

/**
 * Horarios solares para el día civil local que contiene `date`
 * (se usa la hora solar media de la longitud para elegir el día).
 */
export function sunTimes(date: Date, lat: number, lon: number): SunTimes {
  const localMs = date.getTime() + (lon / 15) * 3600000;
  const d = new Date(localMs);
  const dayStartUTC = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

  const noonFor = (t: number) => {
    const s = sunState(new Date(t));
    return dayStartUTC + (720 - 4 * lon - s.equationOfTime) * 60000;
  };
  let noon = noonFor(dayStartUTC + 12 * 3600000 - (lon / 15) * 3600000);
  noon = noonFor(noon);

  const event = (altitude: number, rising: boolean): Date | null | "always" | "never" => {
    let t = noon;
    for (let i = 0; i < 3; i++) {
      const s = sunState(new Date(t));
      const H = hourAngleFor(altitude, lat, s.declination);
      if (typeof H === "string") return H;
      const solarNoon = dayStartUTC + (720 - 4 * lon - s.equationOfTime) * 60000;
      t = solarNoon + (rising ? -1 : 1) * 4 * H * 60000;
    }
    return new Date(t);
  };

  const sr = event(-0.833, true);
  const ss = event(-0.833, false);
  const pick = (v: Date | null | "always" | "never") => (v instanceof Date ? v : null);
  let regime: SunTimes["regime"] = "normal";
  let dayLengthHours: number;
  if (sr === "always") {
    regime = "polar-day";
    dayLengthHours = 24;
  } else if (sr === "never") {
    regime = "polar-night";
    dayLengthHours = 0;
  } else {
    dayLengthHours = ((ss as Date).getTime() - (sr as Date).getTime()) / 3600000;
  }
  return {
    solarNoon: new Date(noon),
    sunrise: pick(sr),
    sunset: pick(ss),
    civilDawn: pick(event(-6, true)),
    civilDusk: pick(event(-6, false)),
    nauticalDawn: pick(event(-12, true)),
    nauticalDusk: pick(event(-12, false)),
    astronomicalDawn: pick(event(-18, true)),
    astronomicalDusk: pick(event(-18, false)),
    dayLengthHours,
    regime,
  };
}

/** Punto subsolar (donde el Sol está en el cenit) — útil para el terminador. */
export function subsolarPoint(date: Date): { lat: number; lon: number } {
  const s = sunState(date);
  const minutesUTC = (date.getTime() % DAY_MS) / 60000;
  let lon = -(minutesUTC + s.equationOfTime - 720) / 4;
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { lat: s.declination, lon };
}

// ---------------------------------------------------------------------------
// Luna
// ---------------------------------------------------------------------------

export interface MoonState {
  rightAscension: number; // °
  declination: number; // °
  distanceKm: number;
  eclipticLongitude: number;
  eclipticLatitude: number;
}

export function moonState(date: Date): MoonState {
  const d = toJulian(date) - J2000;
  const L = norm360(218.316 + 13.176396 * d);
  const M = norm360(134.963 + 13.064993 * d) * RAD; // anomalía media lunar
  const Ms = norm360(357.529 + 0.98560028 * d) * RAD; // anomalía media solar
  const F = norm360(93.272 + 13.22935 * d) * RAD; // argumento de latitud
  const D = norm360(297.85 + 12.190749 * d) * RAD; // elongación media
  const lon =
    L +
    6.289 * Math.sin(M) +
    1.274 * Math.sin(2 * D - M) +
    0.658 * Math.sin(2 * D) +
    0.214 * Math.sin(2 * M) -
    0.186 * Math.sin(Ms) -
    0.114 * Math.sin(2 * F) +
    0.059 * Math.sin(2 * D - 2 * M) +
    0.057 * Math.sin(2 * D - Ms - M) +
    0.053 * Math.sin(2 * D + M) +
    0.046 * Math.sin(2 * D - Ms) -
    0.041 * Math.sin(M - Ms) -
    0.035 * Math.sin(D) -
    0.031 * Math.sin(M + Ms);
  const lat =
    5.128 * Math.sin(F) +
    0.281 * Math.sin(M + F) +
    0.278 * Math.sin(M - F) +
    0.173 * Math.sin(2 * D - F) +
    0.055 * Math.sin(2 * D - M + F) +
    0.046 * Math.sin(2 * D - M - F);
  const dist = 385001 - 20905 * Math.cos(M) - 3699 * Math.cos(2 * D - M) - 2956 * Math.cos(2 * D) - 570 * Math.cos(2 * M);
  const T = d / 36525;
  const eps = (23.439291 - 0.0130042 * T) * RAD;
  const l = lon * RAD;
  const b = lat * RAD;
  const ra = Math.atan2(Math.sin(l) * Math.cos(eps) - Math.tan(b) * Math.sin(eps), Math.cos(l));
  const dec = Math.asin(Math.sin(b) * Math.cos(eps) + Math.cos(b) * Math.sin(eps) * Math.sin(l));
  return { rightAscension: norm360(ra / RAD), declination: dec / RAD, distanceKm: dist, eclipticLongitude: norm360(lon), eclipticLatitude: lat };
}

/** Tiempo sidéreo medio de Greenwich (°). */
export function gmst(date: Date): number {
  const d = toJulian(date) - J2000;
  const T = d / 36525;
  return norm360(280.46061837 + 360.98564736629 * d + 0.000387933 * T * T);
}

export function equatorialToHorizontal(raDeg: number, decDeg: number, date: Date, lat: number, lon: number): HorizontalPosition {
  const H = (gmst(date) + lon - raDeg) * RAD;
  const φ = lat * RAD;
  const δ = decDeg * RAD;
  const alt = Math.asin(Math.sin(φ) * Math.sin(δ) + Math.cos(φ) * Math.cos(δ) * Math.cos(H)) / RAD;
  const az = norm360(Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(φ) - Math.tan(δ) * Math.cos(φ)) / RAD + 180);
  return { azimuth: az, altitude: alt + refraction(alt) };
}

export function moonPosition(date: Date, lat: number, lon: number): HorizontalPosition & MoonState {
  const m = moonState(date);
  // Paralaje horizontal: corrige la altura topocéntrica (~1°).
  const h = equatorialToHorizontal(m.rightAscension, m.declination, date, lat, lon);
  const parallax = Math.asin(6378.14 / m.distanceKm) / RAD;
  return { ...m, azimuth: h.azimuth, altitude: h.altitude - parallax * Math.cos(h.altitude * RAD) };
}

export type MoonPhaseName =
  | "new"
  | "waxing-crescent"
  | "first-quarter"
  | "waxing-gibbous"
  | "full"
  | "waning-gibbous"
  | "last-quarter"
  | "waning-crescent";

export interface MoonIllumination {
  /** Fracción iluminada [0,1] */
  fraction: number;
  /** Fase [0,1): 0 nueva, 0.25 cuarto creciente, 0.5 llena, 0.75 cuarto menguante */
  phase: number;
  name: MoonPhaseName;
  /** Edad aproximada en días desde la luna nueva */
  ageDays: number;
}

const SYNODIC_MONTH = 29.530588853;

export function moonIllumination(date: Date): MoonIllumination {
  const s = sunState(date);
  const m = moonState(date);
  const sunDistKm = s.distanceAU * 149597870.7;
  const αs = s.rightAscension * RAD;
  const δs = s.declination * RAD;
  const αm = m.rightAscension * RAD;
  const δm = m.declination * RAD;
  const phi = Math.acos(Math.sin(δs) * Math.sin(δm) + Math.cos(δs) * Math.cos(δm) * Math.cos(αs - αm));
  const inc = Math.atan2(sunDistKm * Math.sin(phi), m.distanceKm - sunDistKm * Math.cos(phi));
  // Creciente/menguante según la elongación en longitud eclíptica.
  const elong = norm360(m.eclipticLongitude - s.eclipticLongitude);
  const fraction = (1 + Math.cos(inc)) / 2;
  const phase = elong / 360;
  return { fraction, phase, name: phaseName(phase), ageDays: phase * SYNODIC_MONTH };
}

function phaseName(phase: number): MoonPhaseName {
  const p = phase * 8;
  if (p < 0.5 || p >= 7.5) return "new";
  if (p < 1.5) return "waxing-crescent";
  if (p < 2.5) return "first-quarter";
  if (p < 3.5) return "waxing-gibbous";
  if (p < 4.5) return "full";
  if (p < 5.5) return "waning-gibbous";
  if (p < 6.5) return "last-quarter";
  return "waning-crescent";
}

// ---------------------------------------------------------------------------
// Estaciones: equinoccios y solsticios resolviendo la longitud solar aparente.
// ---------------------------------------------------------------------------

export interface Seasons {
  marchEquinox: Date;
  juneSolstice: Date;
  septemberEquinox: Date;
  decemberSolstice: Date;
}

function solveSunLongitude(target: number, guess: Date): Date {
  let t = guess.getTime();
  for (let i = 0; i < 20; i++) {
    const lon = sunState(new Date(t)).eclipticLongitude;
    let diff = target - lon;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    // El Sol avanza ~0.9856°/día
    const step = (diff / 0.98564736) * DAY_MS;
    t += step;
    if (Math.abs(step) < 1000) break;
  }
  return new Date(t);
}

export function seasons(year: number): Seasons {
  return {
    marchEquinox: solveSunLongitude(0, new Date(Date.UTC(year, 2, 20))),
    juneSolstice: solveSunLongitude(90, new Date(Date.UTC(year, 5, 21))),
    septemberEquinox: solveSunLongitude(180, new Date(Date.UTC(year, 8, 22))),
    decemberSolstice: solveSunLongitude(270, new Date(Date.UTC(year, 11, 21))),
  };
}

/** Estación astronómica en un hemisferio para una fecha. */
export function astronomicalSeason(date: Date, lat: number): "spring" | "summer" | "autumn" | "winter" {
  const lon = sunState(date).eclipticLongitude;
  const north = lon < 90 ? "spring" : lon < 180 ? "summer" : lon < 270 ? "autumn" : "winter";
  if (lat >= 0) return north;
  const flip = { spring: "autumn", summer: "winter", autumn: "spring", winter: "summer" } as const;
  return flip[north];
}

/** Duración del día (horas) para cada día del año en una latitud (curva anual). */
export function dayLengthCurve(year: number, lat: number, lon = 0): { day: number; hours: number }[] {
  const out: { day: number; hours: number }[] = [];
  const start = Date.UTC(year, 0, 1, 12);
  const days = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS;
  for (let i = 0; i < days; i += 1) {
    out.push({ day: i, hours: sunTimes(new Date(start + i * DAY_MS), lat, lon).dayLengthHours });
  }
  return out;
}
