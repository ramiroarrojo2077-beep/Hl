// Copia a public/vendor los archivos que la app necesita servir localmente para
// funcionar sin conexión dentro del APK: worker y núcleo de Tesseract (OCR), los
// datos de idioma español e inglés y los recursos auxiliares de pdf.js.
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const out = join(root, 'public', 'vendor', 'tesseract');
mkdirSync(join(out, 'core'), { recursive: true });
mkdirSync(join(out, 'lang'), { recursive: true });

cpSync(join(nm, 'tesseract.js', 'dist', 'worker.min.js'), join(out, 'worker.min.js'));
for (const f of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
  cpSync(join(nm, 'tesseract.js-core', f), join(out, 'core', f));
}
for (const lang of ['spa', 'eng']) {
  const src = join(nm, '@tesseract.js-data', lang, '4.0.0_best_int', `${lang}.traineddata.gz`);
  if (!existsSync(src)) throw new Error(`Falta ${src}`);
  cpSync(src, join(out, 'lang', `${lang}.traineddata.gz`));
}
// pdf.js: mapas de caracteres, fuentes estándar, decodificadores wasm y perfiles ICC
const pdfOut = join(root, 'public', 'vendor', 'pdfjs');
for (const d of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  cpSync(join(nm, 'pdfjs-dist', d), join(pdfOut, d), { recursive: true });
}
console.log('vendor: tesseract y pdf.js copiados a public/vendor');
