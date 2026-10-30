import { isNative } from '@/lib/platform';
import { getSettings } from '@/stores/settings';
import { openaiSpeech } from '@/ai/providers/openai';
import { splitSentences, toSpeakable } from './speakable';
import { voiceBus } from './bus';

// Texto a voz. Motores:
//  - device: voz del sistema (Web Speech API en el navegador, motor TTS de
//    Android vía plugin nativo en el APK). Gratis y sin conexión.
//  - openai: voz en la nube de OpenAI (requiere clave); permite sincronización
//    labial por volumen real del audio y exportar la narración en videos.
// Se habla oración por oración para poder interrumpir y mostrar subtítulos.

let speakToken = 0;
let currentAudio: HTMLAudioElement | null = null;
let audioCtx: AudioContext | null = null;

export function ttsAvailable(): boolean {
  return isNative || (typeof window !== 'undefined' && 'speechSynthesis' in window);
}

export async function listVoices(): Promise<{ id: string; name: string; lang: string }[]> {
  if (isNative) {
    const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
    const { voices } = await TextToSpeech.getSupportedVoices();
    return voices.map((v, i) => ({ id: String(i), name: v.name, lang: v.lang }));
  }
  if (!('speechSynthesis' in window)) return [];
  const get = () => speechSynthesis.getVoices();
  let v = get();
  if (!v.length) {
    await new Promise((r) => {
      speechSynthesis.onvoiceschanged = () => r(null);
      setTimeout(r, 1200);
    });
    v = get();
  }
  return v.map((x) => ({ id: x.voiceURI, name: x.name, lang: x.lang }));
}

export function stopSpeaking() {
  speakToken++;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (isNative) {
    import('@capacitor-community/text-to-speech').then(({ TextToSpeech }) => TextToSpeech.stop()).catch(() => {});
  } else if ('speechSynthesis' in window) {
    speechSynthesis.cancel();
  }
  voiceBus.set({ utterance: null, subtitle: '', level: null, state: voiceBus.get().state === 'speaking' ? 'idle' : voiceBus.get().state });
}

export interface SpeakOptions {
  onSentence?: (s: string, i: number) => void;
  rate?: number;
}

/** Habla un texto (Markdown permitido). Resuelve al terminar o al ser interrumpido. */
export async function speak(markdown: string, opts: SpeakOptions = {}): Promise<boolean> {
  stopSpeaking();
  const token = ++speakToken;
  const s = getSettings();
  const text = toSpeakable(markdown);
  if (!text) return true;
  const sentences = splitSentences(text);
  voiceBus.set({ state: 'speaking' });
  try {
    for (let i = 0; i < sentences.length; i++) {
      if (token !== speakToken) return false;
      const sentence = sentences[i];
      opts.onSentence?.(sentence, i);
      voiceBus.set({ subtitle: sentence, utterance: { text: sentence, startedAt: performance.now(), cps: 14 * (opts.rate ?? s.voice.rate), charIndex: 0, charAt: performance.now() } });
      if (s.voice.engine === 'openai' && s.ai.keys.openai) await speakCloud(sentence, token);
      else if (isNative) await speakNative(sentence, opts.rate ?? s.voice.rate);
      else await speakWeb(sentence, opts.rate ?? s.voice.rate, token);
    }
    return token === speakToken;
  } catch (e) {
    voiceBus.set({ state: 'error', error: `No se pudo reproducir la voz: ${(e as Error).message}` });
    return false;
  } finally {
    if (token === speakToken) voiceBus.set({ state: 'idle', utterance: null, subtitle: '', level: null });
  }
}

function speakWeb(text: string, rate: number, token: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!('speechSynthesis' in window)) return reject(new Error('Este navegador no tiene síntesis de voz'));
    const s = getSettings();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = s.voice.lang;
    u.rate = rate;
    u.pitch = s.voice.pitch;
    const voice = speechSynthesis.getVoices().find((v) => v.voiceURI === s.voice.voiceURI);
    if (voice) u.voice = voice;
    const started = performance.now();
    u.onboundary = (ev) => {
      const cur = voiceBus.get().utterance;
      if (!cur || token !== speakToken) return;
      const now = performance.now();
      const cps = ev.charIndex > 3 ? ev.charIndex / ((now - started) / 1000) : cur.cps;
      voiceBus.set({ utterance: { ...cur, charIndex: ev.charIndex, charAt: now, cps: Math.min(30, Math.max(6, cps)) } });
    };
    u.onend = () => resolve();
    u.onerror = (ev) => (ev.error === 'interrupted' || ev.error === 'canceled' ? resolve() : reject(new Error(ev.error)));
    speechSynthesis.speak(u);
  });
}

async function speakNative(text: string, rate: number) {
  const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
  const s = getSettings();
  const started = performance.now();
  const handle = await TextToSpeech.addListener('onRangeStart', (info) => {
    const cur = voiceBus.get().utterance;
    if (!cur) return;
    const now = performance.now();
    const cps = info.start > 3 ? info.start / ((now - started) / 1000) : cur.cps;
    voiceBus.set({ utterance: { ...cur, charIndex: info.start, charAt: now, cps: Math.min(30, Math.max(6, cps)) } });
  });
  try {
    await TextToSpeech.speak({ text, lang: s.voice.lang, rate, pitch: s.voice.pitch, volume: 1, voice: s.voice.voiceURI && /^\d+$/.test(s.voice.voiceURI) ? Number(s.voice.voiceURI) : undefined });
  } finally {
    await handle.remove();
  }
}

async function speakCloud(text: string, token: number) {
  const s = getSettings();
  const blob = await openaiSpeech(text, s.voice.openaiVoice, { apiKey: s.ai.keys.openai!, baseUrl: s.ai.openaiBaseUrl });
  if (token !== speakToken) return;
  await playBlobWithLevel(blob, token);
}

/** Reproduce audio midiendo el volumen para mover la boca del avatar. */
export async function playBlobWithLevel(blob: Blob, token = speakToken): Promise<void> {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  currentAudio = audio;
  audioCtx ??= new AudioContext();
  const src = audioCtx.createMediaElementSource(audio);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  analyser.connect(audioCtx.destination);
  const buf = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  const tick = () => {
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += ((v - 128) / 128) ** 2;
    voiceBus.set({ level: Math.min(1, Math.sqrt(sum / buf.length) * 4) });
    raf = requestAnimationFrame(tick);
  };
  await audioCtx.resume();
  await new Promise<void>((resolve, reject) => {
    audio.onended = () => resolve();
    audio.onerror = () => reject(new Error('No se pudo reproducir el audio'));
    audio.onpause = () => resolve();
    audio.play().then(tick, reject);
  }).finally(() => {
    cancelAnimationFrame(raf);
    URL.revokeObjectURL(url);
    if (token === speakToken) voiceBus.set({ level: null });
  });
}
