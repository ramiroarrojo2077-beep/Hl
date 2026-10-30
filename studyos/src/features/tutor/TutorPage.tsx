import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, ChevronDown, ChevronUp, ClipboardList, Copy, GraduationCap, Headphones, Lightbulb, MessageSquarePlus, Mic, MicOff, PenTool, Plus, Repeat, Settings2, Square, Trash, Volume2, ZoomIn, ZoomOut, Shuffle, ListChecks, FileText } from 'lucide-react';
import { db, logActivity, type TutorMessage, type TutorMode, type TutorSession } from '@/lib/db';
import { newId } from '@/lib/ids';
import { timeAgo } from '@/lib/format';
import { weakConcepts } from '@/lib/mastery';
import { Badge, Button, IconButton, Modal, Notice, Select, Slider, Toggle, cx } from '@/components/ui';
import { Markdown } from '@/components/Markdown';
import { TUTOR_MODES, tutorReply } from '@/ai/agents/tutor';
import { aiErrorMessage, isAbort } from '@/ai/types';
import { aiConfigured, useSettings } from '@/stores/settings';
import { toast } from '@/stores/toast';
import { AvatarView } from '@/features/avatar/AvatarView';
import { useAvatar } from '@/features/avatar/store';
import { speak, stopSpeaking, ttsAvailable } from '@/voice/tts';
import { listenOnce, stopListening, sttSupported } from '@/voice/stt';
import { useVoice, VOICE_STATE_LABEL } from '@/voice/bus';
import { useDesktop } from '@/lib/useMedia';

const LANGS: { label: string; code: string }[] = [
  { label: 'Inglés', code: 'en-US' },
  { label: 'Portugués', code: 'pt-BR' },
  { label: 'Francés', code: 'fr-FR' },
  { label: 'Italiano', code: 'it-IT' },
  { label: 'Alemán', code: 'de-DE' },
];

const QUICK: { label: string; icon: typeof Lightbulb; prompt: string }[] = [
  { label: 'Dame un ejemplo', icon: Lightbulb, prompt: 'Dame un ejemplo concreto de lo último que explicaste.' },
  { label: 'Explicalo de otra forma', icon: Shuffle, prompt: 'No lo entendí del todo. Explicalo de otra forma, con otro enfoque.' },
  { label: 'Más simple', icon: ZoomOut, prompt: 'Explicalo más simple, como si recién empezara.' },
  { label: 'Más avanzado', icon: ZoomIn, prompt: 'Profundizá con un nivel más avanzado.' },
  { label: 'Repetí lo difícil', icon: Repeat, prompt: 'Repetí la parte más difícil de tu explicación anterior, despacio y paso a paso.' },
  { label: 'Preguntas de práctica', icon: ListChecks, prompt: 'Haceme 3 preguntas de práctica sobre esto, de a una, y esperá mi respuesta.' },
];

function VoiceIndicator() {
  const v = useVoice();
  const tone = v.state === 'listening' ? 'bg-bad animate-pulse' : v.state === 'speaking' ? 'bg-cyan animate-pulse' : v.state === 'processing' ? 'bg-warn animate-pulse' : v.state === 'denied' || v.state === 'error' || v.state === 'unsupported' ? 'bg-bad' : 'bg-ok';
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-[#d5dcf5] bg-black/30 border border-line rounded-full px-2.5 py-1" role="status" aria-live="polite">
      <span className={cx('size-2 rounded-full', tone)} />
      {VOICE_STATE_LABEL[v.state]}
    </span>
  );
}

