/** Extrae el primer objeto/arreglo JSON de un texto (tolera bloques ```json). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const src = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(src);
  } catch {
    /* sigue */
  }
  const start = src.search(/[[{]/);
  if (start < 0) throw new Error('La respuesta no contiene JSON.');
  const open = src[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return JSON.parse(src.slice(start, i + 1));
    }
  }
  throw new Error('JSON incompleto en la respuesta (posible corte por longitud).');
}

