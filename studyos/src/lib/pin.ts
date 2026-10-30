// Bloqueo opcional de la app con PIN. Se guarda solo un hash PBKDF2-SHA256
// (150.000 iteraciones, sal aleatoria), nunca el PIN.

function toHex(buf: ArrayBuffer) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPin(pin: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ? new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16))) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 150_000 }, key, 256);
  return { hash: toHex(bits), salt: toHex(salt.buffer) };
}

export async function verifyPin(pin: string, hash: string, salt: string) {
  const r = await hashPin(pin, salt);
  return r.hash === hash;
}
