import "cesium/Build/Cesium/Widgets/widgets.css";
import "./styles/app.css";
import { render } from "preact";
import { App } from "./ui/App.tsx";
import { cachePrune } from "./services/cache.ts";
import { isNative } from "./native.ts";

render(<App />, document.getElementById("app")!);

void cachePrune();

// Service worker: caché de la aplicación y de teselas para uso sin conexión parcial.
// (En la app Android los archivos ya están en el dispositivo: no hace falta service worker.)
if ("serviceWorker" in navigator && import.meta.env.PROD && !isNative) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* sin SW la app funciona igual */
    });
  });
}
