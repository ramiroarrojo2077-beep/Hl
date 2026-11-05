// Consultas en lenguaje natural para Data Lab: el modelo solo traduce la pregunta a una consulta
// estructurada (con las columnas reales y una muestra); la cuenta la hace datos.ts con el archivo.

import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { client, MODELO, BETA_FALLBACK } from "./cliente.ts";
import { llamar } from "./cupo.ts";
import { registrarUso } from "./gasto.ts";
import { Consulta, consultar, perfil, type Tabla } from "./datos.ts";

const Respuesta = z.object({ consulta: Consulta, explicacion: z.string().describe("Una oración: qué se calcula y por qué responde la pregunta") });

function esquema(s: z.ZodType): Record<string, unknown> {
  const { $schema: _, ...resto } = z.toJSONSchema(s, { reused: "inline" });
  return resto;
}

export async function preguntar(t: Tabla, pregunta: string, signal: AbortSignal) {
  const columnas = perfil(t).map((c) => `- ${c.nombre} (${c.tipo}${c.min != null ? `, de ${c.min} a ${c.max}` : ""}${c.frecuentes?.length ? `, ej.: ${c.frecuentes.slice(0, 3).map((f) => f.valor).join(", ")}` : ""})`).join("\n");
  const mensaje = await llamar("datos", "usuario", signal, () =>
    client.beta.messages.create(
      {
        model: MODELO,
        max_tokens: 2000,
        betas: [BETA_FALLBACK],
        fallbacks: "default",
        output_config: { effort: "low", format: { type: "json_schema" as const, schema: esquema(Respuesta) } },
        system: "Traducís preguntas sobre una tabla a una consulta estructurada. Usá solo columnas que existen, con su nombre exacto. Si la pregunta es por fechas, agrupá por la columna de fecha con el período adecuado. Los valores de los filtros van como aparecen en los datos. Respondé en el idioma del usuario.",
        messages: [{ role: "user", content: `Columnas de la tabla (${t.filas.length} filas):\n${columnas}\n\nPregunta: ${pregunta}` }],
      },
      { signal },
    ),
  );
  registrarUso("datos", mensaje);
  const texto = mensaje.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("").trim();
  let r: z.infer<typeof Respuesta>;
  try {
    r = Respuesta.parse(JSON.parse(texto));
  } catch {
    throw new Error("No pude traducir la pregunta a una consulta. Probá con otras palabras o armala a mano.");
  }
  return { consulta: r.consulta, explicacion: r.explicacion, resultado: consultar(t, r.consulta) };
}
