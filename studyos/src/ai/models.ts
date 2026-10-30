import type { ProviderId } from './types';

// Preferencias para elegir un modelo disponible cuando el configurado no existe
// (los proveedores retiran modelos cada pocos meses).
const SKIP = /(embed|embedding|tts|audio|realtime|transcribe|image|vision-preview|live|search|moderation|guard|whisper|dall-e|computer|robotics|learnlm|gemma|aqa|instruct$)/i;

function versionScore(id: string) {
  const m = id.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

/** Elige el mejor modelo de texto de una lista según el proveedor. */
export function pickModel(id: ProviderId, list: string[]): string | null {
  const ok = list.filter((m) => !SKIP.test(m));
  if (!ok.length) return list[0] ?? null;
  const best = (xs: string[]) => [...xs].sort((a, b) => versionScore(b) - versionScore(a) || a.length - b.length)[0];
  if (id === 'gemini') {
    if (ok.includes('gemini-flash-latest')) return 'gemini-flash-latest';
    const stable = ok.filter((m) => /^gemini-\d/.test(m) && /flash/.test(m) && !/(lite|preview|exp|thinking|8b)/.test(m));
    return best(stable.length ? stable : ok.filter((m) => /flash/.test(m)).length ? ok.filter((m) => /flash/.test(m)) : ok);
  }
  if (id === 'openai') {
    const mini = ok.filter((m) => /^gpt-\d(\.\d+)?-mini$/.test(m));
    if (mini.length) return best(mini);
    const gpt = ok.filter((m) => /^gpt-/.test(m) && !/(nano|pro|codex|oss)/.test(m));
    return gpt.length ? best(gpt) : ok[0];
  }
  if (id === 'anthropic') {
    const tiers = ['sonnet', 'opus', 'haiku'];
    for (const t of tiers) {
      const xs = ok.filter((m) => m.includes(t));
      if (xs.length) return best(xs);
    }
    return ok[0];
  }
  return ok[0];
}

