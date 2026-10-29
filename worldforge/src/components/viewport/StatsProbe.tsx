"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { useEditor } from "@/store/editor";
import { useRuntime } from "@/store/runtime";

/**
 * Mide FPS, llamadas de dibujo y triángulos y los publica dos veces por segundo.
 * Prioridad negativa: corre antes del render y lee las cifras del cuadro anterior.
 */
export function StatsProbe() {
  const { gl } = useThree();
  const acc = useRef({ frames: 0, time: 0, calls: 0, tris: 0, worst: 0 });
  useEffect(() => {
    gl.info.autoReset = false;
    const webgpu = typeof navigator !== "undefined" && "gpu" in navigator;
    useRuntime.getState().setStats({ renderer: "WebGL2", webgpu });
    return () => {
      gl.info.autoReset = true;
    };
  }, [gl]);
  useFrame((_, dt) => {
    const a = acc.current;
    a.frames++;
    a.time += dt;
    a.calls += gl.info.render.calls;
    a.tris += gl.info.render.triangles;
    a.worst = Math.max(a.worst, dt);
    gl.info.reset();
    if (a.time >= 0.5) {
      const doc = useEditor.getState().doc;
      useRuntime.getState().setStats({
        fps: Math.round(a.frames / a.time),
        frameMs: Math.round((a.time / a.frames) * 1000 * 10) / 10,
        drawCalls: Math.round(a.calls / a.frames),
        triangles: Math.round(a.tris / a.frames),
        entities: doc ? Object.keys(doc.entities).length : 0,
        geometries: gl.info.memory.geometries,
        textures: gl.info.memory.textures,
      });
      acc.current = { frames: 0, time: 0, calls: 0, tris: 0, worst: 0 };
    }
  }, -1);
  return null;
}
