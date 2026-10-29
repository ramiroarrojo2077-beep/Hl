import { describe, expect, it } from "vitest";
import { planWorld } from "@/engine/generation/planner";
import { generateWorld } from "@/engine/generation/pipeline";
import { scoreWorld } from "@/engine/generation/validator";
import { WorldDocSchema } from "@/engine/types";

const PROMPTS = [
  "Creá una pequeña ciudad rodeada de montañas, con edificios, calles, árboles y personas caminando",
  "Creá una ciudad japonesa futurista de noche, con edificios altos, calles mojadas, carteles luminosos, vehículos circulando, personas caminando y lluvia realista",
  "Creá una ciudad medieval con castillos, aldeanos, mercados y montañas",
  "Generá un planeta desértico con tormentas de arena, bases científicas y vehículos futuristas",
  "Construí una ciudad moderna con edificios, parques, autos, semáforos y peatones",
  "Creá un bosque fantástico con árboles gigantes, ríos, cascadas y criaturas",
  "Construí un circuito de carreras rodeado de montañas, tribunas y boxes",
  "Una isla tropical con playa, palmeras y cabañas",
];

describe("generación procedural", () => {
  for (const prompt of PROMPTS) {
    it(`genera un mundo válido: ${prompt.slice(0, 50)}…`, async () => {
      const { plan } = planWorld(prompt);
      const t0 = performance.now();
      const result = await generateWorld(plan, { prompt });
      const ms = performance.now() - t0;
      const parsed = WorldDocSchema.safeParse(result.doc);
      if (!parsed.success) console.error(parsed.error.issues.slice(0, 5));
      expect(parsed.success).toBe(true);
      const score = scoreWorld(result.doc, plan.features);
      const counts: Record<string, number> = {};
      for (const e of Object.values(result.doc.entities)) counts[e.type] = (counts[e.type] ?? 0) + 1;
      console.log(`[${plan.archetype}] ${Math.round(ms)}ms puntaje=${score.total}`, counts, score.checks.filter((c) => !c.ok).map((c) => `${c.feature}: ${c.detail}`));
      expect(score.validity).toBeGreaterThan(0.8);
      expect(score.playable).toBe(true);
    });
  }

  it("es determinista con el mismo texto", async () => {
    const prompt = "pueblo con casas y árboles";
    const a = await generateWorld(planWorld(prompt).plan, { prompt });
    const b = await generateWorld(planWorld(prompt).plan, { prompt });
    expect(Object.keys(a.doc.entities)).toEqual(Object.keys(b.doc.entities));
    expect(a.doc.terrain.heights).toEqual(b.doc.terrain.heights);
  });
});
