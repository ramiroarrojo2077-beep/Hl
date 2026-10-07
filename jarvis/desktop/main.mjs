import { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, screen, session, shell, systemPreferences } from "electron";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// App de escritorio: Jarvis como un HUD transparente sobre tu fondo de pantalla, que vive en la
// bandeja del sistema, se abre sola cuando tiene algo que decirte y se muestra/oculta con Alt+J.

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(RAIZ, ".env"));
} catch {}

const PUERTO = Number(process.env.PORT ?? process.env.JARVIS_PUERTO ?? 3700);
const TOKEN = process.env.JARVIS_TOKEN?.trim() ?? "";
const BASE = `http://127.0.0.1:${PUERTO}`;
// "vertical" (predeterminado): panel alto pegado a un costado. "completo": HUD de pantalla completa.
const PANEL = process.env.JARVIS_PANEL === "completo" ? "completo" : "vertical";
const ANCHO_PANEL = Number(process.env.JARVIS_ANCHO) || 440;
const LADO = process.env.JARVIS_LADO === "izquierda" ? "izquierda" : "derecha";
const ATAJO_MOSTRAR = "Alt+J";
const ATAJO_HABLAR = "Alt+H";

let siempreArriba = process.env.JARVIS_SIEMPRE_ARRIBA === "1";
let ventana;
let bandeja;
let servidor;
let saliendo = false;
let activa = true;

if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId("Jarvis");
// Para que pueda escucharte y hablarte sin que primero hagas clic en la ventana.
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

function cabeceras() {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
}

async function servidorVivo() {
  try {
    const res = await fetch(`${BASE}/api/estado`, { headers: cabeceras(), signal: AbortSignal.timeout(1500) });
    if (res.ok) activa = (await res.json()).activa;
    return res.ok;
  } catch {
    return false;
  }
}

async function asegurarServidor() {
  if (await servidorVivo()) return;
  servidor = spawn(process.platform === "win32" ? "node.exe" : "node", ["--env-file-if-exists=.env", "src/server.ts"], {
    cwd: RAIZ,
    stdio: "inherit",
    windowsHide: true,
  });
  servidor.on("error", (err) => console.error(`No pude iniciar el servidor de Jarvis (¿está instalado Node.js 22.18+?): ${err.message}`));
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await servidorVivo()) return;
  }
}

// Ícono del reactor dibujado a mano (sin archivos de imagen).
function iconoJarvis(tam) {
  const pixeles = Buffer.alloc(tam * tam * 4);
  const centro = (tam - 1) / 2;
  for (let y = 0; y < tam; y++) {
    for (let x = 0; x < tam; x++) {
      const d = Math.hypot(x - centro, y - centro) / (tam / 2);
      const nucleo = d < 0.3;
      const alfa = nucleo || (d > 0.6 && d < 0.92) ? 255 : d < 0.42 ? 110 : 0;
      const i = (y * tam + x) * 4;
      // BGRA con alfa premultiplicado.
      pixeles[i] = Math.round(((nucleo ? 225 : 40) * alfa) / 255);
      pixeles[i + 1] = Math.round(((nucleo ? 225 : 40) * alfa) / 255);
      pixeles[i + 2] = alfa;
      pixeles[i + 3] = alfa;
    }
  }
  return nativeImage.createFromBitmap(pixeles, { width: tam, height: tam });
}

function limites() {
  const { workArea } = screen.getPrimaryDisplay();
  if (PANEL === "completo") return workArea;
  const ancho = Math.min(ANCHO_PANEL, workArea.width);
  return {
    x: LADO === "derecha" ? workArea.x + workArea.width - ancho : workArea.x,
    y: workArea.y,
    width: ancho,
    height: workArea.height,
  };
}

function direccion() {
  return `${BASE}/?escritorio=1&modo=${PANEL}${TOKEN ? `&token=${encodeURIComponent(TOKEN)}` : ""}`;
}

