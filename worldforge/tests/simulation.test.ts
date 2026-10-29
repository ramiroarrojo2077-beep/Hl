import { describe, expect, it } from "vitest";
import { planWorld } from "@/engine/generation/planner";
import { generateWorld } from "@/engine/generation/pipeline";
import { SimWorld, lightState } from "@/engine/sim/world";

describe("simulación", () => {
  it("mueve vehículos por sus rutas y respeta semáforos", async () => {
    const prompt = "Construí una ciudad moderna con edificios, parques, autos, semáforos y peatones";
    const { doc } = await generateWorld(planWorld(prompt).plan, { prompt });
    const sim = new SimWorld();
    sim.sync(doc);
    const moving = [...sim.vehicles.values()].filter((v) => !v.parked);
    expect(moving.length).toBeGreaterThan(5);
    const start = moving.map((v) => [v.x, v.z]);
    for (let i = 0; i < 600; i++) sim.step(1 / 30, { traffic: true, npcs: true });
    const movedCount = moving.filter((v, i) => Math.hypot(v.x - start[i]![0]!, v.z - start[i]![1]!) > 5).length;
    expect(movedCount).toBeGreaterThan(moving.length / 2);
    // Nadie sale volando ni queda NaN.
    for (const v of sim.vehicles.values()) expect(Number.isFinite(v.x + v.y + v.z)).toBe(true);
    for (const n of sim.npcs.values()) expect(Number.isFinite(n.x + n.y + n.z)).toBe(true);
    const walkers = [...sim.npcs.values()].filter((n) => Math.hypot(n.x - n.homeX, n.z - n.homeZ) > 2);
    expect(walkers.length).toBeGreaterThan(5);
  });

  it("alterna los semáforos por eje", () => {
    const inter = { id: "x", position: [0, 0] as [number, number], radius: 5, hasLights: true, phaseOffset: 0 };
    expect(lightState(inter, "x", 1)).toBe("green");
    expect(lightState(inter, "z", 1)).toBe("red");
    expect(lightState(inter, "z", 15)).toBe("green");
    expect(lightState(inter, "x", 15)).toBe("red");
  });
});
