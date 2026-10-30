import { readSse } from '../sse';
import { AiError, httpError, type GenRequest, type Msg, type ProviderConfig, type ProviderImpl } from '../types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const EMBED_MODEL = 'gemini-embedding-001';

function toGemini(messages: Msg[]) {
  return messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: typeof m.content === 'string' ? [{ text: m.content }] : m.content.map((p) => (p.type === 'text' ? { text: p.text } : { inline_data: { mime_type: p.mime, data: p.data } })),
  }));
}

function headers(cfg: ProviderConfig) {
  if (!cfg.apiKey) throw new AiError('no_provider', 'Falta la clave de API de Gemini.');
  return { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey };
}

function modelPath(model: string) {
  return model.startsWith('models/') ? model : `models/${model}`;
}

interface GemResp {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}

function textOf(j: GemResp) {
  if (j.promptFeedback?.blockReason) throw new AiError('refusal', 'Gemini bloqueó la solicitud por sus políticas de seguridad. Reformulá la consulta.');
  const c = j.candidates?.[0];
  if (c?.finishReason === 'SAFETY' || c?.finishReason === 'PROHIBITED_CONTENT') throw new AiError('refusal', 'Gemini bloqueó la respuesta por sus políticas de seguridad.');
  return (c?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
}

export const geminiProvider: ProviderImpl = {
  embeddingModel: EMBED_MODEL,
  async generate(req: GenRequest, cfg: ProviderConfig) {
    const body: Record<string, unknown> = {
      contents: toGemini(req.messages),
      generationConfig: { maxOutputTokens: req.maxTokens ?? 32000, ...(req.json ? { responseMimeType: 'application/json' } : {}) },
    };
    if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
    const path = `${BASE}/${modelPath(cfg.model)}:${req.onText ? 'streamGenerateContent?alt=sse' : 'generateContent'}`;
    const res = await fetch(path, { method: 'POST', headers: headers(cfg), body: JSON.stringify(body), signal: req.signal });
    if (!res.ok) throw httpError(res.status, await res.text());
    if (req.onText) {
      let full = '';
      let err: unknown;
      await readSse(
        res,
        (data) => {
          try {
            const d = textOf(JSON.parse(data));
            if (d) {
              full += d;
              req.onText!(d, full);
            }
          } catch (e) {
            if (e instanceof AiError) err = e;
          }
        },
        req.signal,
      );
      if (err && !full) throw err;
      return { text: full, provider: 'gemini' as const, model: cfg.model };
    }
    return { text: textOf(await res.json()), provider: 'gemini' as const, model: cfg.model };
  },
  async listModels(cfg) {
    const res = await fetch(`${BASE}/models?pageSize=200`, { headers: headers(cfg) });
    if (!res.ok) throw httpError(res.status, await res.text());
    const j = await res.json();
    return ((j.models ?? []) as { name: string; supportedGenerationMethods?: string[] }[])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent') && /gemini/.test(m.name))
      .map((m) => m.name.replace(/^models\//, ''))
      .sort();
  },
  async embed(texts, cfg, signal) {
    const res = await fetch(`${BASE}/models/${EMBED_MODEL}:batchEmbedContents`, {
      method: 'POST',
      headers: headers(cfg),
      body: JSON.stringify({ requests: texts.map((t) => ({ model: `models/${EMBED_MODEL}`, content: { parts: [{ text: t }] } })) }),
      signal,
    });
    if (!res.ok) throw httpError(res.status, await res.text());
    const j = await res.json();
    return (j.embeddings as { values: number[] }[]).map((e) => e.values);
  },
};
