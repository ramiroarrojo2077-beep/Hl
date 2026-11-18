/** Formato de magnitudes para la interfaz (sistema métrico o imperial). */

export type UnitSystem = "metric" | "imperial";

const nf = (digits: number, locale?: string) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export function formatDistance(m: number, units: UnitSystem = "metric", locale?: string): string {
  if (!Number.isFinite(m)) return "—";
  if (units === "imperial") {
    const ft = m * 3.28084;
    if (ft < 5280) return `${nf(0, locale).format(ft)} ft`;
    const mi = m / 1609.344;
    return `${nf(mi < 10 ? 2 : mi < 100 ? 1 : 0, locale).format(mi)} mi`;
  }
  if (m < 1000) return `${nf(m < 10 ? 2 : m < 100 ? 1 : 0, locale).format(m)} m`;
  const km = m / 1000;
  return `${nf(km < 10 ? 2 : km < 100 ? 1 : 0, locale).format(km)} km`;
}

export function formatArea(m2: number, units: UnitSystem = "metric", locale?: string): string {
  if (!Number.isFinite(m2)) return "—";
  if (units === "imperial") {
    const ft2 = m2 * 10.7639;
    if (ft2 < 43560) return `${nf(0, locale).format(ft2)} ft²`;
    const acres = m2 / 4046.8564224;
    if (acres < 640) return `${nf(2, locale).format(acres)} acres`;
    return `${nf(2, locale).format(m2 / 2589988.110336)} mi²`;
  }
  if (m2 < 10_000) return `${nf(1, locale).format(m2)} m²`;
  if (m2 < 1_000_000) return `${nf(2, locale).format(m2 / 10_000)} ha`;
  return `${nf(m2 < 1e8 ? 2 : 0, locale).format(m2 / 1_000_000)} km²`;
}

export function formatHeight(m: number, units: UnitSystem = "metric", locale?: string): string {
  if (!Number.isFinite(m)) return "—";
  if (units === "imperial") return `${nf(0, locale).format(m * 3.28084)} ft`;
  return `${nf(Math.abs(m) < 100 ? 1 : 0, locale).format(m)} m`;
}

export function formatAltitude(m: number, units: UnitSystem = "metric", locale?: string): string {
  if (Math.abs(m) >= 10_000) return formatDistance(m, units, locale);
  return formatHeight(m, units, locale);
}

export function formatBearing(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSO", "SO", "OSO", "O", "ONO", "NO", "NNO"];
  const d = ((deg % 360) + 360) % 360;
  return `${d.toFixed(1)}° ${dirs[Math.round(d / 22.5) % 16]}`;
}

export function formatDuration(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m) return `${m} min ${String(r).padStart(2, "0")} s`;
  return `${r} s`;
}

export function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m === 60 ? `${h + 1} h 00 min` : `${h} h ${String(m).padStart(2, "0")} min`;
}
