const ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

/** Identificador corto aleatorio. Usa crypto cuando está disponible. */
export function newId(prefix = "e"): string {
  const bytes = new Uint8Array(10);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

/** Generador determinista de ids para la generación procedural (mismo seed, mismos ids). */
export function createIdFactory(seed: number) {
  let n = 0;
  const base = (seed >>> 0).toString(36);
  return (prefix: string) => `${prefix}_${base}${(n++).toString(36)}`;
}
