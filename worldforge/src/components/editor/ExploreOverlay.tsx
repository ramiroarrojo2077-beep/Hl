"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/store/editor";
import { exploreInput } from "../viewport/ExploreMode";
import { Button, IconButton } from "../ui/controls";
import { Icon } from "../ui/Icon";

/** Controles del modo exploración: joystick y botones táctiles, ayuda y salida. */
export function ExploreOverlay() {
  const view = useEditor((s) => s.exploreView);
  const [touch, setTouch] = useState(false);
  const [help, setHelp] = useState(true);

  useEffect(() => {
    setTouch(window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window);
    const t = setTimeout(() => setHelp(false), 7000);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.pointerLockElement) useEditor.setState({ mode: "edit" });
      if (e.code === "KeyV") useEditor.setState({ exploreView: useEditor.getState().exploreView === "third" ? "first" : "third" });
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      Object.assign(exploreInput, { moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, jump: false, run: false });
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-20" data-testid="explore-overlay">
      <div className="pointer-events-auto absolute top-3 left-3 flex gap-2">
        <Button variant="secondary" icon="arrowLeft" onClick={() => useEditor.setState({ mode: "edit" })} testId="exit-explore" className="glass">
          Volver al editor
        </Button>
        <IconButton icon={view === "third" ? "user" : "eye"} label={view === "third" ? "Primera persona (V)" : "Tercera persona (V)"} onClick={() => useEditor.setState({ exploreView: view === "third" ? "first" : "third" })} className="glass" size="lg" />
      </div>
      {help && !touch && (
        <div className="glass animate-fade-up absolute top-3 left-1/2 -translate-x-1/2 rounded-xl border border-line px-4 py-2 text-xs text-muted">
          Clic para mirar con el mouse · <b className="text-text">WASD</b> moverse · <b className="text-text">Shift</b> correr · <b className="text-text">Espacio</b> saltar · <b className="text-text">V</b> cámara · <b className="text-text">Esc</b> salir
        </div>
      )}
      {touch && <TouchControls />}
    </div>
  );
}

function TouchControls() {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const stickId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const last = useRef({ x: 0, y: 0 });

  const onStick = (e: React.PointerEvent) => {
    const el = base.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    const max = r.width / 2;
    const len = Math.min(max, Math.hypot(dx, dy));
    const a = Math.atan2(dy, dx);
    const x = Math.cos(a) * len, y = Math.sin(a) * len;
    setKnob({ x, y });
    exploreInput.moveX = x / max;
    exploreInput.moveY = -y / max;
    exploreInput.run = len / max > 0.92;
  };

  return (
    <>
      {/* Zona de mirar: mitad derecha de la pantalla */}
      <div
        className="pointer-events-auto absolute top-16 right-0 bottom-0 w-1/2 touch-none"
        onPointerDown={(e) => {
          lookId.current = e.pointerId;
          last.current = { x: e.clientX, y: e.clientY };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (lookId.current !== e.pointerId) return;
          exploreInput.lookDX += (e.clientX - last.current.x) * 1.4;
          exploreInput.lookDY += (e.clientY - last.current.y) * 1.4;
          last.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={() => (lookId.current = null)}
      />
      <div
        ref={base}
        className="pointer-events-auto absolute bottom-8 left-8 h-32 w-32 touch-none rounded-full border border-white/20 bg-white/5"
        data-testid="joystick"
        onPointerDown={(e) => {
          stickId.current = e.pointerId;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          onStick(e);
        }}
        onPointerMove={(e) => stickId.current === e.pointerId && onStick(e)}
        onPointerUp={() => {
          stickId.current = null;
          setKnob({ x: 0, y: 0 });
          exploreInput.moveX = 0;
          exploreInput.moveY = 0;
          exploreInput.run = false;
        }}
      >
        <div className="absolute top-1/2 left-1/2 h-14 w-14 rounded-full bg-white/25 backdrop-blur" style={{ transform: `translate(calc(-50% + ${knob.x}px), calc(-50% + ${knob.y}px))` }} />
      </div>
      <button
        className="pointer-events-auto absolute right-8 bottom-10 flex h-20 w-20 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white backdrop-blur active:bg-white/25"
        aria-label="Saltar"
        data-testid="jump"
        onPointerDown={() => (exploreInput.jump = true)}
      >
        <Icon name="run" size={30} />
      </button>
    </>
  );
}
