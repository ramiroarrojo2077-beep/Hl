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

export type AiErrorCode = 'no_provider' | 'auth' | 'rate_limit' | 'network' | 'refusal' | 'bad_output' | 'aborted' | 'too_long' | 'other';

export class AiError extends Error {
  constructor(public code: AiErrorCode, message: string, public detail?: string) {
    super(message);
    this.name = 'AiError';
  }
}

export function isAbort(e: unknown): boolean {
  return (e instanceof AiError && e.code === 'aborted') || (e instanceof DOMException && e.name === 'AbortError') || (e as Error)?.name === 'AbortError' || (e as Error)?.name === 'APIUserAbortError';
}

export function httpError(status: number, body: string): AiError {
  const short = body.slice(0, 300);
  if (status === 401 || status === 403) return new AiError('auth', 'La clave de API no es válida o no tiene permisos.', short);
  if (status === 429) return new AiError('rate_limit', 'El proveedor limitó las solicitudes (cuota o velocidad). Esperá un momento o revisá tu plan.', short);
  if (status === 404) return new AiError('other', 'El modelo o el endpoint no existe. Elegí otro modelo en Configuración.', short);
  if (status === 413) return new AiError('too_long', 'El contenido es demasiado largo para este modelo.', short);
  if (status >= 500) return new AiError('network', 'El proveedor de IA tuvo un error temporal. Probá de nuevo.', short);
  return new AiError('other', `Error del proveedor (${status}).`, short);
}

export function aiErrorMessage(e: unknown): string {
  if (e instanceof AiError) return e.message;
  if (isAbort(e)) return 'Operación cancelada.';
  if (e instanceof TypeError && /fetch|network|Failed/i.test(e.message)) return 'No se pudo conectar con el proveedor de IA. Revisá tu conexión a internet o la URL configurada.';
  return (e as Error)?.message || 'Error desconocido.';
}
