import { CapacitorHttp } from '@capacitor/core';
import { isNative } from '@/lib/platform';
import { readNdjson } from '../sse';
import { AiError, httpError, type GenRequest, type Msg, type ProviderConfig, type ProviderImpl } from '../types';

// Ollama corre en una computadora de la red local (http://IP:11434). En Android
// el WebView usa https://localhost, así que las solicitudes HTTP se hacen por el
// puente nativo (CapacitorHttp) para evitar el bloqueo de contenido mixto; en
// ese caso la respuesta llega completa, sin transmisión en vivo.

const EMBED_MODEL = 'nomic-embed-text';

function url(cfg: ProviderConfig, path: string) {
  if (!cfg.baseUrl) throw new AiError('no_provider', 'Configurá la dirección de Ollama (por ejemplo http://192.168.0.10:11434).');
  return `${cfg.baseUrl.replace(/\/$/, '')}${path}`;
}

function toOllama(system: string | undefined, messages: Msg[]) {
  const out: { role: string; content: string; images?: string[] }[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (typeof m.content === 'string') out.push({ role: m.role, content: m.content });
    else
      out.push({
        role: m.role,
        content: m.content.filter((p) => p.type === 'text').map((p) => (p as { text: string }).text).join('\n'),
        images: m.content.filter((p) => p.type === 'image').map((p) => (p as { data: string }).data),
      });
  }
  return out;
}

/** Errores del puente nativo (sin conexión, IP equivocada, puerto cerrado) en lenguaje claro. */
function nativeError(u: string, e: unknown): never {
  if (e instanceof AiError) throw e;
  const host = u.replace(/^(https?:\/\/[^/]+).*/, '$1');
  throw new AiError(
    'network',
    `No se pudo conectar con Ollama en ${host}. Revisá que la computadora esté encendida y en la misma red Wi-Fi que el celular, que la dirección sea la IP de esa computadora (no «localhost») y que Ollama se ejecute con OLLAMA_HOST=0.0.0.0.`,
    (e as Error)?.message,
  );
}

async function nativePost(u: string, data: unknown) {
  const res = await CapacitorHttp.post({ url: u, headers: { 'Content-Type': 'application/json' }, data, readTimeout: 600_000, connectTimeout: 15_000 }).catch((e) => nativeError(u, e));
  if (res.status >= 400) throw httpError(res.status, JSON.stringify(res.data));
  return typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
}

export const ollamaProvider: ProviderImpl = {
  embeddingModel: EMBED_MODEL,
  async generate(req: GenRequest, cfg: ProviderConfig) {
    const body: Record<string, unknown> = {
      model: cfg.model,
      messages: toOllama(req.system, req.messages),
      stream: !!req.onText && !isNative,
      options: { num_ctx: 16384 },
    };
    if (req.json) body.format = 'json';
    if (isNative) {
      const j = await nativePost(url(cfg, '/api/chat'), body);
      const text = j.message?.content ?? '';
      req.onText?.(text, text);
      return { text, provider: 'ollama' as const, model: cfg.model };
    }
    const res = await fetch(url(cfg, '/api/chat'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: req.signal });
    if (!res.ok) throw httpError(res.status, await res.text());
    if (req.onText) {
      let full = '';
      await readNdjson(
        res,
        (o) => {
          const d = ((o.message as { content?: string })?.content ?? '') as string;
          if (d) {
            full += d;
            req.onText!(d, full);
          }
        },
        req.signal,
      );
      return { text: full, provider: 'ollama' as const, model: cfg.model };
    }
    const j = await res.json();
    return { text: j.message?.content ?? '', provider: 'ollama' as const, model: cfg.model };
  },
  async listModels(cfg) {
    if (isNative) {
      const u = url(cfg, '/api/tags');
      const res = await CapacitorHttp.get({ url: u, connectTimeout: 8000 }).catch((e) => nativeError(u, e));
      if (res.status >= 400) throw httpError(res.status, JSON.stringify(res.data));
      const j = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
      return (j.models ?? []).map((m: { name: string }) => m.name);
    }
    const res = await fetch(url(cfg, '/api/tags'));
    if (!res.ok) throw httpError(res.status, await res.text());
    const j = await res.json();
    return (j.models ?? []).map((m: { name: string }) => m.name);
  },
  async embed(texts, cfg, signal) {
    const body = { model: EMBED_MODEL, input: texts };
    if (isNative) return (await nativePost(url(cfg, '/api/embed'), body)).embeddings;
    const res = await fetch(url(cfg, '/api/embed'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
    if (!res.ok) throw httpError(res.status, await res.text());
    return (await res.json()).embeddings;
  },
};
