import { describe, expect, it } from 'vitest';
import { pickModel } from '../src/ai/models';
import { httpError, providerMessage } from '../src/ai/types';

describe('pickModel', () => {
  it('Gemini: prefiere el alias que sigue al último Flash', () => {
    expect(pickModel('gemini', ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.5-pro'])).toBe('gemini-flash-latest');
  });
  it('Gemini: sin alias, elige el Flash estable más nuevo (no lite, no preview, no imagen)', () => {
    const list = ['gemini-2.5-flash-lite', 'gemini-3.1-flash-image', 'gemini-3.6-flash-preview', 'gemini-3.5-flash', 'gemini-3.0-flash', 'gemini-embedding-001', 'gemini-3.5-pro'];
    expect(pickModel('gemini', list)).toBe('gemini-3.5-flash');
  });
  it('OpenAI: prefiere el modelo «mini» más nuevo', () => {
    expect(pickModel('openai', ['gpt-4o-mini', 'gpt-5-mini', 'gpt-5.2-mini', 'gpt-5.2', 'gpt-realtime', 'text-embedding-3-small'])).toBe('gpt-5.2-mini');
  });
  it('servicio compatible sin modelos GPT: toma el primero de texto', () => {
    expect(pickModel('openai', ['whisper-large-v3', 'llama-3.3-70b-versatile'])).toBe('llama-3.3-70b-versatile');
  });
  it('lista vacía', () => {
    expect(pickModel('ollama', [])).toBeNull();
  });
});

describe('httpError', () => {
  it('clave inválida de Gemini (llega como 400)', () => {
    const e = httpError(400, JSON.stringify({ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }));
    expect(e.code).toBe('auth');
    expect(e.message).toContain('API key not valid');
  });
  it('modelo retirado', () => {
    const e = httpError(404, JSON.stringify({ error: { message: 'models/gemini-2.5-flash is not found for API version v1beta, or is not supported for generateContent.' } }));
    expect(e.code).toBe('not_found');
  });
  it('OpenAI sin saldo', () => {
    const e = httpError(429, JSON.stringify({ error: { message: 'You exceeded your current quota, please check your plan and billing details.', type: 'insufficient_quota' } }));
    expect(e.code).toBe('quota');
  });
  it('límite de velocidad', () => {
    expect(httpError(429, '{"error":{"message":"Resource has been exhausted (e.g. check quota)."}}').code).toBe('rate_limit');
  });
  it('mensaje de Ollama ({error: "…"})', () => {
    expect(providerMessage('{"error":"model \\"llama3.2\\" not found, try pulling it first"}')).toContain('not found');
    expect(httpError(404, '{"error":"model \\"llama3.2\\" not found"}').code).toBe('not_found');
  });
});
