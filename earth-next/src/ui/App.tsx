import { useEffect, useRef, useState } from "preact/hooks";
import { effect } from "@preact/signals";
import { initEngine, type Engine } from "../engine/engine.ts";
import { activePanel, assistantOpen, infoOpen, settings, resolvedTheme, navMode, notify, isMobile, selection } from "../state/store.ts";
import { t } from "../i18n/index.ts";
import { EngineContext } from "./context.ts";
import { TopBar } from "./components/TopBar.tsx";
import { Rail } from "./components/Rail.tsx";
import { StatusBar } from "./components/StatusBar.tsx";
import { NavControls } from "./components/NavControls.tsx";
import { Timeline } from "./components/Timeline.tsx";
import { InfoPanel } from "./components/InfoPanel.tsx";
import { Toasts } from "./components/Toasts.tsx";
import { SplitHandle } from "./components/SplitHandle.tsx";
import { Minimap } from "./components/Minimap.tsx";
import { HelpModal } from "./components/HelpModal.tsx";
import { PanelHost } from "./panels/PanelHost.tsx";
import { AssistantPanel } from "./panels/AssistantPanel.tsx";
import { StreetViewer, streetImage } from "./panels/StreetViewer.tsx";
import { tourState } from "../engine/tours.ts";

export function App() {
  const globeRef = useRef<HTMLDivElement>(null);
  const creditsRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  // Tema, contraste y tamaño de texto
  useEffect(
    () =>
      effect(() => {
        const root = document.documentElement;
        root.dataset["theme"] = resolvedTheme.value;
        root.dataset["contrast"] = settings.value.highContrast ? "high" : "normal";
        root.dataset["largeText"] = String(settings.value.largeText);
        root.lang = settings.value.lang;
      }),
    [],
  );

  useEffect(() => {
    if (!globeRef.current || !creditsRef.current) return;
    try {
      const e = initEngine(globeRef.current, creditsRef.current);
      setEngine(e);
      (window as unknown as { earthNext: Engine }).earthNext = e; // depuración y pruebas E2E
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  // Atajos globales
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tEl = e.target as HTMLElement | null;
      if (tEl && (tEl.tagName === "INPUT" || tEl.tagName === "TEXTAREA" || tEl.isContentEditable)) return;
      if (e.key === "/" || (e.key === "k" && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        document.querySelector<HTMLInputElement>("#search-input")?.focus();
      } else if (e.key === "?") setHelpOpen((v) => !v);
      else if (e.key === "Escape") {
        if (streetImage.value) streetImage.value = null;
        else if (infoOpen.value) infoOpen.value = false;
        else activePanel.value = null;
      } else if (e.key === "i" && !e.ctrlKey) assistantOpen.value = !assistantOpen.value;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (error) notify(error, "error", 15000);
  }, [error]);

  const rightOpen = assistantOpen.value || (infoOpen.value && !!selection.value);

  return (
    <EngineContext.Provider value={engine}>
      <div ref={globeRef} class="globe" aria-label={t("Globo terrestre 3D")} role="application" />
      {!engine && !error && <Splash />}
      {error && (
        <div class="modal-backdrop">
          <div class="modal glass">
            <h2>{t("No se pudo iniciar el globo 3D")}</h2>
            <p class="muted">{error}</p>
            <p class="muted">{t("EARTH NEXT necesita un navegador con WebGL 2 habilitado (Chrome, Edge, Firefox o Safari recientes).")}</p>
          </div>
        </div>
      )}
      {engine && (
        <>
          <TopBar onHelp={() => setHelpOpen(true)} />
          {navMode.value !== "cinematic" || !tourState.value.playing ? <Rail /> : null}
          <PanelHost />
          {assistantOpen.value ? (
            <div class="drawer-right glass assistant-wrap">
              <AssistantPanel />
            </div>
          ) : (
            infoOpen.value && selection.value && <InfoPanel />
          )}
          {!(isMobile.value && (activePanel.value || rightOpen)) && <Timeline />}
          <NavControls />
          {settings.value.minimap && !isMobile.value && <Minimap />}
          <SplitHandle />
          <StreetViewer />
          {navMode.value === "pedestrian" && !streetImage.value && <div class="approx-badge glass">{t("Vista 3D aproximada a nivel del suelo — no es una fotografía")}</div>}
          {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
        </>
      )}
      <StatusBar creditsRef={creditsRef} />
      <Toasts />
    </EngineContext.Provider>
  );
}

function Splash() {
  return (
    <div class="splash">
      <div class="col" style={{ alignItems: "center", gap: "14px" }}>
        <img class="logo" src="/favicon.svg" alt="" />
        <div style={{ letterSpacing: "0.3em", fontWeight: 800 }}>EARTH NEXT</div>
        <div class="faint">{t("Iniciando motor geoespacial…")}</div>
      </div>
    </div>
  );
}
