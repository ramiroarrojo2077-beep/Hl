import { spawn } from "node:child_process";
import { CUENTAS_EMAIL, TAVILY_API_KEY, WHATSAPP_ACTIVO } from "./config.ts";
import { ahora, datos, guardar, nuevoId } from "./almacen.ts";
import { emitir } from "./eventos.ts";
import type { DefinicionHerramienta } from "./ia.ts";
import { clima, noticias, sistema } from "./info.ts";
import { crearPropuesta, descartarPropuesta, describirPropuesta, editarPropuesta, enviarPropuesta } from "./acciones.ts";
import { leerEmails } from "./conectores/email.ts";
import { buscarContacto, mensajesRecientes } from "./conectores/whatsapp.ts";

// Lo que Jarvis puede hacer cuando le pedís algo. Enviar mensajes nunca es directo: crea un borrador
// que vos aprobás.

const MAX_RESULTADO = 6000;

type Argumentos = Record<string, unknown>;

export interface Contexto {
  // Lo último que dijo el usuario, tal cual: para confirmar que él pidió enviar algo.
  textoUsuario: string;
}

interface Herramienta {
  descripcion: string;
  parametros?: Record<string, { type: string; description: string }>;
  requeridos?: string[];
  disponible?: () => boolean;
  ejecutar: (args: Argumentos, contexto: Contexto) => Promise<unknown> | unknown;
}

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

// Segunda barrera (la primera es la IA): un envío solo sale si el usuario lo pidió con sus palabras.
// Así, un mail con instrucciones escondidas no puede hacer que Jarvis mande nada por su cuenta.
function aproboEnvio(textoUsuario: string): boolean {
  const t = normalizar(textoUsuario);
  if (/^(no|nunca|todavia no|espera)\b/.test(t)) return false;
  return /\b(mand\w*|envi\w*|dale|si|ok\w*|de una|confirm\w*|aprob\w*|respond\w*|contesta\w*|hacelo|perfecto|listo|manda)\b/.test(t);
}

const texto = (valor: unknown) => (typeof valor === "string" ? valor.trim() : "");
const numero = (valor: unknown, porDefecto: number, maximo: number) =>
  Math.min(maximo, Math.max(1, Number.isFinite(Number(valor)) && Number(valor) > 0 ? Math.round(Number(valor)) : porDefecto));

