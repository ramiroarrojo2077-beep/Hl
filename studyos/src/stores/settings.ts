import { create } from 'zustand';
import { db } from '@/lib/db';
import type { ProviderId } from '@/ai/types';

export type Character = 'seed' | 'twist' | 'robot';
export type AmbientSound = 'none' | 'white' | 'pink' | 'brown' | 'rain';

export interface AppSettings {
  onboarded: boolean;
  profile: { name: string; level: string; dialect: 'rioplatense' | 'neutro' };
  ai: {
    provider: ProviderId | 'none';
    keys: Partial<Record<ProviderId, string>>;
    models: Partial<Record<ProviderId, string>>;
    openaiBaseUrl: string;
    ollamaUrl: string;
    effort: 'low' | 'medium' | 'high';
    contextChars: number;
    embeddings: boolean;
    reviewer: boolean;
    visionOcr: boolean;
  };
  voice: {
    engine: 'device' | 'openai';
    voiceURI?: string;
    openaiVoice: string;
    rate: number;
    pitch: number;
    autoSpeak: boolean;
    subtitles: boolean;
    lang: string;
  };
  avatar: { character: Character; background: 'classroom' | 'lab' | 'space' | 'plain'; outfit: string; show: boolean };
  focus: { work: number; short: number; long: number; every: number; sound: AmbientSound; volume: number };
  ui: { reduceMotion: boolean };
  security: { pinHash?: string; pinSalt?: string };
}

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-5-mini',
  // alias de Google que siempre apunta al Flash estable más nuevo
  gemini: 'gemini-flash-latest',
  ollama: 'llama3.2',
};

const RETIRED_DEFAULTS = { gemini: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'] };

export const DEFAULT_SETTINGS: AppSettings = {
  onboarded: false,
  profile: { name: '', level: 'Secundario', dialect: 'rioplatense' },
  ai: {
    provider: 'none',
    keys: {},
    models: { ...DEFAULT_MODELS },
    openaiBaseUrl: 'https://api.openai.com/v1',
    ollamaUrl: 'http://192.168.0.10:11434',
    effort: 'medium',
    contextChars: 60000,
    embeddings: false,
    reviewer: true,
    visionOcr: false,
  },
  voice: { engine: 'device', openaiVoice: 'alloy', rate: 1, pitch: 1, autoSpeak: false, subtitles: true, lang: 'es-AR' },
  avatar: { character: 'seed', background: 'classroom', outfit: '#5271FF', show: true },
  focus: { work: 25, short: 5, long: 15, every: 4, sound: 'none', volume: 0.4 },
  ui: { reduceMotion: false },
  security: {},
};

function merge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return (over ?? base) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) ? merge(b, v) : v;
  }
  return out as T;
}

interface SettingsState {
  loaded: boolean;
  s: AppSettings;
  load: () => Promise<void>;
  update: (fn: (s: AppSettings) => AppSettings | void) => Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  loaded: false,
  s: DEFAULT_SETTINGS,
  load: async () => {
    const row = await db.settings.get('app');
    const s = merge(DEFAULT_SETTINGS, row?.value);
    // Modelos que fueron predeterminados en versiones anteriores y ya se retiraron
    if (RETIRED_DEFAULTS.gemini.includes(s.ai.models.gemini ?? '')) s.ai.models.gemini = DEFAULT_MODELS.gemini;
    set({ s, loaded: true });
  },
  update: async (fn) => {
    const draft = structuredClone(get().s);
    const next = fn(draft) ?? draft;
    set({ s: next });
    await db.settings.put({ key: 'app', value: next });
  },
}));

export function getSettings() {
  return useSettings.getState().s;
}

export function aiConfigured(s: AppSettings = getSettings()): boolean {
  const p = s.ai.provider;
  if (p === 'none') return false;
  if (p === 'ollama') return !!s.ai.ollamaUrl;
  return !!s.ai.keys[p];
}
