"use strict";
// Menú de Jarvis: secciones (conversación, mensajes, correo, agenda, tareas, recordatorios, memoria, avisos),
// ajustes por grupos y estado. Usa lo que define app.js (el, api, estado, avisos, preguntar…).

const menu = {
  pila: [], // secciones abiertas (para "volver")
  abierto: false,
  valores: null, // ajustes cargados
  cambios: {}, // ajustes tocados sin guardar
};

const SECCIONES = [
  { id: "conversacion", nombre: "Conversación", detalle: "Lo que hablaron y escribirle", icono: "i-chat" },
  { id: "mensajes", nombre: "Mensajes", detalle: "WhatsApp, Telegram, Instagram…", icono: "i-whatsapp", movil: true },
  { id: "correo", nombre: "Correo", detalle: "Tu Gmail", icono: "i-mail" },
  { id: "agenda", nombre: "Agenda", detalle: "Hoy y los próximos días", icono: "i-calendario", movil: true },
  { id: "tareas", nombre: "Tareas y rutinas", detalle: "Pendientes y lo que hace sola", icono: "i-check", movil: true },
  { id: "recordatorios", nombre: "Recordatorios", detalle: "Te avisa a la hora justa", icono: "i-campana" },
  { id: "memoria", nombre: "Memoria", detalle: "Lo que sabe de vos", icono: "i-memoria" },
  { id: "avisos", nombre: "Avisos", detalle: "Lo último que te contó", icono: "i-alerta" },
  { id: "ajustes", nombre: "Ajustes", detalle: "IA, voz, oído, correo y más", icono: "i-engranaje" },
  { id: "estado", nombre: "Estado", detalle: "Qué está andando y pruebas", icono: "i-pulso" },
];

const GRUPOS_AJUSTES = [
  {
    id: "general", nombre: "General", detalle: "Tu nombre y tu ciudad", icono: "i-usuario",
    campos: [
      { clave: "usuario", rotulo: "Cómo te llama", tipo: "texto", ayuda: "Ej: Ramiro" },
      { clave: "ciudad", rotulo: "Ciudad", tipo: "texto", ayuda: "Para el clima, ej: Buenos Aires" },
      { clave: "pais", rotulo: "País", tipo: "texto", ayuda: "Código de 2 letras para las noticias, ej: AR" },
    ],
  },
  {
    id: "ia", nombre: "Inteligencia", detalle: "Gemini, Groq y Qwen en el celular", icono: "i-chip",
    campos: [
      { clave: "gemini", rotulo: "Clave de Gemini", tipo: "secreto", ayuda: "Gratis en https://aistudio.google.com/apikey" },
      { clave: "geminiModelo", rotulo: "Modelo de Gemini", tipo: "sugerido", opciones: ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest", "gemini-2.5-flash-lite"], ayuda: "Si uno se queda sin cupo, Jarvis pasa sola a otro." },
      { clave: "groq", rotulo: "Clave de Groq", tipo: "secreto", ayuda: "Gratis en https://console.groq.com/keys · también la usa para entenderte" },
      { clave: "groqModelo", rotulo: "Modelo de Groq", tipo: "sugerido", opciones: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "openai/gpt-oss-20b"] },
      { clave: "openrouter", rotulo: "Clave de OpenRouter", tipo: "secreto", ayuda: "Opcional · https://openrouter.ai" },
      { clave: "openrouterModelo", rotulo: "Modelo de OpenRouter", tipo: "texto", ayuda: "Un modelo :free con herramientas" },
      { clave: "iaLocal", rotulo: "IA en el celular (Qwen)", tipo: "opciones", opciones: [["auto", "Automática (la mejor que entra)"], ["qwen3-1.7b", "Qwen 3 1.7B · la mejor (8 GB)"], ["qwen2.5-1.5b", "Qwen 2.5 1.5B · 6 GB"], ["qwen3-0.6b", "Qwen 3 0.6B · liviana"], ["no", "Apagada"]], ayuda: "Responde sin internet y cuando se acaba el cupo de la nube." },
      { clave: "descargaConDatos", rotulo: "Bajar Qwen con datos móviles", tipo: "si-no", ayuda: "Si está apagado, espera Wi-Fi (pesa 0,6 a 2 GB)." },
      { clave: "razonamiento", rotulo: "Cuánto piensa antes de responder", tipo: "opciones", opciones: [["low", "Poco · más rápido"], ["medium", "Medio"], ["high", "Mucho · más lento"]] },
      { clave: "largoRespuestas", rotulo: "Largo de las respuestas", tipo: "opciones", opciones: [["corto", "Cortas"], ["normal", "Normales"], ["detallado", "Detalladas"]] },
    ],
  },
  {
    id: "voz", nombre: "Voz", detalle: "Cómo suena Jarvis", icono: "i-parlante",
    campos: [
      { clave: "voz", rotulo: "Voz de Jarvis", tipo: "opciones", opciones: [["elena", "Elena · Argentina"], ["tomas", "Tomás · Argentina"], ["dalia", "Dalia · México"], ["paloma", "Paloma · EE. UU."], ["elvira", "Elvira · España"], ["gemini", "Gemini"], ["elevenlabs", "ElevenLabs"], ["sistema", "Voz del celular"]] },
      { clave: "elevenlabs", rotulo: "Clave de ElevenLabs", tipo: "secreto", ayuda: "https://elevenlabs.io/app/settings/api-keys" },
      { clave: "elevenlabsVoz", rotulo: "Voz de ElevenLabs", tipo: "voces", ayuda: "Con el plan gratis solo andan las predeterminadas." },
      { clave: "elevenlabsModelo", rotulo: "Modelo de ElevenLabs", tipo: "opciones", opciones: [["eleven_flash_v2_5", "Flash v2.5 · rápido"], ["eleven_multilingual_v2", "Multilingual v2 · más natural"], ["eleven_turbo_v2_5", "Turbo v2.5"]] },
    ],
    extra: "probarVoz",
  },
  {
    id: "oido", nombre: "Oído", detalle: "Cómo te escucha", icono: "i-mic",
    campos: [
      { clave: "groq", rotulo: "Clave de Groq (recomendada)", tipo: "secreto", ayuda: "Con Groq te entiende mejor (Whisper) y no gasta el cupo de Gemini. Gratis en https://console.groq.com/keys" },
      { clave: "picovoice", rotulo: "AccessKey de Picovoice", tipo: "secreto", ayuda: "Opcional: detecta «Jarvis» sin internet · https://console.picovoice.ai" },
    ],
    extra: "escuchaContinua",
  },
  {
    id: "correo", nombre: "Correo", detalle: "Gmail directo", icono: "i-mail",
    campos: [
      { clave: "emailUsuario", rotulo: "Tu Gmail", tipo: "texto", ayuda: "vos@gmail.com" },
      { clave: "emailClave", rotulo: "Contraseña de aplicación", tipo: "secreto", ayuda: "16 letras, se crea en https://myaccount.google.com/apppasswords (necesita verificación en 2 pasos)" },
      { clave: "emailCuentas", rotulo: "Otras cuentas", tipo: "secreto", ayuda: "otra@gmail.com:contraseña,otra2@…" },
    ],
  },
  {
    id: "sola", nombre: "Trabajar sola", detalle: "Revisiones, resumen y avisos", icono: "i-rayo",
    campos: [
      { clave: "autonomo", rotulo: "Trabajar sola", tipo: "si-no", ayuda: "Cada 30 minutos revisa correo, mensajes, agenda y tareas, y te avisa lo importante." },
      { clave: "resumenDiario", rotulo: "Resumen de buenos días", tipo: "hora", ayuda: "Vacío = apagado" },
      { clave: "avisarDesde", rotulo: "Avisarme en voz alta desde", tipo: "opciones", opciones: [["baja", "Todo"], ["media", "Importancia media"], ["alta", "Solo lo importante"]] },
      { clave: "tavily", rotulo: "Clave de Tavily", tipo: "secreto", ayuda: "Opcional: búsquedas web más precisas · https://tavily.com" },
    ],
  },
  { id: "permisos", nombre: "Permisos", detalle: "Lo que le dejás hacer", icono: "i-escudo", movil: true, campos: [], extra: "permisos" },
];