const HERRAMIENTAS: Record<string, Herramienta> = {
  clima: {
    descripcion: "Clima actual y pronóstico de 7 días. Sin ciudad, usa la del usuario.",
    parametros: { ciudad: { type: "string", description: "Ciudad, opcional" } },
    ejecutar: (a) => clima(texto(a.ciudad) || undefined),
  },
  noticias: {
    descripcion: "Titulares de noticias recientes del país del usuario, o sobre un tema.",
    parametros: { tema: { type: "string", description: "Tema a buscar, opcional" } },
    ejecutar: (a) => noticias(texto(a.tema), 8),
  },
  buscar_web: {
    descripcion: "Busca en internet información actual: precios, resultados, datos, lugares, horarios, etc.",
    parametros: { consulta: { type: "string", description: "Qué buscar" } },
    requeridos: ["consulta"],
    ejecutar: (a) => buscarWeb(texto(a.consulta)),
  },
  leer_pagina: {
    descripcion: "Lee el texto de una página web pública (por ejemplo, un resultado de buscar_web).",
    parametros: { url: { type: "string", description: "URL completa, con https://" } },
    requeridos: ["url"],
    ejecutar: (a) => leerPagina(texto(a.url)),
  },
  calcular: {
    descripcion: "Calcula una expresión matemática exacta. Ej: (1500*1.21)/3, sqrt(2)^3, 15% de 2000 se escribe 2000*15/100.",
    parametros: { expresion: { type: "string", description: "Expresión con + - * / ^ ( ) y funciones sqrt, abs, round, min, max, sin, cos, log, ln" } },
    requeridos: ["expresion"],
    ejecutar: (a) => ({ resultado: calcular(texto(a.expresion)) }),
  },
  estado_compu: {
    descripcion: "Uso de CPU, memoria RAM, disco y tiempo encendida de la compu del usuario.",
    ejecutar: () => sistema(),
  },
  recordar: {
    descripcion: "Guarda en la memoria permanente un dato útil sobre el usuario (gustos, datos personales, contactos, preferencias).",
    parametros: { dato: { type: "string", description: "El dato, en una frase" } },
    requeridos: ["dato"],
    ejecutar: (a) => {
      const dato = { id: nuevoId(), texto: texto(a.dato), fecha: ahora() };
      if (!dato.texto) throw new Error("Falta el dato.");
      datos.memoria.push(dato);
      guardar();
      emitir("memoria", datos.memoria);
      return { guardado: dato };
    },
  },
  olvidar: {
    descripcion: "Borra un dato de la memoria permanente por su id.",
    parametros: { id: { type: "string", description: "Id del dato" } },
    requeridos: ["id"],
    ejecutar: (a) => {
      const antes = datos.memoria.length;
      datos.memoria = datos.memoria.filter((d) => d.id !== texto(a.id));
      guardar();
      emitir("memoria", datos.memoria);
      return { borrado: antes !== datos.memoria.length };
    },
  },
  crear_recordatorio: {
    descripcion: "Programa un recordatorio. Jarvis avisará en voz alta (y por Telegram) en ese momento.",
    parametros: {
      texto: { type: "string", description: "Qué recordar" },
      cuando: { type: "string", description: "Fecha y hora local en formato ISO 8601, ej: 2026-10-08T09:30:00" },
    },
    requeridos: ["texto", "cuando"],
    ejecutar: (a) => {
      const cuando = new Date(texto(a.cuando));
      if (Number.isNaN(cuando.getTime())) throw new Error("Fecha inválida, usá ISO 8601.");
      const recordatorio = { id: nuevoId(), texto: texto(a.texto), cuando: cuando.toISOString(), avisado: false };
      datos.recordatorios.push(recordatorio);
      guardar();
      emitir("recordatorios", datos.recordatorios);
      return { creado: { ...recordatorio, cuando: cuando.toLocaleString("es-AR") } };
    },
  },
  ver_recordatorios: {
    descripcion: "Lista los recordatorios pendientes.",
    ejecutar: () =>
      datos.recordatorios.filter((r) => !r.avisado).map((r) => ({ ...r, cuando: new Date(r.cuando).toLocaleString("es-AR") })),
  },
  borrar_recordatorio: {
    descripcion: "Borra un recordatorio por su id.",
    parametros: { id: { type: "string", description: "Id del recordatorio" } },
    requeridos: ["id"],
    ejecutar: (a) => {
      datos.recordatorios = datos.recordatorios.filter((r) => r.id !== texto(a.id));
      guardar();
      emitir("recordatorios", datos.recordatorios);
      return { listo: true };
    },
  },
  leer_emails: {
    descripcion: "Lee los últimos mails de la bandeja de entrada (sin marcarlos como leídos).",
    parametros: {
      cantidad: { type: "integer", description: "Cuántos, por defecto 5 (máximo 15)" },
      solo_no_leidos: { type: "boolean", description: "true = solo no leídos (por defecto)" },
    },
    disponible: () => CUENTAS_EMAIL.length > 0,
    ejecutar: async (a) =>
      (await leerEmails(numero(a.cantidad, 5, 15), a.solo_no_leidos !== false)).map((e) => ({
        ...e,
        texto: e.texto.slice(0, 1200),
      })),
  },
  leer_whatsapp: {
    descripcion: "Lee los mensajes de WhatsApp recibidos desde que Jarvis está conectada, de todos o de un contacto.",
    parametros: {
      contacto: { type: "string", description: "Nombre o número, opcional" },
      cantidad: { type: "integer", description: "Cuántos, por defecto 15" },
    },
    disponible: () => WHATSAPP_ACTIVO,
    ejecutar: (a) => mensajesRecientes(texto(a.contacto) || undefined, numero(a.cantidad, 15, 50)),
  },
  responder_aviso: {
    descripcion: "Prepara un borrador de respuesta a un mail o WhatsApp que llegó (usa el id del aviso). NO lo envía: queda para que el usuario lo apruebe.",
    parametros: {
      aviso_id: { type: "string", description: "Id del aviso" },
      texto: { type: "string", description: "Texto de la respuesta" },
    },
    requeridos: ["aviso_id", "texto"],
    ejecutar: (a) => {
      const aviso = datos.avisos.find((x) => x.id === texto(a.aviso_id));
      if (!aviso?.origen) throw new Error("Ese aviso no existe o no se puede responder.");
      const o = aviso.origen;
      const propuesta =
        o.canal === "email"
          ? crearPropuesta({
              canal: "email",
              para: o.responderA,
              paraNombre: aviso.de,
              cuenta: o.cuenta,
              asunto: /^re:/i.test(o.asunto) ? o.asunto : `Re: ${o.asunto}`,
              texto: texto(a.texto),
              motivo: aviso.resumen,
              enRespuestaA: { messageId: o.messageId, references: o.references },
            })
          : crearPropuesta({ canal: "whatsapp", para: o.jid, paraNombre: aviso.de, texto: texto(a.texto), motivo: aviso.resumen });
      return describirPropuesta(propuesta);
    },
  },
  proponer_email: {
    descripcion: "Prepara un borrador de mail nuevo. NO lo envía: queda para que el usuario lo apruebe.",
    parametros: {
      para: { type: "string", description: "Dirección de correo del destinatario" },
      asunto: { type: "string", description: "Asunto" },
      texto: { type: "string", description: "Cuerpo del mail" },
    },
    requeridos: ["para", "asunto", "texto"],
    disponible: () => CUENTAS_EMAIL.length > 0,
    ejecutar: (a) => {
      const para = texto(a.para);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) throw new Error("Dirección de correo inválida.");
      return describirPropuesta(
        crearPropuesta({ canal: "email", para, paraNombre: para, asunto: texto(a.asunto), texto: texto(a.texto), motivo: "Pedido del usuario" }),
      );
    },
  },
  proponer_whatsapp: {
    descripcion: "Prepara un borrador de WhatsApp. NO lo envía: queda para que el usuario lo apruebe.",
    parametros: {
      contacto: { type: "string", description: "Nombre de alguien que ya escribió, o número con código de país (ej: 5491112345678)" },
      texto: { type: "string", description: "Mensaje" },
    },
    requeridos: ["contacto", "texto"],
    disponible: () => WHATSAPP_ACTIVO,
    ejecutar: (a) => {
      const destino = buscarContacto(texto(a.contacto));
      if (!destino) throw new Error("No conozco ese contacto. Pedile al usuario el número con código de país.");
      return describirPropuesta(
        crearPropuesta({ canal: "whatsapp", para: destino.jid, paraNombre: destino.nombre, texto: texto(a.texto), motivo: "Pedido del usuario" }),
      );
    },
  },
  enviar_borrador: {
    descripcion:
      "Envía un borrador pendiente. Usala SOLO si el usuario lo pidió explícitamente en su último mensaje (ej: 'mandala', 'sí, enviásela'). Si dijo 'mandala' sin aclarar, es el borrador más reciente.",
    parametros: {
      id: { type: "string", description: "Id del borrador" },
      texto: { type: "string", description: "Texto final si el usuario pidió un cambio de último momento, opcional" },
    },
    requeridos: ["id"],
    ejecutar: async (a, contexto) => {
      if (!aproboEnvio(contexto.textoUsuario)) {
        throw new Error("El usuario no pidió enviarlo. Preguntale si lo querés mandar antes de enviarlo.");
      }
      const p = await enviarPropuesta(texto(a.id), { texto: texto(a.texto) || undefined });
      return { enviado: true, canal: p.canal, para: p.paraNombre };
    },
  },
  corregir_borrador: {
    descripcion: "Cambia el texto de un borrador pendiente según lo que pidió el usuario. No lo envía.",
    parametros: {
      id: { type: "string", description: "Id del borrador" },
      texto: { type: "string", description: "Texto nuevo completo" },
    },
    requeridos: ["id", "texto"],
    ejecutar: (a) => {
      const p = editarPropuesta(texto(a.id), { texto: texto(a.texto) });
      return { corregido: true, texto: p.texto };
    },
  },
  descartar_borrador: {
    descripcion: "Descarta un borrador pendiente (no se envía nada).",
    parametros: { id: { type: "string", description: "Id del borrador" } },
    requeridos: ["id"],
    ejecutar: (a) => {
      const p = descartarPropuesta(texto(a.id));
      return { descartado: true, para: p.paraNombre };
    },
  },
  abrir: {
    descripcion: "Abre una página o servicio web en el navegador de la compu (YouTube, Gmail, Spotify, un mapa, etc).",
    parametros: { url: { type: "string", description: "URL completa con https://" } },
    requeridos: ["url"],
    ejecutar: (a) => abrirEnNavegador(texto(a.url)),
  },
};

