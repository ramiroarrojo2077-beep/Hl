// PNG mínimo (sin dependencias) para mirar imágenes del simulador.
import { deflateSync } from "node:zlib";

const TABLA = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc(buf) {
  let c = -1;
  for (const b of buf) c = TABLA[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function trozo(tipo, datos) {
  const t = Buffer.from(tipo, "ascii");
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(Buffer.concat([t, datos])));
  return Buffer.concat([largo, t, datos, c]);
}

// rgba con la fila 0 abajo (como la app) → PNG.
export function png(rgba, w, h) {
  const filas = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    filas[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + src, w * 4).copy(filas, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), trozo("IHDR", ihdr), trozo("IDAT", deflateSync(filas)), trozo("IEND", Buffer.alloc(0))]);
}