// ---------- Utilidades ----------

const disponibleEnEsta = (s) => !s.movil || movil;

function vacio(texto, accion) {
  return el("div", { class: "m-vacio" }, el("p", {}, texto), accion ?? null);
}

function noDisponible() {
  return vacio("No disponible en esta versión.");
}

async function pedir(ruta, opciones) {
  try {
    return await api(ruta, opciones);
  } catch (err) {
    return { _error: err.message || "No pude cargarlo." };
  }
}

function fechaCorta(iso) {
  const f = new Date(iso);
  if (Number.isNaN(f.getTime())) return "";
  const hoy = new Date();
  if (f.toDateString() === hoy.toDateString()) return f.toLocaleTimeString(LOCALE, HORA);
  return f.toLocaleString(LOCALE, { day: "numeric", month: "short", ...HORA });
}

function boton(texto, onclick, clase = "", iconoId) {
  return el("button", { type: "button", class: `m-boton ${clase}`, onclick }, iconoId ? icono(iconoId) : null, texto);
}

function tarjeta(...hijos) {
  return el("div", { class: "m-tarjeta" }, ...hijos);
}

function titulo(texto, extra) {
  return el("div", { class: "m-subtitulo" }, el("span", {}, texto), extra ?? null);
}

function aviso(texto, clase = "") {
  const nodo = el("div", { class: `m-toast ${clase}` }, texto);
  document.body.append(nodo);
  requestAnimationFrame(() => nodo.classList.add("visible"));
  setTimeout(() => {
    nodo.classList.remove("visible");
    setTimeout(() => nodo.remove(), 300);
  }, 2600);
}

// ---------- Abrir, cerrar y navegar ----------

function abrirMenu(seccion) {
  const panel = $("#menu");
  panel.hidden = false;
  $("#menu-fondo").hidden = false;
  requestAnimationFrame(() => {
    panel.classList.add("abierto");
    $("#menu-fondo").classList.add("visible");
  });
  menu.abierto = true;
  $("#abrir-menu").setAttribute("aria-expanded", "true");
  menu.pila = [];
  if (seccion) irA(seccion);
  else mostrarInicio();
}

function cerrarMenu() {
  const panel = $("#menu");
  panel.classList.remove("abierto");
  $("#menu-fondo").classList.remove("visible");
  menu.abierto = false;
  $("#abrir-menu").setAttribute("aria-expanded", "false");
  setTimeout(() => {
    if (!menu.abierto) {
      panel.hidden = true;
      $("#menu-fondo").hidden = true;
    }
  }, 260);
}

function pintar(tituloTexto, ...contenido) {
  $("#menu-titulo").textContent = tituloTexto;
  $("#menu-atras").hidden = menu.pila.length === 0;
  const cuerpo = $("#menu-cuerpo");
  cuerpo.replaceChildren(...contenido.flat().filter(Boolean));
  cuerpo.scrollTop = 0;
  cuerpo.classList.remove("entrando");
  void cuerpo.offsetWidth;
  cuerpo.classList.add("entrando");
}

