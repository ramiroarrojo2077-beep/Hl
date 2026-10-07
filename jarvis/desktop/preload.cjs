const { contextBridge, ipcRenderer } = require("electron");

// Lo único que la interfaz puede pedirle a la app de escritorio.
contextBridge.exposeInMainWorld("escritorio", {
  interactivo: (si) => ipcRenderer.send("interactivo", Boolean(si)),
  mostrar: () => ipcRenderer.send("mostrar"),
  ocultar: () => ipcRenderer.send("ocultar"),
  onHablar: (fn) => ipcRenderer.on("hablar", () => fn()),
});