export function definiciones(): DefinicionHerramienta[] {
  return Object.entries(HERRAMIENTAS)
    .filter(([, h]) => h.disponible?.() ?? true)
    .map(([nombre, h]) => {
      const funcion: DefinicionHerramienta["function"] = { name: nombre, description: h.descripcion };
      // Gemini rechaza objetos sin propiedades, así que las herramientas sin parámetros no los declaran.
      if (h.parametros) {
        funcion.parameters = { type: "object", properties: h.parametros, ...(h.requeridos ? { required: h.requeridos } : {}) };
      }
      return { type: "function", function: funcion };
    });
}

export async function ejecutarHerramienta(nombre: string, argumentosJson: string, contexto: Contexto): Promise<string> {
  const herramienta = HERRAMIENTAS[nombre];
  if (!herramienta || herramienta.disponible?.() === false) return JSON.stringify({ error: `No existe la herramienta ${nombre}.` });
  let args: Argumentos = {};
  try {
    args = argumentosJson.trim() ? JSON.parse(argumentosJson) : {};
  } catch {
    return JSON.stringify({ error: "Argumentos con JSON inválido." });
  }
  try {
    const resultado = await herramienta.ejecutar(args, contexto);
    const serializado = typeof resultado === "string" ? resultado : JSON.stringify(resultado);
    return serializado.length > MAX_RESULTADO ? `${serializado.slice(0, MAX_RESULTADO)}…(recortado)` : serializado;
  } catch (err) {
    return JSON.stringify({ error: (err as Error).message });
  }
}

