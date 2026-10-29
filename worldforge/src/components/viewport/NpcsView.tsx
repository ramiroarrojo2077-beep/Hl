"use client";

import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { memo, useEffect, useMemo, useRef } from "react";
import { AnimationAction, AnimationMixer, Group, LoopOnce, LoopRepeat, Vector3 } from "three";
import { createHumanoid, GAIT_SPEED, humanoidClips, type HumanoidClip } from "@/engine/models/humanoid";
import { isEffectivelyVisible } from "@/engine/scene/doc";
import type { NpcState } from "@/engine/sim/world";
import type { EntityOf, WorldDoc } from "@/engine/types";
import { useEditor, useEditorWith } from "@/store/editor";
import { useQuality } from "@/store/settings";
import { liveMatrix, objectRegistry, runtime } from "./registry";

type Npc = EntityOf<"npc">;

function select(doc: WorldDoc | null): Npc[] {
  if (!doc) return EMPTY;
  const out: Npc[] = [];
  for (const e of Object.values(doc.entities)) if (e.type === "npc" && e.parentId) out.push(e);
  return out;
}
const EMPTY: Npc[] = [];
const sameList = <T,>(a: T[], b: T[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function NpcsView({ onPick }: { onPick: (id: string, e: ThreeEvent<MouseEvent>) => void }) {
  const npcs = useEditorWith((s) => select(s.doc), sameList);
  const folderVisible = useEditor((s) => s.doc?.entities.f_characters?.visible ?? true);
  return (
    <group name="Characters" visible={folderVisible}>
      {npcs.map((n) => (
        <NpcView key={n.id} npc={n} onPick={onPick} />
      ))}
    </group>
  );
}

const STATE_CLIP: Record<NpcState, HumanoidClip> = {
  walk: "walk",
  run: "run",
  idle: "idle",
  wait: "idle",
  sit: "sit",
  interact: "interact",
  wave: "wave",
  cheer: "cheer",
};

const NpcView = memo(function NpcView({ npc, onPick }: { npc: Npc; onPick: (id: string, e: ThreeEvent<MouseEvent>) => void }) {
  const quality = useQuality();
  const { camera } = useThree();
  const appearanceKey = JSON.stringify(npc.props.appearance);
  const instance = useMemo(() => createHumanoid(npc.props.appearance), [appearanceKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const group = useRef<Group>(null);
  const mixer = useMemo(() => new AnimationMixer(instance.mesh), [instance]);
  const actions = useMemo(() => {
    const clips = humanoidClips();
    const out = new Map<HumanoidClip, AnimationAction>();
    for (const [name, clip] of Object.entries(clips)) {
      const a = mixer.clipAction(clip);
      a.setLoop(LoopRepeat, Infinity);
      out.set(name as HumanoidClip, a);
    }
    return out;
  }, [mixer]);
  const current = useRef<HumanoidClip | null>(null);
  const accum = useRef(0);
  const frame = useRef(0);
  const offset = useMemo(() => (npc.id.charCodeAt(npc.id.length - 1) % 7) / 7, [npc.id]);
  const tmp = useMemo(() => new Vector3(), []);

  useEffect(() => {
    instance.mesh.castShadow = quality.shadows;
  }, [instance, quality.shadows]);

  useEffect(() => {
    const g = group.current;
    if (g) objectRegistry.set(npc.id, g);
    return () => {
      objectRegistry.delete(npc.id);
    };
  }, [npc.id]);

  useEffect(
    () => () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(instance.mesh);
      instance.mesh.skeleton.dispose();
    },
    [mixer, instance],
  );

  const play = (clip: HumanoidClip) => {
    if (current.current === clip) return;
    const next = actions.get(clip)!;
    const prev = current.current ? actions.get(current.current) : null;
    next.reset();
    next.time = offset * next.getClip().duration;
    next.setLoop(clip === "wave" ? LoopRepeat : LoopRepeat, Infinity);
    next.fadeIn(0.25).play();
    prev?.fadeOut(0.25);
    current.current = clip;
  };

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const doc = useEditor.getState().doc;
    if (!doc) return;
    const agent = runtime.simActive ? runtime.sim?.npcs.get(npc.id) : undefined;
    if (agent) {
      g.position.set(agent.x, agent.y, agent.z);
      g.rotation.set(0, agent.yaw, 0);
      const clip = agent.state === "walk" && agent.speed > 2.6 ? "run" : STATE_CLIP[agent.state];
      play(clip);
      const gait = clip === "walk" ? GAIT_SPEED.walk : clip === "run" ? GAIT_SPEED.run : 0;
      const a = actions.get(clip)!;
      a.timeScale = gait ? agent.speed / gait : 1;
      const playing = useEditor.getState().simPlaying || useEditor.getState().mode === "explore";
      if (!playing) return;
    } else {
      const m = liveMatrix(doc, npc.id);
      m.decompose(g.position, g.quaternion, g.scale);
      play("idle");
    }
    g.visible = isEffectivelyVisible(doc, npc.id);
    // Animación a menor frecuencia lejos de la cámara (y nada si está muy lejos).
    frame.current++;
    accum.current += delta;
    const d = g.getWorldPosition(tmp).distanceTo(camera.position);
    const far = quality.animationDistance;
    const every = d < far ? 1 : d < far * 2.5 ? 4 : 0;
    if (every && frame.current % every === 0) {
      mixer.update(accum.current);
      accum.current = 0;
    }
  });

  return (
    <group
      ref={group}
      name={npc.name}
      onClick={(e) => {
        e.stopPropagation();
        onPick(npc.id, e);
      }}
    >
      <primitive object={instance.group} />
    </group>
  );
});

export { LoopOnce };
