"use strict";

const $ = (selector) => document.querySelector(selector);
const parametros = new URLSearchParams(location.search);
// Dónde corre: app de escritorio (Electron), app de Android o navegador común.
const escritorio = window.escritorio;
const movil = Boolean(window.Android);
if (escritorio || parametros.has("escritorio")) document.body.classList.add("escritorio");
if (movil) document.body.classList.add("movil");

// Vertical es el diseño principal; ?modo=completo da el HUD de pantalla completa en pantallas anchas.
const PIDE_COMPLETO = parametros.get("modo") === "completo";
let modoCompleto = null;
function aplicarModo() {
  const completo = PIDE_COMPLETO && innerWidth >= 1100;
  if (completo === modoCompleto) return;
  modoCompleto = completo;
  document.body.classList.toggle("completo", completo);
  document.body.classList.toggle("vertical", !completo);
  diaDibujado = "";
}

const LOCALE = "es-AR";
const HORA = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
const ICONOS_CANAL = {
  sms: "i-chat",
  instagram: "i-chat",
  messenger: "i-chat",
  app: "i-chat", email: "i-mail", whatsapp: "i-whatsapp", telegram: "i-telegram", recordatorio: "i-campana", jarvis: "i-jarvis" };
const NOMBRES_HERRAMIENTA = {
  clima: "consultando el clima",
  noticias: "leyendo noticias",
  buscar_web: "buscando en internet",
  leer_pagina: "leyendo una página",
  calcular: "calculando",
  estado_compu: "revisando la compu",
  recordar: "guardando en memoria",
  olvidar: "borrando de la memoria",
  crear_recordatorio: "agendando recordatorio",
  ver_recordatorios: "revisando recordatorios",
  borrar_recordatorio: "borrando recordatorio",
  leer_emails: "leyendo tus mails",
  leer_whatsapp: "leyendo WhatsApp",
  responder_aviso: "preparando respuesta",
  proponer_email: "redactando mail",
  proponer_whatsapp: "redactando WhatsApp",
  abrir: "abriendo",
  estado_celular: "revisando el celular",
  leer_mensajes: "leyendo tus mensajes",
  buscar_emails: "buscando en tu correo",
  proponer_sms: "redactando SMS",
  enviar_borrador: "enviando",
  ver_agenda: "mirando tu agenda",
  crear_evento: "agendando",
  agregar_tarea: "anotando tarea",
  ver_tareas: "revisando tareas",
  completar_tarea: "tachando tarea",
  crear_rutina: "programando rutina",
  ver_rutinas: "revisando rutinas",
  revisar_todo: "revisando todo",
  buscar_contacto: "buscando contacto",
  llamar: "llamando",
  poner_alarma: "poniendo alarma",
  navegar: "abriendo el mapa",
  reproducir: "poniendo música",
};
const ACCESOS = [
  ["Gmail", "https://mail.google.com"],
  ["WhatsApp", "https://web.whatsapp.com"],
  ["YouTube", "https://www.youtube.com"],
  ["Calendario", "https://calendar.google.com"],
  ["Spotify", "https://open.spotify.com"],
  ["Mapas", "https://www.google.com/maps"],
];

// ---------- Utilidades ----------

function leerLocal(clave, porDefecto) {
  try {
    const valor = localStorage.getItem(clave);
    return valor === null ? porDefecto : valor;
  } catch {
    return porDefecto;
  }
}
function guardarLocal(clave, valor) {
  try {
    localStorage.setItem(clave, valor);
  } catch {}
}

let token = new URLSearchParams(location.search).get("token") || leerLocal("jarvis-token", "");
const conToken = (url) => (token ? `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}` : url);

function cabeceras(extra = {}) {
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

async function api(ruta, { metodo = "GET", json, cuerpo, tipo } = {}) {
  const headers = cabeceras(json !== undefined ? { "Content-Type": "application/json" } : tipo ? { "Content-Type": tipo } : {});
  const res = await fetch(conToken(ruta), { method: metodo, headers, body: json !== undefined ? JSON.stringify(json) : cuerpo });
  if (res.status === 401) pedirToken();
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(datos.error || `Error ${res.status}`);
  return datos;
}

function pedirToken() {
  const nuevo = window.prompt?.("Jarvis pide el token de acceso (JARVIS_TOKEN):");
  if (nuevo) {
    guardarLocal("jarvis-token", nuevo.trim());
    location.reload();
  }
}

// Crea elementos sin usar innerHTML: los mails y mensajes que llegan nunca se interpretan como HTML.
function el(etiqueta, atributos = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) {
    if (valor === undefined || valor === null || valor === false) continue;
    if (clave.startsWith("on")) nodo.addEventListener(clave.slice(2), valor);
    else if (clave === "class") nodo.className = valor;
    else nodo.setAttribute(clave, valor === true ? "" : valor);
  }
  for (const hijo of hijos.flat()) if (hijo !== null && hijo !== undefined && hijo !== false) nodo.append(hijo);
  return nodo;
}

function icono(id, clase = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  if (clase) svg.setAttribute("class", clase);
  const uso = document.createElementNS("http://www.w3.org/2000/svg", "use");
  uso.setAttribute("href", `#${id}`);
  svg.append(uso);
  return svg;
}

const dosDigitos = (n) => String(n).padStart(2, "0");

function haceCuanto(fechaIso) {
  const seg = Math.max(0, (Date.now() - Date.parse(fechaIso)) / 1000);
  if (seg < 60) return "ahora";
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return `hace ${Math.floor(seg / 3600)} h`;
  return new Date(fechaIso).toLocaleDateString(LOCALE, { day: "numeric", month: "short" });
}

function gigas(bytes) {
  return `${(bytes / 1024 ** 3).toLocaleString(LOCALE, { maximumFractionDigits: 1 })} GB`;
}

function arco(id, porcentaje) {
  const nodo = document.getElementById(id);
  const total = Number(nodo.getAttribute("pathLength")) || 100;
  const valor = Math.max(0, Math.min(total, (porcentaje / 100) * total));
  nodo.style.strokeDasharray = `${valor} ${total}`;
}

// ---------- Fecha, hora y calendario ----------

let diaDibujado = "";

function dibujarCalendario(ahora) {
  const anio = ahora.getFullYear();
  const mes = ahora.getMonth();
  const dias = new Date(anio, mes + 1, 0).getDate();
  $("#mes-anio").textContent = ahora.toLocaleDateString(LOCALE, { month: "long", year: "numeric" });
  const lista = $("#dias-mes");
  lista.replaceChildren(
    ...Array.from({ length: dias }, (_, i) => {
      const dia = i + 1;
      const semana = new Date(anio, mes, dia).getDay();
      const clases = [
        dia === ahora.getDate() && "hoy",
        (semana === 0 || semana === 6) && "finde",
        dia < ahora.getDate() && "pasado",
        Math.abs(dia - ahora.getDate()) > (modoCompleto ? 8 : 3) && "lejos",
      ];
      const corto = new Date(anio, mes, dia).toLocaleDateString(LOCALE, { weekday: "short" }).replace(".", "");
      return el("li", { class: clases.filter(Boolean).join(" ") }, el("span", { class: "corto" }, corto), dosDigitos(dia));
    }),
  );
  $("#fecha-mes").textContent = ahora.toLocaleDateString(LOCALE, { month: "long" });
  $("#fecha-dia").textContent = String(ahora.getDate());
  $("#fecha-semana").textContent = ahora.toLocaleDateString(LOCALE, { weekday: "long" });
  arco("arco-mes", (ahora.getDate() / dias) * 100);
  $("#hora-zona").textContent = Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, " ");
}

function tic() {
  const ahora = new Date();
  const clave = ahora.toDateString();
  if (clave !== diaDibujado) {
    diaDibujado = clave;
    dibujarCalendario(ahora);
  }
  const hm = `${dosDigitos(ahora.getHours())}:${dosDigitos(ahora.getMinutes())}`;
  $("#hora-grande").textContent = hm;
  $("#reloj-hm").textContent = hm;
  $("#reloj-s").textContent = dosDigitos(ahora.getSeconds());
  arco("arco-segundos", ((ahora.getSeconds() + 1) / 60) * 100);
  arco("arco-dia", ((ahora.getHours() * 60 + ahora.getMinutes()) / 1440) * 100);
}

// ---------- Sistema ----------

const historiaCpu = [];
const historiaRam = [];
const PUNTOS = 90;

function dibujarGrafico(id, valores) {
  const paso = 300 / (PUNTOS - 1);
  const inicio = PUNTOS - valores.length;
  $(`#${id}`).setAttribute("points", valores.map((v, i) => `${((inicio + i) * paso).toFixed(1)},${(48 - (v / 100) * 46).toFixed(1)}`).join(" "));
}

