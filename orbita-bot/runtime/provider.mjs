export class ProviderError extends Error {}

export function createProvider({ provider, model, key, endpoint, fetcher = fetch }) {
  return async (messages, tools, signal) => {
    if (provider === 'xai' && !key) throw new ProviderError('Falta XAI_API_KEY en la configuración privada del servidor.');
    const local = provider === 'ollama';
    const url = local ? `${endpoint.replace(/\/$/, '')}/api/chat` : 'https://api.x.ai/v1/responses';
    let response;
    try {
      response = await fetcher(url, {
        method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
        headers: { 'Content-Type': 'application/json', ...(!local ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify(local ? {
          model, stream: false, messages,
          tools: tools.map(({ type, ...fn }) => ({ type: 'function', function: fn })),
          options: { num_predict: 4096, num_ctx: 32768 }
        } : { model, input: messages, tools, store: false, max_output_tokens: 4096 })
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new ProviderError(local ? 'No se pudo conectar con Ollama. Inícialo y descarga el modelo indicado en Ajustes.' : 'No se pudo conectar con xAI o se agotó el tiempo de espera.');
    }
    if (!response.ok) throw new ProviderError(local
      ? `Ollama respondió HTTP ${response.status}. Comprueba que el modelo «${model}» esté instalado y admita herramientas.`
      : `xAI respondió HTTP ${response.status}. Revisa la clave, el modelo y los límites de tu cuenta.`);
    const data = await response.json();
    if (local) {
      if (!data.message || data.error) throw new ProviderError('Ollama no devolvió un mensaje válido.');
      const message = data.message;
      const calls = (message.tool_calls ?? []).map((t, i) => ({ id: `${i}`, name: t.function.name, args: t.function.arguments }));
      return { text: message.content ?? '', calls, continuation: [message], toolResult: (call, result) => ({ role: 'tool', tool_name: call.name, content: JSON.stringify(result) }) };
    }
    if (!Array.isArray(data.output) || ['failed', 'incomplete'].includes(data.status)) throw new ProviderError('El modelo no completó la respuesta. Acorta la tarea e inténtalo de nuevo.');
    const calls = data.output.filter(x => x.type === 'function_call').map(x => ({ id: x.call_id, name: x.name, args: x.arguments }));
    const text = data.output.filter(x => x.type === 'message').flatMap(x => x.content ?? []).filter(x => x.type === 'output_text').map(x => x.text).join('\n');
    return { text, calls, continuation: data.output, toolResult: (call, result) => ({ type: 'function_call_output', call_id: call.id, output: JSON.stringify(result) }) };
  };
}
