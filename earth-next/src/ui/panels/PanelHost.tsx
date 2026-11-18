import type { ComponentChildren } from "preact";
import { X } from "lucide-preact";
import { activePanel } from "../../state/store.ts";
import { t } from "../../i18n/index.ts";
import { LayersPanel } from "./LayersPanel.tsx";
import { ToolsPanel } from "./ToolsPanel.tsx";
import { PlacesPanel } from "./PlacesPanel.tsx";
import { WeatherPanel } from "./WeatherPanel.tsx";
import { HistoryPanel } from "./HistoryPanel.tsx";
import { LightingPanel } from "./LightingPanel.tsx";
import { ToursPanel } from "./ToursPanel.tsx";
import { SettingsPanel } from "./SettingsPanel.tsx";
import { StreetPanel } from "./StreetViewer.tsx";
import { ExplorePanel } from "./ExplorePanel.tsx";

export function Panel({ title, children, actions }: { title: string; children: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <section class="panel glass" aria-label={title}>
      <div class="panel-head">
        <h2>{title}</h2>
        {actions}
        <button class="icon-btn" onClick={() => (activePanel.value = null)} aria-label={t("Cerrar")}>
          <X size={18} />
        </button>
      </div>
      <div class="panel-body">{children}</div>
    </section>
  );
}

export function PanelHost() {
  switch (activePanel.value) {
    case "layers":
      return <LayersPanel />;
    case "tools":
      return <ToolsPanel />;
    case "places":
      return <PlacesPanel />;
    case "weather":
      return <WeatherPanel />;
    case "history":
      return <HistoryPanel />;
    case "lighting":
      return <LightingPanel />;
    case "tours":
      return <ToursPanel />;
    case "settings":
      return <SettingsPanel />;
    case "street":
      return <StreetPanel />;
    case "explore":
      return <ExplorePanel />;
    default:
      return null;
  }
}
