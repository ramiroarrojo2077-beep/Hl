import { isNative } from '@/lib/platform';
import { getSettings } from '@/stores/settings';
import { voiceBus } from './bus';

// Reconocimiento de voz: Web Speech API en navegadores compatibles (Chrome,
// Edge, Safari) y reconocimiento nativo de Android en el APK (el WebView de
// Android no incluye la Web Speech API). Siempre informa estados reales.

type WebRec = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
};

function webCtor(): (new () => WebRec) | null {
  const w = window as unknown as { SpeechRecognition?: new () => WebRec; webkitSpeechRecognition?: new () => WebRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export async function sttSupported(): Promise<boolean> {
  if (isNative) {
    try {
      const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
      return (await SpeechRecognition.available()).available;
    } catch {
      return false;
    }
  }
  return !!webCtor();
}

let active: { stop: () => void } | null = null;

export function stopListening() {
  active?.stop();
  active = null;
}

/**
 * Escucha una frase. Resuelve con el texto reconocido ('' si no se entendió).
 * Lanza un error con mensaje claro si no hay permiso o soporte.
 */
export async function listenOnce(onInterim?: (t: string) => void): Promise<string> {
  stopListening();
  const lang = getSettings().voice.lang;
  if (isNative) return listenNative(lang, onInterim);
  const Ctor = webCtor();
  if (!Ctor) {
    voiceBus.set({ state: 'unsupported', error: 'Tu navegador no permite dictado por voz. Probá con Chrome o con la app de Android, o escribí tu mensaje.' });
    throw new Error(voiceBus.get().error);
  }
  return new Promise<string>((resolve, reject) => {
    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';
    let failed = false;
    rec.onstart = () => voiceBus.set({ state: 'listening', interim: '', error: undefined });
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      voiceBus.set({ interim: finalText + interim });
      onInterim?.(finalText + interim);
    };
    rec.onerror = (e) => {
      failed = true;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        voiceBus.set({ state: 'denied', error: 'StudyOS no tiene permiso para usar el micrófono. Habilitalo en la configuración del navegador (ícono del candado) y volvé a intentar.' });
        reject(new Error(voiceBus.get().error));
      } else if (e.error === 'no-speech' || e.error === 'aborted') {
        voiceBus.set({ state: 'idle' });
        resolve('');
      } else if (e.error === 'audio-capture') {
        voiceBus.set({ state: 'error', error: 'No se encontró un micrófono disponible.' });
        reject(new Error(voiceBus.get().error));
      } else if (e.error === 'network') {
        voiceBus.set({ state: 'error', error: 'El reconocimiento de voz del navegador necesita conexión a internet.' });
        reject(new Error(voiceBus.get().error));
      } else {
        voiceBus.set({ state: 'error', error: `Error de reconocimiento de voz: ${e.error}` });
        reject(new Error(voiceBus.get().error));
      }
    };
    rec.onend = () => {
      active = null;
      if (!failed) {
        voiceBus.set({ state: 'idle', interim: '' });
        resolve(finalText.trim());
      }
    };
    active = { stop: () => rec.stop() };
    try {
      rec.start();
    } catch (err) {
      reject(err);
    }
  });
}

async function listenNative(lang: string, onInterim?: (t: string) => void): Promise<string> {
  const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
  const { available } = await SpeechRecognition.available();
  if (!available) {
    voiceBus.set({ state: 'unsupported', error: 'Este dispositivo no tiene un servicio de reconocimiento de voz. Instalá o activá "Google" / "Speech Services by Google".' });
    throw new Error(voiceBus.get().error);
  }
  let perm = await SpeechRecognition.checkPermissions();
  if (perm.speechRecognition !== 'granted') perm = await SpeechRecognition.requestPermissions();
  if (perm.speechRecognition !== 'granted') {
    voiceBus.set({ state: 'denied', error: 'StudyOS no tiene permiso para usar el micrófono. Activalo en Ajustes → Apps → StudyOS AI → Permisos → Micrófono.' });
    throw new Error(voiceBus.get().error);
  }
  let last = '';
  await SpeechRecognition.removeAllListeners();
  const done = new Promise<string>((resolve) => {
    SpeechRecognition.addListener('partialResults', (d) => {
      last = d.matches?.[0] ?? last;
      voiceBus.set({ interim: last });
      onInterim?.(last);
    });
    SpeechRecognition.addListener('listeningState', (d) => {
      if (d.status === 'started') voiceBus.set({ state: 'listening', interim: '', error: undefined });
      if (d.status === 'stopped') resolve(last);
    });
  });
  active = { stop: () => void SpeechRecognition.stop() };
  try {
    await SpeechRecognition.start({ language: lang, maxResults: 1, partialResults: true, popup: false });
  } catch (e) {
    voiceBus.set({ state: 'error', error: `No se pudo iniciar el reconocimiento: ${(e as Error).message}` });
    throw e;
  }
  const text = await done;
  active = null;
  await SpeechRecognition.removeAllListeners();
  voiceBus.set({ state: 'idle', interim: '' });
  return text.trim();
}