function duracion(segundos) {
  const d = Math.floor(segundos / 86400);
  const h = Math.floor((segundos % 86400) / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  return [d && `${d} d`, (d || h) && `${h} h`, `${m} min`].filter(Boolean).join(" ");
}

async function actualizarSistema() {
  try {
    const s = await api("/api/sistema");
    const ram = Math.round(((s.ram.total - s.ram.libre) / s.ram.total) * 100);
    // En el celular Android no deja leer la CPU (llega -1).
    const conCpu = s.cpu >= 0;
    arco("arco-cpu", conCpu ? s.cpu : 0);
    arco("arco-ram", ram);
    $("#valor-cpu").textContent = conCpu ? `${s.cpu}%` : "--";
    if (s.bateria) {
      arco("arco-bateria", s.bateria.nivel);
      $("#valor-bateria").textContent = `${s.bateria.nivel}%${s.bateria.cargando ? "⚡" : ""}`;
    }
    $("#valor-ram").textContent = `${ram}%`;
    $("#grafico-cpu-valor").textContent = `${s.cpu}% · ${s.nucleos} núcleos`;
    $("#grafico-ram-valor").textContent = `${gigas(s.ram.total - s.ram.libre)} / ${gigas(s.ram.total)}`;
    if (s.disco.total) {
      const usado = s.disco.total - s.disco.libre;
      $("#disco-unidad").textContent = s.disco.unidad;
      $("#disco-texto").textContent = `${gigas(s.disco.libre)} libres`;
      $("#disco-barra").style.width = `${(usado / s.disco.total) * 100}%`;
    }
    $("#encendida").textContent = duracion(s.encendidoSeg);
    $("#equipo").textContent = s.equipo;
    $("#ip").textContent = s.ip;
    if (conCpu) historiaCpu.push(s.cpu);
    historiaRam.push(ram);
    if (historiaCpu.length > PUNTOS) historiaCpu.shift();
    if (historiaRam.length > PUNTOS) historiaRam.shift();
    dibujarGrafico("grafico-cpu", historiaCpu);
    dibujarGrafico("grafico-ram", historiaRam);
  } catch {}
}

async function iniciarBateria() {
  if (movil) return;
  const mostrar = (nivel, cargando) => {
    arco("arco-bateria", nivel);
    $("#valor-bateria").textContent = `${nivel}%${cargando ? "⚡" : ""}`;
  };
  if (!navigator.getBattery) return mostrar(100, true);
  try {
    const bateria = await navigator.getBattery();
    const refrescar = () => mostrar(Math.round(bateria.level * 100), bateria.charging);
    bateria.addEventListener("levelchange", refrescar);
    bateria.addEventListener("chargingchange", refrescar);
    refrescar();
  } catch {
    mostrar(100, true);
  }
}

// ---------- Estado y conexiones ----------

let estado = null;

function filaConexion(iconoId, nombre, detalle, clasePunto, extra) {
  return el(
    "li",
    {},
    icono(iconoId),
    el("span", { class: "nombre" }, nombre, el("span", { class: "detalle" }, detalle)),
    extra ?? el("span", { class: `punto ${clasePunto}` }),
  );
}

function dibujarEstado(e) {
  estado = e;
  const filas = [];
  const ia = e.ia.find((p) => p.disponible) ?? e.ia[0];
  filas.push(
    filaConexion(
      "i-jarvis",
      "Inteligencia",
      ia ? `${ia.nombre} · ${ia.modelo}${e.ia.length > 1 ? ` (+${e.ia.length - 1} de respaldo)` : ""}` : e.movil ? "Falta configurar: tocá ⚙ Ajustes" : "Falta configurar una IA",
      ia ? (ia.disponible ? "ok" : "espera") : "mal",
    ),
  );
  for (const cuenta of e.email) {
    const clase = cuenta.estado === "conectado" ? "ok" : cuenta.estado === "conectando" ? "espera" : "mal";
    filas.push(
      filaConexion(
        "i-mail",
        cuenta.cuenta,
        cuenta.estado === "conectado" ? `${cuenta.noLeidos} sin leer` : cuenta.error || "Conectando…",
        clase,
        cuenta.noLeidos && cuenta.estado === "conectado" ? el("span", { class: "insignia" }, String(cuenta.noLeidos)) : undefined,
      ),
    );
  }
  if (e.movil) {
    const activar = (cual) => el("button", { type: "button", class: "enlace-boton", onclick: () => window.Android?.abrirPermiso(cual) }, "ACTIVAR");
    if (e.email.length === 0) filas.push(filaConexion("i-mail", "Correo", "Opcional: agregalo en ⚙ Ajustes", ""));
    filas.push(filaConexion("i-chat", "Tus apps", e.notificaciones ? "Conectada a WhatsApp, Gmail, Telegram…" : "Tocá ACTIVAR para leer tus notificaciones",
      e.notificaciones ? "ok" : "mal", e.notificaciones ? undefined : activar("notificaciones")));
    filas.push(filaConexion("i-jarvis", "Abrirse sola", e.superponer ? "Se abre cuando la llamás o hay un aviso" : "Tocá ACTIVAR para que aparezca sola",
      e.superponer ? "ok" : "mal", e.superponer ? undefined : activar("superponer")));
    const VOCES = { elena: "Elena (neural, Argentina)", tomas: "Tomás (neural, Argentina)", dalia: "Dalia (neural, México)", paloma: "Paloma (neural, EE.UU.)",
      elvira: "Elvira (neural, España)", gemini: "Gemini", elevenlabs: "ElevenLabs", sistema: "Voz del celular" };
    filas.push(filaConexion("i-parlante", "Voz", VOCES[e.vozNombre] ?? (e.vozNatural ? "ElevenLabs" : "Voz del celular"), "ok"));
    filas.push(filaConexion("i-mic", "Oído", e.oidoPropio ? "Propio (Whisper), sin Google" : "Del sistema · pegá la clave de Groq para el propio", e.oidoPropio ? "ok" : "espera"));
    $("#conexiones").replaceChildren(...filas);
    $("#ajustes").hidden = !e.ajustes;
    if (e.ajustes && e.ia.length === 0 && !ajustesMostrados) {
      ajustesMostrados = true;
      void abrirAjustes(true);
    }
  } else {
  if (e.email.length === 0) filas.push(filaConexion("i-mail", "Correo", "Sin configurar (EMAIL_CUENTAS)", ""));
    const wa = e.whatsapp.estado;
    filas.push(
      filaConexion(
        "i-whatsapp",
        "WhatsApp",
        { apagado: "Desactivado (WHATSAPP_ACTIVO)", esperando_qr: "Esperando que escanees el QR", conectando: "Conectando…", conectado: "Conectado", error: "Error" }[wa],
        wa === "conectado" ? "ok" : wa === "apagado" ? "" : wa === "error" ? "mal" : "espera",
        wa === "esperando_qr" ? el("button", { type: "button", class: "enlace-boton", onclick: () => mostrarQr(e.whatsapp.qr) }, "VER QR") : undefined,
      ),
    );
    const tg = e.telegram.estado;
    filas.push(
      filaConexion(
        "i-telegram",
        "Telegram",
        { apagado: "Sin configurar", conectado: "Conectado", sin_chat: "Escribile al bot para vincularlo", error: "Sin conexión" }[tg],
        tg === "conectado" ? "ok" : tg === "apagado" ? "" : tg === "error" ? "mal" : "espera",
      ),
    );
    filas.push(filaConexion("i-mic", "Voz", e.voz ? "Te escucho" : "Falta GROQ_API_KEY o GEMINI_API_KEY", e.voz ? "ok" : "mal"));
  $("#conexiones").replaceChildren(...filas);
  }

  if (e.movil) dibujarHoy();
  $("#marca-estado").textContent = !e.activa ? "DESACTIVADA" : ia ? "EN LÍNEA" : "SIN IA";
  const boton = $("#interruptor");
  boton.setAttribute("aria-pressed", String(e.activa));
  $("#interruptor-texto").textContent = e.activa ? "ACTIVA" : "DESACTIVADA";
  boton.title = e.activa ? "Desactivar a Jarvis (no te avisa ni se abre sola)" : "Activar a Jarvis";
  $("#reactor").classList.toggle("apagada", !e.activa);
  ponerEstado(estadoReactor);
  // Con escucha continua, el micrófono queda abierto esperando que digas "Jarvis".
  // Desactivada no escucha; activa y con escucha continua, el micrófono espera que digas "Jarvis".
  if (!movil && !e.activa) cerrarMicrofono();
  else if (!movil && oido.continuo && e.voz && !oido.activo) void abrirMicrofono();
}

function mostrarQr(qr) {
  if (!qr) return;
  $("#imagen-qr").src = qr;
  $("#modal-qr").hidden = false;
  escritorio?.mostrar();
}

// ---------- Ajustes (app del celular) ----------

let ajustesMostrados = false;
const CAMPOS_AJUSTES = [
  ["usuario", "Tu nombre", "text", "Cómo te llama Jarvis"],
  ["ciudad", "Ciudad", "text", "Para el clima, ej: Buenos Aires"],
  ["pais", "País", "text", "Código de 2 letras para las noticias, ej: AR"],
  ["gemini", "Clave de Gemini (gratis)", "password", "https://aistudio.google.com/apikey"],
  ["groq", "Clave de Groq (gratis, respaldo y oído)", "password", "https://console.groq.com/keys"],
  ["elevenlabs", "Clave de ElevenLabs (voz natural)", "password", "https://elevenlabs.io"],
  ["elevenlabsVoz", "ID de voz de ElevenLabs", "text", "Vacío = elige sola una voz femenina en español"],
  ["picovoice", "AccessKey de Picovoice", "password", "https://console.picovoice.ai · detecta «Jarvis» sin internet"],
  ["voz", "Voz de Jarvis", "select:elena,tomas,dalia,paloma,elvira,gemini,elevenlabs,sistema", "elena = argentina natural (gratis) · tomas = argentino · gemini usa tu clave de Gemini"],
  ["emailUsuario", "Tu Gmail (para que entre directo a tu correo)", "email", "vos@gmail.com"],
  ["emailClave", "Contraseña de aplicación de ese Gmail", "password", "16 letras · se crea en https://myaccount.google.com/apppasswords (hace falta verificación en 2 pasos)"],
  ["autonomo", "Trabajar sola", "select:si,no", "si = cada 30 min revisa correo, mensajes, agenda y tareas y te avisa lo importante"],
  ["emailCuentas", "Otras cuentas de correo (opcional)", "password", "otra@gmail.com:contraseñadeaplicación,otra2@…"],
  ["tavily", "Clave de Tavily (opcional)", "password", "https://tavily.com · búsqueda web más precisa"],
  ["openrouter", "Clave de OpenRouter (opcional)", "password", "https://openrouter.ai"],
  ["openrouterModelo", "Modelo de OpenRouter", "text", "Ej: un modelo :free con herramientas"],
  ["resumenDiario", "Resumen de buenos días", "time", "Vacío = apagado"],
  ["avisarDesde", "Avisarme en voz alta desde", "select:baja,media,alta", "Importancia mínima"],
  ["razonamiento", "Razonamiento de la IA", "select:low,medium,high", "low = más rápido"],
];

function enlazar(texto) {
  const partes = texto.split(/(https:\/\/\S+)/);
  return partes.map((p) => (p.startsWith("https://") ? el("a", { href: p, target: "_blank", rel: "noopener" }, p.replace("https://", "")) : p));
}

async function abrirAjustes(bienvenida = false) {
  const formulario = $("#formulario-ajustes");
  let valores = {};
  try {
    valores = await api("/api/ajustes");
  } catch (err) {
    agregarLinea("jarvis error", err.message);
    return;
  }
  $("#ajustes-intro").textContent = bienvenida
    ? "Para empezar pegá tu clave gratis de Gemini o de Groq. Lo demás es opcional."
    : "Todo queda guardado solo en tu celular.";
  formulario.replaceChildren(
    ...CAMPOS_AJUSTES.map(([clave, rotulo, tipo, ayuda]) => {
      let campo;
      if (tipo.startsWith("select:")) {
        campo = el("select", { name: clave }, ...tipo.slice(7).split(",").map((v) => el("option", { value: v }, v)));
      } else {
        campo = el("input", { name: clave, type: tipo === "password" ? "text" : tipo, autocomplete: "off", spellcheck: "false" });
      }
      campo.value = valores[clave] ?? "";
      return el("label", { class: "campo" }, el("span", {}, rotulo), campo, el("small", {}, ...enlazar(ayuda)));
    }),
  );
  $("#ajustes-estado").textContent = "";
  $("#modal-ajustes").hidden = false;
}

async function guardarAjustes(e) {
  e.preventDefault();
  const datos = Object.fromEntries(new FormData($("#formulario-ajustes-caja")).entries());
  $("#ajustes-estado").textContent = "Guardando…";
  try {
    await api("/api/ajustes", { metodo: "POST", json: datos });
    $("#ajustes-estado").textContent = "Guardado.";
    setTimeout(() => ($("#modal-ajustes").hidden = true), 600);
  } catch (err) {
    $("#ajustes-estado").textContent = err.message;
  }
}

// ---------- Reactor y conversación ----------

let estadoReactor = null;
const ETIQUETAS_REACTOR = { escuchando: "TE ESCUCHO…", pensando: "PROCESANDO…", hablando: "HABLANDO" };

function ponerEstado(nuevo) {
  estadoReactor = nuevo;
  const reactor = $("#reactor");
  reactor.classList.remove("escuchando", "pensando", "hablando");
  if (nuevo) reactor.classList.add(nuevo);
  $("#reactor-estado").textContent = ETIQUETAS_REACTOR[nuevo] ?? (estado && !estado.activa ? "DESACTIVADA" : "EN LÍNEA");
  $("#microfono").classList.toggle("grabando", nuevo === "escuchando");
  actualizarPista();
}

function agregarLinea(clase, texto) {
  const caja = $("#conversacion");
  const linea = el("div", { class: `linea ${clase}` }, texto);
  caja.append(linea);
  while (caja.children.length > 40) caja.firstElementChild.remove();
  caja.scrollTop = caja.scrollHeight;
  return linea;
}

async function preguntar(texto, canal) {
  texto = texto.trim();
  if (!texto) return;
  agregarLinea("yo", texto);
  const linea = agregarLinea("jarvis", "");
  ponerEstado("pensando");
  let respuesta = "";
  try {
    const res = await fetch(conToken("/api/chat"), {
      method: "POST",
      headers: cabeceras({ "Content-Type": "application/json" }),
      body: JSON.stringify({ mensaje: texto, canal, stream: true }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
    const lector = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let resto = "";
    for (;;) {
      const { value, done } = await lector.read();
      if (done) break;
      resto += value;
      const bloques = resto.split("\n\n");
      resto = bloques.pop();
      for (const bloque of bloques) {
        const evento = bloque.match(/^event: (.+)$/m)?.[1];
        const datos = bloque.match(/^data: (.+)$/m)?.[1];
        if (!evento || !datos) continue;
        const d = JSON.parse(datos);
        if (evento === "texto") {
          linea.textContent += d.delta;
          $("#conversacion").scrollTop = $("#conversacion").scrollHeight;
        } else if (evento === "herramienta") {
          linea.before(el("div", { class: "linea herramienta" }, `⟳ ${NOMBRES_HERRAMIENTA[d.nombre] ?? d.nombre}`));
        } else if (evento === "fin") {
          respuesta = d.respuesta;
          linea.textContent = respuesta;
        } else if (evento === "error") {
          throw new Error(d.mensaje);
        }
      }
    }
  } catch (err) {
    linea.classList.add("error");
    linea.textContent = err.message;
    ponerEstado(null);
    hablar(err.message);
    return;
  }
  ponerEstado(null);
  // Si Jarvis te hizo una pregunta, sigue escuchando tu respuesta sin que digas "Jarvis" de nuevo.
  if (respuesta) hablar(respuesta, { luegoEscuchar: canal === "voz" && /\?\s*$/.test(respuesta) });
}

// ---------- Voz de Jarvis ----------

let vozActiva = leerLocal("jarvis-voz", "1") === "1";
let vozElegida = null;
let turnoVoz = 0;
let audioActual = null;
let movilLuegoEscuchar = false;

function elegirVoz() {
  const voces = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("es"));
  const puntaje = (v) => {
    const lang = v.lang.toLowerCase();
    let p = lang === "es-ar" ? 50 : /es-(us|mx|419|co|cl|uy)/.test(lang) ? 35 : lang === "es-es" ? 20 : 10;
    if (/sabina|helena|laura|paulina|m[oó]nica|elena|elvira|dalia|lupe|paloma|female|mujer|google/i.test(v.name)) p += 15;
    if (/natural|online|neural/i.test(v.name)) p += 10;
    return p;
  };
  vozElegida = voces.sort((a, b) => puntaje(b) - puntaje(a))[0] ?? null;
}

function limpiarParaVoz(texto) {
  return texto
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_#`>]/g, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .trim();
}

// Habla con ElevenLabs si está configurado; si no (o se acabó el cupo), con la voz del sistema.
async function hablar(texto, { luegoEscuchar = false } = {}) {
  const limpio = limpiarParaVoz(texto);
  callar();
  if (!limpio || !vozActiva) {
    if (luegoEscuchar) void escucharOrden();
    return;
  }
  if (movil) {
    movilLuegoEscuchar = luegoEscuchar;
    ponerEstado("hablando");
    window.Android.hablar(limpio);
    return;
  }
  const turno = ++turnoVoz;
  oido.pausado = true;
  ponerEstado("hablando");
  let terminado = false;
  const terminar = () => {
    if (terminado || turno !== turnoVoz) return;
    terminado = true;
    audioActual = null;
    // Un instante de margen para que no se escuche a sí misma.
    setTimeout(() => {
      if (turno === turnoVoz) oido.pausado = false;
    }, 350);
    if (estadoReactor === "hablando") ponerEstado(null);
    if (luegoEscuchar) void escucharOrden();
  };

  if (estado?.vozNatural) {
    try {
      const res = await fetch(conToken("/api/hablar"), {
        method: "POST",
        headers: cabeceras({ "Content-Type": "application/json" }),
        body: JSON.stringify({ texto: limpio }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      if (turno !== turnoVoz) return URL.revokeObjectURL(url);
      const audio = new Audio(url);
      audioActual = audio;
      audio.onended = audio.onerror = () => {
        URL.revokeObjectURL(url);
        terminar();
      };
      await audio.play();
      return;
    } catch {
      if (turno !== turnoVoz) return;
    }
  }
  hablarConSistema(limpio, terminar);
}

function hablarConSistema(texto, alTerminar) {
  if (!("speechSynthesis" in window)) return alTerminar();
  // Chrome corta los textos largos: se lee frase por frase.
  const frases = texto.match(/[^.!?…]+[.!?…]*/g) ?? [texto];
  frases.forEach((frase, i) => {
    const u = new SpeechSynthesisUtterance(frase.trim());
    if (vozElegida) u.voice = vozElegida;
    u.lang = vozElegida?.lang ?? "es-AR";
    u.rate = 1.05;
    if (i === frases.length - 1) u.onend = u.onerror = alTerminar;
    speechSynthesis.speak(u);
  });
  // A veces el navegador no avisa que terminó.
  setTimeout(alTerminar, 4000 + texto.length * 90);
}

function callar() {
  turnoVoz++;
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  audioActual?.pause();
  audioActual = null;
  if (movil) window.Android.callar();
  oido.pausado = false;
  if (estadoReactor === "hablando") ponerEstado(null);
}

function dibujarBotonVoz() {
  const boton = $("#boton-voz");
  boton.replaceChildren(icono(vozActiva ? "i-parlante" : "i-mudo"));
  boton.title = vozActiva ? "Silenciar la voz de Jarvis" : "Activar la voz de Jarvis";
}

// Tono corto cuando te escucha decir "Jarvis".
function sonarAtencion() {
  try {
    const ctx = oido.ctx ?? new AudioContext();
    const t = ctx.currentTime;
    for (const [frecuencia, inicio] of [[880, 0], [1320, 0.09]]) {
      const osc = ctx.createOscillator();
      const vol = ctx.createGain();
      osc.frequency.value = frecuencia;
      vol.gain.setValueAtTime(0.0001, t + inicio);
      vol.gain.exponentialRampToValueAtTime(0.12, t + inicio + 0.02);
      vol.gain.exponentialRampToValueAtTime(0.0001, t + inicio + 0.14);
      osc.connect(vol).connect(ctx.destination);
      osc.start(t + inicio);
      osc.stop(t + inicio + 0.16);
    }
  } catch {}
}

// ---------- Oído: escucha continua con la palabra "Jarvis" ----------

// Whisper a veces escribe "Jarvis" de otras formas.
const PALABRA_CLAVE = /\b(jarvis|yarvis|jarbis|yarbis|charvis|jervis|harvis|jarvi|yarvi)\b/i;
// Frases que Whisper inventa cuando solo hay ruido.
const ALUCINACIONES = /amara\.org|gracias por ver|suscr[ií]b|subt[ií]tulos|^\W*$/i;
const MAX_PASIVAS_POR_MINUTO = 8;

const oido = {
  continuo: leerLocal("jarvis-continuo", "1") === "1",
  activo: false,
  abriendo: null,
  pausado: false,
  ocupado: false,
  comandoHasta: 0,
  ctx: null,
  stream: null,
  frecuencia: 48000,
  acumulado: [],
  largoAcumulado: 0,
  pre: [],
  segmento: null,
  inicioSegmento: 0,
  voz: 0,
  hablado: 0,
  silencio: 0,
  ruido: 0.006,
  pasivas: [],
};

function escuchandoOrden() {
  return oido.comandoHasta > Date.now();
}

function actualizarPista() {
  const pista = $("#voz-pista");
  const boton = $("#microfono");
  boton.classList.toggle("continuo", oido.continuo);
  boton.title = oido.continuo ? "Escucha continua activada: tocá para apagarla" : "Escucha continua apagada: tocá para que te escuche siempre";
  if (estadoReactor === "escuchando") pista.textContent = "Te escucho…";
  else if (estadoReactor === "pensando") pista.textContent = "Pensando…";
  else if (estadoReactor === "hablando") pista.textContent = "Tocá el reactor para interrumpirla";
  else if (estado && !estado.voz && !movil) pista.textContent = "Para escucharte falta GROQ_API_KEY en el .env";
  else if (oido.ctx?.state === "suspended") pista.textContent = "Tocá la pantalla para activar el micrófono";
  else pista.textContent = oido.continuo ? "Decí «Jarvis» y lo que necesites" : "Tocá el reactor para hablar";
}

async function abrirMicrofono() {
  if (oido.activo) return true;
  if (oido.abriendo) return oido.abriendo;
  oido.abriendo = (async () => {
    try {
      oido.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch {
      agregarLinea("jarvis error", "No tengo permiso para usar el micrófono.");
      return false;
    }
    oido.ctx = new AudioContext();
    oido.frecuencia = oido.ctx.sampleRate;
    const codigo =
      'class Captura extends AudioWorkletProcessor { process(e) { const c = e[0] && e[0][0]; if (c) this.port.postMessage(c.slice(0)); return true; } } registerProcessor("captura", Captura);';
    await oido.ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([codigo], { type: "text/javascript" })));
    const nodo = new AudioWorkletNode(oido.ctx, "captura");
    nodo.port.onmessage = (e) => recibirAudio(e.data);
    const mudo = oido.ctx.createGain();
    mudo.gain.value = 0;
    oido.ctx.createMediaStreamSource(oido.stream).connect(nodo);
    nodo.connect(mudo).connect(oido.ctx.destination);
    oido.activo = true;
    actualizarPista();
    return true;
  })();
  const resultado = await oido.abriendo;
  oido.abriendo = null;
  return resultado;
}

function cerrarMicrofono() {
  if (!oido.activo) return;
  oido.activo = false;
  oido.stream?.getTracks().forEach((t) => t.stop());
  void oido.ctx?.close();
  oido.ctx = null;
  oido.segmento = null;
  oido.pre = [];
  mostrarNivel(0);
}

function recibirAudio(muestras) {
  oido.acumulado.push(muestras);
  oido.largoAcumulado += muestras.length;
  const tamBloque = Math.round(oido.frecuencia * 0.03);
  if (oido.largoAcumulado < tamBloque) return;
  const bloque = new Float32Array(oido.largoAcumulado);
  let pos = 0;
  for (const m of oido.acumulado) {
    bloque.set(m, pos);
    pos += m.length;
  }
  oido.acumulado = [];
  oido.largoAcumulado = 0;
  analizar(bloque);
}

let ultimoNivel = 0;
function mostrarNivel(rms) {
  const ahora = performance.now();
  if (ahora - ultimoNivel < 60) return;
  ultimoNivel = ahora;
  $("#nivel").style.setProperty("--nivel", Math.min(1, rms * 12).toFixed(2));
}

function analizar(bloque) {
  let suma = 0;
  for (const x of bloque) suma += x * x;
  const rms = Math.sqrt(suma / bloque.length);
  mostrarNivel(rms);

  if (oido.pausado || oido.ocupado) {
    oido.segmento = null;
    oido.pre = [];
    oido.voz = 0;
    return;
  }
  const umbral = Math.max(0.012, oido.ruido * 3.2);
  const duracion = bloque.length / oido.frecuencia;

  if (!oido.segmento) {
    oido.pre.push(bloque);
    while (oido.pre.length * duracion > 0.45) oido.pre.shift();
    if (rms > umbral) {
      oido.voz += duracion;
      if (oido.voz >= 0.09) {
        oido.segmento = [...oido.pre];
        oido.inicioSegmento = Date.now();
        oido.hablado = oido.voz;
        oido.silencio = 0;
      }
    } else {
      oido.voz = 0;
      oido.ruido = oido.ruido * 0.97 + rms * 0.03;
    }
  } else {
    oido.segmento.push(bloque);
    if (rms > umbral * 0.8) {
      oido.hablado += duracion;
      oido.silencio = 0;
    } else {
      oido.silencio += duracion;
    }
    if (oido.silencio > 0.85 || oido.segmento.length * duracion > 14) cerrarSegmento();
  }

  // Se terminó el tiempo para dar la orden sin decir "Jarvis".
  if (oido.comandoHasta && !escuchandoOrden() && !oido.segmento) {
    oido.comandoHasta = 0;
    if (estadoReactor === "escuchando") ponerEstado(null);
    if (!oido.continuo) cerrarMicrofono();
  }
}

function cerrarSegmento() {
  const trozos = oido.segmento;
  oido.segmento = null;
  oido.voz = 0;
  if (oido.hablado < 0.3) return;
  const esOrden = oido.inicioSegmento <= oido.comandoHasta;
  if (esOrden) {
    oido.comandoHasta = 0;
  } else {
    if (!oido.continuo) return;
    // Si hay mucho ruido (tele, música), se vuelve menos sensible en vez de gastar cupo.
    const ahora = Date.now();
    oido.pasivas = oido.pasivas.filter((t) => ahora - t < 60_000);
    if (oido.pasivas.length >= MAX_PASIVAS_POR_MINUTO) {
      oido.ruido *= 1.5;
      return;
    }
    oido.pasivas.push(ahora);
  }
  void entender(codificarWav(trozos, oido.frecuencia), esOrden);
}

async function entender(wav, esOrden) {
  oido.ocupado = true;
  if (esOrden) ponerEstado("pensando");
  let texto = "";
  try {
    texto = ((await api("/api/transcribir", { metodo: "POST", cuerpo: wav, tipo: "audio/wav" })).texto || "").trim();
  } catch (err) {
    if (esOrden) agregarLinea("jarvis error", err.message);
  }
  oido.ocupado = false;
  if (ALUCINACIONES.test(texto)) texto = "";

  if (!esOrden) {
    const encontrada = texto.match(PALABRA_CLAVE);
    // Solo si la nombran al principio ("Jarvis…", "Che Jarvis…"), no en medio de otra charla.
    if (!encontrada || encontrada.index > 15) return;
    if (estado && !estado.activa) return;
    escritorio?.mostrar();
    const resto = texto.slice(encontrada.index + encontrada[0].length).replace(/^[\s,.;:!¡¿?]+/, "").trim();
    if (resto.replace(/[^\p{L}\p{N}]/gu, "").length >= 3) {
      await preguntar(resto, "voz");
      return;
    }
    sonarAtencion();
    void escucharOrden();
    return;
  }
  if (!texto) {
    ponerEstado(null);
    return;
  }
  await preguntar(texto, "voz");
}

// Audio a WAV de 16 kHz mono: liviano y lo entienden Whisper y Gemini.
function codificarWav(trozos, frecuencia) {
  const total = trozos.reduce((n, t) => n + t.length, 0);
  const datos = new Float32Array(total);
  let pos = 0;
  for (const t of trozos) {
    datos.set(t, pos);
    pos += t.length;
  }
  const factor = frecuencia / 16000;
  const largo = Math.floor(total / factor);
  const buffer = new ArrayBuffer(44 + largo * 2);
  const v = new DataView(buffer);
  const texto = (p, s) => [...s].forEach((c, i) => v.setUint8(p + i, c.charCodeAt(0)));
  texto(0, "RIFF");
  v.setUint32(4, 36 + largo * 2, true);
  texto(8, "WAVE");
  texto(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true);
  v.setUint32(28, 32000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  texto(36, "data");
  v.setUint32(40, largo * 2, true);
  for (let i = 0; i < largo; i++) {
    const desde = Math.floor(i * factor);
    const hasta = Math.min(total, Math.floor((i + 1) * factor));
    let s = 0;
    for (let j = desde; j < hasta; j++) s += datos[j];
    const muestra = Math.max(-1, Math.min(1, s / Math.max(1, hasta - desde)));
    v.setInt16(44 + i * 2, muestra < 0 ? muestra * 0x8000 : muestra * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

const Reconocimiento = window.SpeechRecognition || window.webkitSpeechRecognition;

// Escucha una orden ya (sin decir "Jarvis"): al tocar el reactor, con Alt+H o después de una pregunta.
async function escucharOrden() {
  callar();
  if (movil) {
    ponerEstado("escuchando");
    window.Android.escuchar();
    return;
  }
  if (!estado?.voz) {
    if (Reconocimiento) return escucharConNavegador();
    agregarLinea("jarvis error", "Para escucharte necesito GROQ_API_KEY (gratis) o GEMINI_API_KEY en el .env.");
    return;
  }
  if (!(await abrirMicrofono())) return;
  void oido.ctx.resume();
  oido.comandoHasta = Date.now() + 7000;
  ponerEstado("escuchando");
}

function cancelarEscucha() {
  oido.comandoHasta = 0;
  oido.segmento = null;
  if (estadoReactor === "escuchando") ponerEstado(null);
  if (!oido.continuo) cerrarMicrofono();
}

function escucharConNavegador() {
  const r = new Reconocimiento();
  r.lang = "es-AR";
  r.interimResults = false;
  ponerEstado("escuchando");
  r.onresult = (e) => {
    const texto = e.results[0]?.[0]?.transcript;
    if (texto) void preguntar(texto, "voz");
  };
  r.onend = () => {
    if (estadoReactor === "escuchando") ponerEstado(null);
  };
  r.onerror = () => r.onend();
  r.start();
}

async function alternarContinuo() {
  oido.continuo = !oido.continuo;
  guardarLocal("jarvis-continuo", oido.continuo ? "1" : "0");
  if (movil) window.Android.escuchaContinua(oido.continuo);
  else if (oido.continuo) await abrirMicrofono();
  else if (!escuchandoOrden()) cerrarMicrofono();
  actualizarPista();
}

// Puente con la app de Android: el celular escucha y habla con su propio motor.
window.jarvisMovil = {
  mostrar(texto) {
    agregarLinea("jarvis", texto);
  },
  oido(texto) {
    if (texto) void preguntar(texto, "voz");
    else ponerEstado(null);
  },
  estado(nombre) {
    ponerEstado(nombre || null);
  },
  nivel(valor) {
    mostrarNivel(valor);
  },
  finHablar() {
    if (estadoReactor === "hablando") ponerEstado(null);
    if (movilLuegoEscuchar) {
      movilLuegoEscuchar = false;
      void escucharOrden();
    }
  },
};

// ---------- Avisos y borradores ----------

let avisos = [];
const propuestas = new Map();
const editando = new Set();
const textosEditados = new Map();

function crearBorrador(p) {
  const canal = p.app || (p.canal === "email" ? "Mail" : "WhatsApp");
  const caja = el(
    "div",
    { class: "borrador" },
    el("span", { class: "borrador-titulo" }, `Respuesta sugerida · ${canal} a ${p.paraNombre}`),
    p.asunto ? el("small", {}, `Asunto: ${p.asunto}`) : null,
  );
  if (p.estado === "enviada" || p.estado === "descartada") {
    caja.append(el("p", {}, p.texto), el("span", { class: "estado-final" }, p.estado === "enviada" ? "✓ ENVIADA" : "DESCARTADA"));
    return caja;
  }
  const enEdicion = editando.has(p.id);
  const area = enEdicion
    ? el("textarea", { "data-propuesta": p.id, oninput: (e) => textosEditados.set(p.id, e.target.value) })
    : null;
  if (area) area.value = textosEditados.get(p.id) ?? p.texto;

  const acciones = el("div", { class: "acciones" });
  const ocupar = () => acciones.querySelectorAll("button").forEach((b) => (b.disabled = true));
  const enviar = el(
    "button",
    {
      type: "button",
      class: "principal",
      onclick: async () => {
        ocupar();
        try {
          const cambios = enEdicion ? { texto: area.value } : {};
          const actualizada = await api(`/api/propuestas/${p.id}/enviar`, { metodo: "POST", json: cambios });
          editando.delete(p.id);
          textosEditados.delete(p.id);
          propuestas.set(p.id, actualizada);
        } catch (err) {
          agregarLinea("jarvis error", err.message);
        }
        dibujarAvisos();
      },
    },
    "ENVIAR",
  );
  acciones.append(enviar);
  if (enEdicion) {
    acciones.append(
      el("button", { type: "button", onclick: () => (editando.delete(p.id), textosEditados.delete(p.id), dibujarAvisos()) }, "CANCELAR"),
    );
  } else {
    acciones.append(
      el("button", { type: "button", onclick: () => (editando.add(p.id), dibujarAvisos(), document.querySelector(`textarea[data-propuesta="${p.id}"]`)?.focus()) }, "EDITAR"),
      el(
        "button",
        {
          type: "button",
          onclick: async () => {
            ocupar();
            try {
              propuestas.set(p.id, await api(`/api/propuestas/${p.id}/descartar`, { metodo: "POST" }));
            } catch (err) {
              agregarLinea("jarvis error", err.message);
            }
            dibujarAvisos();
          },
        },
        "DESCARTAR",
      ),
    );
  }
  caja.append(area ?? el("p", {}, p.texto));
  if (!enEdicion) caja.append(el("span", { class: "borrador-pista" }, "Decile: «mandala», «cambiale…» o «descartala»"));
  if (p.error) caja.append(el("span", { class: "falla" }, `No se pudo enviar: ${p.error}`));
  caja.append(acciones);
  return caja;
}

function dibujarAvisos() {
  const enfocado = document.activeElement?.dataset?.propuesta;
  const usadas = new Set(avisos.map((a) => a.propuestaId).filter(Boolean));
  // Borradores pedidos por chat, que no responden a ningún aviso.
  const sueltos = [...propuestas.values()].filter((p) => !usadas.has(p.id) && p.estado === "pendiente");
  const items = [
    ...sueltos.map((p) => ({ fecha: p.fecha, nodo: el("li", { class: "aviso alta" }, crearBorrador(p)) })),
    ...avisos.map((a) => {
      const propuesta = a.propuestaId ? propuestas.get(a.propuestaId) : null;
      return {
        fecha: a.fecha,
        nodo: el(
          "li",
          { class: `aviso ${a.importancia}` },
          el(
            "div",
            { class: "aviso-cabeza" },
            icono(ICONOS_CANAL[a.canal] ?? "i-campana"),
            el("b", {}, a.de),
            el("time", { datetime: a.fecha, title: new Date(a.fecha).toLocaleString(LOCALE) }, haceCuanto(a.fecha)),
          ),
          el("p", {}, a.resumen || a.titulo),
          propuesta ? crearBorrador(propuesta) : null,
        ),
      };
    }),
  ].sort((x, y) => y.fecha.localeCompare(x.fecha));

  const lista = $("#avisos");
  lista.replaceChildren(...(items.length ? items.map((i) => i.nodo) : [el("li", { class: "vacio" }, "Todo tranquilo por ahora.")]));
  const pendientes = [...propuestas.values()].filter((p) => p.estado === "pendiente").length;
  $("#contador-avisos").textContent = pendientes ? `${pendientes} por aprobar` : "";
  if (enfocado) {
    const area = lista.querySelector(`textarea[data-propuesta="${enfocado}"]`);
    if (area) {
      area.focus();
      area.setSelectionRange(area.value.length, area.value.length);
    }
  }
}

function notificarSistema(texto) {
  if (!("Notification" in window) || Notification.permission !== "granted" || (document.hasFocus() && !document.hidden)) return;
  new Notification("Jarvis", { body: texto, silent: true });
}

// ---------- Recordatorios ----------

function dibujarRecordatorios(lista) {
  const proximos = lista.filter((r) => !r.avisado).sort((a, b) => a.cuando.localeCompare(b.cuando)).slice(0, 6);
  $("#recordatorios").replaceChildren(
    ...(proximos.length
      ? proximos.map((r) => {
          const fecha = new Date(r.cuando);
          const esHoy = fecha.toDateString() === new Date().toDateString();
          const cuando = esHoy
            ? fecha.toLocaleTimeString(LOCALE, HORA)
            : fecha.toLocaleString(LOCALE, { day: "numeric", month: "short", ...HORA });
          return el("li", {}, el("span", {}, r.texto), el("time", { datetime: r.cuando }, cuando));
        })
      : [el("li", { class: "vacio" }, "Sin recordatorios. Pedíselos a Jarvis.")]),
  );
}

// ---------- Clima ----------

function iconoClima(nombre, esDeDia = true) {
  if (nombre === "sol" && !esDeDia) return "i-luna";
  return `i-${nombre}`;
}

async function actualizarClima() {
  try {
    const c = await api("/api/clima");
    $("#clima-lugar").textContent = c.lugar;
    $("#clima-actualizado").textContent = `Actualizado ${new Date(c.actualizado).toLocaleTimeString(LOCALE, HORA)}`;
    $("#clima-icono").replaceChildren(...icono(iconoClima(c.actual.icono, c.actual.esDeDia)).childNodes);
    $("#clima-temp").textContent = `${c.actual.temperatura}°`;
    $("#clima-estado").textContent = c.actual.estado;
    const filas = [
      ["Sensación", `${c.actual.sensacion}°`],
      ["Humedad", `${c.actual.humedad}%`],
      ["Viento", `${c.actual.viento} km/h`],
      ["Lluvia", `${c.actual.precipitacion} mm`],
      ["Sale el sol", c.salidaSol],
      ["Se pone", c.puestaSol],
    ];
    $("#clima-datos").replaceChildren(...filas.map(([k, v]) => el("div", {}, el("dt", {}, k), el("dd", {}, v))));
    $("#pronostico").replaceChildren(
      ...c.dias.map((d, i) => {
        const fecha = new Date(`${d.fecha}T12:00:00`);
        const nombre = i === 0 ? "Hoy" : i === 1 ? "Mañana" : fecha.toLocaleDateString(LOCALE, { weekday: "long" });
        const corto = i === 0 ? "Hoy" : fecha.toLocaleDateString(LOCALE, { weekday: "short" }).replace(".", "");
        return el(
          "li",
          { title: `${d.estado} · ${d.lluvia}% de lluvia` },
          el(
            "div",
            {},
            el(
              "span",
              { class: "dia" },
              el("span", { class: "dia-largo" }, nombre.charAt(0).toUpperCase() + nombre.slice(1)),
              el("span", { class: "dia-corto" }, corto.charAt(0).toUpperCase() + corto.slice(1)),
            ),
            el("span", { class: "detalle" }, fecha.toLocaleDateString(LOCALE, { day: "numeric", month: "short" })),
            el("span", { class: "temps" }, `${d.maxima}° / ${d.minima}°`),
            el("span", { class: "detalle" }, d.lluvia ? `${d.estado} · ${d.lluvia}%` : d.estado),
          ),
          icono(iconoClima(d.icono), "icono-clima"),
        );
      }),
    );
  } catch (err) {
    $("#clima-estado").textContent = err.message;
  }
}

// ---------- Noticias ----------

async function actualizarNoticias() {
  try {
    const lista = await api("/api/noticias");
    $("#noticias").replaceChildren(
      ...lista.map((n) =>
        el(
          "li",
          {},
          el("a", { href: n.url, target: "_blank", rel: "noopener" }, n.titulo, el("small", {}, [n.fuente, n.fecha && haceCuanto(n.fecha)].filter(Boolean).join(" · "))),
        ),
      ),
    );
  } catch (err) {
    $("#noticias").replaceChildren(el("li", { class: "vacio" }, `No pude cargar noticias: ${err.message}`));
  }
}

// ---------- Accesos rápidos alrededor del reactor ----------

function ubicarAccesos() {
  const contenedor = $("#accesos");
  const caja = $(".centro").getBoundingClientRect();
  const reactor = $("#reactor").getBoundingClientRect();
  const cx = reactor.left - caja.left + reactor.width / 2;
  const cy = reactor.top - caja.top + reactor.height / 2;
  const radio = reactor.width / 2 + 14;
  contenedor.replaceChildren(
    ...ACCESOS.map(([nombre, url], i) => {
      const angulo = ((145 + (i * 70) / (ACCESOS.length - 1)) * Math.PI) / 180;
      const x = cx + radio * Math.cos(angulo);
      const y = cy + radio * Math.sin(angulo);
      if (x < 90) return null;
      return el("a", { href: url, target: "_blank", rel: "noopener", style: `left:${x}px;top:${y}px` }, nombre);
    }).filter(Boolean),
  );
}

function dibujarMarcas() {
  const ns = "http://www.w3.org/2000/svg";
  const grupo = $("#marcas");
  for (let i = 0; i < 120; i++) {
    const angulo = (i * 3 * Math.PI) / 180;
    const larga = i % 10 === 0;
    const linea = document.createElementNS(ns, "line");
    const r1 = larga ? 190 : 193;
    linea.setAttribute("x1", (r1 * Math.cos(angulo)).toFixed(2));
    linea.setAttribute("y1", (r1 * Math.sin(angulo)).toFixed(2));
    linea.setAttribute("x2", (199 * Math.cos(angulo)).toFixed(2));
    linea.setAttribute("y2", (199 * Math.sin(angulo)).toFixed(2));
    if (larga) linea.setAttribute("class", "larga");
    grupo.append(linea);
  }
}

// ---------- Eventos en vivo ----------

function conectarEventos() {
  const fuente = new EventSource(conToken("/api/eventos"));
  const al = (tipo, fn) => fuente.addEventListener(tipo, (e) => fn(JSON.parse(e.data)));

  al("estado", dibujarEstado);
  al("activa", ({ activa }) => estado && dibujarEstado({ ...estado, activa }));
  al("aviso", ({ aviso, propuesta, hablar: debeHablar }) => {
    if (propuesta) propuestas.set(propuesta.id, propuesta);
    avisos.unshift(aviso);
    avisos = avisos.slice(0, 40);
    dibujarAvisos();
    if (movil) {
      dibujarHoy();
      if (aviso.canal === "email") void cargarCorreo(true);
    }
    // En el celular, si la app no está a la vista, el aviso lo da el servicio de Android.
    if (debeHablar && !(movil && document.hidden)) {
      // Se abre sola para decirte algo y, si hay respuesta sugerida, te la lee y espera tu "mandala".
      escritorio?.mostrar();
      const lectura = !propuesta
        ? ""
        : propuesta.texto.length <= 280
          ? ` Te propongo responderle: ${propuesta.texto} ¿Se la mando?`
          : " Te dejé una respuesta preparada en pantalla. ¿Se la mando?";
      agregarLinea("jarvis", aviso.texto + lectura);
      notificarSistema(aviso.texto);
      hablar(aviso.texto + lectura, { luegoEscuchar: Boolean(propuesta) });
    }
  });
  al("propuesta", (p) => {
    propuestas.set(p.id, p);
    dibujarAvisos();
  });
  al("recordatorios", dibujarRecordatorios);
  al("tareas", (d) => {
    tareasDatos = d;
    dibujarTareas();
  });
  al("historial", ({ canal, pregunta, respuesta }) => {
    // Lo que se habló por Telegram o por la API también aparece acá.
    if (canal === "telegram" || canal === "api") {
      agregarLinea("yo", `(${canal}) ${pregunta}`);
      agregarLinea("jarvis", respuesta);
    }
  });
  al("whatsapp_qr", ({ qr }) => mostrarQr(qr));
  fuente.onerror = () => {
    $("#marca-estado").textContent = "RECONECTANDO…";
  };
}

// ---------- Lo que Jarvis hace sola (celular): hoy, agenda, tareas, rutinas y correo ----------

let tareasDatos = { tareas: [], rutinas: [] };
let agendaDatos = [];
let correoDatos = null;

const PEDIDOS_RAPIDOS = [
  ["REVISÁ TODO", null],
  ["¿QUÉ TENGO HOY?", "¿Qué tengo hoy? Agenda, tareas y lo que esté pendiente."],
  ["MIS MAILS", "Entrá a mi correo y decime lo importante de lo que no leí."],
  ["MENSAJES", "¿Qué mensajes me llegaron hoy? Resumímelos."],
  ["RESUMEN DEL DÍA", "Dame el resumen del día."],
  ["MIS TAREAS", "¿Qué tareas tengo pendientes?"],
];

function dibujarPedidos() {
  $("#chips").replaceChildren(
    ...PEDIDOS_RAPIDOS.map(([rotulo, pedido]) =>
      el("button", { type: "button", onclick: () => (pedido ? void preguntar(pedido, "voz") : void revisarAhora()) }, rotulo),
    ),
  );
}

async function revisarAhora() {
  agregarLinea("yo", "Revisá todo.");
  ponerEstado("pensando");
  try {
    const r = await api("/api/revisar", { metodo: "POST" });
    ponerEstado(null);
    // Si encontró algo, el aviso llega solo (y se dice en voz alta); si no, lo cuenta acá.
    if (!r.dijo) {
      agregarLinea("jarvis", r.texto);
      hablar(r.texto);
    }
  } catch (err) {
    ponerEstado(null);
    agregarLinea("jarvis error", err.message);
  }
  void cargarTrabajo();
}

function horaCorta(iso) {
  return new Date(iso).toLocaleTimeString(LOCALE, HORA);
}

function dibujarHoy() {
  if (!estado?.movil) return;
  const ahora = Date.now();
  const proximo = agendaDatos.find((e) => !e.todoElDia && new Date(e.inicio).getTime() > ahora - 5 * 60_000);
  const pendientes = tareasDatos.tareas.filter((t) => t.estado === "pendiente");
  const noLeidos = (estado.email ?? []).reduce((n, c) => n + (c.noLeidos || 0), 0);
  const borradores = [...propuestas.values()].filter((p) => p.estado === "pendiente").length;
  const hoyTexto = new Date().toDateString();
  const avisosHoy = avisos.filter((a) => new Date(a.fecha).toDateString() === hoyTexto).length;
  const dato = (rotulo, valor, detalle, ancho) => el("li", { class: ancho ? "ancho" : "" }, el("span", {}, rotulo), el("b", {}, valor), detalle ? el("small", {}, detalle) : null);
  $("#hoy").replaceChildren(
    dato(
      "Próximo",
      proximo ? horaCorta(proximo.inicio) : "—",
      proximo ? `${proximo.titulo}${new Date(proximo.inicio).toDateString() === hoyTexto ? "" : " · " + proximo.cuando}` : "Nada más en la agenda",
      true,
    ),
    dato("Tareas", String(pendientes.length), pendientes[0]?.texto ?? "Al día"),
    dato("Mails sin leer", estado.email?.length ? String(noLeidos) : "—", estado.email?.length ? estado.email[0].cuenta : "Cargá tu Gmail en ⚙"),
    dato("Por aprobar", String(borradores), borradores ? "Respuestas listas para mandar" : "Nada esperando"),
    dato("Avisos hoy", String(avisosHoy), avisos[0] ? `Último: ${avisos[0].de}` : "Todo tranquilo"),
    dato(
      "Modo autónomo",
      estado.autonomo ? "ACTIVO" : "APAGADO",
      estado.autonomo
        ? estado.ultimaRevision
          ? `Revisó todo a las ${horaCorta(estado.ultimaRevision)} · vuelve cada 30 min`
          : "Revisa correo, mensajes y agenda cada 30 min"
        : "Activalo en ⚙ Ajustes → Trabajar sola",
      true,
    ),
  );
  $("#modo-autonomo").textContent = estado.autonomo && estado.activa ? "AUTÓNOMA" : "";
}

function dibujarAgenda() {
  const lista = agendaDatos.slice(0, 8);
  const hoyTexto = new Date().toDateString();
  $("#agenda").replaceChildren(
    ...(lista.length
      ? lista.map((e) => {
          const fecha = new Date(e.inicio);
          const cuando = e.todoElDia
            ? fecha.toDateString() === hoyTexto ? "HOY" : fecha.toLocaleDateString(LOCALE, { weekday: "short", day: "numeric" })
            : fecha.toDateString() === hoyTexto ? horaCorta(e.inicio) : fecha.toLocaleString(LOCALE, { weekday: "short", ...HORA });
          return el("li", {}, el("span", {}, e.titulo), el("time", { datetime: e.inicio }, cuando), e.lugar ? el("small", {}, e.lugar) : null);
        })
      : [el("li", { class: "vacio" }, "Nada en los próximos 3 días.")]),
  );
}

function dibujarTareas() {
  const { tareas, rutinas } = tareasDatos;
  const pendientes = tareas.filter((t) => t.estado === "pendiente");
  $("#contador-tareas").textContent = pendientes.length ? String(pendientes.length) : "";
  const visibles = [...pendientes, ...tareas.filter((t) => t.estado !== "pendiente").slice(0, 3)].slice(0, 12);
  $("#tareas").replaceChildren(
    ...(visibles.length
      ? visibles.map((t) => {
          const hecha = t.estado !== "pendiente";
          const detalle = [t.origen === "jarvis" ? "La anotó Jarvis" : "", t.para ? `Para ${new Date(t.para).toLocaleString(LOCALE, { day: "numeric", month: "short", ...HORA })}` : ""]
            .filter(Boolean)
            .join(" · ");
          return el(
            "li",
            { class: hecha ? "hecha" : "" },
            el("button", { type: "button", class: "marcar", title: hecha ? "Hecha" : "Marcar como hecha", onclick: () => !hecha && void completarTarea(t.id) }, hecha ? "✓" : ""),
            el("span", {}, t.texto),
            el("button", { type: "button", class: "enlace-boton", title: "Borrar", onclick: () => void borrarTrabajo("tareas", t.id) }, "✕"),
            detalle ? el("small", { class: t.origen === "jarvis" ? "jarvis" : "" }, detalle) : null,
          );
        })
      : [el("li", { class: "vacio" }, "Sin tareas. Jarvis anota sola las que salen de tus mails y mensajes.")]),
  );
  $("#rutinas").replaceChildren(
    ...(rutinas.length
      ? rutinas.map((r) =>
          el(
            "li",
            {},
            el("span", {}, r.texto),
            el("time", {}, `${r.hora}${r.dias && r.dias !== "todos" ? " · " + r.dias : ""}`),
            el("small", {}, el("button", { type: "button", class: "enlace-boton", onclick: () => void borrarTrabajo("rutinas", r.id) }, "BORRAR")),
          ),
        )
      : [el("li", { class: "vacio" }, "Pedile: «todos los días a las 9 revisá mis mails y decime lo importante».")]),
  );
  dibujarHoy();
}

function dibujarCorreo() {
  const d = correoDatos;
  if (!d) return;
  const total = (d.cuentas ?? []).reduce((n, c) => n + (c.noLeidos || 0), 0);
  $("#contador-correo").textContent = total ? String(total) : "";
  let filas;
  if (!d.configurado) {
    filas = [el("li", { class: "vacio" }, "Cargá tu Gmail y su contraseña de aplicación en ⚙ Ajustes: Jarvis entra directo a tu bandeja.")];
  } else if (d.error && !d.mails.length) {
    filas = [el("li", { class: "vacio" }, d.error)];
  } else if (!d.mails.length) {
    filas = [el("li", { class: "vacio" }, "Bandeja al día: nada sin leer.")];
  } else {
    filas = d.mails.map((m) => el("li", {}, el("span", {}, m.asunto || "(sin asunto)"), el("time", { datetime: m.fecha }, haceCuanto(m.fecha)), el("small", {}, `${m.de} — ${m.texto}`)));
  }
  $("#correo").replaceChildren(...filas);
}

async function completarTarea(id) {
  try {
    await api(`/api/tareas/${encodeURIComponent(id)}/hecha`, { metodo: "POST" });
  } catch (err) {
    agregarLinea("jarvis error", err.message);
  }
}

async function borrarTrabajo(lista, id) {
  try {
    await api(`/api/${lista}/${encodeURIComponent(id)}`, { metodo: "DELETE" });
  } catch (err) {
    agregarLinea("jarvis error", err.message);
  }
}

async function cargarTrabajo() {
  if (!movil) return;
  const [trabajo, agenda] = await Promise.all([api("/api/tareas").catch(() => null), api("/api/agenda").catch(() => null)]);
  if (trabajo) tareasDatos = trabajo;
  if (agenda) agendaDatos = agenda;
  dibujarAgenda();
  dibujarTareas();
}

async function cargarCorreo(refrescar = false) {
  if (!movil) return;
  correoDatos = await api(`/api/correo${refrescar ? "?refrescar=1" : ""}`).catch(() => correoDatos);
  dibujarCorreo();
  dibujarHoy();
}

function iniciarTrabajo() {
  if (!movil) return;
  for (const id of ["chips", "panel-hoy", "panel-agenda", "panel-tareas", "panel-correo"]) $(`#${id}`).hidden = false;
  dibujarPedidos();
  $("#nueva-tarea").addEventListener("submit", async (e) => {
    e.preventDefault();
    const campo = e.target.elements.texto;
    const texto = campo.value.trim();
    if (!texto) return;
    campo.value = "";
    try {
      await api("/api/tareas", { metodo: "POST", json: { texto } });
    } catch (err) {
      agregarLinea("jarvis error", err.message);
    }
  });
  void cargarTrabajo();
  void cargarCorreo();
  setInterval(cargarTrabajo, 5 * 60_000);
  setInterval(cargarCorreo, 4 * 60_000);
}

// ---------- Arranque ----------

async function cargarInicial() {
  const [lista, borradores, recordatorios, historial] = await Promise.all([
    api("/api/avisos?cantidad=40").catch(() => []),
    api("/api/propuestas").catch(() => []),
    api("/api/recordatorios").catch(() => []),
    api("/api/historial").catch(() => []),
  ]);
  avisos = lista;
  for (const p of borradores) propuestas.set(p.id, p);
  dibujarAvisos();
  dibujarRecordatorios(recordatorios);
  for (const m of historial.slice(-6)) agregarLinea(m.rol === "user" ? "yo" : "jarvis", m.texto);
}

function iniciar() {
  aplicarModo();
  dibujarMarcas();
  tic();
  setInterval(tic, 1000);
  void actualizarSistema();
  setInterval(actualizarSistema, 2000);
  void iniciarBateria();
  void actualizarClima();
  setInterval(actualizarClima, 15 * 60_000);
  void actualizarNoticias();
  setInterval(actualizarNoticias, 15 * 60_000);
  setInterval(() => document.querySelectorAll("time[datetime]").forEach((t) => {
    if (t.closest(".aviso")) t.textContent = haceCuanto(t.getAttribute("datetime"));
  }), 60_000);
  void cargarInicial();
  conectarEventos();
  iniciarTrabajo();
  dibujarBotonVoz();
  actualizarPista();
  if (movil) window.Android.escuchaContinua(oido.continuo);
  requestAnimationFrame(ubicarAccesos);
  window.addEventListener("resize", () => {
    aplicarModo();
    tic();
    ubicarAccesos();
    $(".clima").classList.toggle("compacto", innerWidth <= 1400);
  });
  $(".clima").classList.toggle("compacto", innerWidth <= 1400);

  if ("speechSynthesis" in window) {
    elegirVoz();
    speechSynthesis.addEventListener("voiceschanged", elegirVoz);
  }

  $("#reactor").addEventListener("click", () => {
    if (estadoReactor === "hablando") callar();
    if (estadoReactor === "escuchando") return cancelarEscucha();
    void escucharOrden();
  });
  $("#microfono").addEventListener("click", () => void alternarContinuo());
  $("#boton-voz").addEventListener("click", () => {
    vozActiva = !vozActiva;
    guardarLocal("jarvis-voz", vozActiva ? "1" : "0");
    if (!vozActiva) callar();
    dibujarBotonVoz();
  });
  $("#interruptor").addEventListener("click", async () => {
    try {
      await api("/api/activa", { metodo: "POST", json: { activa: !estado?.activa } });
    } catch (err) {
      agregarLinea("jarvis error", err.message);
    }
  });
  $("#cerrar-qr").addEventListener("click", () => ($("#modal-qr").hidden = true));
  $("#ajustes").addEventListener("click", () => void abrirAjustes());
  $("#cerrar-ajustes").addEventListener("click", () => ($("#modal-ajustes").hidden = true));
  $("#formulario-ajustes-caja").addEventListener("submit", guardarAjustes);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      callar();
      cancelarEscucha();
      $("#modal-qr").hidden = true;
    }
    // En la app de escritorio Alt+H es un atajo global que maneja la propia app.
    if (!escritorio && e.altKey && e.key.toLowerCase() === "h") {
      e.preventDefault();
      void escucharOrden();
    }
  });
  document.addEventListener(
    "pointerdown",
    () => {
      if ("Notification" in window && Notification.permission === "default" && !movil) void Notification.requestPermission();
      // Los navegadores no dejan usar audio hasta que tocás la página una vez.
      void oido.ctx?.resume().then(actualizarPista);
    },
    { once: true },
  );

  if (escritorio) {
    // Las zonas vacías dejan pasar el mouse a tu escritorio; los paneles sí se pueden usar.
    let interactivo = null;
    document.addEventListener("mousemove", (e) => {
      const sobre = Boolean(e.target.closest(".panel, button, a, input, textarea, .modal"));
      if (sobre !== interactivo) {
        interactivo = sobre;
        escritorio.interactivo(sobre);
      }
    });
    escritorio.onHablar(() => void escucharOrden());
  }
  if (escritorio || movil) {
    const ocultar = $("#ocultar");
    ocultar.hidden = false;
    ocultar.addEventListener("click", () => {
      callar();
      cancelarEscucha();
      if (escritorio) escritorio.ocultar();
      else window.Android.ocultar();
    });
  }
}

iniciar();
