/**
 * Parseo y formato de coordenadas geográficas (WGS84).
 * Formatos aceptados: decimal, grados-minutos-segundos, hemisferios (N/S/E/O/W),
 * URI geo:, y UTM ("21H 373317 6170033").
 */

export interface LonLat {
  lon: number;
  lat: number;
}

export interface UtmCoord {
  zone: number;
  band: string;
  hemisphere: "N" | "S";
  easting: number;
  northing: number;
}

const DEG = Math.PI / 180;

export function isValidLonLat(p: LonLat): boolean {
  return Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
}

/** Normaliza una longitud a [-180, 180). */
export function normalizeLon(lon: number): number {
  const r = ((((lon + 180) % 360) + 360) % 360) - 180;
  return r === -180 && lon > 0 ? 180 : r;
}

interface Component {
  value: number;
  hemi: "N" | "S" | "E" | "W" | null;
}

const HEMI_RE = /^[NSEOW]$/i;

function hemiOf(ch: string): Component["hemi"] {
  const c = ch.toUpperCase();
  if (c === "N" || c === "S" || c === "E" || c === "W") return c;
  if (c === "O") return "W"; // Oeste
  return null;
}

/** Convierte una componente textual ("34°36'13.2\"S", "-34.6", "S 34 36 13") a número. */
function parseComponent(raw: string): Component | null {
  let s = raw.trim().replace(/,/g, ".");
  if (!s) return null;
  let hemi: Component["hemi"] = null;
  const first = s[0];
  const last = s[s.length - 1];
  if (first && HEMI_RE.test(first)) {
    hemi = hemiOf(first);
    s = s.slice(1).trim();
  } else if (last && HEMI_RE.test(last)) {
    hemi = hemiOf(last);
    s = s.slice(0, -1).trim();
  }
  // Separadores de grados, minutos y segundos (incluye variantes tipográficas).
  const parts = s
    .replace(/[°º˚d]/gi, " ")
    .replace(/['’′m]/gi, " ")
    .replace(/["”″s]|''/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 3) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  const [d, m = 0, sec = 0] = nums as [number, number?, number?];
  if (parts.length > 1 && (m < 0 || m >= 60 || sec < 0 || sec >= 60)) return null;
  const sign = d < 0 || Object.is(d, -0) ? -1 : 1;
  const value = sign * (Math.abs(d) + m / 60 + sec / 3600);
  return { value, hemi };
}

function applyHemi(c: Component): number {
  if (c.hemi === "S" || c.hemi === "W") return -Math.abs(c.value);
  if (c.hemi === "N" || c.hemi === "E") return Math.abs(c.value);
  return c.value;
}

/**
 * Intenta interpretar un texto como coordenadas. Devuelve null si no lo es.
 * Sin hemisferios explícitos se asume el orden "lat, lon".
 */
export function parseCoordinates(input: string): LonLat | null {
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^geo:/i, "").replace(/;.*$/, "");

  const utm = parseUtm(s);
  if (utm) return utmToLonLat(utm);

  let a: string | undefined;
  let b: string | undefined;

  // Separación explícita por coma, punto y coma o barra cuando hay decimales con punto.
  const byComma = s.split(/\s*[,;/|]\s*/);
  if (byComma.length === 2) {
    [a, b] = byComma;
  } else {
    // Separar por la letra de hemisferio: "34 36 13 S 58 22 54 W"
    const m = s.match(/^(.*?[NSns])\s*(.+?[EWOewo])$/) ?? s.match(/^([NSns].*?)\s+([EWOewo].*)$/);
    if (m) {
      a = m[1];
      b = m[2];
    } else {
      const parts = s.split(/\s+/);
      if (parts.length === 2) [a, b] = parts;
      else if (parts.length === 4 || parts.length === 6) {
        const half = parts.length / 2;
        a = parts.slice(0, half).join(" ");
        b = parts.slice(half).join(" ");
      }
    }
  }
  if (a === undefined || b === undefined) return null;
  // Rechazar texto que no tenga ningún dígito (p. ej. "Nueva York").
  if (!/\d/.test(a) || !/\d/.test(b)) return null;
  if (/[a-df-mp-rt-vx-z]/i.test(a.replace(/[NSEOWnseow°º˚'’′"”″dms]/g, ""))) return null;
  if (/[a-df-mp-rt-vx-z]/i.test(b.replace(/[NSEOWnseow°º˚'’′"”″dms]/g, ""))) return null;

  const ca = parseComponent(a);
  const cb = parseComponent(b);
  if (!ca || !cb) return null;

  let lat: number;
  let lon: number;
  const aIsLon = ca.hemi === "E" || ca.hemi === "W";
  const bIsLat = cb.hemi === "N" || cb.hemi === "S";
  if (aIsLon || bIsLat) {
    lon = applyHemi(ca);
    lat = applyHemi(cb);
  } else {
    lat = applyHemi(ca);
    lon = applyHemi(cb);
  }
  const p = { lat, lon };
  return isValidLonLat(p) ? p : null;
}

export function formatDecimal(p: LonLat, digits = 6): string {
  return `${p.lat.toFixed(digits)}, ${p.lon.toFixed(digits)}`;
}

function dms(value: number, pos: string, neg: string, degDigits: number): string {
  const hemi = value < 0 ? neg : pos;
  const abs = Math.abs(value);
  let d = Math.floor(abs);
  let m = Math.floor((abs - d) * 60);
  let s = Math.round(((abs - d) * 60 - m) * 60 * 100) / 100;
  if (s >= 60) {
    s = 0;
    m += 1;
  }
  if (m >= 60) {
    m = 0;
    d += 1;
  }
  return `${String(d).padStart(degDigits, "0")}°${String(m).padStart(2, "0")}′${s.toFixed(2).padStart(5, "0")}″${hemi}`;
}

export function formatDMS(p: LonLat, west = "O"): string {
  return `${dms(p.lat, "N", "S", 2)} ${dms(p.lon, "E", west, 3)}`;
}

// ---------------------------------------------------------------------------
// UTM (WGS84) — fórmulas de Krüger (serie de 3er orden, error < 1 mm en la zona)
// ---------------------------------------------------------------------------

const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const N_ = F / (2 - F);
const A_RECT = (A / (1 + N_)) * (1 + N_ ** 2 / 4 + N_ ** 4 / 64);
const ALPHA = [N_ / 2 - (2 / 3) * N_ ** 2 + (5 / 16) * N_ ** 3, (13 / 48) * N_ ** 2 - (3 / 5) * N_ ** 3, (61 / 240) * N_ ** 3];
const BETA = [N_ / 2 - (2 / 3) * N_ ** 2 + (37 / 96) * N_ ** 3, (1 / 48) * N_ ** 2 + (1 / 15) * N_ ** 3, (17 / 480) * N_ ** 3];
const DELTA = [2 * N_ - (2 / 3) * N_ ** 2 - 2 * N_ ** 3, (7 / 3) * N_ ** 2 - (8 / 5) * N_ ** 3, (56 / 15) * N_ ** 3];
const BANDS = "CDEFGHJKLMNPQRSTUVWXX";

export function utmZoneFor(p: LonLat): number {
  const { lat, lon } = p;
  // Excepciones de Noruega y Svalbard
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) return 32;
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) return 31;
    if (lon >= 9 && lon < 21) return 33;
    if (lon >= 21 && lon < 33) return 35;
    if (lon >= 33 && lon < 42) return 37;
  }
  return Math.min(60, Math.floor((normalizeLon(lon) + 180) / 6) + 1);
}

export function lonLatToUtm(p: LonLat): UtmCoord | null {
  if (p.lat < -80 || p.lat > 84) return null; // fuera del dominio UTM (usar UPS)
  const zone = utmZoneFor(p);
  const lon0 = ((zone - 1) * 6 - 180 + 3) * DEG;
  const phi = p.lat * DEG;
  const lambda = normalizeLon(p.lon) * DEG - lon0;
  const e = Math.sqrt(F * (2 - F));
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - e * Math.atanh(e * Math.sin(phi)));
  const xiP = Math.atan2(t, Math.cos(lambda));
  const etaP = Math.atanh(Math.sin(lambda) / Math.sqrt(1 + t * t));
  let xi = xiP;
  let eta = etaP;
  for (let j = 1; j <= 3; j++) {
    const a = ALPHA[j - 1]!;
    xi += a * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
    eta += a * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
  }
  const easting = 500000 + K0 * A_RECT * eta;
  let northing = K0 * A_RECT * xi;
  const hemisphere = p.lat < 0 ? "S" : "N";
  if (hemisphere === "S") northing += 10000000;
  const band = BANDS[Math.floor((p.lat + 80) / 8)] ?? "X";
  return { zone, band, hemisphere, easting, northing };
}

export function utmToLonLat(u: UtmCoord): LonLat | null {
  if (u.zone < 1 || u.zone > 60) return null;
  const x = u.easting - 500000;
  const y = u.hemisphere === "S" ? u.northing - 10000000 : u.northing;
  const xi = y / (K0 * A_RECT);
  const eta = x / (K0 * A_RECT);
  let xiP = xi;
  let etaP = eta;
  for (let j = 1; j <= 3; j++) {
    const b = BETA[j - 1]!;
    xiP -= b * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaP -= b * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += DELTA[j - 1]! * Math.sin(2 * j * chi);
  const lon0 = (u.zone - 1) * 6 - 180 + 3;
  const lambda = Math.atan2(Math.sinh(etaP), Math.cos(xiP));
  const p = { lat: phi / DEG, lon: normalizeLon(lon0 + lambda / DEG) };
  return isValidLonLat(p) ? p : null;
}

/** "21H 373317 6170033" o "21 S 373317 6170033" (hemisferio explícito). */
export function parseUtm(s: string): UtmCoord | null {
  const m = s.trim().match(/^(\d{1,2})\s*([C-HJ-NP-Xc-hj-np-x])\s+(\d{5,7}(?:\.\d+)?)\s*m?\s*[EeOo]?\s+(\d{6,8}(?:\.\d+)?)\s*m?\s*[Nn]?$/);
  if (!m) return null;
  const zone = Number(m[1]);
  const letter = m[2]!.toUpperCase();
  const easting = Number(m[3]);
  const northing = Number(m[4]);
  if (zone < 1 || zone > 60 || easting < 100000 || easting > 900000 || northing > 10000000) return null;
  // Si la letra es una banda de latitud: C–M sur, N–X norte.
  const hemisphere = letter < "N" ? "S" : "N";
  return { zone, band: letter, hemisphere, easting, northing };
}

export function formatUtm(u: UtmCoord): string {
  return `${u.zone}${u.band} ${Math.round(u.easting)} E ${Math.round(u.northing)} N`;
}
