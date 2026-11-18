import { useEffect, useRef, useState } from "preact/hooks";
import { Search, X, Camera, Share2, Maximize, Sparkles, HelpCircle, Sun, Moon, MapPin, Loader2, Navigation } from "lucide-preact";
import { useEngine } from "../context.ts";
import { assistantOpen, cameraState, notify, resolvedTheme, updateSettings, settings, infoOpen } from "../../state/store.ts";
import { suggest, searchBest, type Place } from "../../services/geocoder.ts";
import { downloadBlob } from "../../engine/userdata.ts";
import { t } from "../../i18n/index.ts";
import { addRecent, recentPlaces } from "../places.ts";

export function TopBar({ onHelp }: { onHelp: () => void }) {
  const engine = useEngine();

  const screenshot = async () => {
    try {
      const blob = await engine.screenshot();
      downloadBlob(blob, `earth-next-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
      notify(t("Captura guardada (incluye atribuciones de datos)."), "success");
    } catch (err) {
      notify(String(err), "error");
    }
  };

  const share = async () => {
    const url = engine.shareUrl();
    const c = cameraState.value;
    const text = `EARTH NEXT — ${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "EARTH NEXT", text, url });
        return;
      } catch {
        /* cancelado: se copia */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      notify(t("Enlace a esta vista copiado al portapapeles."), "success");
    } catch {
      prompt(t("Copiá el enlace:"), url);
    }
  };

  const fullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.();
  };

  return (
    <header class="topbar">
      <div class="brand glass" title="EARTH NEXT">
        <img class="brand-logo" src="/favicon.svg" alt="" />
        <div>
          <span>EARTH NEXT</span>
          <small>{t("Plataforma geoespacial 3D")}</small>
        </div>
      </div>
      <SearchBar />
      <div class="top-actions glass" role="toolbar" aria-label={t("Acciones")}>
        <button class={`icon-btn ${assistantOpen.value ? "active" : ""}`} onClick={() => ((assistantOpen.value = !assistantOpen.value), (infoOpen.value = false))} title={t("Asistente de IA (I)")} aria-label={t("Asistente de IA")}>
          <Sparkles size={19} />
        </button>
        <button class="icon-btn hide-mobile" onClick={screenshot} title={t("Captura de pantalla")} aria-label={t("Captura de pantalla")}>
          <Camera size={19} />
        </button>
        <button class="icon-btn" onClick={share} title={t("Compartir esta vista")} aria-label={t("Compartir esta vista")}>
          <Share2 size={19} />
        </button>
        <button class="icon-btn hide-mobile" onClick={() => updateSettings({ theme: resolvedTheme.value === "dark" ? "light" : "dark" })} title={t("Tema claro/oscuro")} aria-label={t("Tema claro/oscuro")}>
          {resolvedTheme.value === "dark" ? <Sun size={19} /> : <Moon size={19} />}
        </button>
        <button class="icon-btn hide-mobile" onClick={fullscreen} title={t("Pantalla completa")} aria-label={t("Pantalla completa")}>
          <Maximize size={19} />
        </button>
        <button class="icon-btn hide-mobile" onClick={onHelp} title={t("Ayuda y atajos (?)")} aria-label={t("Ayuda")}>
          <HelpCircle size={19} />
        </button>
      </div>
    </header>
  );
}

function SearchBar() {
  const engine = useEngine();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const ctrl = useRef<AbortController | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const skipNext = useRef(false);
  const [resultsFor, setResultsFor] = useState("");

  useEffect(() => {
    const query = q.trim();
    if (skipNext.current) {
      // El texto cambió porque se eligió un resultado: no se vuelve a buscar.
      skipNext.current = false;
      return;
    }
    if (query.length < 2) {
      setResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      ctrl.current?.abort();
      const c = new AbortController();
      ctrl.current = c;
      setLoading(true);
      try {
        const near = cameraState.value.heightAboveGround < 2_000_000 ? { lon: cameraState.value.lon, lat: cameraState.value.lat } : undefined;
        const r = await suggest(query, { lang: settings.value.lang, near, signal: c.signal });
        if (!c.signal.aborted) {
          setResults(r);
          setResultsFor(query);
          setSel(0);
          setOpen(true);
        }
      } catch {
        /* errores de red: se intenta en Enter con Nominatim */
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, []);

  const go = async (p: Place) => {
    ctrl.current?.abort();
    setOpen(false);
    skipNext.current = true;
    setQ(p.name);
    setResults([]);
    (document.activeElement as HTMLElement | null)?.blur();
    addRecent(p);
    await engine.flyToPlace(p, { cinematic: false });
  };

  const submit = async () => {
    // Sólo se usan sugerencias que corresponden al texto actual.
    if (results[sel] && resultsFor === q.trim()) return go(results[sel]!);
    if (!q.trim()) return;
    setLoading(true);
    try {
      const r = await searchBest(q, { lang: settings.value.lang });
      if (r[0]) await go(r[0]);
      else notify(t("No se encontraron lugares para \"{q}\".", { q }), "info");
    } catch (err) {
      notify(t("La búsqueda no está disponible: {e}", { e: err instanceof Error ? err.message : String(err) }), "error");
    } finally {
      setLoading(false);
    }
  };

  const list = q.trim().length >= 2 ? results : recentPlaces.value.slice(0, 6);

  return (
    <div class="search" ref={box}>
      <div class="search-box glass">
        {loading ? <Loader2 size={18} class="muted spin" /> : <Search size={18} class="muted" />}
        <label for="search-input" class="sr-only">
          {t("Buscar lugares o coordenadas")}
        </label>
        <input
          id="search-input"
          value={q}
          placeholder={t("Buscar lugares, direcciones o coordenadas…")}
          autocomplete="off"
          spellcheck={false}
          role="combobox"
          aria-expanded={open}
          aria-controls="search-results"
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSel((s) => Math.min(list.length - 1, s + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setSel((s) => Math.max(0, s - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (list[sel] && q.trim().length < 2) void go(list[sel]!);
              else void submit();
            } else if (e.key === "Escape") setOpen(false);
          }}
        />
        {q && (
          <button class="icon-btn" onClick={() => (setQ(""), setResults([]))} aria-label={t("Limpiar")}>
            <X size={17} />
          </button>
        )}
      </div>
      {open && list.length > 0 && (
        <div class="search-results glass" id="search-results" role="listbox">
          {q.trim().length < 2 && <div class="section-title" style={{ padding: "4px 10px" }}>{t("Recientes")}</div>}
          {list.map((p, i) => (
            <button key={p.id} class="search-item" role="option" aria-selected={i === sel} onMouseEnter={() => setSel(i)} onClick={() => go(p)}>
              {p.source === "coordinates" ? <Navigation size={18} class="muted" /> : <MapPin size={18} class="muted" />}
              <div class="grow">
                <div class="t">{p.name}</div>
                <div class="s">{p.label || `${p.category} · ${p.kind}`}</div>
              </div>
              <span class="faint">{p.kind}</span>
            </button>
          ))}
          <div class="faint" style={{ padding: "6px 10px" }}>
            {t("Datos: Photon / Nominatim — © colaboradores de OpenStreetMap")}
          </div>
        </div>
      )}
    </div>
  );
}