function irA(id, desdeAtras = false) {
  if (!desdeAtras) menu.pila.push(id);
  try {
    localStorage.setItem("jarvis-menu", id);
  } catch {}
  const [base, sub] = id.split(":");
  const vistas = {
    conversacion: verConversacion,
    mensajes: verMensajes,
    correo: verCorreo,
    agenda: verAgenda,
    tareas: verTareas,
    recordatorios: verRecordatorios,
    memoria: verMemoria,
    avisos: verAvisos,
    ajustes: () => (sub ? verGrupoAjustes(sub) : verAjustes()),
    estado: verEstado,
  };
  (vistas[base] ?? mostrarInicio)();
}

function volver() {
  menu.pila.pop();
  const anterior = menu.pila[menu.pila.length - 1];
  if (anterior) irA(anterior, true);
  else mostrarInicio();
}

function insignia(id) {
  if (id === "avisos") return avisos.length || "";
  if (id === "mensajes") return "";
  if (id === "correo") return (estado?.email ?? []).reduce((n, c) => n + (c.noLeidos || 0), 0) || "";
  if (id === "tareas") return (typeof tareasDatos !== "undefined" ? tareasDatos.tareas.filter((t) => t.estado === "pendiente").length : 0) || "";
  return "";
}

function filaNavegacion(item, onclick) {
  const n = insignia(item.id);
  return el(
    "button",
    { type: "button", class: "m-fila", onclick },
    el("span", { class: "m-fila-icono" }, icono(item.icono)),
    el("span", { class: "m-fila-texto" }, el("b", {}, item.nombre), el("small", {}, item.detalle)),
    n ? el("span", { class: "m-insignia" }, String(n)) : null,
    icono("i-flecha", "m-fila-flecha"),
  );
}

function mostrarInicio() {
  menu.pila = [];
  const ia = estado?.ia?.find((p) => p.disponible) ?? null;
  const resumen = el(
    "div",
    { class: "m-cabecera-estado" },
    el("span", { class: `m-punto ${estado?.activa === false ? "apagado" : ia ? "ok" : "mal"}` }),
    el(
      "div",
      {},
      el("b", {}, estado?.activa === false ? "Desactivada" : ia ? "En línea" : "Sin IA"),
      el("small", {}, ia ? `${nombreIA(ia)} · ${ia.local ? "en el celular" : ia.modelo}` : "Configurala en Ajustes > Inteligencia"),
    ),
    boton("Inicio", cerrarMenu, "chico", "i-inicio"),
  );
  pintar(
    "Menú",
    resumen,
    el("nav", { class: "m-lista" }, ...SECCIONES.filter(disponibleEnEsta).map((s) => filaNavegacion(s, () => irA(s.id)))),
    el("p", { class: "m-pie" }, `Jarvis ${movil ? "para Android" : "para PC"} · decí «Jarvis» o tocá el reactor`),
  );
}

function nombreIA(p) {
  return { gemini: "Gemini", groq: "Groq", openrouter: "OpenRouter", qwen: "Qwen" }[p.nombre] ?? p.nombre;
}

// ---------- Conversación ----------

async function verConversacion() {
  pintar("Conversación", el("div", { class: "m-cargando" }, "Cargando…"));
  const historial = await pedir("/api/historial");
  const lista = el("div", { class: "m-chat" });
  if (historial._error) lista.append(vacio(historial._error));
  else if (!historial.length) lista.append(vacio("Todavía no hablaron. Decí «Jarvis» o escribile abajo."));
  else {
    for (const m of historial.slice(-80)) {
      lista.append(
        el("div", { class: `m-burbuja ${m.rol === "user" ? "yo" : "jarvis"}` }, el("p", {}, m.texto), el("time", {}, fechaCorta(m.fecha))),
      );
    }
  }
  const campo = el("input", { type: "text", placeholder: "Escribile a Jarvis…", autocomplete: "off", enterkeyhint: "send" });
  const enviar = async () => {
    const texto = campo.value.trim();
    if (!texto) return;
    campo.value = "";
    lista.append(el("div", { class: "m-burbuja yo" }, el("p", {}, texto), el("time", {}, "ahora")));
    const pensando = el("div", { class: "m-burbuja jarvis pensando" }, el("p", {}, "…"));
    lista.append(pensando);
    lista.scrollTop = lista.scrollHeight;
    await preguntar(texto, "texto");
    if (menu.pila[menu.pila.length - 1] === "conversacion") verConversacion();
  };
  campo.addEventListener("keydown", (e) => e.key === "Enter" && enviar());
  const barra = el(
    "div",
    { class: "m-escribir" },
    el("button", { type: "button", class: "m-redondo", title: "Hablar", onclick: () => (cerrarMenu(), void escucharOrden()) }, icono("i-mic")),
    campo,
    el("button", { type: "button", class: "m-redondo principal", title: "Enviar", onclick: enviar }, icono("i-enviar")),
  );
  pintar("Conversación", lista, barra);
  requestAnimationFrame(() => (lista.scrollTop = lista.scrollHeight));
}

// ---------- Mensajes ----------

const ICONO_APP = { whatsapp: "i-whatsapp", telegram: "i-telegram", email: "i-mail" };
let filtroApp = "Todas";

