"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect } from "react";
import { SimWorld } from "@/engine/sim/world";
import { useEditor } from "@/store/editor";
import { runtime } from "./registry";

/** Mantiene la simulación sincronizada con el documento y la avanza cada cuadro. */
export function SimulationDriver() {
  const doc = useEditor((s) => s.doc);
  const resetToken = useEditor((s) => s.simResetToken);

  useEffect(() => {
    if (!runtime.sim) runtime.sim = new SimWorld();
    return () => {
      runtime.sim = null;
      runtime.simActive = false;
    };
  }, []);

  useEffect(() => {
    runtime.sim?.reset();
  }, [resetToken]);

  useEffect(() => {
    if (doc && runtime.sim) runtime.sim.sync(doc);
  }, [doc, resetToken]);

  useFrame((_, delta) => {
    const s = useEditor.getState();
    const sim = runtime.sim;
    if (!sim || !s.doc) return;
    const playing = s.simPlaying || s.mode === "explore";
    runtime.simActive = true;
    if (!playing) return;
    const dt = Math.min(delta, 0.05);
    sim.step(dt, { traffic: s.doc.simulation.traffic, npcs: s.doc.simulation.npcs });
  });
  return null;
}
