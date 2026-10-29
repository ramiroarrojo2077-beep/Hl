import { describe, expect, it } from "vitest";
import { produce } from "immer";
import { interpret } from "@/engine/ai/interpreter";
import { planWorld } from "@/engine/generation/planner";
import { generateWorld } from "@/engine/generation/pipeline";
import { executeOperations, OperationListSchema } from "@/engine/scene/operations";
import { execute, emptyHistory, undo, redo } from "@/engine/scene/history";
import { entitiesOfType } from "@/engine/scene/doc";
import type { WorldDoc } from "@/engine/types";

let doc: WorldDoc;
const prompt = "Creá una pequeña ciudad rodeada de montañas, con edificios, calles, árboles, un lago y personas caminando";

async function world() {
  if (!doc) doc = (await generateWorld(planWorld(prompt).plan, { prompt })).doc;
  return doc;
}

describe("intérprete local", () => {
  it("hace más alto el edificio seleccionado", async () => {
    const d = await world();
    const b = entitiesOfType(d, "building")[0]!;
    const r = interpret("Hacé que este edificio sea más alto", { doc: d, selection: [b.id] });
    expect(r.operations).toEqual([{ operation: "modify_building", target: { kind: "selection" }, changes: { floorsBy: 1.5 } }]);
  });

  it("cambia el material a ladrillo", async () => {
    const d = await world();
    const b = entitiesOfType(d, "building")[0]!;
    const r = interpret("Cambiá el material de esta casa por ladrillos", { doc: d, selection: [b.id] });
    expect(r.operations[0]).toMatchObject({ operation: "set_material", target: { kind: "selection" }, preset: "brick" });
  });

  it("agrega veinte árboles alrededor del lago", async () => {
    const d = await world();
    const r = interpret("Agregá veinte árboles alrededor del lago", { doc: d, selection: [] });
    expect(r.operations[0]).toMatchObject({ operation: "add_objects", objectType: "tree", count: 20, placement: { mode: "around", anchor: "water" } });
  });

  it("convierte la ciudad en nocturna", async () => {
    const r = interpret("Convertí esta ciudad en una versión nocturna", { doc: await world(), selection: [] });
    expect(r.operations).toContainEqual({ operation: "set_environment", preset: "night" });
  });

  it("agrega una autopista alrededor de la montaña", async () => {
    const r = interpret("Agregá una autopista alrededor de la montaña", { doc: await world(), selection: [] });
    expect(r.operations[0]).toMatchObject({ operation: "add_road", kind: "highway", mode: "ring_around", anchor: "mountain" });
  });

  it("hace que los personajes caminen por las veredas", async () => {
    const r = interpret("Hacé que todos los personajes caminen por las veredas", { doc: await world(), selection: [] });
    expect(r.operations[0]).toMatchObject({ operation: "set_npc_behavior", target: { kind: "type", type: "npc" }, behavior: "sidewalk" });
  });

  it("pone lluvia y charcos", async () => {
    const r = interpret("Poné lluvia y charcos sobre el asfalto", { doc: await world(), selection: [] });
    expect(r.operations[0]).toMatchObject({ operation: "set_weather", type: "rain", wetness: 1 });
  });

  it("crea una animación cinematográfica que termina en un edificio", async () => {
    const r = interpret("Creá una animación cinematográfica donde la cámara sobrevuele la ciudad y termine enfocando un edificio", { doc: await world(), selection: [] });
    expect(r.operations[0]).toMatchObject({ operation: "create_camera_animation", style: "flyover", target: { kind: "type", type: "building" } });
  });

  it("entiende inglés", async () => {
    const d = await world();
    const b = entitiesOfType(d, "building")[0]!;
    const r = interpret("make this building taller and paint it red", { doc: d, selection: [b.id] });
    expect(r.operations.map((o) => o.operation)).toEqual(["modify_building", "set_material"]);
  });

  it("no inventa operaciones para texto sin sentido", async () => {
    const r = interpret("asdkjh qwe zzz", { doc: await world(), selection: [] });
    expect(r.operations).toEqual([]);
    expect(r.notUnderstood.length).toBe(1);
  });
});

describe("operaciones validadas y reversibles", () => {
  it("rechaza operaciones desconocidas o con código", () => {
    expect(OperationListSchema.safeParse([{ operation: "eval", code: "alert(1)" }]).success).toBe(false);
    expect(OperationListSchema.safeParse([{ operation: "modify_object", target: { kind: "selection" }, changes: { onClick: "x" } }]).success).toBe(false);
    expect(OperationListSchema.safeParse([{ operation: "add_objects", objectType: "tree", count: 99999, placement: { mode: "random" } }]).success).toBe(false);
  });

  it("aplica y deshace una edición por texto", async () => {
    const d = await world();
    const b = entitiesOfType(d, "building")[0]!;
    const before = b.props.floors;
    const ops = interpret("hacé este edificio el doble de alto", { doc: d, selection: [b.id] }).operations;
    let history = emptyHistory();
    const r1 = execute(d, history, "IA", (draft) => {
      executeOperations(draft as WorldDoc, ops, { selection: [b.id], seed: 1 });
    });
    const after = r1.doc.entities[b.id]!;
    expect(after.type === "building" && after.props.floors).toBe(Math.round(before * 2));
    history = r1.history;
    const u = undo(r1.doc, history);
    const restored = u.doc.entities[b.id]!;
    expect(restored.type === "building" && restored.props.floors).toBe(before);
    const rd = redo(u.doc, u.history);
    const again = rd.doc.entities[b.id]!;
    expect(again.type === "building" && again.props.floors).toBe(Math.round(before * 2));
  });

  it("agrega árboles junto al agua sin pisar edificios", async () => {
    const d = await world();
    const ops = interpret("agregá 20 árboles alrededor del lago", { doc: d, selection: [] }).operations;
    let res: ReturnType<typeof executeOperations> | null = null;
    const next = produce(d, (draft) => {
      res = executeOperations(draft as WorldDoc, ops, { selection: [], seed: 7 });
    });
    expect(res!.created.length).toBeGreaterThanOrEqual(15);
    for (const id of res!.created) {
      const e = next.entities[id]!;
      expect(e.type).toBe("tree");
      expect(e.transform.position[1]).toBeGreaterThan(next.terrain.waterLevel);
    }
  });

  it("crea una autopista circular alrededor de la montaña", async () => {
    const d = await world();
    const ops = interpret("Agregá una autopista alrededor de la montaña", { doc: d, selection: [] }).operations;
    let res: ReturnType<typeof executeOperations> | null = null;
    const next = produce(d, (draft) => {
      res = executeOperations(draft as WorldDoc, ops, { selection: [], seed: 3 });
    });
    const road = next.entities[res!.created[0]!]!;
    expect(road.type).toBe("road");
    expect(road.type === "road" && road.props.closed).toBe(true);
  });
});
