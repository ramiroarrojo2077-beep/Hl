"use client";

import { useFrame } from "@react-three/fiber";
import { Matrix4 } from "three";
import { sampleTrack } from "@/engine/scene/animation";
import { parentWorldMatrix, transformToMatrix } from "@/engine/scene/doc";
import type { Transform } from "@/engine/types";
import { useEditor } from "@/store/editor";
import { runtime } from "./registry";

/** Avanza la línea de tiempo y publica las transformaciones animadas para los visores. */
export function TimelinePlayer() {
  useFrame((_, delta) => {
    const s = useEditor.getState();
    const doc = s.doc;
    if (!doc) return;
    const pb = s.playback;
    let time = pb.time;
    if (pb.playing) {
      time += delta * pb.speed;
      if (time > doc.animation.duration) time = 0;
      useEditor.setState({ playback: { ...pb, time } });
    }
    const active = pb.playing || time > 0;
    const hadOverrides = runtime.overrides.size > 0 || runtime.timeOfDay !== null;
    if (!active || !doc.animation.tracks.length) {
      if (hadOverrides) {
        runtime.overrides.clear();
        runtime.lightIntensity.clear();
        runtime.timeOfDay = null;
        runtime.overrideVersion++;
      }
      if (!active) return;
    }
    const byEntity = new Map<string, Partial<Record<"position" | "rotation" | "scale", number[]>>>();
    runtime.lightIntensity.clear();
    runtime.timeOfDay = null;
    for (const track of doc.animation.tracks) {
      const v = sampleTrack(track, time);
      if (!v) continue;
      if (track.property === "timeOfDay") runtime.timeOfDay = v[0]!;
      else if (track.property === "intensity") runtime.lightIntensity.set(track.entityId, v[0]!);
      else {
        if (!byEntity.has(track.entityId)) byEntity.set(track.entityId, {});
        byEntity.get(track.entityId)![track.property] = v;
      }
    }
    runtime.overrides.clear();
    for (const [id, props] of byEntity) {
      const e = doc.entities[id];
      if (!e) continue;
      const t: Transform = {
        position: (props.position as Transform["position"]) ?? e.transform.position,
        rotation: (props.rotation as Transform["rotation"]) ?? e.transform.rotation,
        scale: (props.scale as Transform["scale"]) ?? e.transform.scale,
      };
      const m = parentWorldMatrix(doc, id, new Matrix4()).multiply(transformToMatrix(t));
      runtime.overrides.set(id, m);
    }
    runtime.overrideVersion++;
  }, -2);
  return null;
}
