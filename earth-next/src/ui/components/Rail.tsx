import { Layers, Ruler, Star, CloudSun, History, SunMoon, Clapperboard, PersonStanding, Settings, Compass } from "lucide-preact";
import { activePanel, type PanelId } from "../../state/store.ts";
import { t } from "../../i18n/index.ts";

const ITEMS: { id: PanelId; icon: typeof Layers; label: string }[] = [
  { id: "layers", icon: Layers, label: "Capas" },
  { id: "explore", icon: Compass, label: "Explorar" },
  { id: "tools", icon: Ruler, label: "Herramientas" },
  { id: "places", icon: Star, label: "Lugares" },
  { id: "street", icon: PersonStanding, label: "Calle" },
  { id: "weather", icon: CloudSun, label: "Clima" },
  { id: "history", icon: History, label: "Historia" },
  { id: "lighting", icon: SunMoon, label: "Luz" },
  { id: "tours", icon: Clapperboard, label: "Recorridos" },
  { id: "settings", icon: Settings, label: "Ajustes" },
];

export function Rail() {
  return (
    <nav class="rail glass" aria-label={t("Paneles")}>
      {ITEMS.map(({ id, icon: Icon, label }) => (
        <div key={id} class="col" style={{ alignItems: "center", gap: 0 }}>
          <button
            class={`icon-btn ${activePanel.value === id ? "active" : ""}`}
            onClick={() => (activePanel.value = activePanel.value === id ? null : id)}
            title={t(label)}
            aria-label={t(label)}
            aria-pressed={activePanel.value === id}
          >
            <Icon size={21} />
          </button>
          <div class="rail-label">{t(label)}</div>
        </div>
      ))}
    </nav>
  );
}