async function verMensajes() {
  if (!movil) return pintar("Mensajes", noDisponible());
  pintar("Mensajes", el("div", { class: "m-cargando" }, "Cargando…"));
  const mensajes = await pedir("/api/mensajes?cantidad=80");
  if (mensajes._error) return pintar("Mensajes", vacio(mensajes._error));
  const apps = ["Todas", ...new Set(mensajes.map((m) => m.app))];
  if (!apps.includes(filtroApp)) filtroApp = "Todas";
  const filtros = el(
    "div",
    { class: "m-filtros" },
    ...apps.map((a) => el("button", { type: "button", class: `m-filtro ${a === filtroApp ? "activo" : ""}`, onclick: () => ((filtroApp = a), verMensajes()) }, a)),
  );
  const visibles = mensajes.filter((m) => filtroApp === "Todas" || m.app === filtroApp);
  const lista = visibles.length
    ? el(
        "div",
        { class: "m-tarjetas" },
        ...visibles.map((m) =>
          tarjeta(
            el(
              "div",
              { class: "m-tarjeta-cabeza" },
              el("span", { class: "m-avatar" }, icono(ICONO_APP[m.canal] ?? "i-chat")),
              el("div", { class: "m-quien" }, el("b", {}, m.grupo || m.de), el("small", {}, `${m.grupo ? m.de + " · " : ""}${m.app}`)),
              el("time", {}, haceCuanto(m.fecha)),
            ),
            el("p", { class: "m-texto" }, m.texto),
            el(
              "div",
              { class: "m-acciones" },
              boton("Responder", () => {
                cerrarMenu();
                void preguntar(`Preparame una respuesta para ${m.grupo || m.de} por ${m.app}.`, "texto");
              }, "chico", "i-enviar"),
            ),
          ),
        ),
      )
    : vacio(
        estado?.notificaciones === false
          ? "Para ver tus mensajes, activá el acceso a notificaciones en Ajustes > Permisos."
          : "No llegó nada desde que Jarvis está prendida.",
      );
  pintar("Mensajes", filtros, lista);
}

// ---------- Correo ----------

async function verCorreo(refrescar = false) {
  pintar("Correo", el("div", { class: "m-cargando" }, "Cargando…"));
  const d = await pedir(`/api/correo${refrescar ? "?refrescar=1" : ""}`);
  if (d._error) return pintar("Correo", vacio("No disponible en esta versión."));
  const cuentas = (d.cuentas ?? []).map((c) =>
    el(
      "div",
      { class: "m-fila-dato" },
      el("span", { class: `m-punto ${c.estado === "conectado" ? "ok" : c.estado === "conectando" ? "espera" : "mal"}` }),
      el("span", {}, c.cuenta),
      el("small", {}, c.estado === "conectado" ? `${c.noLeidos} sin leer` : c.error || "Conectando…"),
    ),
  );
  const explicacion = !d.configurado
    ? tarjeta(
        el("b", {}, "Conectá tu Gmail para leer toda la bandeja"),
        el("p", {}, "Mientras tanto te muestro los mails que llegan como notificación de Gmail."),
        el(
          "ol",
          { class: "m-pasos" },
          el("li", {}, "Activá la verificación en 2 pasos de tu cuenta de Google."),
          el("li", {}, "Creá una contraseña de aplicación en ", el("a", { href: "https://myaccount.google.com/apppasswords", target: "_blank" }, "myaccount.google.com/apppasswords"), "."),
          el("li", {}, "Pegala en Ajustes > Correo junto con tu Gmail."),
        ),
        boton("Ir a Ajustes > Correo", () => irA("ajustes:correo"), "chico", "i-engranaje"),
      )
    : null;
  const mails = (d.mails ?? []).length
    ? el(
        "div",
        { class: "m-tarjetas" },
        ...d.mails.map((m) =>
          tarjeta(
            el("div", { class: "m-tarjeta-cabeza" }, el("span", { class: "m-avatar" }, icono("i-mail")), el("div", { class: "m-quien" }, el("b", {}, m.asunto || "(sin asunto)"), el("small", {}, m.de)), el("time", {}, haceCuanto(m.fecha))),
            m.texto ? el("p", { class: "m-texto" }, m.texto) : null,
          ),
        ),
      )
    : vacio(d.configurado ? "Bandeja al día: nada sin leer." : "Todavía no llegó ningún mail como notificación.");
  pintar(
    "Correo",
    titulo(d.fuente === "imap" ? "Bandeja de entrada" : "Desde las notificaciones", boton("Actualizar", () => verCorreo(true), "chico", "i-refrescar")),
    cuentas.length ? tarjeta(...cuentas) : null,
    explicacion,
    mails,
    d.error ? el("p", { class: "m-error" }, d.error) : null,
  );
}

// ---------- Agenda ----------

async function verAgenda() {
  pintar("Agenda", el("div", { class: "m-cargando" }, "Cargando…"));
  const eventos = await pedir("/api/agenda");
  if (eventos._error) return pintar("Agenda", noDisponible());
  if (!eventos.length) return pintar("Agenda", vacio("Nada en los próximos 3 días. Pedile: «agendame dentista el viernes a las 10»."));
  const porDia = new Map();
  for (const e of eventos) {
    const dia = new Date(e.inicio).toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long" });
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia).push(e);
  }
  pintar(
    "Agenda",
    ...[...porDia].map(([dia, lista]) => [
      titulo(dia),
      tarjeta(
        ...lista.map((e) =>
          el(
            "div",
            { class: "m-evento" },
            el("span", { class: "m-hora" }, e.todoElDia ? "Todo el día" : new Date(e.inicio).toLocaleTimeString(LOCALE, HORA)),
            el("div", {}, el("b", {}, e.titulo), e.lugar ? el("small", {}, e.lugar) : null),
          ),
        ),
      ),
    ]),
  );
}

// ---------- Tareas y rutinas ----------

