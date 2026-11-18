import { useRef } from "preact/hooks";
import { useEngine } from "../context.ts";
import { compareLayer, splitEnabled, splitPosition } from "../../engine/imagery.ts";
import { settings } from "../../state/store.ts";
import { t } from "../../i18n/index.ts";

/** Divisor arrastrable para comparar dos capas (p. ej. imágenes de distintas épocas). */
export function SplitHandle() {
  const engine = useEngine();
  const dragging = useRef(false);
  if (!splitEnabled.value || !compareLayer.value) return null;
  const x = splitPosition.value * 100;
  const def = engine.imagery.definition(compareLayer.value.id);
  const base = engine.imagery.baseDefinition();
  const name = (d: typeof def | null) => (d ? (settings.value.lang === "es" ? d.name : d.nameEn) : "");
  const onMove = (e: PointerEvent) => {
    if (!dragging.current) return;
    engine.imagery.setSplitPosition(e.clientX / window.innerWidth);
  };
  return (
    <>
      <div class="split-label glass" style={{ left: `calc(${x}% - 12px)`, transform: "translateX(-100%)" }}>
        ◀ {name(def)} {compareLayer.value.date ?? ""}
      </div>
      <div class="split-label glass" style={{ left: `calc(${x}% + 12px)` }}>
        {name(base)} {engine.imagery.baseDate() ?? ""} ▶
      </div>
      <div
        class="split-handle"
        style={{ left: `${x}%` }}
        role="slider"
        aria-label={t("Divisor de comparación")}
        aria-valuenow={Math.round(x)}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={onMove}
        onPointerUp={() => (dragging.current = false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") engine.imagery.setSplitPosition(splitPosition.value - 0.02);
          if (e.key === "ArrowRight") engine.imagery.setSplitPosition(splitPosition.value + 0.02);
        }}
      >
        <div class="knob">⇆</div>
      </div>
    </>
  );
}