/** Escenario del profesor en celulares: avatar 3D, pizarra holográfica y voz. */
function MobileStage(p: { compact: boolean; onToggle: () => void; title: string; detail: string; board: string; conversation: boolean; canTalk: boolean; onTalk: () => void; onSessions: () => void; onSettings: () => void }) {
  const s = useSettings((x) => x.s);
  const voice = useVoice();
  return (
    <div
      className={cx('relative shrink-0 overflow-hidden border-b border-line-strong/70 transition-[height] duration-300 ease-out', p.compact ? 'h-[68px]' : 'h-[196px]')}
      style={{ background: 'radial-gradient(90% 120% at 85% 10%, rgba(80,120,255,.35), transparent 60%), radial-gradient(60% 90% at 0% 100%, rgba(139,92,246,.22), transparent 60%), linear-gradient(180deg,#121a44,#0b1029)' }}
    >
      <div className="absolute inset-0 opacity-60 bg-[linear-gradient(rgba(90,200,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(90,200,255,.08)_1px,transparent_1px)] bg-[size:22px_22px]" aria-hidden="true" />
      {!p.compact && (
        <div className="holo absolute left-3 top-[56px] w-[47%] h-[76px] rounded-md px-2.5 py-2 overflow-hidden" aria-hidden={!p.board}>
          <div className="text-[9px] uppercase tracking-widest text-cyan/80">Pizarra</div>
          <div className="text-[10.5px] text-[#cfeaff] leading-snug line-clamp-4">{voice.subtitle || p.board || 'Las ideas clave de la explicación aparecen acá.'}</div>
        </div>
      )}
      <div className={cx('absolute bottom-0 right-0 transition-all duration-300', p.compact ? 'w-[74px] h-[68px]' : 'w-[50%] h-full')}>
        {s.avatar.show ? <AvatarView character={s.avatar.character} framing="half" facing={-0.3} className="absolute inset-0" /> : <img src="./teacher-seed.png" alt="Profesora virtual" className="absolute right-0 bottom-0 h-full object-contain" />}
      </div>
      <div className={cx('relative z-10 flex gap-2 p-3', p.compact ? 'items-center h-full pr-[84px]' : 'flex-col h-full pr-[48%]')}>
        <div className="min-w-0 flex-1">
          <h1 className="font-display font-semibold text-[15px] leading-tight truncate">{p.title}</h1>
          {!p.compact && <div className="text-[11px] text-[#b9c3e6] truncate">{p.detail}</div>}
        </div>
        <div className={cx('flex items-center gap-1.5', !p.compact && 'mt-auto')}>
          <button
            onClick={p.onTalk}
            disabled={!p.canTalk}
            aria-label={p.conversation ? 'Terminar conversación por voz' : 'Conversar por voz'}
            className={cx('inline-flex items-center gap-1.5 h-10 px-3.5 rounded-full text-[13px] font-medium text-white disabled:opacity-45 transition shrink-0', p.conversation ? 'bg-bad/85 shadow-[0_0_20px_-4px_rgba(248,113,113,.9)]' : 'bg-gradient-to-r from-primary to-violet shadow-[0_8px_20px_-8px_rgba(82,113,255,.9)]')}
          >
            {p.conversation ? <MicOff className="size-4" /> : <Headphones className="size-4" />}
            {p.conversation ? 'Terminar' : 'Hablar'}
          </button>
          {!p.compact && (
            <>
              <IconButton label="Clases" onClick={p.onSessions} className="size-9 shrink-0 bg-black/30 border border-line">
                <MessageSquarePlus className="size-4" />
              </IconButton>
              <IconButton label="Ajustes de la clase" onClick={p.onSettings} className="size-9 shrink-0 bg-black/30 border border-line">
                <Settings2 className="size-4" />
              </IconButton>
            </>
          )}
        </div>
      </div>
      {!p.compact && (
        <div className="absolute z-10 right-2 top-2">
          <VoiceIndicator />
        </div>
      )}
      <button onClick={p.onToggle} aria-label={p.compact ? 'Mostrar profesor' : 'Achicar profesor'} className={cx('absolute z-20 grid place-items-center size-8 rounded-full bg-black/35 border border-line text-[#cdd5f0]', p.compact ? 'right-1.5 top-1.5' : 'right-2 bottom-2')}>
        {p.compact ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
      </button>
      <AnimatePresence>
        {s.voice.subtitles && voice.subtitle && !p.compact && (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute z-10 left-3 right-12 bottom-14 rounded-xl bg-black/70 px-3 py-1.5 text-[12px] leading-snug line-clamp-2" aria-live="polite">
            {voice.subtitle}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function TutorPage() {
  const { sessionId } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const s = useSettings((x) => x.s);
  const update = useSettings((x) => x.update);
  const sessions = useLiveQuery(() => db.tutorSessions.orderBy('updatedAt').reverse().toArray(), []) ?? [];
  const session = useLiveQuery(() => (sessionId ? db.tutorSessions.get(sessionId) : undefined), [sessionId]);
  const messages = useLiveQuery(() => (sessionId ? db.tutorMessages.where('sessionId').equals(sessionId).sortBy('createdAt') : []), [sessionId]) ?? [];
  const subjects = useLiveQuery(() => db.subjects.orderBy('name').toArray(), []) ?? [];
  const docs = useLiveQuery(() => db.documents.orderBy('createdAt').reverse().toArray(), []) ?? [];
  const [input, setInput] = useState(params.get('q') ?? '');
  const [streaming, setStreaming] = useState<{ text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docIds, setDocIds] = useState<string[]>([]);
  const [conversation, setConversation] = useState(false);
  const [sttOk, setSttOk] = useState<boolean | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [typing, setTyping] = useState(false);
  const [stageMin, setStageMin] = useState(false);
  const desktop = useDesktop();
  const abortRef = useRef<AbortController | null>(null);
  const convRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);
  const voice = useVoice();
  const playGesture = useAvatar((a) => a.play);
  const setMood = useAvatar((a) => a.setMood);
  const ai = aiConfigured(s);

  useEffect(() => {
    sttSupported().then(setSttOk);
  }, []);

  // Sesión nueva si no hay ninguna seleccionada
  const ensureSession = useCallback(async (): Promise<TutorSession> => {
    if (session) return session;
    const subjectId = params.get('subject') ?? undefined;
    const docId = params.get('doc') ?? undefined;
    const doc = docId ? await db.documents.get(docId) : undefined;
    const sub = subjectId ? await db.subjects.get(subjectId) : doc?.subjectId ? await db.subjects.get(doc.subjectId) : undefined;
    const ns: TutorSession = { id: newId(), subjectId: sub?.id, docId, title: doc ? `Clase: ${doc.title}` : sub ? `Clase de ${sub.name}` : 'Nueva clase', mode: 'patient', level: 3, createdAt: Date.now(), updatedAt: Date.now() };
    await db.tutorSessions.add(ns);
    nav(`/tutor/${ns.id}`, { replace: true });
    return ns;
  }, [session, params, nav]);

  // Documentos de contexto por defecto: el de la sesión o los de su materia
  useEffect(() => {
    if (!session) return;
    if (session.docId) setDocIds([session.docId]);
    else if (session.subjectId) setDocIds(docs.filter((d) => d.subjectId === session.subjectId && d.status !== 'error').slice(0, 6).map((d) => d.id));
    else setDocIds([]);
  }, [session?.id, docs.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, streaming?.text]);

  const updateSession = (p: Partial<TutorSession>) => session && db.tutorSessions.update(session.id, { ...p, updatedAt: Date.now() });

  const send = useCallback(
    async (text: string, opts: { speakReply?: boolean } = {}) => {
      const content = text.trim();
      if (!content || streaming) return;
      setError(null);
      stopSpeaking();
      const sess = await ensureSession();
      const userMsg: TutorMessage = { id: newId(), sessionId: sess.id, role: 'user', content, createdAt: Date.now() };
      await db.tutorMessages.add(userMsg);
      if (sess.title === 'Nueva clase' || sess.title.startsWith('Clase de ')) await db.tutorSessions.update(sess.id, { title: content.slice(0, 60) });
      setInput('');
      const history = [...(await db.tutorMessages.where('sessionId').equals(sess.id).sortBy('createdAt'))].filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setStreaming({ text: '' });
      setMood('thinking');
      playGesture('think');
      useVoice.getState().set({ state: 'processing' });
      const subjectName = sess.subjectId ? subjects.find((x) => x.id === sess.subjectId)?.name : undefined;
      const weak = sess.subjectId ? (await weakConcepts(sess.subjectId, 5)).map((w) => w.concept) : [];
      try {
        const r = await tutorReply({
          mode: sess.mode,
          level: sess.level,
          targetLanguage: sess.targetLanguage,
          history,
          docIds,
          subjectName,
          weakConcepts: weak,
          voice: !!opts.speakReply || convRef.current,
          signal: ctrl.signal,
          onText: (full) => setStreaming({ text: full }),
        });
        await db.tutorMessages.add({ id: newId(), sessionId: sess.id, role: 'assistant', content: r.text, createdAt: Date.now() });
        await db.tutorSessions.update(sess.id, { updatedAt: Date.now() });
        await logActivity({ type: 'tutor', title: `Clase: ${sess.title}`, refId: sess.id, route: `/tutor/${sess.id}`, subjectId: sess.subjectId });
        setMood('happy');
        setTimeout(() => setMood('neutral'), 3000);
        playGesture('explain');
        useVoice.getState().set({ state: 'idle' });
        if (opts.speakReply || s.voice.autoSpeak || convRef.current) {
          const finished = await speak(r.text);
          if (finished && convRef.current) listenLoop();
        }
      } catch (e) {
        const partial = streamingRef.current;
        if (isAbort(e)) {
          if (partial) await db.tutorMessages.add({ id: newId(), sessionId: sess.id, role: 'assistant', content: partial, createdAt: Date.now(), interrupted: true });
        } else {
          setError(aiErrorMessage(e));
          await db.tutorMessages.add({ id: newId(), sessionId: sess.id, role: 'assistant', content: '', error: aiErrorMessage(e), createdAt: Date.now() });
        }
        useVoice.getState().set({ state: 'idle' });
        setMood('neutral');
      } finally {
        abortRef.current = null;
        setStreaming(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [streaming, ensureSession, docIds, subjects, s.voice.autoSpeak],
  );

  const streamingRef = useRef('');
  useEffect(() => {
    streamingRef.current = streaming?.text ?? '';
  }, [streaming]);

  const interrupt = () => {
    abortRef.current?.abort();
    stopSpeaking();
    stopListening();
  };

  const listenLoop = useCallback(async () => {
    try {
      const text = await listenOnce((t) => setInput(t));
      if (text) await sendRef.current(text, { speakReply: true });
      else if (convRef.current) {
        // Silencio: sale del modo conversación para no dejar el micrófono abierto indefinidamente.
        convRef.current = false;
        setConversation(false);
        toast.info('No escuché nada. El modo conversación se pausó.');
      }
    } catch (e) {
      convRef.current = false;
      setConversation(false);
      toast.error((e as Error).message);
    }
  }, []);
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  }, [send]);

  const toggleConversation = () => {
    if (conversation) {
      convRef.current = false;
      setConversation(false);
      stopListening();
      stopSpeaking();
      useVoice.getState().set({ state: 'off' });
      return;
    }
    convRef.current = true;
    setConversation(true);
    listenLoop();
  };

  const dictate = async () => {
    if (voice.state === 'listening') return stopListening();
    try {
      const text = await listenOnce((t) => setInput(t));
      if (text) setInput(text);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // Parámetros de entrada: ?send=texto (auto), ?voice=1
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    const auto = params.get('send');
    if (auto && auto !== '1' && sessionId && session) {
      handled.current = true;
      setParams({}, { replace: true });
      send(auto);
    } else if (auto === '1' && params.get('q')) {
      handled.current = true;
      const q = params.get('q')!;
      setParams({}, { replace: true });
      send(q);
    } else if (params.get('voice') === '1' && sttOk) {
      handled.current = true;
      setParams({}, { replace: true });
      toggleConversation();
    }
  }, [params, sessionId, session, sttOk]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al salir de la página se corta la voz
  useEffect(
    () => () => {
      convRef.current = false;
      abortRef.current?.abort();
      stopSpeaking();
      stopListening();
    },
    [],
  );

  const sessionDocs = useMemo(() => docs.filter((d) => d.status !== 'error' && d.status !== 'processing'), [docs]);
  const mode = session?.mode ?? 'patient';
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && !m.error);

  const newSession = async () => {
    stopSpeaking();
    const ns: TutorSession = { id: newId(), subjectId: session?.subjectId, title: 'Nueva clase', mode: session?.mode ?? 'patient', level: session?.level ?? 3, createdAt: Date.now(), updatedAt: Date.now() };
    await db.tutorSessions.add(ns);
    nav(`/tutor/${ns.id}`);
  };

  const toTask = () => {
    const convo = messages.slice(-10).map((m) => `${m.role === 'user' ? 'Estudiante' : 'Profesor'}: ${m.content}`).join('\n');
    sessionStorage.setItem('studyos:taskContext', convo);
    nav(`/tasks?new=1&from=tutor${session?.subjectId ? `&subject=${session.subjectId}` : ''}`);
  };

  const toBoard = () => {
    const last = [...messages].reverse().find((m) => m.role === 'user');
    nav(`/board?problem=${encodeURIComponent(last?.content ?? input)}`);
  };

  const Sessions = (
    <div className="space-y-1">
      <Button variant="primary" size="sm" className="w-full mb-2" icon={<Plus className="size-4" />} onClick={newSession}>
        Nueva clase
      </Button>
      {sessions.map((x) => (
        <div key={x.id} className={cx('group flex items-center gap-1 rounded-xl pr-1', x.id === sessionId ? 'nav-active' : 'hover:bg-white/5')}>
          <button
            onClick={() => {
              setShowSessions(false);
              nav(`/tutor/${x.id}`);
            }}
            className="flex-1 min-w-0 text-left px-3 py-2"
          >
            <div className="text-[13px] truncate">{x.title}</div>
            <div className="text-[11px] text-muted">
              {TUTOR_MODES[x.mode].label} · {timeAgo(x.updatedAt)}
            </div>
          </button>
          <IconButton
            label="Eliminar clase"
            className="opacity-60 group-hover:opacity-100"
            onClick={async () => {
              if (!confirm('¿Eliminar esta clase?')) return;
              await db.tutorMessages.where('sessionId').equals(x.id).delete();
              await db.tutorSessions.delete(x.id);
              if (x.id === sessionId) nav('/tutor');
            }}
          >
            <Trash className="size-3.5" />
          </IconButton>
        </div>
      ))}
    </div>
  );

  return (
    <div className="grid gap-3.5 xl:grid-cols-[230px_minmax(0,1fr)_360px] lg:grid-cols-[minmax(0,1fr)_340px] h-[calc(100dvh-var(--safe-top)-var(--safe-bottom)-146px)] lg:h-[calc(100dvh-100px)] min-h-[440px] lg:min-h-[520px]">
      <aside className="hidden xl:block panel p-3 overflow-y-auto scroll-thin">{Sessions}</aside>

      {/* Chat */}
      <section className="panel flex flex-col min-h-0 overflow-hidden">
        {!desktop && (
          <MobileStage
            compact={typing || stageMin}
            onToggle={() => setStageMin((v) => !v)}
            title={session?.title ?? 'Profesor IA'}
            detail={`${TUTOR_MODES[mode].label} · nivel ${session?.level ?? 3}/5${docIds.length ? ` · ${docIds.length} doc.` : ''}`}
            board={(lastAssistant?.content ?? '').replace(/[#*$`>|]/g, '').slice(0, 220)}
            conversation={conversation}
            canTalk={ai && sttOk !== false}
            onTalk={toggleConversation}
            onSessions={() => setShowSessions(true)}
            onSettings={() => setShowSettings(true)}
          />
        )}
        <header className="hidden lg:flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-line">
          <div className="min-w-0">
            <h1 className="font-display font-semibold truncate">{session?.title ?? 'Profesor IA'}</h1>
            <div className="text-[11px] text-muted">
              {TUTOR_MODES[mode].label} · complejidad {session?.level ?? 3}/5 · {docIds.length ? `${docIds.length} documento(s) como material` : 'sin material asociado'}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="xl:hidden" icon={<MessageSquarePlus className="size-4" />} onClick={() => setShowSessions(true)}>
              Clases
            </Button>
            <IconButton label="Ajustes de la clase" onClick={() => setShowSettings(true)}>
              <Settings2 className="size-4" />
            </IconButton>
          </div>
        </header>

        <div ref={listRef} className="flex-1 overflow-y-auto scroll-thin px-3 sm:px-4 py-3 sm:py-4 space-y-4">
          {!desktop && voice.error && (voice.state === 'denied' || voice.state === 'error' || voice.state === 'unsupported') && <Notice tone="bad">{voice.error}</Notice>}
          {!ai && (
            <Notice tone="warn" title="El profesor necesita un proveedor de IA">
              Configurá Gemini (gratis), Claude, OpenAI o Ollama en <button className="underline" onClick={() => nav('/settings#ia')}>Configuración</button>. Sin IA podés usar la pizarra, el laboratorio y tus tareas guardadas.
            </Notice>
          )}
          {messages.length === 0 && !streaming && (
            <div className="text-center py-4 lg:py-10">
              <GraduationCap className="hidden lg:block size-8 mx-auto text-[#8ea2ff]" />
              <h2 className="font-display font-semibold lg:mt-3">¿Qué querés aprender hoy?</h2>
              <p className="text-[13px] lg:text-sm text-muted mt-1">Preguntá, pedí ejemplos o resolvé ejercicios acompañado. Podés interrumpir en cualquier momento.</p>
              <div className="flex flex-col lg:flex-row lg:flex-wrap justify-center gap-2 mt-4">
                {['Explicame la separación magnética con un ejemplo de reciclaje', '¿Cómo se resuelve una ecuación cuadrática?', 'Ayudame a entender la fotosíntesis'].map((q) => (
                  <button key={q} onClick={() => send(q)} disabled={!ai} className="text-[13px] lg:text-xs text-left lg:text-center rounded-2xl lg:rounded-full border border-line-strong px-3.5 py-2.5 lg:px-3 lg:py-1.5 hover:bg-white/5 disabled:opacity-40">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={cx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              {m.role === 'user' ? (
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-primary/90 to-violet/80 px-4 py-2.5 text-sm text-white whitespace-pre-wrap">{m.content}</div>
              ) : m.error ? (
                <div className="max-w-[90%] rounded-2xl border border-bad/30 bg-bad/10 px-4 py-2.5 text-sm text-[#ffc9c9]">{m.error}</div>
              ) : (
                <div className="max-w-[92%] group">
                  <div className="rounded-2xl rounded-bl-md bg-[#141d42] border border-line px-4 py-3">
                    <Markdown onCite={session?.docId ? (p) => nav(`/library/${session.docId}?page=${p}`) : undefined}>{m.content}</Markdown>
                    {m.interrupted && <div className="text-[11px] text-warn mt-1">Interrumpido</div>}
                  </div>
                  <div className="flex gap-1 mt-1 opacity-70 group-hover:opacity-100">
                    {ttsAvailable() && (
                      <IconButton label="Escuchar" onClick={() => speak(m.content)}>
                        <Volume2 className="size-3.5" />
                      </IconButton>
                    )}
                    <IconButton
                      label="Copiar"
                      onClick={() => {
                        navigator.clipboard?.writeText(m.content);
                        toast.ok('Copiado');
                      }}
                    >
                      <Copy className="size-3.5" />
                    </IconButton>
                  </div>
                </div>
              )}
            </div>
          ))}
          {streaming && (
            <div className="flex justify-start">
              <div className="max-w-[92%] rounded-2xl rounded-bl-md bg-[#141d42] border border-line px-4 py-3">
                {streaming.text ? <Markdown>{streaming.text}</Markdown> : <span className="text-sm text-muted">El profesor está pensando…</span>}
              </div>
            </div>
          )}
          {error && <p className="text-xs text-bad">{error}</p>}
        </div>

        {lastAssistant && !streaming && (
          <div className="flex gap-1.5 overflow-x-auto scroll-thin px-3 pb-2">
            {QUICK.map((q) => (
              <button key={q.label} onClick={() => send(q.prompt)} disabled={!ai} className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-line-strong text-xs text-[#cdd5f0] hover:bg-white/5 disabled:opacity-40">
                <q.icon className="size-3.5" /> {q.label}
              </button>
            ))}
            <button onClick={toBoard} className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-primary/40 text-xs text-[#c3cdff] hover:bg-primary/10">
              <PenTool className="size-3.5" /> Llevar a la pizarra
            </button>
            <button onClick={toTask} className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-full border border-violet/40 text-xs text-[#d6c8ff] hover:bg-violet/10">
              <ClipboardList className="size-3.5" /> Crear tarea de esto
            </button>
          </div>
        )}

        <form
          className="flex items-end gap-1.5 sm:gap-2 p-2.5 sm:p-3 border-t border-line"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <label className="flex-1 min-w-0">
            <span className="sr-only">Mensaje</span>
            <textarea
              value={voice.state === 'listening' ? voice.interim || input : input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              onFocus={() => setTyping(true)}
              onBlur={() => setTyping(false)}
              placeholder={voice.state === 'listening' ? 'Escuchando…' : desktop ? 'Escribí tu pregunta o usá el micrófono…' : 'Escribí tu pregunta…'}
              className="block w-full resize-none max-h-40 h-11 rounded-xl bg-[#0a102a] border border-line-strong px-3.5 py-[11px] text-[15px] lg:text-sm leading-5 outline-none focus:border-primary/70"
            />
          </label>
          {sttOk !== false ? (
            <IconButton label={voice.state === 'listening' ? 'Dejar de escuchar' : 'Dictar por voz'} onClick={dictate} active={voice.state === 'listening'} className="size-11">
              {voice.state === 'listening' ? <MicOff className="size-5 text-bad" /> : <Mic className="size-5" />}
            </IconButton>
          ) : (
            <span className="text-[10px] text-faint max-w-20 leading-tight">Sin dictado en este navegador</span>
          )}
          {streaming || voice.state === 'speaking' ? (
            <Button type="button" variant="danger" onClick={interrupt} icon={<Square className="size-4" />} className="h-11">
              Detener
            </Button>
          ) : (
            <button type="submit" aria-label="Enviar" disabled={!ai || !input.trim()} className="grid place-items-center size-11 rounded-full bg-gradient-to-br from-[#4d6bff] to-[#3a4fe0] text-white disabled:opacity-40">
              <ArrowRight className="size-[18px]" />
            </button>
          )}
        </form>
      </section>

      {/* Escenario del profesor */}
      <aside className="hidden lg:flex flex-col gap-3 relative overflow-hidden rounded-[18px] border border-line-strong bg-[linear-gradient(180deg,#121a44_0%,#0d1334_55%,#0b1029_100%)] p-3.5">
        <div className="flex items-center justify-between relative z-10">
          <h2 className="font-display font-semibold text-lg">Profesor IA</h2>
          <VoiceIndicator />
        </div>
        <div className="relative flex-1 min-h-[260px] -mx-3.5">
          <div className="holo absolute left-3 top-3 w-[58%] h-[70%] rounded-md p-3 overflow-hidden [transform:perspective(600px)_rotateY(12deg)] origin-left">
            <div className="text-[10px] uppercase tracking-widest text-cyan/80 mb-1">Pizarra</div>
            <div className="text-[11px] text-[#cfeaff] leading-snug line-clamp-[12]">{voice.subtitle || (lastAssistant?.content ?? 'Las ideas clave de la explicación aparecen acá.').replace(/[#*$`>|]/g, '').slice(0, 360)}</div>
          </div>
          {desktop && (s.avatar.show ? <AvatarView character={s.avatar.character} framing="half" facing={-0.35} className="absolute inset-y-0 right-0 w-[80%]" /> : <img src="./teacher-seed.png" alt="Profesora virtual" className="absolute right-0 bottom-0 h-full object-contain" />)}
          <AnimatePresence>
            {s.voice.subtitles && voice.subtitle && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="absolute inset-x-3 bottom-2 rounded-xl bg-black/65 px-3 py-2 text-center text-[13px] leading-snug" aria-live="polite">
                {voice.subtitle}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {voice.error && (voice.state === 'denied' || voice.state === 'error' || voice.state === 'unsupported') && <Notice tone="bad">{voice.error}</Notice>}
        <div className="grid grid-cols-2 gap-2 relative z-10">
          <Button variant={conversation ? 'danger' : 'primary'} icon={conversation ? <MicOff className="size-4" /> : <Headphones className="size-4" />} onClick={toggleConversation} disabled={!ai || sttOk === false} className="col-span-2">
            {conversation ? 'Terminar conversación por voz' : 'Conversar por voz'}
          </Button>
          <Button variant="secondary" size="sm" icon={<Volume2 className="size-4" />} disabled={!lastAssistant || !ttsAvailable()} onClick={() => lastAssistant && speak(lastAssistant.content)}>
            Leer respuesta
          </Button>
          <Button variant="secondary" size="sm" icon={<Square className="size-4" />} disabled={voice.state !== 'speaking'} onClick={stopSpeaking}>
            Callar
          </Button>
        </div>
        {sttOk === false && <p className="text-[11px] text-faint">Este navegador no tiene reconocimiento de voz: podés escribir y escuchar las respuestas. En la app de Android se usa el reconocimiento del sistema.</p>}
        <label className="flex items-center justify-between text-xs text-muted relative z-10">
          Leer respuestas automáticamente
          <input type="checkbox" checked={s.voice.autoSpeak} onChange={(e) => update((x) => void (x.voice.autoSpeak = e.target.checked))} className="accent-primary size-4" />
        </label>
      </aside>

      <Modal open={showSessions} onClose={() => setShowSessions(false)} title="Clases">
        {Sessions}
      </Modal>

      <Modal open={showSettings} onClose={() => setShowSettings(false)} title="Ajustes de la clase" footer={<Button variant="primary" onClick={() => setShowSettings(false)}>Listo</Button>}>
        <div className="space-y-4">
          {!session && <Notice>Los ajustes se aplican cuando empezás la clase (escribí tu primer mensaje).</Notice>}
          <div>
            <div className="text-xs text-muted mb-2">Modo de enseñanza</div>
            <div className="grid sm:grid-cols-2 gap-2">
              {(Object.keys(TUTOR_MODES) as TutorMode[]).map((m) => (
                <button key={m} disabled={!session} onClick={() => updateSession({ mode: m })} className={cx('rounded-xl border p-3 text-left', mode === m ? 'nav-active' : 'border-line hover:border-line-strong')}>
                  <div className="text-sm font-medium">{TUTOR_MODES[m].label}</div>
                  <div className="text-[11px] text-muted">{TUTOR_MODES[m].desc}</div>
                </button>
              ))}
            </div>
          </div>
          {mode === 'language' && (
            <label className="block">
              <span className="text-xs text-muted">Idioma a practicar</span>
              <Select
                value={session?.targetLanguage ?? 'Inglés'}
                onChange={(e) => {
                  updateSession({ targetLanguage: e.target.value });
                  const code = LANGS.find((l) => l.label === e.target.value)?.code;
                  if (code) update((x) => void (x.voice.lang = code));
                }}
                className="mt-1.5"
              >
                {LANGS.map((l) => (
                  <option key={l.code}>{l.label}</option>
                ))}
              </Select>
              <span className="text-[11px] text-faint">El dictado y la voz cambian a ese idioma. Volvé a español en Configuración → Voz.</span>
            </label>
          )}
          <Slider label="Nivel de complejidad" value={session?.level ?? 3} min={1} max={5} onChange={(v) => updateSession({ level: v })} format={(v) => ['', 'Muy simple', 'Simple', 'Intermedio', 'Avanzado', 'Experto'][v]} />
          <label className="block">
            <span className="text-xs text-muted">Materia</span>
            <Select value={session?.subjectId ?? ''} onChange={(e) => updateSession({ subjectId: e.target.value || undefined })} className="mt-1.5" disabled={!session}>
              <option value="">Sin materia</option>
              {subjects.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </label>
          <div>
            <div className="text-xs text-muted mb-1.5">Material que usa el profesor (búsqueda en tus documentos)</div>
            <div className="max-h-48 overflow-y-auto scroll-thin space-y-1">
              {sessionDocs.length === 0 && <p className="text-sm text-muted">No hay documentos importados.</p>}
              {sessionDocs.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="accent-primary size-4" checked={docIds.includes(d.id)} onChange={(e) => setDocIds((v) => (e.target.checked ? [...v, d.id] : v.filter((x) => x !== d.id)))} />
                  <FileText className="size-3.5 text-faint" />
                  <span className="truncate">{d.title}</span>
                </label>
              ))}
            </div>
          </div>
          <Toggle label="Subtítulos" checked={s.voice.subtitles} onChange={(v) => update((x) => void (x.voice.subtitles = v))} />
          <Toggle label="Leer respuestas automáticamente" checked={s.voice.autoSpeak} onChange={(v) => update((x) => void (x.voice.autoSpeak = v))} />
          {sttOk === false && <p className="text-[11px] text-faint">Este navegador no tiene reconocimiento de voz: podés escribir y escuchar las respuestas. En la app de Android se usa el reconocimiento del sistema.</p>}
          <div className="flex items-center gap-2 text-xs text-muted">
            Estado de voz: <Badge>{VOICE_STATE_LABEL[voice.state]}</Badge>
          </div>
        </div>
      </Modal>
    </div>
  );
}