function crearVentana() {
  ventana = new BrowserWindow({
    ...limites(),
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: siempreArriba,
    show: false,
    title: "Jarvis",
    icon: iconoJarvis(64),
    webPreferences: {
      preload: path.join(RAIZ, "desktop", "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      // Sigue escuchando avisos aunque esté oculta.
      backgroundThrottling: false,
    },
  });
  ventana.loadURL(direccion());
  ventana.once("ready-to-show", () => mostrar(true));

  // Las zonas vacías dejan pasar los clics a tu escritorio (el renderer avisa cuándo estás sobre un panel).
  if (process.platform !== "linux") ventana.setIgnoreMouseEvents(true, { forward: true });

  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  ventana.webContents.on("will-navigate", (evento, url) => {
    if (!url.startsWith(BASE)) {
      evento.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  ventana.webContents.on("render-process-gone", () => setTimeout(() => ventana.reload(), 1000));
  ventana.webContents.on("did-fail-load", () => setTimeout(() => ventana.loadURL(direccion()), 2000));
  ventana.on("close", (evento) => {
    if (!saliendo) {
      evento.preventDefault();
      ventana.hide();
    }
  });
}

// Al decir "Jarvis" o cuando llega un aviso, aparece sola.
function mostrar(conFoco) {
  if (!ventana) return;
  if (conFoco) {
    ventana.show();
    ventana.focus();
  } else {
    // Cuando se abre sola no te roba el teclado: aparece arriba y seguís escribiendo donde estabas.
    ventana.showInactive();
    ventana.moveTop();
  }
}

function alternar() {
  if (ventana.isVisible() && ventana.isFocused()) ventana.hide();
  else mostrar(true);
}

function hablar() {
  mostrar(true);
  ventana.webContents.send("hablar");
}

async function cambiarActiva(valor) {
  try {
    await fetch(`${BASE}/api/activa`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...cabeceras() },
      body: JSON.stringify({ activa: valor }),
    });
    activa = valor;
  } catch {}
  armarMenu();
}

function armarMenu() {
  const inicio = app.getLoginItemSettings(app.isPackaged ? {} : { path: process.execPath, args: [RAIZ] });
  bandeja.setToolTip(activa ? "Jarvis · activa" : "Jarvis · desactivada");
  bandeja.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Mostrar / ocultar  (${ATAJO_MOSTRAR})`, click: alternar },
      { label: `Hablarle  (${ATAJO_HABLAR})`, click: hablar },
      { type: "separator" },
      { label: "Jarvis activa", type: "checkbox", checked: activa, click: (item) => void cambiarActiva(item.checked) },
      {
        label: "Siempre arriba de las ventanas",
        type: "checkbox",
        checked: siempreArriba,
        click: (item) => {
          siempreArriba = item.checked;
          ventana.setAlwaysOnTop(siempreArriba);
        },
      },
      {
        label: "Iniciar con la compu",
        type: "checkbox",
        checked: inicio.openAtLogin,
        click: (item) =>
          app.setLoginItemSettings({ openAtLogin: item.checked, ...(app.isPackaged ? {} : { path: process.execPath, args: [RAIZ] }) }),
      },
      { type: "separator" },
      {
        label: "Salir",
        click: () => {
          saliendo = true;
          app.quit();
        },
      },
    ]),
  );
}

app.on("second-instance", () => mostrar(true));
app.on("window-all-closed", () => {});
app.on("before-quit", () => {
  saliendo = true;
  servidor?.kill();
});
app.on("will-quit", () => globalShortcut.unregisterAll());

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_contenido, permiso, responder) => {
    responder(["media", "notifications", "clipboard-sanitized-write"].includes(permiso));
  });
  if (process.platform === "darwin") await systemPreferences.askForMediaAccess("microphone").catch(() => {});

  await asegurarServidor();
  crearVentana();

  bandeja = new Tray(iconoJarvis(process.platform === "darwin" ? 18 : 32));
  bandeja.on("click", alternar);
  armarMenu();
  // El estado puede cambiar desde la interfaz o por voz: se refresca el menú cada tanto.
  setInterval(async () => {
    const antes = activa;
    if ((await servidorVivo()) && antes !== activa) armarMenu();
  }, 10_000);

  if (!globalShortcut.register(ATAJO_MOSTRAR, alternar)) console.warn(`No pude registrar ${ATAJO_MOSTRAR} (¿lo usa otra app?)`);
  if (!globalShortcut.register(ATAJO_HABLAR, hablar)) console.warn(`No pude registrar ${ATAJO_HABLAR} (¿lo usa otra app?)`);

  ipcMain.on("interactivo", (_e, interactivo) => {
    if (process.platform !== "linux") ventana.setIgnoreMouseEvents(!interactivo, { forward: true });
  });
  ipcMain.on("mostrar", () => mostrar(false));
  ipcMain.on("ocultar", () => ventana.hide());
  // Si cambia la resolución o se conecta otra pantalla, se reacomoda.
  screen.on("display-metrics-changed", () => ventana.setBounds(limites()));
});
