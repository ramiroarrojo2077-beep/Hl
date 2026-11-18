import { useEffect, useRef, useState } from "preact/hooks";
import { Send, X, Sparkles, RotateCcw, Mic, Loader2, Volume2 } from "lucide-preact";
import { useEngine } from "../context.ts";
import { assistantOpen, cameraState, selection, settings, sceneTime } from "../../state/store.ts";
import { activeOverlays, activeBase } from "../../engine/imagery.ts";
import { ask, resetConversation } from "../../services/assistant.ts";
import type { Source } from "../../services/assistant-types.ts";
import { ActionQueue, describeAction, type AssistantAction } from "../assistant-actions.ts";
import { speak } from "../../engine/tours.ts";
import { t } from "../../i18n/index.ts";

interface Msg {
  id: number;
  role: "user" | "assistant";
  text: string;
  actions: AssistantAction[];
  sources: Source[];
  status?: string;
  mode?: "ai" | "basic";
  error?: string;
}

const SUGGESTIONS_ES = [
  "Mostrame Buenos Aires desde el espacio",
  "Viajá hasta el Obelisco",
  "Compará esta zona con imágenes históricas de 2000",
  "Mostrame los edificios más altos de Argentina",
  "Explicame cómo se formó el Aconcagua",
  "Calculá la distancia entre Ushuaia y La Quiaca",
  "Mostrame cómo cambia la iluminación durante el día",
];
const SUGGESTIONS_EN = [
  "Show me Tokyo from space",
  "Fly to the Eiffel Tower",
  "Compare this area with historic imagery from 2000",
  "Show me the tallest buildings in Japan",
  "Explain how Mount Fuji formed",
  "Distance between New York and London",
];

let msgId = 0;

/** Asistente geográfico: lenguaje natural → consultas con fuentes + acciones en el globo. */
export function AssistantPanel() {
  const engine = useEngine();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const queue = useRef(new ActionQueue(engine));
  const abort = useRef<AbortController | null>(null);
  const lang = settings.value.lang;

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const update = (id: number, fn: (m: Msg) => Msg) => setMsgs((list) => list.map((m) => (m.id === id ? fn(m) : m)));

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    const userMsg: Msg = { id: ++msgId, role: "user", text: q, actions: [], sources: [] };
    const reply: Msg = { id: ++msgId, role: "assistant", text: "", actions: [], sources: [], status: t("Pensando…") };
    setMsgs((l) => [...l, userMsg, reply]);
    setBusy(true);
    abort.current = new AbortController();
    const cam = cameraState.value;
    const center = engine.viewCenter();
    const sel = selection.value;
    try {
      await ask(
        q,
        {
          lang,
          camera: { lat: cam.lat, lon: cam.lon, height: cam.height, heading: cam.heading, pitch: cam.pitch },
          view: engine.viewBBox(),
          selection: sel ? { title: sel.title, lat: sel.lat, lon: sel.lon } : null,
          sceneTime: sceneTime.value.toISOString(),
          layers: [activeBase.value, ...activeOverlays.value.map((o) => o.id)],
          center,
        },
        {
          onText: (d) => update(reply.id, (m) => ({ ...m, text: m.text + d, status: undefined })),
          onAction: (a) => {
            update(reply.id, (m) => ({ ...m, actions: [...m.actions, a] }));
            void queue.current.push(a);
          },
          onStatus: (s) => update(reply.id, (m) => ({ ...m, status: s })),
          onSources: (s) => update(reply.id, (m) => ({ ...m, sources: s })),
          onMode: (mode) => update(reply.id, (m) => ({ ...m, mode })),
        },
        { useAi: settings.value.aiEnabled, signal: abort.current.signal },
      );
    } catch (err) {
      if (!abort.current?.signal.aborted) update(reply.id, (m) => ({ ...m, error: err instanceof Error ? err.message : String(err) }));
    } finally {
      update(reply.id, (m) => ({ ...m, status: undefined }));
      setBusy(false);
    }
  };

  const voice = () => {
    const SR = (window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRec }).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = lang === "es" ? "es-AR" : "en-US";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const text = e.results[0]?.[0]?.transcript ?? "";
      if (text) void send(text);
    };
    rec.onend = () => setListening(false);
    setListening(true);
    rec.start();
  };

  const hasVoice = typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
  const suggestions = lang === "es" ? SUGGESTIONS_ES : SUGGESTIONS_EN;

  return (
    <div class="assistant">
      <div class="panel-head">
        <Sparkles size={18} color="var(--accent)" />
        <h2>{t("Asistente geográfico")}</h2>
        <button
          class="icon-btn"
          title={t("Nueva conversación")}
          aria-label={t("Nueva conversación")}
          onClick={() => {
            abort.current?.abort();
            resetConversation();
            setMsgs([]);
          }}
        >
          <RotateCcw size={16} />
        </button>
        <button class="icon-btn" onClick={() => (assistantOpen.value = false)} aria-label={t("Cerrar")}>
          <X size={18} />
        </button>
      </div>
      <div class="chat" ref={chatRef} aria-live="polite">
        {msgs.length === 0 && (
          <div class="col">
            <p class="muted" style={{ margin: 0, lineHeight: 1.5 }}>
              {t("Preguntame por lugares, distancias, clima, historia o iluminación. Muevo la cámara, activo capas y cito las fuentes. No invento datos: si no hay información suficiente, te lo digo.")}
            </p>
            <div class="suggestions">
              {suggestions.map((s) => (
                <button key={s} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} class={`msg ${m.role}`}>
            {m.text}
            {m.status && (
              <span class="faint row" style={{ gap: "6px" }}>
                <Loader2 size={13} /> {m.status}
              </span>
            )}
            {m.error && <div style={{ color: "var(--danger)" }}>{m.error}</div>}
            {m.actions.length > 0 && (
              <div class="actions">
                {m.actions.map((a, i) => (
                  <span key={i} class="act">
                    ▶ {describeAction(a, lang)}
                  </span>
                ))}
              </div>
            )}
            {m.role === "assistant" && !m.status && m.text && (
              <div class="row" style={{ marginTop: "4px", gap: "6px" }}>
                {m.mode && <span class="faint">{m.mode === "ai" ? t("IA") : t("Modo básico")}</span>}
                <button class="icon-btn" style={{ width: "24px", height: "24px" }} title={t("Escuchar")} aria-label={t("Escuchar")} onClick={() => speak(m.text)}>
                  <Volume2 size={13} />
                </button>
              </div>
            )}
            {m.sources.length > 0 && (
              <div class="srcs">
                {t("Fuentes")}:{" "}
                {m.sources.map((s, i) => (
                  <span key={i}>
                    {i > 0 && " · "}
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener">
                        {s.name}
                      </a>
                    ) : (
                      s.name
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      <form
        class="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input class="input" value={input} placeholder={t("Escribí un pedido… (p. ej. «Viajá hasta el Obelisco»)")} onInput={(e) => setInput((e.target as HTMLInputElement).value)} aria-label={t("Mensaje para el asistente")} />
        {hasVoice && (
          <button type="button" class={`icon-btn ${listening ? "active" : ""}`} onClick={voice} title={t("Dictar por voz")} aria-label={t("Dictar por voz")}>
            <Mic size={17} />
          </button>
        )}
        <button class="btn primary" type="submit" disabled={busy || !input.trim()} aria-label={t("Enviar")}>
          {busy ? <Loader2 size={16} /> : <Send size={16} />}
        </button>
      </form>
    </div>
  );
}

interface SpeechRec {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: { [i: number]: { [j: number]: { transcript: string } } } }) => void;
  onend: () => void;
  start: () => void;
}
