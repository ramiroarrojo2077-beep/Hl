"use client";

import { Grid } from "@react-three/drei";
import { Canvas, type RootState, type ThreeEvent } from "@react-three/fiber";
import { Suspense, useCallback, useRef } from "react";
import { ACESFilmicToneMapping, PCFShadowMap, Raycaster, SRGBColorSpace, Vector2, type Object3D } from "three";
import { ROOT_ID } from "@/engine/scene/doc";
import type { WorldDoc } from "@/engine/types";
import { useEditor } from "@/store/editor";
import { useQuality } from "@/store/settings";
import { BuildingsView } from "./BuildingsView";
import { CameraRig } from "./CameraRig";
import { ExploreMode } from "./ExploreMode";
import { InstancedView } from "./InstancedView";
import { LightPool, MiscView } from "./MiscView";
import { NpcsView } from "./NpcsView";
import { PostFX } from "./PostFX";
import { SceneEnvironment } from "./SceneEnvironment";
import { SelectionOutline, TransformGizmo } from "./Selection";
import { SimulationDriver } from "./SimulationDriver";
import { StatsProbe } from "./StatsProbe";
import { StreetsView } from "./StreetsView";
import { BrushCursor, RoadDraftPreview, useTerrainTools } from "./TerrainTools";
import { TerrainView } from "./TerrainView";
import { VehiclesView } from "./VehiclesView";
import { WaterView } from "./WaterView";
import { WeatherView } from "./WeatherView";
import { TimelinePlayer } from "./TimelinePlayer";

export const canvasState: { current: RootState | null } = { current: null };

/** Si la entidad está dentro de un grupo de usuario, se selecciona el grupo más externo. */
function pickTarget(doc: WorldDoc, id: string, alt: boolean): string {
  if (alt) return id;
  let target = id;
  let cur = doc.entities[id]?.parentId ?? null;
  while (cur && cur !== ROOT_ID) {
    const p = doc.entities[cur];
    if (!p) break;
    if (p.type === "group") target = p.id;
    cur = p.parentId;
  }
  return target;
}

function Scene() {
  const mode = useEditor((s) => s.mode);
  const showGrid = useEditor((s) => s.ui.showGrid);
  const { handlers, active } = useTerrainTools();
  const editing = mode === "edit";

  const onPick = useCallback((id: string, e: ThreeEvent<MouseEvent>) => {
    const s = useEditor.getState();
    if (s.mode !== "edit" || s.tool === "terrain" || !s.doc) return;
    if (e.delta > 6) return; // fue un arrastre de cámara
    const target = pickTarget(s.doc, id, e.altKey);
    s.select([target], e.shiftKey || e.ctrlKey || e.metaKey ? "toggle" : "replace");
  }, []);

  const terrainHandlers = {
    ...handlers,
    onClick: (e: ThreeEvent<MouseEvent>) => {
      const s = useEditor.getState();
      if (s.tool !== "terrain" && s.mode === "edit" && e.delta <= 6 && !(e.shiftKey || e.ctrlKey)) {
        // Clic en el terreno: selecciona el terreno solo con doble intención (Alt), si no limpia.
        if (e.altKey) s.select(["terrain"]);
        else s.select([]);
      }
    },
  };

  return (
    <>
      <SceneEnvironment />
      <SimulationDriver />
      <TimelinePlayer />
      <TerrainView handlers={terrainHandlers} interactive={active} />
      <WaterView />
      <StreetsView onPick={onPick} />
      <BuildingsView onPick={onPick} />
      <InstancedView onPick={onPick} />
      <VehiclesView onPick={onPick} />
      <NpcsView onPick={onPick} />
      <MiscView onPick={onPick} showHelpers={editing} />
      <LightPool />
      <WeatherView />
      {editing && (
        <>
          <SelectionOutline />
          <TransformGizmo />
          <BrushCursor />
          <RoadDraftPreview />
          {showGrid && <Grid infiniteGrid cellSize={1} sectionSize={10} fadeDistance={250} cellColor="#2a3346" sectionColor="#6D7CFF" position={[0, 0.02, 0]} />}
          <CameraRig />
        </>
      )}
      {mode === "explore" && <ExploreMode />}
      <PostFX />
      <StatsProbe />
    </>
  );
}

export default function Viewport({ onDropAsset }: { onDropAsset?: (payload: string, point: [number, number, number]) => void }) {
  const quality = useQuality();
  const hasDoc = useEditor((s) => !!s.doc);
  const container = useRef<HTMLDivElement>(null);

  const raycastTerrain = (clientX: number, clientY: number): [number, number, number] | null => {
    const st = canvasState.current;
    const el = container.current;
    if (!st || !el) return null;
    const rect = el.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new Raycaster();
    ray.setFromCamera(ndc, st.camera);
    const terrain: Object3D | undefined = st.scene.getObjectByName("Terrain");
    if (!terrain) return null;
    const hit = ray.intersectObject(terrain, true)[0];
    return hit ? [hit.point.x, hit.point.y, hit.point.z] : null;
  };

  return (
    <div
      ref={container}
      className="relative h-full w-full"
      data-testid="viewport"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("application/x-worldforge")) e.preventDefault();
      }}
      onDrop={(e) => {
        const payload = e.dataTransfer.getData("application/x-worldforge");
        if (!payload) return;
        e.preventDefault();
        const p = raycastTerrain(e.clientX, e.clientY);
        if (p) onDropAsset?.(payload, p);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {hasDoc && (
        <Canvas
          shadows={quality.shadows ? { type: PCFShadowMap } : false}
          dpr={quality.dpr}
          gl={{ antialias: quality.antialias, powerPreference: "high-performance", preserveDrawingBuffer: false, alpha: false }}
          camera={{ fov: 55, near: 0.5, far: 5000, position: [120, 90, 140] }}
          onCreated={(state) => {
            canvasState.current = state;
            state.gl.toneMapping = ACESFilmicToneMapping;
            state.gl.outputColorSpace = SRGBColorSpace;
          }}
          onPointerMissed={(e) => {
            const s = useEditor.getState();
            if (s.mode === "edit" && s.tool !== "terrain" && e.type === "click" && !(e.shiftKey || e.ctrlKey)) s.select([]);
          }}
        >
          <Suspense fallback={null}>
            <Scene />
          </Suspense>
        </Canvas>
      )}
    </div>
  );
}

export { raycastScreen };

/** Raycast desde coordenadas de pantalla contra el terreno (usado por el soltar de la biblioteca). */
function raycastScreen(clientX: number, clientY: number, el: HTMLElement): [number, number, number] | null {
  const st = canvasState.current;
  if (!st) return null;
  const rect = el.getBoundingClientRect();
  const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new Raycaster();
  ray.setFromCamera(ndc, st.camera);
  const terrain = st.scene.getObjectByName("Terrain");
  const hit = terrain ? ray.intersectObject(terrain, true)[0] : undefined;
  return hit ? [hit.point.x, hit.point.y, hit.point.z] : null;
}