async function verTareas() {
  pintar("Tareas y rutinas", el("div", { class: "m-cargando" }, "Cargando…"));
  const d = await pedir("/api/tareas");
  if (d._error) return pintar("Tareas y rutinas", noDisponible());
  const nueva = el("input", { type: "text", placeholder: "Nueva tarea…", maxlength: "300" });
  const agregar = async () => {
    const texto = nueva.value.trim();
    if (!texto) return;
    const r = await pedir("/api/tareas", { metodo: "POST", json: { texto } });
    if (r._error) aviso(r._error, "error");
    verTareas();
  };
  nueva.addEventListener("keydown", (e) => e.key === "Enter" && agregar());
  const tareas = d.tareas ?? [];
  const filasTareas = tareas.length
    ? tareas.slice(0, 40).map((t) =>
        el(
          "div",
          { class: `m-tarea ${t.estado !== "pendiente" ? "hecha" : ""}` },
          el("button", { type: "button", class: "m-check", "aria-label": "Marcar como hecha", onclick: async () => (t.estado === "pendiente" && (await pedir(`/api/tareas/${encodeURIComponent(t.id)}/hecha`, { metodo: "POST" })), verTareas()) }, t.estado !== "pendiente" ? "✓" : ""),
          el("div", { class: "m-tarea-texto" }, el("span", {}, t.texto), el("small", {}, [t.origen === "jarvis" ? "La anotó Jarvis" : "", t.para ? `Para ${fechaCorta(t.para)}` : ""].filter(Boolean).join(" · "))),
          el("button", { type: "button", class: "m-icono-boton", "aria-label": "Borrar", onclick: async () => (await pedir(`/api/tareas/${encodeURIComponent(t.id)}`, { metodo: "DELETE" }), verTareas()) }, icono("i-papelera")),
        ),
      )
    : [vacio("Sin tareas. Jarvis anota sola las que salen de tus mails y mensajes.")];

  const rutinaTexto = el("input", { type: "text", placeholder: "Qué hace (ej: revisá mis mails y decime lo importante)" });
  const rutinaHora = el("input", { type: "time", value: "09:00" });
  const rutinaDias = el("select", {}, ...[["todos", "Todos los días"], ["laborables", "Lunes a viernes"], ["finde", "Fines de semana"]].map(([v, n]) => el("option", { value: v }, n)));
  const crearRutina = async () => {
    if (!rutinaTexto.value.trim()) return;
    const r = await pedir("/api/rutinas", { metodo: "POST", json: { texto: rutinaTexto.value.trim(), hora: rutinaHora.value, dias: rutinaDias.value } });
    if (r._error) aviso(r._error, "error");
    else aviso("Rutina creada");
    verTareas();
  };
  const rutinas = d.rutinas ?? [];
  pintar(
    "Tareas y rutinas",
    titulo("Tareas", el("span", { class: "m-contador" }, String(tareas.filter((t) => t.estado === "pendiente").length))),
    tarjeta(el("div", { class: "m-agregar" }, nueva, el("button", { type: "button", class: "m-redondo principal", "aria-label": "Agregar", onclick: agregar }, icono("i-mas"))), ...filasTareas),
    titulo("Rutinas automáticas"),
    tarjeta(
      ...(rutinas.length
        ? rutinas.map((r) =>
            el(
              "div",
              { class: "m-tarea" },
              el("span", { class: "m-hora" }, r.hora),
              el("div", { class: "m-tarea-texto" }, el("span", {}, r.texto), el("small", {}, { todos: "Todos los días", laborables: "Lunes a viernes", finde: "Fines de semana" }[r.dias] ?? r.dias)),
              el("button", { type: "button", class: "m-icono-boton", "aria-label": "Borrar", onclick: async () => (await pedir(`/api/rutinas/${encodeURIComponent(r.id)}`, { metodo: "DELETE" }), verTareas()) }, icono("i-papelera")),
            ),
          )
        : [el("p", { class: "m-ayuda" }, "Jarvis hace estas tareas sola cada día y te cuenta el resultado.")]),
      el("div", { class: "m-formulario" }, rutinaTexto, el("div", { class: "m-dos" }, rutinaHora, rutinaDias), boton("Crear rutina", crearRutina, "principal", "i-mas")),
    ),
  );
}

// ---------- Recordatorios ----------

async function verRecordatorios() {
  pintar("Recordatorios", el("div", { class: "m-cargando" }, "Cargando…"));
  const lista = await pedir("/api/recordatorios");
  if (lista._error) return pintar("Recordatorios", noDisponible());
  const texto = el("input", { type: "text", placeholder: "Qué te recuerdo" });
  const cuando = el("input", { type: "datetime-local" });
  const crear = async () => {
    if (!texto.value.trim() || !cuando.value) return aviso("Completá qué y cuándo", "error");
    const r = await pedir("/api/recordatorios", { metodo: "POST", json: { texto: texto.value.trim(), cuando: cuando.value } });
    if (r._error) aviso(r._error, "error");
    else aviso("Recordatorio creado");
    verRecordatorios();
  };
  pintar(
    "Recordatorios",
    tarjeta(
      ...(lista.length
        ? lista
            .sort((a, b) => a.cuando.localeCompare(b.cuando))
            .map((r) =>
              el(
                "div",
                { class: "m-tarea" },
                el("span", { class: "m-hora" }, fechaCorta(r.cuando)),
                el("div", { class: "m-tarea-texto" }, el("span", {}, r.texto)),
                el("button", { type: "button", class: "m-icono-boton", "aria-label": "Borrar", onclick: async () => (await pedir(`/api/recordatorios/${encodeURIComponent(r.id)}`, { metodo: "DELETE" }), verRecordatorios()) }, icono("i-papelera")),
              ),
            )
        : [el("p", { class: "m-ayuda" }, "Sin recordatorios. Pedile: «recordame sacar la ropa en 40 minutos».")]),
    ),
    titulo("Nuevo recordatorio"),
    tarjeta(el("div", { class: "m-formulario" }, texto, cuando, boton("Crear", crear, "principal", "i-mas"))),
  );
}

// ---------- Memoria ----------

