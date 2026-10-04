// Muestra cuadro a cuadro qué vio y qué decidió el seguimiento en una sesión.
//   node arquero/sim/traza.mjs escenario semilla [tiro]
import { ESCENARIOS, sesion } from "./banco.mjs";

const [nombre = "fijo-sol", semilla = "102", tiro] = process.argv.slice(2);
const dir = process.env.FOTOS;
const taus = (process.env.TAUS ?? "-0.5,0.05,0.15").split(",").map(Number);
const r = await sesion({
  nombre,
  cfg: ESCENARIOS[nombre],
  semilla: Number(semilla),
  tiros: tiro === undefined ? 3 : Number(tiro) + 1,
  detalle: true,
  traza: !process.env.SIN_FILAS,
  fotos: dir ? { dir, taus } : null,
});
if (r.omitida) console.log("omitida", r.motivo ?? "");
for (const [i, x] of (r.resultados ?? []).entries()) {
  if (tiro !== undefined && x.n !== Number(tiro)) continue;
  console.log(x.texto);
  for (const f of x.filas ?? []) console.log("   ", JSON.stringify(f));
}
