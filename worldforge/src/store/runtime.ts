"use client";

import { create } from "zustand";

/** Estado que cambia seguido (estadísticas, hora simulada): separado del documento. */
interface RuntimeState {
  stats: { fps: number; frameMs: number; drawCalls: number; triangles: number; entities: number; geometries: number; textures: number; renderer: string; webgpu: boolean };
  timeOfDay: number;
  nightFactor: number;
  pointerWorld: [number, number, number] | null;
  setStats(s: Partial<RuntimeState["stats"]>): void;
  setTime(t: number, night: number): void;
  setPointer(p: [number, number, number] | null): void;
}

export const useRuntime = create<RuntimeState>()((set, get) => ({
  stats: { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0, entities: 0, geometries: 0, textures: 0, renderer: "WebGL2", webgpu: false },
  timeOfDay: 12,
  nightFactor: 0,
  pointerWorld: null,
  setStats(s) {
    set({ stats: { ...get().stats, ...s } });
  },
  setTime(t, night) {
    const cur = get();
    if (Math.abs(cur.timeOfDay - t) > 0.01 || Math.abs(cur.nightFactor - night) > 0.01) set({ timeOfDay: t, nightFactor: night });
  },
  setPointer(p) {
    set({ pointerWorld: p });
  },
}));
