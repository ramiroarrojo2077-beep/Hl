import type { z } from 'zod';
import { getSettings, aiConfigured, type AppSettings } from '@/stores/settings';
import { anthropicProvider } from './providers/anthropic';
import { openaiProvider } from './providers/openai';
import { geminiProvider } from './providers/gemini';
import { ollamaProvider } from './providers/ollama';
import { extractJson } from './json';
import { AiError, type GenRequest, type GenResult, type ProviderConfig, type ProviderId, type ProviderImpl } from './types';

const PROVIDERS: Record<ProviderId, ProviderImpl> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
  ollama: ollamaProvider,
};

export function providerConfig(id: ProviderId, s: AppSettings = getSettings()): ProviderConfig {
  return {
    apiKey: s.ai.keys[id],
    model: s.ai.models[id] || '',
    baseUrl: id === 'openai' ? s.ai.openaiBaseUrl : id === 'ollama' ? s.ai.ollamaUrl : undefined,
    effort: s.ai.effort,
  };
}

export function activeProvider(): { id: ProviderId; impl: ProviderImpl; cfg: ProviderConfig } {
  const s = getSettings();
  if (!aiConfigured(s) || s.ai.provider === 'none') {
    throw new AiError('no_provider', 'Configurá un proveedor de IA en Configuración → Inteligencia artificial para usar esta función.');
  }
  const id = s.ai.provider;
  return { id, impl: PROVIDERS[id], cfg: providerConfig(id, s) };
}

export function getProviderImpl(id: ProviderId) {
  return PROVIDERS[id];
}

export async function generate(req: GenRequest): Promise<GenResult> {
  const { impl, cfg } = activeProvider();
  if (!cfg.model) throw new AiError('no_provider', 'Elegí un modelo en Configuración.');
  return impl.generate(req, cfg);
}

/**
 * Pide una respuesta JSON y la valida con zod. Si no valida, hace un intento de
 * reparación mostrando el error al modelo. Nunca completa datos faltantes por su cuenta.
 */
export async function generateJson<T>(schema: z.ZodType<T>, req: Omit<GenRequest, 'json' | 'onText'>, opts: { retries?: number } = {}): Promise<{ data: T; meta: GenResult }> {
  const system = `${req.system ?? ''}\n\nFORMATO: respondé únicamente con un objeto JSON válido, sin texto antes ni después y sin bloques de código.`.trim();
  let messages = req.messages;
  let lastErr = '';
  const retries = opts.retries ?? 1;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await generate({ ...req, system, messages, json: true });
    let parsed: unknown;
    try {
      parsed = extractJson(res.text);
    } catch (e) {
      lastErr = (e as Error).message;
      messages = [...req.messages, { role: 'assistant', content: res.text.slice(0, 4000) || '(vacío)' }, { role: 'user', content: `Tu respuesta no era JSON válido (${lastErr}). Devolvé SOLO el JSON completo y válido.` }];
      continue;
    }
    const v = schema.safeParse(parsed);
    if (v.success) return { data: v.data, meta: res };
    lastErr = v.error.issues.slice(0, 6).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    messages = [...req.messages, { role: 'assistant', content: JSON.stringify(parsed).slice(0, 6000) }, { role: 'user', content: `El JSON no cumple el esquema pedido: ${lastErr}. Corregilo y devolvé SOLO el JSON completo.` }];
  }
  throw new AiError('bad_output', 'La IA devolvió un formato inválido. Probá de nuevo o con otro modelo.', lastErr);
}

export async function embedTexts(texts: string[], signal?: AbortSignal): Promise<{ vectors: number[][]; model: string } | null> {
  const s = getSettings();
  if (!s.ai.embeddings || !aiConfigured(s) || s.ai.provider === 'none') return null;
  const impl = PROVIDERS[s.ai.provider];
  if (!impl.embed || !impl.embeddingModel) return null;
  const cfg = providerConfig(s.ai.provider, s);
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    out.push(...(await impl.embed(texts.slice(i, i + 64), cfg, signal)));
  }
  return { vectors: out, model: `${s.ai.provider}:${impl.embeddingModel}` };
}

export function currentEmbeddingModel(): string | null {
  const s = getSettings();
  if (!s.ai.embeddings || s.ai.provider === 'none') return null;
  const impl = PROVIDERS[s.ai.provider];
  return impl.embeddingModel ? `${s.ai.provider}:${impl.embeddingModel}` : null;
}

export { extractJson };
