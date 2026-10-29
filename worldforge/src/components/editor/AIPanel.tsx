"use client";

import { useEffect, useRef, useState } from "react";
import { fetchProviderStatus, type ProviderStatus } from "@/engine/ai/provider";
import { useEditor } from "@/store/editor";
import { useSettings } from "@/store/settings";
import { applyPreview, discardPreview, generateFromPrompt, previewInstruction } from "./actions";
import { Badge, Button, Modal, cx } from "../ui/controls";
import { Icon } from "../ui/Icon";

const SUGGESTIONS_SELECTED = ["Hacé que este edificio sea más alto", "Cambiá el material por ladrillos", "Pintalo de azul", "Duplicalo", "Rotalo 45 grados"];
const SUGGESTIONS_WORLD = [
  "Agregá veinte árboles alrededor del lago",
  "Convertí esta ciudad en una versión nocturna",
  "Agregá una autopista alrededor de la montaña",
  "Hacé que todos los personajes caminen por las veredas",
  "Poné lluvia y charcos sobre el asfalto",
  "Creá una animación cinematográfica donde la cámara sobrevuele la ciudad y termine enfocando un edificio",
];

/** Panel de IA: instrucciones en lenguaje natural con vista previa antes de aplicar. */
export function AIPanel() {
  const [text, setText] = useState("");
  const [confirmGen, setConfirmGen] = useState(false);
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const preview = useEditor((s) => s.aiPreview);
  const busy = useEditor((s) => s.aiBusy);
  const history = useEditor((s) => s.aiHistory);
  const selection = useEditor((s) => s.selection);
  const selName = useEditor((s) => (s.selection.length === 1 ? s.doc?.entities[s.selection[0]!]?.name : s.selection.length ? `${s.selection.length} objetos` : null));
  const provider = useSettings((s) => s.provider);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void fetchProviderStatus().then(setStatus);
  }, []);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [history.length, preview]);

  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    await previewInstruction(t);
    setText("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="ai-panel">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <div className="flex items-center gap-2 text-xs">
          <Icon name="sparkles" size={14} className="text-accent-2" />
          <select
            className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs outline-none"
            value={provider}
            onChange={(e) => useSettings.getState().setProvider(e.target.value as "local" | "openai-compatible")}
            data-testid="ai-provider"
          >
            <option value="local">Forge 1 · local y gratis</option>
            <option value="openai-compatible" disabled={!status?.connected.available}>
              {status?.connected.available ? status.connected.name : "Modelo conectado (no configurado)"}
            </option>
          </select>
        </div>
        <Button variant="ghost" icon="globe" onClick={() => setConfirmGen(true)} className="px-2 py-1 text-xs">
          Mundo nuevo
        </Button>
      </div>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-auto p-3 text-xs">
        {history.length === 0 && !preview && (
          <div className="space-y-2 text-muted">
            <p>Escribí qué querés cambiar. Vas a ver una vista previa de las operaciones antes de aplicarlas, y todo se puede deshacer.</p>
            <p className="pt-1 text-[11px] font-semibold tracking-wide uppercase">{selName ? `Con ${selName}` : "Sobre el mundo"}</p>
            <div className="flex flex-wrap gap-1.5">
              {(selection.length ? SUGGESTIONS_SELECTED : SUGGESTIONS_WORLD).map((s) => (
                <button key={s} onClick={() => setText(s)} className="rounded-full border border-line px-2.5 py-1 text-left text-[11px] text-text hover:border-accent">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {history.map((h) => (
          <div key={h.id} className="space-y-1">
            <div className="ml-6 rounded-xl rounded-br-sm bg-accent/15 px-3 py-2 text-text">{h.prompt}</div>
            <div className="mr-6 rounded-xl rounded-bl-sm bg-surface px-3 py-2">
              <div className="mb-1 flex items-center gap-2">
                <Badge tone={h.status === "applied" ? "ok" : h.status === "discarded" ? "neutral" : "warn"}>{h.status === "applied" ? "aplicado" : h.status === "discarded" ? "descartado" : "sin cambios"}</Badge>
                <span className="text-[10px] text-muted">{h.source}</span>
              </div>
              {h.summary.map((s, i) => (
                <p key={i} className="text-muted">
                  {s}
                </p>
              ))}
            </div>
          </div>
        ))}
        {preview && (
          <div className="animate-fade-up space-y-2 rounded-xl border border-accent/40 bg-surface p-3" data-testid="ai-preview">
            <div className="flex items-center justify-between">
              <span className="font-semibold">Vista previa</span>
              <span className="text-[10px] text-muted">{preview.source}</span>
            </div>
            <p className="text-muted">“{preview.prompt}”</p>
            {preview.operations.length > 0 && (
              <ul className="space-y-1">
                {preview.summary.map((s, i) => (
                  <li key={i} className="flex gap-1.5">
                    <Icon name="check" size={13} className="mt-0.5 shrink-0 text-ok" />
                    {s}
                  </li>
                ))}
              </ul>
            )}
            {preview.warnings.map((w, i) => (
              <p key={i} className="text-warn">
                {w}
              </p>
            ))}
            {preview.notUnderstood.length > 0 && preview.operations.length > 0 && <p className="text-[11px] text-muted">No interpretado: “{preview.notUnderstood.join("”, “")}”</p>}
            <details className="text-[10px] text-muted">
              <summary className="cursor-pointer">Operaciones ({preview.operations.length})</summary>
              <pre className="mt-1 max-h-40 overflow-auto rounded bg-bg p-2 font-mono">{JSON.stringify(preview.operations, null, 1)}</pre>
            </details>
            <div className="flex gap-2 pt-1">
              <Button variant="primary" icon="check" onClick={applyPreview} disabled={!preview.operations.length} testId="ai-apply">
                Aplicar
              </Button>
              <Button variant="ghost" onClick={discardPreview} testId="ai-discard">
                Descartar
              </Button>
            </div>
          </div>
        )}
      </div>

      <form
        className="border-t border-line p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {selName && (
          <div className="mb-1.5 flex items-center gap-1.5 px-1 text-[11px] text-muted">
            <Icon name="cursor" size={12} />
            Contexto: <span className="text-accent-2">{selName}</span>
          </div>
        )}
        <div className="flex items-end gap-2 rounded-xl border border-line bg-surface p-1.5 focus-within:border-accent">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={2}
            maxLength={2000}
            placeholder={selName ? `¿Qué querés cambiar de ${selName}?` : "Ej: agregá 20 árboles alrededor del lago"}
            className="min-h-[40px] flex-1 resize-none bg-transparent px-1.5 py-1 text-sm outline-none"
            data-testid="ai-input"
          />
          <button type="submit" disabled={!text.trim() || busy} className={cx("flex h-9 w-9 items-center justify-center rounded-lg", text.trim() ? "bg-accent text-white" : "bg-surface-2 text-muted")} aria-label="Enviar" data-testid="ai-send">
            {busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : <Icon name="sparkles" size={16} />}
          </button>
        </div>
      </form>

      <Modal open={confirmGen} onClose={() => setConfirmGen(false)} title="Generar un mundo nuevo">
        <NewWorldForm
          onDone={() => setConfirmGen(false)}
        />
      </Modal>
    </div>
  );
}

function NewWorldForm({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        onDone();
        void generateFromPrompt(text);
      }}
    >
      <p className="text-xs text-muted">Se crea un proyecto nuevo; el mundo actual queda guardado tal como está.</p>
      <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} rows={4} className="w-full rounded-lg border border-line bg-surface p-2 text-sm outline-none focus:border-accent" placeholder="Describí el mundo…" />
      <Button type="submit" variant="glow" icon="sparkles" disabled={!text.trim()}>
        Generar
      </Button>
    </form>
  );
}
