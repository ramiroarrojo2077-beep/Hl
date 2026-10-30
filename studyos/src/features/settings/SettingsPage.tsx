import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { CircleCheck, CircleX, Database, Download, KeyRound, Lock, Mic, Settings, Trash, Upload, UserRound, Volume2, Bot, Monitor, Info } from 'lucide-react';
import { BACKUP_TABLES, db } from '@/lib/db';
import { fmtBytes } from '@/lib/format';
import { hashPin } from '@/lib/pin';
import { isNative, platform, saveFile, fileToDataUrl } from '@/lib/platform';
import { Badge, Button, Field, Input, Notice, PageHeader, Panel, Segmented, Select, Slider, Toggle } from '@/components/ui';
import { useSettings, DEFAULT_MODELS, type Character } from '@/stores/settings';
import { PROVIDER_LABEL, aiErrorMessage, type ProviderId } from '@/ai/types';
import { getProviderImpl, pickModel, providerConfig } from '@/ai/client';
import { listVoices, speak, stopSpeaking } from '@/voice/tts';
import { listenOnce, sttSupported } from '@/voice/stt';
import { useVoice, VOICE_STATE_LABEL } from '@/voice/bus';
import { CHARACTERS } from '@/features/avatar/store';
import { toast } from '@/stores/toast';

// Índice de secciones (también fija el color de cada bloque)
const SECTIONS = [
  { id: 'perfil', label: 'Perfil', grad: 'linear-gradient(135deg,#3d5bff,#8b5cf6)' },
  { id: 'ia', label: 'IA', grad: 'linear-gradient(135deg,#8b5cf6,#d946ef)' },
  { id: 'voz', label: 'Voz', grad: 'linear-gradient(135deg,#12a58a,#22d3ee)' },
  { id: 'avatar', label: 'Profesor 3D', grad: 'linear-gradient(135deg,#2e7bff,#22d3ee)' },
  { id: 'interfaz', label: 'Interfaz', grad: 'linear-gradient(135deg,#e0389a,#a92ad6)' },
  { id: 'datos', label: 'Datos', grad: 'linear-gradient(135deg,#ff8a3d,#e0389a)' },
  { id: 'seguridad', label: 'PIN', grad: 'linear-gradient(135deg,#5b6b95,#8b9be8)' },
  { id: 'estado', label: 'Estado', grad: 'linear-gradient(135deg,#1fb3a1,#2f63ff)' },
];

