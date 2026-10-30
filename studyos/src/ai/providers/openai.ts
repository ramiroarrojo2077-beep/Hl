import { readSse } from '../sse';
import { AiError, httpError, type GenRequest, type Msg, type ProviderConfig, type ProviderImpl } from '../types';

// API de OpenAI o cualquier servicio compatible con /chat/completions
// (Groq, OpenRouter, LM Studio, etc.) cambiando la URL base.

function base(cfg: ProviderConfig) {
  return (cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
}

function headers(cfg: ProviderConfig) {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) h.Authorization = `Bearer ${cfg.apiKey}`;
  return h;
}

function toOpenAI(system: string | undefined, messages: Msg[]) {
  const out: unknown[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (typeof m.content === 'string') out.push({ role: m.role, content: m.content });
    else
      out.push({
        role: m.role,
        content: m.content.map((p) => (p.type === 'text' ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data}` } })),
      });
  }
  return out;
}

export const openaiProvider: ProviderImpl = {
  embeddingModel: 'text-embedding-3-small',
  async generate(req: GenRequest, cfg: ProviderConfig) {
    const official = base(cfg).includes('api.openai.com');
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: toOpenAI(req.system, req.messages),
      stream: !!req.onText,
    };
    // Los modelos de razonamiento usan max_completion_tokens; los compatibles suelen aceptar max_tokens.
    body[official ? 'max_completion_tokens' : 'max_tokens'] = req.maxTokens ?? 16000;
    if (req.json) body.response_format = { type: 'json_object' };
    const res = await fetch(`${base(cfg)}/chat/completions`, { method: 'POST', headers: headers(cfg), body: JSON.stringify(body), signal: req.signal });
    if (!res.ok) throw httpError(res.status, await res.text());
    if (req.onText) {
      let full = '';
      await readSse(
        res,
        (data) => {
          if (data === '[DONE]') return;
          try {
            const j = JSON.parse(data);
            const d = j.choices?.[0]?.delta?.content ?? '';
            if (d) {
              full += d;
              req.onText!(d, full);
            }
          } catch {
            /* línea parcial */
          }
        },
        req.signal,
      );
      return { text: full, provider: 'openai' as const, model: cfg.model };
    }
    const j = await res.json();
    const choice = j.choices?.[0];
    if (choice?.finish_reason === 'content_filter') throw new AiError('refusal', 'El proveedor filtró la respuesta por sus políticas. Reformulá la consulta.');
    if (choice?.message?.refusal) throw new AiError('refusal', choice.message.refusal);
    return { text: choice?.message?.content ?? '', provider: 'openai' as const, model: j.model ?? cfg.model };
  },
  async listModels(cfg) {
    const res = await fetch(`${base(cfg)}/models`, { headers: headers(cfg) });
    if (!res.ok) throw httpError(res.status, await res.text());
    const j = await res.json();
    const ids: string[] = (j.data ?? []).map((m: { id: string }) => m.id);
    const official = base(cfg).includes('api.openai.com');
    return (official ? ids.filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|transcribe|tts|image|search)/.test(id)) : ids).sort();
  },
  async embed(texts, cfg, signal) {
    const res = await fetch(`${base(cfg)}/embeddings`, { method: 'POST', headers: headers(cfg), body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }), signal });
    if (!res.ok) throw httpError(res.status, await res.text());
    const j = await res.json();
    return (j.data as { embedding: number[]; index: number }[]).sort((a, b) => a.index - b.index).map((d) => d.embedding);
  },
};

/** Texto a voz de OpenAI (opcional): devuelve audio MP3. */
export async function openaiSpeech(text: string, voice: string, cfg: { apiKey: string; baseUrl?: string }, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(`${(cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')}/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice, input: text, response_format: 'mp3' }),
    signal,
  });
  if (!res.ok) throw httpError(res.status, await res.text());
  return res.blob();
}