// ---------- Búsqueda web ----------

async function buscarWeb(consulta: string) {
  if (!consulta) throw new Error("Falta la consulta.");
  if (TAVILY_API_KEY) {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TAVILY_API_KEY}` },
      body: JSON.stringify({ query: consulta, max_results: 5, include_answer: true }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      const r = (await res.json()) as { answer?: string; results?: { title: string; url: string; content: string }[] };
      return { respuesta: r.answer, resultados: (r.results ?? []).map(({ title, url, content }) => ({ titulo: title, url, resumen: content.slice(0, 500) })) };
    }
    console.warn(`[buscar_web] Tavily HTTP ${res.status}, uso DuckDuckGo`);
  }
  try {
    const resultados = await duckDuckGo(consulta);
    if (resultados.length) return { resultados };
  } catch (err) {
    console.warn(`[buscar_web] DuckDuckGo: ${(err as Error).message}`);
  }
  return { resultados: await wikipedia(consulta) };
}

function sinEtiquetas(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function duckDuckGo(consulta: string) {
  const res = await fetch(`https://html.duckduckgo.com/html/?kl=ar-es&q=${encodeURIComponent(consulta)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const titulos = [...html.matchAll(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  const resumenes = [...html.matchAll(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
  return titulos.slice(0, 6).map(([, href, titulo], i) => {
    let url = href.replace(/&amp;/g, "&");
    const real = url.match(/[?&]uddg=([^&]+)/);
    if (real) url = decodeURIComponent(real[1]);
    return { titulo: sinEtiquetas(titulo), url, resumen: sinEtiquetas(resumenes[i]?.[1] ?? "") };
  });
}