async function verMemoria() {
  pintar("Memoria", el("div", { class: "m-cargando" }, "Cargando…"));
  const lista = await pedir("/api/memoria");
  if (lista._error) return pintar("Memoria", noDisponible());
  const nuevo = el("input", { type: "text", placeholder: "Algo que tenga que saber de vos…" });
  const agregar = async () => {
    if (!nuevo.value.trim()) return;
    const r = await pedir("/api/memoria", { metodo: "POST", json: { texto: nuevo.value.trim() } });
    if (r._error) aviso(r._error === "Ruta no encontrada." ? "No disponible en esta versión." : r._error, "error");
    verMemoria();
  };
  nuevo.addEventListener("keydown", (e) => e.key === "Enter" && agregar());
  pintar(
    "Memoria",
    el("p", { class: "m-ayuda" }, "Jarvis usa esto para conocerte. Podés agregar o borrar lo que quieras."),
    tarjeta(
      el("div", { class: "m-agregar" }, nuevo, el("button", { type: "button", class: "m-redondo principal", "aria-label": "Agregar", onclick: agregar }, icono("i-mas"))),
      ...(lista.length
        ? lista
            .slice()
            .reverse()
            .map((d) =>
              el(
                "div",
                { class: "m-tarea" },
                el("span", { class: "m-fila-icono chico" }, icono("i-memoria")),
                el("div", { class: "m-tarea-texto" }, el("span", {}, d.texto), d.fecha ? el("small", {}, fechaCorta(d.fecha)) : null),
                el("button", { type: "button", class: "m-icono-boton", "aria-label": "Olvidar", onclick: async () => (await pedir(`/api/memoria/${encodeURIComponent(d.id)}`, { metodo: "DELETE" }), verMemoria()) }, icono("i-papelera")),
              ),
            )
        : [el("p", { class: "m-ayuda" }, "Todavía no guardó nada. Contale cosas: «acordate que mi cumple es el 3 de mayo».")]),
    ),
  );
}

// ---------- Avisos ----------

function verAvisos() {
  if (!avisos.length) return pintar("Avisos", vacio("Todo tranquilo por ahora."));
  pintar(
    "Avisos",
    el(
      "div",
      { class: "m-tarjetas" },
      ...avisos.slice(0, 40).map((a) => {
        const p = a.propuestaId ? propuestas.get(a.propuestaId) : null;
        return tarjeta(
          el("div", { class: "m-tarjeta-cabeza" }, el("span", { class: `m-avatar ${a.importancia}` }, icono(ICONOS_CANAL[a.canal] ?? "i-campana")), el("div", { class: "m-quien" }, el("b", {}, a.de), el("small", {}, a.importancia === "alta" ? "Importante" : a.canal)), el("time", {}, haceCuanto(a.fecha))),
          el("p", { class: "m-texto" }, a.resumen || a.titulo),
          p ? crearBorrador(p) : null,
        );
      }),
    ),
  );
}

// ---------- Ajustes ----------

async function cargarAjustes() {
  const v = await pedir("/api/ajustes");
  if (v._error) return null;
  menu.valores = v;
  return v;
}

async function verAjustes(bienvenida = false) {
  pintar("Ajustes", el("div", { class: "m-cargando" }, "Cargando…"));
  const v = await cargarAjustes();
  if (!v) return pintar("Ajustes", noDisponible());
  pintar(
    "Ajustes",
    bienvenida ? tarjeta(el("b", {}, "¡Bienvenido!"), el("p", {}, "Para empezar pegá tu clave gratis de Gemini o de Groq en Inteligencia. Lo demás es opcional: sin claves, responde Qwen en el celular.")) : null,
    el("nav", { class: "m-lista" }, ...GRUPOS_AJUSTES.filter(disponibleEnEsta).map((g) => filaNavegacion(g, () => irA(`ajustes:${g.id}`)))),
    el("p", { class: "m-pie" }, "Todo queda guardado solo en tu celular."),
  );
}

function enlazarAyuda(texto) {
  return texto.split(/(https:\/\/\S+)/).map((p) => (p.startsWith("https://") ? el("a", { href: p, target: "_blank", rel: "noopener" }, p.replace("https://", "")) : p));
}

function control(campo, valor) {
  const cambiar = (v) => (menu.cambios[campo.clave] = v);
  switch (campo.tipo) {
    case "secreto": {
      const input = el("input", { type: "password", autocomplete: "off", spellcheck: "false", placeholder: valor ? "Guardada · escribí para cambiarla" : "Pegá la clave" });
      input.value = valor ?? "";
      input.addEventListener("input", () => cambiar(input.value));
      const ver = el("button", { type: "button", class: "m-icono-boton", "aria-label": "Mostrar", onclick: () => (input.type = input.type === "password" ? "text" : "password") }, icono("i-ojo"));
      return el("div", { class: "m-con-boton" }, input, ver);
    }
    case "opciones": {
      const select = el("select", {}, ...campo.opciones.map(([v, n]) => el("option", { value: v }, n)));
      select.value = valor ?? campo.opciones[0][0];
      select.addEventListener("change", () => cambiar(select.value));
      return select;
    }
    case "si-no": {
      const activo = valor === "si";
      const interruptor = el("button", { type: "button", class: `m-switch ${activo ? "si" : ""}`, role: "switch", "aria-checked": String(activo) }, el("span"));
      interruptor.addEventListener("click", () => {
        const si = !interruptor.classList.contains("si");
        interruptor.classList.toggle("si", si);
        interruptor.setAttribute("aria-checked", String(si));
        cambiar(si ? "si" : "no");
      });
      return interruptor;
    }
    case "hora": {
      const input = el("input", { type: "time" });
      input.value = valor ?? "";
      input.addEventListener("input", () => cambiar(input.value));
      return input;
    }
    case "sugerido": {
      const id = `sug-${campo.clave}`;
      const input = el("input", { type: "text", list: id, autocomplete: "off", spellcheck: "false" });
      input.value = valor ?? "";
      input.addEventListener("input", () => cambiar(input.value.trim()));
      return el("div", {}, input, el("datalist", { id }, ...campo.opciones.map((o) => el("option", { value: o }))));
    }
    case "voces": {
      const select = el("select", {}, el("option", { value: "" }, "Automática (elige una que ande)"));
      if (valor) select.append(el("option", { value: valor }, valor));
      select.value = valor ?? "";
      select.addEventListener("change", () => cambiar(select.value));
      pedir("/api/voces").then((voces) => {
        if (voces._error || !Array.isArray(voces)) return;
        const premade = voces.filter((v) => v.tipo === "premade");
        const otras = voces.filter((v) => v.tipo !== "premade");
        const grupo = (rotulo, lista, nota) =>
          lista.length ? el("optgroup", { label: rotulo }, ...lista.map((v) => el("option", { value: v.id }, `${v.nombre}${nota}`))) : null;
        select.replaceChildren(el("option", { value: "" }, "Automática (elige una que ande)"), grupo("Predeterminadas (andan en el plan gratis)", premade, ""), grupo("Tuyas o de la biblioteca", otras, " · puede requerir plan pago"));
        select.value = valor ?? "";
      });
      return select;
    }
    default: {
      const input = el("input", { type: "text", autocomplete: "off", spellcheck: "false" });
      input.value = valor ?? "";
      input.addEventListener("input", () => cambiar(input.value.trim()));
      return input;
    }
  }
}

