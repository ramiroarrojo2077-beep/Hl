// Empaqueta el motor de Gravity en un solo archivo JavaScript (sin TypeScript ni node_modules),
// listo para correr dentro de la app de Android. Salida: dist/gravity/servidor.mjs + dist/public/.
import { build } from "esbuild";
import { cpSync, rmSync } from "node:fs";

const destino = process.argv[2] ?? "dist";
rmSync(destino, { recursive: true, force: true });
await build({
  entryPoints: ["bots/src/servidor.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: `${destino}/gravity/servidor.mjs`,
  // Algunas dependencias son CommonJS y usan require.
  banner: { js: "import { createRequire as __gravityRequire } from 'node:module'; const require = __gravityRequire(import.meta.url);" },
  legalComments: "none",
  logLevel: "warning",
});
cpSync("bots/public", `${destino}/public`, { recursive: true });
console.log(`Motor empaquetado en ${destino}/`);
