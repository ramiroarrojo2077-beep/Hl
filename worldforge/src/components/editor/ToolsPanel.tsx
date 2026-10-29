"use client";

import { newId } from "@/engine/ids";
import { FOLDERS } from "@/engine/scene/doc";
import { spawn } from "@/engine/scene/factory";
import { TERRAIN_PAINT, type RoadKind, type WorldDoc } from "@/engine/types";
import { useEditor, type TerrainToolMode } from "@/store/editor";
import { Button, Row, Section, Select, Slider, Toggle, cx } from "../ui/controls";
import { Icon, type IconName } from "../ui/Icon";
import { useState } from "react";

const BRUSHES: { id: TerrainToolMode; label: string; icon: IconName }[] = [
  { id: "raise", label: "Elevar", icon: "mountain" },
  { id: "lower", label: "Bajar", icon: "download" },
  { id: "smooth", label: "Suavizar", icon: "water" },
  { id: "flatten", label: "Aplanar", icon: "grid" },
  { id: "water", label: "Agua", icon: "water" },
  { id: "paint", label: "Pintar", icon: "brush" },
  { id: "addTrees", label: "Plantar", icon: "tree" },
  { id: "removeVegetation", label: "Desmalezar", icon: "trash" },
  { id: "road", label: "Camino", icon: "route" },
];

const PAINT_LABELS = ["Automático", "Pasto", "Arena", "Roca", "Nieve", "Tierra", "Pavimento"];

/** Herramientas de terreno, caminos y ajustes de precisión. */
export function ToolsPanel() {
  const tool = useEditor((s) => s.tool);
  const brush = useEditor((s) => s.brush);
  const snap = useEditor((s) => s.snap);
  const draft = useEditor((s) => s.roadDraft);
  const [roadKind, setRoadKind] = useState<RoadKind>("dirt");
  const setBrush = (patch: Partial<typeof brush>) => useEditor.setState({ brush: { ...brush, ...patch } });
  const setSnap = (patch: Partial<typeof snap>) => useEditor.setState({ snap: { ...snap, ...patch } });

  const finishRoad = () => {
    const s = useEditor.getState();
    if (s.roadDraft.length < 2) return;
    const pts = s.roadDraft;
    let id = "";
    s.exec(`Trazar camino (${pts.length} puntos)`, (d) => {
      const e = spawn(d as WorldDoc, {
        id: newId("r"),
        type: "road",
        props: { kind: roadKind, points: pts, closed: false, width: roadKind === "path" ? 3 : roadKind === "dirt" ? 5 : roadKind === "highway" ? 14 : 9, markings: roadKind !== "dirt" && roadKind !== "path" },
        parentId: FOLDERS.streets.id,
      });
      id = e.id;
    });
    useEditor.setState({ roadDraft: [] });
    if (id) s.select([id]);
  };

  return (
    <div className="pb-6" data-testid="tools-panel">
      <Section title="Terreno">
        <Toggle checked={tool === "terrain"} label="Herramientas de terreno activas" onChange={(v) => useEditor.getState().setTool(v ? "terrain" : "move")} testId="terrain-tool-toggle" />
        <div className="grid grid-cols-3 gap-1.5">
          {BRUSHES.map((b) => (
            <button
              key={b.id}
              data-testid={`brush-${b.id}`}
              onClick={() => {
                setBrush({ mode: b.id });
                useEditor.getState().setTool("terrain");
              }}
              className={cx(
                "flex flex-col items-center gap-1 rounded-lg py-2 text-[11px]",
                tool === "terrain" && brush.mode === b.id ? "bg-accent/20 text-text ring-1 ring-accent/60" : "bg-surface-2 text-muted hover:text-text",
              )}
            >
              <Icon name={b.icon} size={16} />
              {b.label}
            </button>
          ))}
        </div>
        {brush.mode !== "road" && (
          <>
            <Row label="Radio (m)">
              <Slider value={brush.radius} min={2} max={80} step={1} onCommit={(v) => setBrush({ radius: v })} />
            </Row>
            <Row label="Fuerza">
              <Slider value={brush.strength} min={0.1} max={5} step={0.1} onCommit={(v) => setBrush({ strength: v })} />
            </Row>
          </>
        )}
        {brush.mode === "paint" && (
          <Row label="Material">
            <Select value={String(brush.paint)} options={TERRAIN_PAINT.map((_, i) => ({ value: String(i), label: PAINT_LABELS[i]! }))} onChange={(v) => setBrush({ paint: Number(v) })} />
          </Row>
        )}
        {brush.mode === "road" ? (
          <div className="space-y-2 rounded-lg bg-surface p-2 text-xs text-muted">
            <p>Hacé clic sobre el terreno para agregar puntos. {draft.length} puntos.</p>
            <Row label="Tipo">
              <Select value={roadKind} options={[{ value: "dirt", label: "Tierra" }, { value: "path", label: "Sendero" }, { value: "street", label: "Calle" }, { value: "avenue", label: "Avenida" }, { value: "highway", label: "Autopista" }]} onChange={setRoadKind} />
            </Row>
            <div className="flex gap-2">
              <Button variant="primary" icon="check" disabled={draft.length < 2} onClick={finishRoad}>
                Crear camino
              </Button>
              <Button variant="ghost" onClick={() => useEditor.setState({ roadDraft: [] })} disabled={!draft.length}>
                Borrar puntos
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-muted">Arrastrá con el botón izquierdo sobre el terreno. La cámara gira con el botón derecho mientras el pincel está activo.</p>
        )}
      </Section>
      <Section title="Ajuste y precisión">
        <Toggle checked={snap.grid} label="Ajustar a la cuadrícula" onChange={(v) => setSnap({ grid: v })} testId="snap-grid" />
        <Row label="Paso (m)">
          <Slider value={snap.translate} min={0.25} max={10} step={0.25} onCommit={(v) => setSnap({ translate: v })} />
        </Row>
        <Row label="Ángulo (°)">
          <Slider value={snap.rotateDeg} min={1} max={90} step={1} onCommit={(v) => setSnap({ rotateDeg: v })} />
        </Row>
        <Toggle checked={snap.surface} label="Apoyar sobre el terreno al mover" onChange={(v) => setSnap({ surface: v })} />
      </Section>
    </div>
  );
}