async function verGrupoAjustes(id) {
  const grupo = GRUPOS_AJUSTES.find((g) => g.id === id);
  if (!grupo) return verAjustes();
  const v = menu.valores ?? (await cargarAjustes());
  if (!v) return pintar(grupo.nombre, noDisponible());
  menu.cambios = {};
  const filas = grupo.campos.map((c) =>
    el(
      "label",
      { class: `m-campo ${c.tipo === "si-no" ? "en-linea" : ""}` },
      el("span", { class: "m-campo-rotulo" }, c.rotulo),
      control(c, v[c.clave]),
      c.ayuda ? el("small", { class: "m-campo-ayuda" }, ...enlazarAyuda(c.ayuda)) : null,
    ),
  );
  const estadoGuardado = el("span", { class: "m-guardado" });
  const guardar = async () => {
    if (!Object.keys(menu.cambios).length) return aviso("No cambiaste nada");
    estadoGuardado.textContent = "Guardando…";
    const r = await pedir("/api/ajustes", { metodo: "POST", json: menu.cambios });
    if (r._error) {
      estadoGuardado.textContent = r._error;
      return;
    }
    menu.valores = r;
    menu.cambios = {};
    estadoGuardado.textContent = "";
    aviso("Guardado");
  };
  pintar(
    grupo.nombre,
    grupo.campos.length ? tarjeta(...filas) : null,
    grupo.extra === "probarVoz" ? tarjeta(el("b", {}, "Probar la voz"), el("p", { class: "m-ayuda" }, "Guardá primero si cambiaste algo."), resultadoPrueba("voz")) : null,
    grupo.extra === "escuchaContinua" ? tarjeta(filaEscuchaContinua()) : null,
    grupo.extra === "permisos" ? filasPermisos() : null,
    grupo.campos.length ? el("div", { class: "m-barra-guardar" }, estadoGuardado, boton("Guardar cambios", guardar, "principal")) : null,
  );
}

function filaEscuchaContinua() {
  const activo = typeof oido !== "undefined" ? oido.continuo : true;
  const interruptor = el("button", { type: "button", class: `m-switch ${activo ? "si" : ""}`, role: "switch", "aria-checked": String(activo) }, el("span"));
  interruptor.addEventListener("click", () => {
    void alternarContinuo();
    const si = typeof oido !== "undefined" ? oido.continuo : !activo;
    interruptor.classList.toggle("si", si);
    interruptor.setAttribute("aria-checked", String(si));
  });
  return el("div", { class: "m-campo en-linea" }, el("span", { class: "m-campo-rotulo" }, "Escuchar «Jarvis» siempre"), interruptor, el("small", { class: "m-campo-ayuda" }, "Si lo apagás, solo te escucha cuando tocás el reactor."));
}

function filasPermisos() {
  const permisos = [
    ["notificaciones", "Leer tus apps", "WhatsApp, Gmail, Telegram, Instagram…", estado?.notificaciones],
    ["superponer", "Abrirse sola", "Aparece cuando la llamás o hay un aviso", estado?.superponer],
    ["bateria", "Sin límite de batería", "Para que no la cierre el sistema", null],
    ["alarmas", "Alarmas exactas", "Recordatorios a la hora justa", null],
    ["app", "Todos los permisos", "Micrófono, contactos, agenda, llamadas", null],
  ];
  return tarjeta(
    ...permisos.map(([id, nombre, detalle, ok]) =>
      el(
        "div",
        { class: "m-permiso" },
        el("span", { class: `m-punto ${ok === true ? "ok" : ok === false ? "mal" : "neutro"}` }),
        el("div", { class: "m-tarea-texto" }, el("span", {}, nombre), el("small", {}, ok === true ? "Activado" : detalle)),
        boton(ok === true ? "Ver" : "Activar", () => window.Android?.abrirPermiso(id), "chico"),
      ),
    ),
  );
}

