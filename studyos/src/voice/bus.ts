import { create } from 'zustand';

// Estado compartido de voz: lo usan el chat, el avatar (sincronización labial)
// y los indicadores de estado.

export type VoiceState = 'idle' | 'listening' | 'processing' | 'speaking' | 'off' | 'denied' | 'unsupported' | 'error';

export const VOICE_STATE_LABEL: Record<VoiceState, string> = {
  idle: 'Listo',
  listening: 'Escuchando…',
  processing: 'Procesando…',
  speaking: 'Respondiendo…',
  off: 'Micrófono desactivado',
  denied: 'Permiso de micrófono denegado',
  unsupported: 'Reconocimiento de voz no disponible',
  error: 'Error de voz',
};

interface Utterance {
  text: string;
  startedAt: number;
  /** caracteres por segundo estimados (se recalibra con eventos de límite de palabra) */
  cps: number;
  charIndex: number;
  charAt: number;
}

interface VoiceBus {
  state: VoiceState;
  error?: string;
  subtitle: string;
  interim: string;
  utterance: Utterance | null;
  /** nivel de audio 0..1 cuando la voz viene de un archivo de audio (TTS en la nube) */
  level: number | null;
  set: (p: Partial<Omit<VoiceBus, 'set'>>) => void;
}

export const useVoice = create<VoiceBus>((set) => ({
  state: 'idle',
  subtitle: '',
  interim: '',
  utterance: null,
  level: null,
  set: (p) => set(p),
}));

export const voiceBus = {
  get: () => useVoice.getState(),
  set: (p: Partial<Omit<VoiceBus, 'set'>>) => useVoice.getState().set(p),
};

/** Posición estimada (índice de carácter) de lo que se está diciendo ahora. */
export function currentCharIndex(now = performance.now()): number {
  const u = useVoice.getState().utterance;
  if (!u) return -1;
  return Math.min(u.text.length - 1, u.charIndex + ((now - u.charAt) / 1000) * u.cps);
}
