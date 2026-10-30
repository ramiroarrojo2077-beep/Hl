export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'ollama';

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI o compatible',
  gemini: 'Google Gemini',
  ollama: 'Ollama (local)',
};

export interface TextPart { type: 'text'; text: string }
export interface ImagePart { type: 'image'; mime: string; data: string }
export type Content = string | (TextPart | ImagePart)[];

export interface Msg {
  role: 'user' | 'assistant';
  content: Content;
}

export interface GenRequest {
  system?: string;
  messages: Msg[];
  json?: boolean;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Si se pasa, la respuesta se transmite en vivo. */
  onText?: (delta: string, full: string) => void;
}

export interface GenResult {
  text: string;
  provider: ProviderId;
  model: string;
}

export interface ProviderConfig {
  apiKey?: string;
  model: string;
  baseUrl?: string;
  effort: 'low' | 'medium' | 'high';
}

export interface ProviderImpl {
  generate(req: GenRequest, cfg: ProviderConfig): Promise<GenResult>;
  listModels(cfg: ProviderConfig): Promise<string[]>;
  embed?(texts: string[], cfg: ProviderConfig, signal?: AbortSignal): Promise<number[][]>;
  embeddingModel?: string;
}

export type AiErrorCode = 'no_provider' | 'auth' | 'rate_limit' | 'quota' | 'not_found' | 'network' | 'refusal' | 'bad_output' | 'aborted' | 'too_long' | 'other';

export class AiError extends Error {
  constructor(public code: AiErrorCode, message: string, public detail?: string) {
    super(message);
    this.name = 'AiError';
  }
}

export function isAbort(e: unknown): boolean {
  return (e instanceof AiError && e.code === 'aborted') || (e instanceof DOMException && e.name === 'AbortError') || (e as Error)?.name === 'AbortError' || (e as Error)?.name === 'APIUserAbortError';
}

/** Mensaje de error que devuelve el proveedor ({error:{message}} o {error:"…"}). */
export function providerMessage(body: string): string {
  try {
    const j = JSON.parse(body);
    const e = Array.isArray(j) ? j[0]?.error : j.error;
    const m = typeof e === 'string' ? e : e?.message ?? j.message;
    if (typeof m === 'string' && m.trim()) return m.trim().slice(0, 240);
  } catch {
    /* no es JSON */
  }
  return body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240);
}

export function httpError(status: number, body: string): AiError {
  const msg = providerMessage(body);
  const said = msg ? ` Detalle del proveedor: «${msg}»` : '';
  if (status === 401 || ((status === 400 || status === 403) && /API[_ ]?key[_ ]?(not valid|invalid)|API_KEY_INVALID|invalid[_ -]?(x-)?api[_ -]?key|incorrect api key/i.test(body)))
    return new AiError('auth', `La clave de API no es válida. Copiala de nuevo completa (sin espacios) desde la página del proveedor.${said}`, msg);
  if (status === 403) return new AiError('auth', `La clave no tiene permiso para usar este servicio o modelo (o la API no está habilitada en tu proyecto/país).${said}`, msg);
  if (status === 429) {
    if (/insufficient_quota|billing|credit|exceeded your current quota/i.test(body)) return new AiError('quota', `Tu cuenta no tiene saldo o cuota disponible para la API. En OpenAI hay que cargar crédito (platform.openai.com → Billing); con Gemini podés usar la cuota gratuita de Google AI Studio.${said}`, msg);
    return new AiError('rate_limit', `Se alcanzó el límite de uso del proveedor (por minuto o por día). Esperá un momento y probá de nuevo, o elegí un modelo más liviano.${said}`, msg);
  }
  if (status === 404 || /not[_ ]found|does not exist|is not supported for generateContent|no longer available/i.test(msg))
    return new AiError('not_found', `El modelo elegido no existe o ya no está disponible para tu clave.${said}`, msg);
  if (status === 413) return new AiError('too_long', 'El contenido es demasiado largo para este modelo.', msg);
  if (status === 400 && /location|region|country/i.test(msg)) return new AiError('auth', `El proveedor no ofrece la API en tu ubicación.${said}`, msg);
  if (status >= 500) return new AiError('network', `El proveedor de IA tuvo un error temporal. Probá de nuevo en unos segundos.${said}`, msg);
  return new AiError('other', `Error del proveedor (${status}).${said}`, msg);
}

export function aiErrorMessage(e: unknown): string {
  if (e instanceof AiError) return e.message;
  if (isAbort(e)) return 'Operación cancelada.';
  if (e instanceof TypeError && /fetch|network|Failed/i.test(e.message)) return 'No se pudo conectar con el proveedor de IA. Revisá tu conexión a internet o la URL configurada.';
  return (e as Error)?.message || 'Error desconocido.';
}
