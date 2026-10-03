import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { Pais } from "./paises.ts";

const MODELO = process.env.PRECIO_MODELO ?? "claude-opus-5-5";
const ESFUERZOS = ["low", "medium", "high", "xhigh", "max"] as const;
type Esfuerzo = (typeof ESFUERZOS)[number];
// "low" prioriza velocidad; subilo a "medium" o "high" si querés más precisión.
const ESFUERZO: Esfuerzo = ESFUERZOS.includes(process.env.PRECIO_ESFUERZO as Esfuerzo)
  ? (process.env.PRECIO_ESFUERZO as Esfuerzo)
  : "low";
const MAX_BUSQUEDAS = 6;
const MAX_VUELTAS = 6;
const HERRAMIENTA = "entregar_resultado";

const client = new Anthropic();

const Rango = z.strictObject({ minimo: z.number(), maximo: z.number() });

export const ResultadoSchema = z.strictObject({
  producto: z.string().describe("Nombre normalizado del producto (y variante asumida)"),
  resumen: z.string().describe("Conclusión en 1 o 2 frases"),
  confianza: z.enum(["alta", "media", "baja"]),
  fabrica: z.strictObject({
    moneda: z.string().describe("Código ISO 4217, normalmente USD"),
    precio_unitario: Rango.describe("Precio de fábrica por unidad comprando por volumen"),
    unidad: z.string().describe('Ej: "por unidad", "por kg", "por par"'),
    moq: z.string().describe('Pedido mínimo típico, ej: "500 unidades". Vacío si no se sabe'),
    origen: z.string().describe('País o región de fabricación típica, ej: "China (Guangdong)"'),
    condicion: z.string().describe('Incoterm del precio, ej: "FOB", "EXW"'),
  }),
  desglose_fabricacion: z
    .array(z.strictObject({ concepto: z.string(), porcentaje: z.number() }))
    .describe("Estimación de en qué se va el costo de fábrica (materiales, mano de obra, etc.). Suma 100"),
  pais: z.strictObject({
    nombre: z.string(),
    moneda: z.string().describe("Código ISO 4217 de la moneda local"),
    tipo_cambio: z.number().describe("Unidades de moneda local por 1 USD"),
    tipo_cambio_detalle: z.string().describe('Qué cotización se usó, ej: "oficial BNA vendedor, 02/10/2026"'),
    costo_importado: z
      .array(z.strictObject({ concepto: z.string(), monto: z.number(), detalle: z.string() }))
      .describe(
        "Paso a paso por unidad en moneda local: precio de fábrica convertido, flete y seguro, aranceles, tasas, IVA y otros impuestos",
      ),
    costo_importado_total: z.number().describe("Suma de costo_importado: costo puesto en el país por unidad"),
    margen_supuesto: z.string().describe('Margen de distribución y comercio usado, ej: "40% a 70%"'),
    precio_justo: Rango.describe("Lo que debería costar al público en el país, en moneda local"),
    precio_mercado: Rango.nullable().describe("Lo que cuesta hoy en tiendas del país, en moneda local. null si no se encontró"),
  }),
  fuentes: z.array(
    z.strictObject({
      titulo: z.string(),
      url: z.string(),
      dato: z.string().describe("Qué dato se sacó de esta fuente"),
      tipo: z.enum(["fabricante", "mayorista", "minorista", "impuestos", "tipo_cambio", "otro"]),
    }),
  ),
  advertencias: z.array(z.string()),
});

export type Resultado = z.infer<typeof ResultadoSchema>;

const { $schema: _, ...esquemaResultado } = z.toJSONSchema(ResultadoSchema, { reused: "inline" });

const SISTEMA = `Sos un analista de abastecimiento y comercio exterior. Dado un producto y un país, estimás rápido dos cosas:

1. El precio de fábrica: lo que cobra el fabricante por unidad comprando por volumen (FOB o EXW). Buscá en Alibaba, Made-in-China, 1688, Global Sources, IndiaMART, sitios de fabricantes y análisis de costos (teardowns, BOM).
2. Lo que debería costar realmente en el país elegido: precio de fábrica + flete y seguro internacional + aranceles de importación + tasas + impuestos (IVA y los que correspondan) + un margen razonable de distribución y comercio. Usá el tipo de cambio actual y las reglas impositivas vigentes para importar ese tipo de producto en ese país.

Además buscá a cuánto se vende hoy en ese país (tiendas y marketplaces locales) para compararlo.

Reglas:
- Priorizá la velocidad: pocas búsquedas concretas (idealmente 3 a 5), sin repetir.
- Si el producto es ambiguo, asumí la variante más común y aclaralo en advertencias.
- Montos como números, sin símbolos ni separadores de miles.
- Si un dato no aparece, estimalo con criterio y bajá la confianza. En fuentes poné solo URLs que aparecieron en tus búsquedas; nunca inventes URLs.
- Terminá siempre llamando una sola vez a la herramienta ${HERRAMIENTA}. No escribas el resultado como texto.`;