function SectionIndex() {
  return (
    <nav aria-label="Secciones de configuración" className="sticky top-[calc(3.5rem+var(--safe-top))] lg:top-2 z-20 -mx-3.5 px-3.5 sm:mx-0 sm:px-0 py-2 mb-2 bg-bg/85 backdrop-blur-md lg:bg-transparent lg:backdrop-blur-0">
      <div className="snap-row gap-1.5">
        {SECTIONS.map((x) => (
          <button key={x.id} onClick={() => document.getElementById(x.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="inline-flex items-center gap-2 h-9 px-3.5 rounded-full border border-line bg-surface/70 text-xs text-[#cdd5f0] whitespace-nowrap hover:text-white">
            <span className="size-2 rounded-full" style={{ background: x.grad }} />
            {x.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function Section({ id, icon, title, children, subtitle }: { id: string; icon: ReactNode; title: string; subtitle?: string; children: ReactNode }) {
  const grad = SECTIONS.find((x) => x.id === id)?.grad ?? SECTIONS[0].grad;
  return (
    <Panel id={id} className="p-4 sm:p-5 scroll-mt-36 lg:scroll-mt-20">
      <div className="flex items-start gap-3 mb-4">
        <span className="grid place-items-center size-10 rounded-xl text-white shrink-0 shadow-[0_8px_18px_-10px_rgba(0,0,0,.9)]" style={{ background: grad }}>{icon}</span>
        <div>
          <h2 className="font-display font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </Panel>
  );
}

const KEY_HELP: Record<ProviderId, string> = {
  gemini: 'Gratis con límites: creá la clave en aistudio.google.com → Get API key.',
  anthropic: 'Clave de la consola de Anthropic (platform.claude.com → API keys). Uso pago por tokens.',
  openai: 'Clave de OpenAI o de un servicio compatible (Groq, OpenRouter, LM Studio, etc. con su URL base).',
  ollama: 'Sin clave: instalá Ollama en una computadora de tu red y ejecutá OLLAMA_HOST=0.0.0.0 ollama serve. En el navegador también hace falta OLLAMA_ORIGINS=*.',
};

function AiSection() {
  const { s, update } = useSettings();
  const p = s.ai.provider;
  const [models, setModels] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const test = async () => {
    if (p === 'none') return;
    setTesting(true);
    setResult(null);
    try {
      const impl = getProviderImpl(p);
      const list = await impl.listModels(providerConfig(p));
      setModels(list);
      // Si el modelo guardado no está en la lista (retirado o de otro servicio), se elige uno disponible
      let changed = '';
      if (list.length && !list.includes(providerConfig(p).model)) {
        const next = pickModel(p, list);
        if (next) {
          changed = ` (${providerConfig(p).model || 'sin modelo'} no está disponible para tu clave: se eligió ${next})`;
          await update((x) => void (x.ai.models[p] = next));
        }
      }
      const cfg = providerConfig(p);
      // margen de tokens: los modelos con razonamiento piensan antes de contestar
      const r = await impl.generate({ messages: [{ role: 'user', content: 'Respondé solo: OK' }], maxTokens: 1024 }, cfg);
      setResult({ ok: true, text: `Conexión correcta con ${cfg.model}${changed}. Respuesta: «${r.text.trim().slice(0, 40) || '(vacía)'}». ${list.length} modelos disponibles.` });
    } catch (e) {
      setResult({ ok: false, text: aiErrorMessage(e) });
    } finally {
      setTesting(false);
    }
  };
  return (
    <Section id="ia" icon={<Bot className="size-5" />} title="Inteligencia artificial" subtitle="Las claves se guardan solo en este dispositivo y se envían únicamente al proveedor elegido.">
      <Field label="Proveedor">
        <Select value={p} onChange={(e) => update((x) => void (x.ai.provider = e.target.value as ProviderId | 'none'))}>
          <option value="none">Sin IA (funciones locales)</option>
          {(Object.keys(PROVIDER_LABEL) as ProviderId[]).map((id) => (
            <option key={id} value={id}>
              {PROVIDER_LABEL[id]}
            </option>
          ))}
        </Select>
      </Field>
      {p !== 'none' && (
        <>
          <Notice>{KEY_HELP[p]}</Notice>
          {p !== 'ollama' && (
            <Field label="Clave de API">
              <Input type="password" autoComplete="off" value={s.ai.keys[p] ?? ''} onChange={(e) => update((x) => void (x.ai.keys[p] = e.target.value.trim()))} placeholder="Pegá tu clave" />
            </Field>
          )}
          {p === 'openai' && (
            <Field label="URL base" hint="https://api.openai.com/v1 · Groq: https://api.groq.com/openai/v1 · OpenRouter: https://openrouter.ai/api/v1">
              <Input value={s.ai.openaiBaseUrl} onChange={(e) => update((x) => void (x.ai.openaiBaseUrl = e.target.value.trim()))} />
            </Field>
          )}
          {p === 'ollama' && (
            <Field label="Dirección de Ollama">
              <Input value={s.ai.ollamaUrl} onChange={(e) => update((x) => void (x.ai.ollamaUrl = e.target.value.trim()))} placeholder="http://192.168.0.10:11434" />
            </Field>
          )}
          <Field label="Modelo" hint={`Predeterminado: ${DEFAULT_MODELS[p]}. Usá «Probar conexión» para ver los modelos de tu cuenta.`}>
            {models.length ? (
              <Select value={s.ai.models[p] ?? ''} onChange={(e) => update((x) => void (x.ai.models[p] = e.target.value))}>
                {!models.includes(s.ai.models[p] ?? '') && <option value={s.ai.models[p]}>{s.ai.models[p]}</option>}
                {models.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
            ) : (
              <Input value={s.ai.models[p] ?? ''} onChange={(e) => update((x) => void (x.ai.models[p] = e.target.value.trim()))} />
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={test} loading={testing}>
              Probar conexión y cargar modelos
            </Button>
            {result && (
              <span className={`text-sm flex items-start gap-1.5 ${result.ok ? 'text-ok' : 'text-bad'}`}>
                {result.ok ? <CircleCheck className="size-4 mt-0.5 shrink-0" /> : <CircleX className="size-4 mt-0.5 shrink-0" />} {result.text}
              </span>
            )}
          </div>
          {p === 'anthropic' && (
            <Field label="Esfuerzo de razonamiento" hint="Más esfuerzo = respuestas más cuidadas, más lentas y con más tokens.">
              <Segmented size="sm" value={s.ai.effort} onChange={(v) => update((x) => void (x.ai.effort = v))} options={[{ value: 'low', label: 'Bajo' }, { value: 'medium', label: 'Medio' }, { value: 'high', label: 'Alto' }]} />
            </Field>
          )}
          <Slider label="Material enviado por consulta" value={s.ai.contextChars} min={10000} max={200000} step={5000} onChange={(v) => update((x) => void (x.ai.contextChars = v))} format={(v) => `${Math.round(v / 1000)}k caracteres`} />
          <Toggle label="Revisor de calidad" hint="Segunda pasada que verifica resúmenes y claves de corrección (usa más tokens)." checked={s.ai.reviewer} onChange={(v) => update((x) => void (x.ai.reviewer = v))} />
          <Toggle label="Búsqueda semántica (embeddings)" hint={p === 'anthropic' ? 'Anthropic no ofrece embeddings: se usa búsqueda por palabras.' : 'Calcula vectores de tus documentos con el proveedor para encontrar fragmentos por significado.'} checked={s.ai.embeddings && p !== 'anthropic'} onChange={(v) => update((x) => void (x.ai.embeddings = v))} />
        </>
      )}
    </Section>
  );
}

function VoiceSection() {
  const { s, update } = useSettings();
  const v = useVoice();
  const [voices, setVoices] = useState<{ id: string; name: string; lang: string }[]>([]);
  const [stt, setStt] = useState<boolean | null>(null);
  const [heard, setHeard] = useState('');
  useEffect(() => {
    listVoices().then(setVoices).catch(() => setVoices([]));
    sttSupported().then(setStt);
  }, []);
  const filtered = voices.filter((x) => x.lang.toLowerCase().startsWith(s.voice.lang.slice(0, 2).toLowerCase()));
  return (
    <Section id="voz" icon={<Volume2 className="size-5" />} title="Voz" subtitle="Lectura de explicaciones, dictado y conversación con el profesor.">
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Idioma">
          <Select value={s.voice.lang} onChange={(e) => update((x) => void (x.voice.lang = e.target.value))}>
            <option value="es-AR">Español (Argentina)</option>
            <option value="es-ES">Español (España)</option>
            <option value="es-MX">Español (México)</option>
            <option value="en-US">Inglés (EE. UU.)</option>
            <option value="pt-BR">Portugués (Brasil)</option>
            <option value="fr-FR">Francés</option>
            <option value="it-IT">Italiano</option>
            <option value="de-DE">Alemán</option>
          </Select>
        </Field>
        <Field label="Motor de voz">
          <Select value={s.voice.engine} onChange={(e) => update((x) => void (x.voice.engine = e.target.value as 'device' | 'openai'))}>
            <option value="device">Voz del dispositivo (gratis, sin conexión)</option>
            <option value="openai" disabled={!s.ai.keys.openai}>
              Voz de OpenAI (requiere clave de OpenAI)
            </option>
          </Select>
        </Field>
      </div>
      {s.voice.engine === 'device' ? (
        <Field label="Voz" hint={voices.length ? undefined : 'El dispositivo no informó voces; se usa la predeterminada.'}>
          <Select value={s.voice.voiceURI ?? ''} onChange={(e) => update((x) => void (x.voice.voiceURI = e.target.value || undefined))}>
            <option value="">Predeterminada</option>
            {(filtered.length ? filtered : voices).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} ({x.lang})
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field label="Voz de OpenAI">
          <Select value={s.voice.openaiVoice} onChange={(e) => update((x) => void (x.voice.openaiVoice = e.target.value))}>
            {['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
        </Field>
      )}
      <div className="grid sm:grid-cols-2 gap-4">
        <Slider label="Velocidad" value={s.voice.rate} min={0.6} max={1.6} step={0.05} onChange={(x) => update((y) => void (y.voice.rate = x))} format={(x) => `${x.toFixed(2)}×`} />
        <Slider label="Tono" value={s.voice.pitch} min={0.6} max={1.5} step={0.05} onChange={(x) => update((y) => void (y.voice.pitch = x))} format={(x) => x.toFixed(2)} />
      </div>
      <Toggle label="Leer automáticamente las respuestas del profesor" checked={s.voice.autoSpeak} onChange={(x) => update((y) => void (y.voice.autoSpeak = x))} />
      <Toggle label="Subtítulos" checked={s.voice.subtitles} onChange={(x) => update((y) => void (y.voice.subtitles = x))} />
      <div className="flex flex-wrap items-center gap-2">
        <Button icon={<Volume2 className="size-4" />} onClick={() => (v.state === 'speaking' ? stopSpeaking() : speak('Hola, soy tu profesora virtual de StudyOS. Así suena mi voz.'))}>
          {v.state === 'speaking' ? 'Detener' : 'Probar voz'}
        </Button>
        <Button
          icon={<Mic className="size-4" />}
          disabled={stt === false}
          onClick={async () => {
            setHeard('');
            try {
              setHeard((await listenOnce()) || '(no se escuchó nada)');
            } catch (e) {
              setHeard('');
              toast.error((e as Error).message);
            }
          }}
        >
          Probar micrófono
        </Button>
        <Badge>{VOICE_STATE_LABEL[v.state]}</Badge>
      </div>
      {stt === false && <Notice tone="warn">Este navegador no tiene reconocimiento de voz. Usá Chrome o la app de Android; mientras tanto podés escribir.</Notice>}
      {heard && <p className="text-sm">Escuché: «{heard}»</p>}
      {v.error && (v.state === 'denied' || v.state === 'error') && <Notice tone="bad">{v.error}</Notice>}
    </Section>
  );
}

function DataSection() {
  const { s, update } = useSettings();
  const [usage, setUsage] = useState<{ usage?: number; quota?: number; persisted?: boolean }>({});
  const [withFiles, setWithFiles] = useState(false);
  const [withKeys, setWithKeys] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    (async () => {
      const est = await navigator.storage?.estimate?.();
      const persisted = await navigator.storage?.persisted?.();
      setUsage({ usage: est?.usage, quota: est?.quota, persisted });
    })();
  }, []);
  const exportAll = async () => {
    setBusy(true);
    try {
      const data: Record<string, unknown> = { app: 'studyos', version: 1, exportedAt: new Date().toISOString() };
      for (const t of BACKUP_TABLES) data[t] = await db.table(t).toArray();
      const settings = structuredClone(s);
      if (!withKeys) settings.ai.keys = {};
      settings.security = {};
      data.settings = settings;
      if (withFiles) {
        const files = await db.docFiles.toArray();
        data.docFiles = await Promise.all(files.map(async (f) => ({ id: f.id, dataUrl: await fileToDataUrl(f.blob) })));
      }
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const where = await saveFile(blob, `studyos-backup-${new Date().toISOString().slice(0, 10)}.json`);
      toast.ok(`Copia exportada: ${where}`);
    } catch (e) {
      toast.error(`No se pudo exportar: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const importAll = async (file: File) => {
    setBusy(true);
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'studyos') throw new Error('El archivo no es una copia de StudyOS.');
      if (!confirm('Importar combina la copia con tus datos actuales (los registros con el mismo identificador se reemplazan). ¿Continuar?')) return;
      await db.transaction('rw', [...BACKUP_TABLES.map((t) => db.table(t)), db.docFiles], async () => {
        for (const t of BACKUP_TABLES) if (Array.isArray(data[t])) await db.table(t).bulkPut(data[t]);
        if (Array.isArray(data.docFiles)) {
          for (const f of data.docFiles as { id: string; dataUrl: string }[]) await db.docFiles.put({ id: f.id, blob: await (await fetch(f.dataUrl)).blob() });
        }
      });
      if (data.settings) await update((x) => ({ ...x, ...data.settings, security: x.security, ai: { ...data.settings.ai, keys: { ...x.ai.keys, ...data.settings.ai.keys } } }));
      toast.ok('Copia importada');
    } catch (e) {
      toast.error(`No se pudo importar: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const wipe = async () => {
    const t = prompt('Esto borra TODOS tus datos de StudyOS en este dispositivo (materias, documentos, tareas, progreso y configuración). Escribí BORRAR para confirmar.');
    if (t !== 'BORRAR') return;
    await db.delete();
    localStorage.clear();
    sessionStorage.clear();
    location.reload();
  };
  return (
    <Section id="datos" icon={<Database className="size-5" />} title="Datos y cuenta" subtitle="StudyOS guarda todo en este dispositivo (guardado automático). No hay servidor ni cuenta en la nube.">
      <div className="grid sm:grid-cols-3 gap-3 text-sm">
        <div className="tile p-3">
          <div className="text-xs text-muted">Espacio usado</div>
          <div className="font-mono">{usage.usage !== undefined ? fmtBytes(usage.usage) : '—'}</div>
        </div>
        <div className="tile p-3">
          <div className="text-xs text-muted">Disponible para la app</div>
          <div className="font-mono">{usage.quota ? fmtBytes(usage.quota) : '—'}</div>
        </div>
        <div className="tile p-3">
          <div className="text-xs text-muted">Almacenamiento persistente</div>
          <div>{isNative ? 'Sí (app instalada)' : usage.persisted ? 'Sí' : 'No garantizado por el navegador'}</div>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Toggle label="Incluir archivos originales" hint="Los PDF e imágenes hacen la copia mucho más grande." checked={withFiles} onChange={setWithFiles} />
        <Toggle label="Incluir claves de API" hint="Desactivado por seguridad: no compartas la copia si las incluís." checked={withKeys} onChange={setWithKeys} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button icon={<Download className="size-4" />} loading={busy} onClick={exportAll}>
          Exportar copia de seguridad
        </Button>
        <Button icon={<Upload className="size-4" />} disabled={busy} onClick={() => fileRef.current?.click()}>
          Importar copia
        </Button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && importAll(e.target.files[0])} />
        <Button variant="danger" icon={<Trash className="size-4" />} onClick={wipe}>
          Eliminar todos mis datos
        </Button>
      </div>
      <Notice>Sincronización entre dispositivos y recuperación de cuenta requieren un servidor propio: no están disponibles en esta versión. Usá la copia de seguridad para pasar tus datos a otro dispositivo.</Notice>
    </Section>
  );
}

function SecuritySection() {
  const { s, update } = useSettings();
  const [pin, setPin] = useState('');
  return (
    <Section id="seguridad" icon={<Lock className="size-5" />} title="Bloqueo con PIN" subtitle="Protege el acceso a StudyOS en este dispositivo. Se guarda solo un hash (PBKDF2), nunca el PIN.">
      {s.security.pinHash ? (
        <div className="flex items-center gap-3">
          <Badge tone="ok">Activado</Badge>
          <Button variant="danger" size="sm" onClick={() => confirm('¿Quitar el PIN?') && update((x) => void (x.security = {}))}>
            Quitar PIN
          </Button>
        </div>
      ) : (
        <div className="flex gap-2 max-w-sm">
          <Input type="password" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="4 a 8 dígitos" aria-label="Nuevo PIN" />
          <Button
            icon={<KeyRound className="size-4" />}
            disabled={pin.length < 4}
            onClick={async () => {
              const h = await hashPin(pin);
              await update((x) => void (x.security = { pinHash: h.hash, pinSalt: h.salt }));
              setPin('');
              toast.ok('PIN activado');
            }}
          >
            Activar
          </Button>
        </div>
      )}
    </Section>
  );
}

const STATUS: { area: string; state: 'ok' | 'ai' | 'partial'; note: string }[] = [
  { area: 'Materias, apuntes, carpetas y biblioteca', state: 'ok', note: 'Local, sin conexión.' },
  { area: 'Importación PDF/DOCX/PPTX/TXT e imágenes con OCR', state: 'ok', note: 'OCR local (español/inglés) o por IA.' },
  { area: 'Flashcards con repetición espaciada', state: 'ok', note: 'SM-2, sin conexión. Generación automática con IA.' },
  { area: 'Calendario, planificador y recordatorios', state: 'ok', note: 'Planificador local; interpretación del pedido con IA.' },
  { area: 'Modo Focus, pizarra, laboratorio 3D, estadísticas', state: 'ok', note: 'Local.' },
  { area: 'Profesor IA, resúmenes, tareas, exámenes, mapas', state: 'ai', note: 'Requieren un proveedor de IA (Gemini tiene plan gratuito).' },
  { area: 'Videos educativos', state: 'partial', note: 'Motor de plantillas animadas y escenas 3D; guion con IA; exporta WebM. La narración se incluye en el archivo solo con voz de OpenAI.' },
  { area: 'Profesor 3D y sincronización labial', state: 'partial', note: 'Modelos VRM riggeados con visemas; la sincronía es aproximada (por texto) salvo con audio en la nube (por volumen).' },
  { area: 'Cuentas en la nube y sincronización', state: 'partial', note: 'No disponible: datos locales con copia de seguridad.' },
];

export default function SettingsPage() {
  const { s, update } = useSettings();
  const loc = useLocation();
  useEffect(() => {
    if (loc.hash) document.querySelector(loc.hash)?.scrollIntoView({ behavior: 'smooth' });
  }, [loc.hash]);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Configuración" subtitle={`StudyOS AI 0.2.1 · ${isNative ? `app ${platform}` : 'web'}`} icon={<Settings className="size-5" />} />
      <SectionIndex />
      <div className="space-y-4">
        <Section id="perfil" icon={<UserRound className="size-5" />} title="Perfil">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Nombre">
              <Input value={s.profile.name} onChange={(e) => update((x) => void (x.profile.name = e.target.value))} />
            </Field>
            <Field label="Nivel educativo">
              <Input value={s.profile.level} onChange={(e) => update((x) => void (x.profile.level = e.target.value))} />
            </Field>
          </div>
          <Field label="Variante de español del profesor">
            <Segmented size="sm" value={s.profile.dialect} onChange={(v) => update((x) => void (x.profile.dialect = v))} options={[{ value: 'rioplatense', label: 'Rioplatense (vos)' }, { value: 'neutro', label: 'Neutro (tú)' }]} />
          </Field>
        </Section>
        <AiSection />
        <VoiceSection />
        <Section id="avatar" icon={<UserRound className="size-5" />} title="Profesor 3D">
          <div className="grid sm:grid-cols-3 gap-2">
            {(Object.keys(CHARACTERS) as Character[]).map((c) => (
              <button key={c} onClick={() => update((x) => void (x.avatar.character = c))} className={`rounded-xl border p-3 text-left ${s.avatar.character === c ? 'nav-active' : 'border-line hover:border-line-strong'}`}>
                <div className="text-sm font-medium">{CHARACTERS[c].label}</div>
                <div className="text-[11px] text-muted">{CHARACTERS[c].lipSync ? 'Con sincronización labial' : 'Gestos animados (sin boca articulada)'}</div>
              </button>
            ))}
          </div>
          <Toggle label="Mostrar el profesor 3D" hint="Desactivalo en celulares lentos: se muestra una imagen fija." checked={s.avatar.show} onChange={(v) => update((x) => void (x.avatar.show = v))} />
          <p className="text-[11px] text-faint">{CHARACTERS[s.avatar.character].credit}</p>
        </Section>
        <Section id="interfaz" icon={<Monitor className="size-5" />} title="Interfaz">
          <Toggle label="Reducir animaciones" checked={s.ui.reduceMotion} onChange={(v) => update((x) => void (x.ui.reduceMotion = v))} />
        </Section>
        <SecuritySection />
        <DataSection />
        <Section id="estado" icon={<Info className="size-5" />} title="Estado real de las funciones">
          <ul className="space-y-2">
            {STATUS.map((x) => (
              <li key={x.area} className="flex items-start gap-3 text-sm">
                <Badge tone={x.state === 'ok' ? 'ok' : x.state === 'ai' ? 'primary' : 'warn'}>{x.state === 'ok' ? 'Funciona' : x.state === 'ai' ? 'Con IA' : 'Parcial'}</Badge>
                <span>
                  {x.area}
                  <span className="block text-xs text-muted">{x.note}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-faint">Modelos 3D: Seed-san © VirtualCast, Inc. y VRM sample © pixiv Inc. (VRM Public License 1.0); RobotExpressive de Tomás Laulhé (CC0). OCR: Tesseract (Apache 2.0). PDF: pdf.js (Apache 2.0).</p>
        </Section>
      </div>
    </div>
  );
}