async function wikipedia(consulta: string) {
  const res = await fetch(
    `https://es.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=5&srsearch=${encodeURIComponent(consulta)}`,
    { headers: { "User-Agent": "Jarvis/1.0" }, signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) throw new Error("No pude buscar en internet.");
  const r = (await res.json()) as { query?: { search?: { title: string; snippet: string }[] } };
  return (r.query?.search ?? []).map((s) => ({
    titulo: s.title,
    url: `https://es.wikipedia.org/wiki/${encodeURIComponent(s.title.replace(/ /g, "_"))}`,
    resumen: sinEtiquetas(s.snippet),
  }));
}

// Evita que una página o un mensaje malicioso haga que Jarvis lea servicios de tu red local.
function esDireccionPrivada(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return (
    h === "localhost" ||
    h.endsWith(".local") ||
    h.endsWith(".internal") ||
    h === "::1" ||
    h.startsWith("fc") ||
    h.startsWith("fd") ||
    h.startsWith("fe80") ||
    /^(127|10|0)\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    !h.includes(".")
  );
}

function validarUrl(url: string): URL {
  let destino: URL;
  try {
    destino = new URL(url);
  } catch {
    throw new Error("URL inválida.");
  }
  if (destino.protocol !== "https:" && destino.protocol !== "http:") throw new Error("Solo se permiten URLs http o https.");
  if (esDireccionPrivada(destino.hostname)) throw new Error("No se permiten direcciones de la red local.");
  return destino;
}

async function leerPagina(url: string) {
  const destino = validarUrl(url);
  const res = await fetch(destino, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36" },
    signal: AbortSignal.timeout(20_000),
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`La página respondió ${res.status}.`);
  if (esDireccionPrivada(new URL(res.url).hostname)) throw new Error("La página redirige a la red local.");
  const tipo = res.headers.get("content-type") ?? "";
  if (!/text|html|json|xml/.test(tipo)) throw new Error(`No es una página de texto (${tipo}).`);
  const html = (await res.text()).slice(0, 2_000_000);
  const titulo = sinEtiquetas(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const cuerpo = sinEtiquetas(html.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ").replace(/<\/(p|div|li|h\d|tr|br)>/gi, "\n"));
  return { titulo, url: res.url, texto: cuerpo.slice(0, 8000) };
}

function abrirEnNavegador(url: string) {
  const destino = validarUrl(url).toString();
  // Sin pasar por una consola, para que caracteres raros en la URL no se interpreten como comandos.
  const [comando, args] =
    process.platform === "win32"
      ? ["rundll32.exe", ["url.dll,FileProtocolHandler", destino]]
      : process.platform === "darwin"
        ? ["open", [destino]]
        : ["xdg-open", [destino]];
  const hijo = spawn(comando, args, { detached: true, stdio: "ignore" });
  hijo.on("error", () => {});
  hijo.unref();
  emitir("abrir", { url: destino });
  return { abierto: destino };
}

// ---------- Calculadora ----------

const FUNCIONES: Record<string, (...n: number[]) => number> = {
  sqrt: Math.sqrt,
  raiz: Math.sqrt,
  abs: Math.abs,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  min: Math.min,
  max: Math.max,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  log: Math.log10,
  ln: Math.log,
  exp: Math.exp,
  pow: Math.pow,
};
const CONSTANTES: Record<string, number> = { pi: Math.PI, e: Math.E };

export function calcular(expresion: string): number {
  const fuente = expresion.replace(/×/g, "*").replace(/÷/g, "/").replace(/\*\*/g, "^");
  const tokens = fuente.match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|[a-záéíóú_]+|[-+*/^%(),]/gi);
  if (!tokens || tokens.join("") !== fuente.replace(/\s+/g, "")) throw new Error("Expresión inválida.");
  let i = 0;
  const ver = () => tokens[i];
  const tomar = (esperado?: string) => {
    const t = tokens[i++];
    if (esperado && t !== esperado) throw new Error(`Se esperaba "${esperado}".`);
    return t;
  };

  const suma = (): number => {
    let v = producto();
    while (ver() === "+" || ver() === "-") v = tomar() === "+" ? v + producto() : v - producto();
    return v;
  };
  const producto = (): number => {
    let v = unario();
    while (ver() === "*" || ver() === "/" || ver() === "%") {
      const op = tomar();
      const d = unario();
      v = op === "*" ? v * d : op === "/" ? v / d : v % d;
    }
    return v;
  };
  // El signo va antes que la potencia: -2^2 da -4.
  const unario = (): number => {
    if (ver() === "-") {
      tomar();
      return -unario();
    }
    if (ver() === "+") {
      tomar();
      return unario();
    }
    return potencia();
  };
  const potencia = (): number => {
    const base = primario();
    if (ver() !== "^") return base;
    tomar();
    return base ** unario();
  };
  const primario = (): number => {
    const t = tomar();
    if (t === undefined) throw new Error("Expresión incompleta.");
    if (t === "(") {
      const v = suma();
      tomar(")");
      return v;
    }
    if (/^\d/.test(t)) return Number(t);
    const nombre = t.toLowerCase();
    if (nombre in CONSTANTES) return CONSTANTES[nombre];
    const fn = FUNCIONES[nombre];
    if (!fn) throw new Error(`No conozco "${t}".`);
    tomar("(");
    const args = [suma()];
    while (ver() === ",") {
      tomar();
      args.push(suma());
    }
    tomar(")");
    return fn(...args);
  };

  const resultado = suma();
  if (i !== tokens.length) throw new Error("Expresión inválida.");
  if (!Number.isFinite(resultado)) throw new Error("El resultado no es un número finito.");
  return Math.round(resultado * 1e10) / 1e10;
}