function resultadoPrueba(que) {
  const salida = el("p", { class: "m-resultado" });
  const correr = async () => {
    salida.className = "m-resultado";
    salida.textContent = "Probando…";
    const r = await pedir(que === "voz" ? "/api/probar/voz" : "/api/probar/ia", { metodo: "POST", json: {} });
    if (r._error) {
      salida.textContent = r._error === "Ruta no encontrada." ? "No disponible en esta versión." : r._error;
      salida.classList.add("mal");
      return;
    }
    if (que === "voz") {
      const nombres = { elevenlabs: "ElevenLabs", edge: "voz neural", gemini: "Gemini", sistema: "voz del celular" };
      salida.textContent = `Sonó con ${nombres[r.motor] ?? r.motor}.${r.error ? " " + r.error : ""}`;
      salida.classList.add(r.error ? "mal" : "ok");
    } else {
      salida.textContent = r.ok ? `${nombreIA({ nombre: r.proveedor })} · ${r.modelo} respondió en ${(r.ms / 1000).toFixed(1)} s: «${r.texto}»` : r.error;
      salida.classList.add(r.ok ? "ok" : "mal");
    }
  };
  return el("div", { class: "m-prueba" }, boton(que === "voz" ? "Probar voz" : "Probar IA", correr, "", que === "voz" ? "i-parlante" : "i-chip"), salida);
}

// ---------- Estado ----------

function verEstado() {
  const e = estado ?? {};
  const ias = (e.ia ?? []).map((p) => {
    const pausa = p.pausaHasta ? `en pausa hasta las ${new Date(p.pausaHasta).toLocaleTimeString(LOCALE, HORA)}` : "";
    const detalle = p.local
      ? p.disponible
        ? "Lista: responde sin internet"
        : p.descargando
          ? `Bajando… ${p.progreso}%`
          : p.error || "Falta bajarla"
      : p.disponible
        ? p.modelo
        : pausa || "Sin cupo por ahora";
    return el(
      "div",
      { class: "m-fila-dato" },
      el("span", { class: `m-punto ${p.disponible ? "ok" : p.descargando ? "espera" : "mal"}` }),
      el("span", {}, p.local ? p.modelo.replace(" (en el celular)", "") : nombreIA(p)),
      el("small", {}, detalle),
    );
  });
  const vozNombres = { elena: "Elena · Argentina", tomas: "Tomás · Argentina", dalia: "Dalia", paloma: "Paloma", elvira: "Elvira", gemini: "Gemini", elevenlabs: "ElevenLabs", sistema: "Voz del celular" };
  const oidos = { groq: "Whisper (Groq) · el más preciso", gemini: "Gemini · gasta cupo de la charla", sistema: "Reconocedor del celular" };
  pintar(
    "Estado",
    titulo("Inteligencia"),
    tarjeta(...(ias.length ? ias : [el("p", { class: "m-ayuda" }, "No hay ninguna IA configurada.")]), resultadoPrueba("ia")),
    titulo("Voz y oído"),
    tarjeta(
      el("div", { class: "m-fila-dato" }, el("span", { class: `m-punto ${e.vozError ? "mal" : "ok"}` }), el("span", {}, "Voz"), el("small", {}, vozNombres[e.vozNombre] ?? (e.vozNatural ? "ElevenLabs" : "Del celular"))),
      e.vozError ? el("p", { class: "m-error" }, e.vozError) : null,
      el("div", { class: "m-fila-dato" }, el("span", { class: `m-punto ${e.oidoMotor === "groq" ? "ok" : "espera"}` }), el("span", {}, "Oído"), el("small", {}, oidos[e.oidoMotor] ?? (e.voz ? "Activo" : "Sin configurar"))),
      resultadoPrueba("voz"),
    ),
    titulo("Correo"),
    tarjeta(
      ...((e.email ?? []).length
        ? e.email.map((c) => el("div", { class: "m-fila-dato" }, el("span", { class: `m-punto ${c.estado === "conectado" ? "ok" : "mal"}` }), el("span", {}, c.cuenta), el("small", {}, c.estado === "conectado" ? `${c.noLeidos} sin leer` : c.error || c.estado)))
        : [el("p", { class: "m-ayuda" }, "Sin Gmail conectado: leo los mails desde las notificaciones.")]),
    ),
    movil ? titulo("Permisos") : null,
    movil ? filasPermisos() : null,
  );
}

// ---------- Integración con el HUD ----------

// El ⚙ y el primer arranque abren Ajustes dentro del menú (reemplaza al formulario viejo).
abrirAjustes = async function (bienvenida = false) {
  abrirMenu();
  menu.pila = ["ajustes"];
  await verAjustes(bienvenida);
};

// Pedidos rápidos del HUD: más completos y con accesos a las secciones.
dibujarPedidos = function () {
  const chips = [
    ["Revisá todo", "i-pulso", () => void revisarAhora()],
    ["¿Qué tengo hoy?", "i-calendario", () => void preguntar("¿Qué tengo hoy? Agenda, tareas y lo que esté pendiente.", "voz")],
    ["Mensajes", "i-whatsapp", () => abrirMenu("mensajes")],
    ["Correo", "i-mail", () => abrirMenu("correo")],
    ["Agenda", "i-calendario", () => abrirMenu("agenda")],
    ["Tareas", "i-check", () => abrirMenu("tareas")],
    ["Resumen del día", "i-sol", () => void preguntar("Dame el resumen del día.", "voz")],
  ];
  $("#chips").replaceChildren(...chips.map(([rotulo, iconoId, accion]) => el("button", { type: "button", onclick: accion }, icono(iconoId), rotulo)));
};

(function iniciarMenu() {
  $("#abrir-menu").addEventListener("click", () => (menu.abierto ? cerrarMenu() : abrirMenu()));
  $("#menu-cerrar").addEventListener("click", cerrarMenu);
  $("#menu-atras").addEventListener("click", volver);
  $("#menu-fondo").addEventListener("click", cerrarMenu);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menu.abierto) {
      e.stopPropagation();
      if (menu.pila.length) volver();
      else cerrarMenu();
    }
  }, true);
  if (movil) dibujarPedidos();
})();
