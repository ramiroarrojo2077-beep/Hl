import "cesium/Build/Cesium/Widgets/widgets.css";
import "./styles/app.css";
import { render } from "preact";
import { App } from "./ui/App.tsx";
import { cachePrune } from "./services/cache.ts";

render(<App />, document.getElementById("app")!);

void cachePrune();

// Service worker: caché de la aplicación y de teselas para uso sin conexión parcial.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* sin SW la app funciona igual */
    });
  });
}