export class ErrorBusqueda extends Error {}

export async function buscarPrecio(
  producto: string,
  pais: Pais,
  onProgreso: (mensaje: string) => void,
  signal: AbortSignal,
): Promise<Resultado> {
  const hoy = new Date().toISOString().slice(0, 10);
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: `Producto: ${producto}\nPaís: ${pais.nombre} (moneda ${pais.moneda})\nFecha de hoy: ${hoy}`,
    },
  ];
  const tools: Anthropic.Beta.BetaToolUnion[] = [
    {
      type: "web_search_20260209",
      name: "web_search",
      max_uses: MAX_BUSQUEDAS,
      user_location: { type: "approximate", country: pais.codigo, timezone: pais.zonaHoraria },
    },
    {
      name: HERRAMIENTA,
      description:
        "Entrega el resultado final: precio de fábrica y lo que debería costar en el país. Llamala una sola vez, al final.",
      strict: true,
      eager_input_streaming: true,
      input_schema: esquemaResultado as Anthropic.Beta.BetaTool.InputSchema,
    },
  ];

  let reintentosJson = 0;
  let avisoCalculo = false;
  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    const stream = client.beta.messages.stream(
      {
        model: MODELO,
        max_tokens: 64000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: ESFUERZO },
        system: SISTEMA,
        tools,
        messages,
      },
      { signal },
    );

    stream.on("streamEvent", (evento) => {
      if (
        evento.type === "content_block_start" &&
        evento.content_block.type === "tool_use" &&
        evento.content_block.name === HERRAMIENTA &&
        !avisoCalculo
      ) {
        avisoCalculo = true;
        onProgreso("Calculando el costo real…");
      }
    });
    stream.on("contentBlock", (bloque) => {
      if (bloque.type !== "server_tool_use") return;
      const entrada = bloque.input as { query?: string; url?: string };
      if (bloque.name === "web_search" && entrada.query) onProgreso(`Buscando: ${entrada.query}`);
      if (bloque.name === "web_fetch" && entrada.url) onProgreso(`Leyendo: ${entrada.url}`);
    });

    let mensaje: Anthropic.Beta.BetaMessage;
    try {
      mensaje = await stream.finalMessage();
      reintentosJson = 0;
    } catch (err) {
      // Con eager_input_streaming, un JSON de herramienta ilegible rechaza acá; solo eso se reintenta.
      if (err instanceof Anthropic.APIError || reintentosJson++ >= 2) throw err;
      continue;
    }

    if (mensaje.stop_reason === "refusal") {
      throw new ErrorBusqueda("La consulta fue rechazada. Probá describir el producto de otra forma.");
    }
    // El loop de herramientas del servidor llegó a su límite: se reenvía para que continúe.
    if (mensaje.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: mensaje.content });
      continue;
    }

    const entrega = mensaje.content.find(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === HERRAMIENTA,
    );
    if (mensaje.stop_reason === "max_tokens") {
      throw new ErrorBusqueda("La respuesta quedó cortada. Probá de nuevo.");
    }

    messages.push({ role: "assistant", content: mensaje.content });
    if (entrega) {
      const parseado = ResultadoSchema.safeParse(entrega.input);
      if (parseado.success) return parseado.data;
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: entrega.id,
            is_error: true,
            content: `INVALID_JSON: ${parseado.error.message}`,
          },
        ],
      });
    } else {
      // tool_choice "auto" no garantiza la llamada: se pide explícitamente.
      messages.push({ role: "user", content: `Entregá el resultado llamando a ${HERRAMIENTA}.` });
    }
  }
  throw new ErrorBusqueda("No se pudo completar la búsqueda. Probá de nuevo.");
}
