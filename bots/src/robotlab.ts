// Robot Lab (motor): guiones para el robot presentador y el robot profesor. El robot 3D, sus movimientos,
// la iluminación y el rendimiento viven en la app; acá se arma el contenido (con el modelo configurado) y se
// guarda la configuración visual de cada compañero.

import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";

export const GESTOS = ["abrir", "explicar", "ambas", "asentir", "senalar", "pecho", "encoger", "pulgar", "saludo", "festejo", "estirarse"] as const;
const Guion = z.object({
  titulo: z.string(),
  partes: z.array(z.object({ texto: z.string().describe("Lo que el robot dice en voz alta: 1 a 3 oraciones"), puntos: z.array(z.string()).describe("1 a 3 frases cortas para el holograma"), gesto: z.enum(GESTOS).describe("Gesto que acompaña") })),
  preguntas: z.array(z.object({ pregunta: z.string(), opciones: z.array(z.string()), correcta: z.number().describe("Índice de la opción correcta, desde 0"), explicacion: z.string() })).describe("Solo en modo enseñar: 2 a 4 preguntas de repaso; si no, vacío"),
});
export type Guion = z.infer<typeof Guion>;
function esquema(s: z.ZodType): Record<string, unknown> { const { $schema: _, ...r } = z.toJSONSchema(s, { reused: "inline" }); return r; }
export const ia = {
  async json(sistema: string, usuario: string, signal: AbortSignal): Promise<unknown> {
    const { client, MODELO, BETA_FALLBACK } = await import("./cliente.ts");
    const { llamar } = await import("./cupo.ts");
    const { registrarUso } = await import("./gasto.ts");
    const m = await llamar("robot", "usuario", signal, () => client.beta.messages.create({ model: MODELO, max_tokens: 6000, betas: [BETA_FALLBACK], fallbacks: "default", output_config: { effort: "low", format: { type: "json_schema" as const, schema: esquema(Guion) } }, system: sistema, messages: [{ role: "user", content: usuario }] }, { signal }));
    registrarUso("robot", m);
    const t = m.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("").trim();
    return JSON.parse(t.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  },
};
/** Guion para presentar un tema o un texto, o para enseñarlo con preguntas de repaso al final. */
export async function guion(d: { tema: string; modo: "presentar" | "ensenar"; partes?: number; publico?: string }, signal: AbortSignal): Promise<Guion> {
  const n = Math.max(2, Math.min(12, d.partes ?? 5));
  let r: Guion;
  try {
    r = Guion.parse(await ia.json(
      `Escribís el guion de un robot 3D que ${d.modo === "ensenar" ? "enseña como un profesor paciente: explica de lo simple a lo complejo, con ejemplos, y al final hace preguntas de repaso" : "presenta un tema o proyecto de forma clara y amena"}. ${n} partes; cada una con lo que dice (oral, natural, 1 a 3 oraciones), hasta 3 puntos cortos para su holograma y un gesto adecuado (saludo al empezar, festejo o pulgar al cerrar, explicar o señalar en el medio). ${d.publico ? `Público: ${d.publico}.` : ""} Si te pasan un texto, se basa solo en él. Español rioplatense neutro.`,
      d.tema, signal));
  } catch (err) {
    if (err instanceof SyntaxError || err instanceof z.ZodError) throw new Error("La respuesta del modelo no tuvo el formato esperado. Probá de nuevo.");
    throw err;
  }
  return {
    titulo: r.titulo.slice(0, 120),
    partes: r.partes.slice(0, 12).map((p) => ({ texto: p.texto.slice(0, 600), puntos: p.puntos.slice(0, 3).map((x) => x.slice(0, 60)), gesto: p.gesto })),
    preguntas: d.modo === "ensenar" ? r.preguntas.filter((q) => q.opciones.length >= 2 && q.correcta >= 0 && q.correcta < q.opciones.length).slice(0, 6) : [],
  };
}
