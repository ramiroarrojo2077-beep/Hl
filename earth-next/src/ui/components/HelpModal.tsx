import { X } from "lucide-preact";
import { t } from "../../i18n/index.ts";

export function HelpModal({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["/ · Ctrl+K", "Buscar lugares o coordenadas"],
    ["I", "Abrir/cerrar el asistente de IA"],
    ["?", "Esta ayuda"],
    ["Esc", "Cerrar panel / cancelar herramienta"],
    ["W A S D", "Mover (aéreo, dron, peatón) · girar el globo (orbital)"],
    ["Q / E", "Bajar / subir"],
    ["← → ↑ ↓", "Girar la vista o el planeta"],
    ["Shift", "Moverse más rápido"],
    ["Clic", "Información del lugar o edificio"],
    ["Doble clic / Enter", "Terminar medición o dibujo"],
    ["Retroceso", "Deshacer el último punto"],
  ];
  return (
    <div class="modal-backdrop" onClick={onClose}>
      <div class="modal glass" role="dialog" aria-modal="true" aria-label={t("Ayuda")} onClick={(e) => e.stopPropagation()}>
        <div class="row between">
          <h2 style={{ margin: 0 }}>{t("Ayuda y atajos")}</h2>
          <button class="icon-btn" onClick={onClose} aria-label={t("Cerrar")}>
            <X size={18} />
          </button>
        </div>
        <table style={{ width: "100%", marginTop: "12px", borderCollapse: "collapse" }}>
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <td style={{ padding: "6px 0", width: "40%" }}>
                  <kbd>{k}</kbd>
                </td>
                <td class="muted">{t(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h3>{t("Sobre los datos")}</h3>
        <p class="muted" style={{ lineHeight: 1.5 }}>
          {t(
            "EARTH NEXT usa sólo fuentes abiertas o autorizadas: OpenStreetMap, NASA GIBS, AWS Terrain Tiles, Esri, Open-Meteo, NOAA, GDACS, Panoramax, Wikipedia y Wikidata. Cada panel indica la fuente y si el dato es observado, un modelo, un pronóstico o un efecto visual simulado. Las alturas de edificios sin dato en OSM se muestran semitransparentes y rotuladas como aproximadas.",
          )}
        </p>
        <p class="faint">
          {t("Táctil: un dedo arrastra, dos dedos pellizcan para acercar y giran/inclinan la vista.")}
        </p>
      </div>
    </div>
  );
}
