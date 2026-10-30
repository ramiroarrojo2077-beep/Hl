/** Lee un stream de eventos SSE y llama onData con el contenido de cada línea "data:". */
export async function readSse(res: Response, onData: (data: string) => void, signal?: AbortSignal) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const onAbort = () => reader.cancel().catch(() => {});
  signal?.addEventListener('abort', onAbort);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        if (line.startsWith('data:')) onData(line.slice(5).trimStart());
      }
    }
    if (buf.startsWith('data:')) onData(buf.slice(5).trimStart());
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
}

/** Lee un stream NDJSON (Ollama). */
export async function readNdjson(res: Response, onObj: (o: Record<string, unknown>) => void, signal?: AbortSignal) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const onAbort = () => reader.cancel().catch(() => {});
  signal?.addEventListener('abort', onAbort);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (line) onObj(JSON.parse(line));
      }
    }
    if (buf.trim()) onObj(JSON.parse(buf));
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
}
