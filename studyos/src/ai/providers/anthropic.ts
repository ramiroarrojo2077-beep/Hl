import Anthropic from '@anthropic-ai/sdk';
import { AiError, type GenRequest, type GenResult, type Msg, type ProviderConfig, type ProviderImpl } from '../types';

// Llamadas directas desde el dispositivo con la clave del usuario
// (dangerouslyAllowBrowser agrega el encabezado de acceso directo desde navegador).
// Se activa el fallback del servidor ("default") para que, si el modelo pedido
// rechaza una solicitud educativa legítima por un falso positivo de seguridad,
// la API la reintente con el modelo sustituto configurado por Anthropic.

function client(cfg: ProviderConfig) {
  if (!cfg.apiKey) throw new AiError('no_provider', 'Falta la clave de API de Anthropic.');
  return new Anthropic({ apiKey: cfg.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

function toAnthropic(messages: Msg[]): Anthropic.Beta.BetaMessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content:
      typeof m.content === 'string'
        ? m.content
        : m.content.map((p) =>
            p.type === 'text'
              ? ({ type: 'text', text: p.text } as const)
              : ({ type: 'image', source: { type: 'base64', media_type: p.mime as 'image/png', data: p.data } } as const),
          ),
  }));
}

/** effort solo existe en los modelos actuales (4.6 en adelante). */
function supportsEffort(model: string) {
  return /claude-(opus|sonnet|haiku|fable|mythos)-(5|[6-9])/.test(model) || /claude-(opus|sonnet)-4-[6-9]/.test(model);
}

function mapError(e: unknown): never {
  if (e instanceof Anthropic.APIUserAbortError) throw new DOMException('Cancelado', 'AbortError');
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiError('auth', 'La clave de API de Anthropic no es válida o no tiene permisos.');
  if (e instanceof Anthropic.RateLimitError) throw new AiError('rate_limit', 'Anthropic limitó las solicitudes. Esperá un momento o revisá tu plan.');
  if (e instanceof Anthropic.NotFoundError) throw new AiError('other', 'El modelo elegido no existe para tu cuenta. Elegí otro en Configuración.');
  if (e instanceof Anthropic.BadRequestError) throw new AiError('other', `Solicitud rechazada por Anthropic: ${e.message}`);
  if (e instanceof Anthropic.APIConnectionError) throw new AiError('network', 'No se pudo conectar con Anthropic. Revisá tu conexión.');
  if (e instanceof Anthropic.APIError) throw new AiError('network', `Error de Anthropic (${e.status ?? 'sin estado'}): ${e.message}`);
  throw e;
}

export const anthropicProvider: ProviderImpl = {
  async generate(req: GenRequest, cfg: ProviderConfig): Promise<GenResult> {
    const c = client(cfg);
    const params = {
      model: cfg.model,
      max_tokens: req.maxTokens ?? (req.onText ? 32000 : 16000),
      system: req.system,
      messages: toAnthropic(req.messages),
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default' as const,
      ...(supportsEffort(cfg.model) ? { output_config: { effort: cfg.effort } } : {}),
    };
    try {
      let msg: Anthropic.Beta.BetaMessage;
      if (req.onText) {
        const stream = c.beta.messages.stream(params, { signal: req.signal });
        stream.on('text', (delta, snapshot) => req.onText!(delta, snapshot));
        msg = await stream.finalMessage();
      } else {
        msg = await c.beta.messages.create(params, { signal: req.signal });
      }
      if (msg.stop_reason === 'refusal') {
        throw new AiError('refusal', 'El modelo no respondió esta solicitud por sus políticas de seguridad. Reformulá la consulta o probá con otro modelo.');
      }
      const text = msg.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return { text, provider: 'anthropic', model: msg.model ?? cfg.model };
    } catch (e) {
      if (e instanceof AiError) throw e;
      mapError(e);
    }
  },

  async listModels(cfg) {
    const c = client(cfg);
    const ids: string[] = [];
    try {
      for await (const m of c.models.list({ limit: 100 })) ids.push(m.id);
    } catch (e) {
      mapError(e);
    }
    return ids;
  },
};
