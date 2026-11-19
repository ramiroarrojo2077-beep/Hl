/**
 * Integración con la app nativa (Android, vía Capacitor). En el navegador todas estas
 * funciones usan la alternativa web, así que el mismo código sirve para ambos.
 */
import { Capacitor, CapacitorHttp } from "@capacitor/core";

export const isNative = Capacitor.isNativePlatform();
export const platform = Capacitor.getPlatform();

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Guarda un archivo generado (captura, video, GeoJSON, KML…).
 * Web: descarga. Android: lo guarda en la app y abre el menú "Compartir" para enviarlo
 * a Galería, Drive, WhatsApp, Archivos, etc.
 */
export async function saveFile(blob: Blob, filename: string): Promise<void> {
  if (!isNative) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return;
  }
  const { Filesystem, Directory } = await import("@capacitor/filesystem");
  const { Share } = await import("@capacitor/share");
  const data = await blobToBase64(blob);
  const written = await Filesystem.writeFile({ path: `earth-next/${filename}`, data, directory: Directory.Cache, recursive: true });
  try {
    await Share.share({ title: filename, files: [written.uri], dialogTitle: "EARTH NEXT" });
  } catch {
    /* el usuario cerró el menú */
  }
}

/** Narración: voz nativa en Android (WebView no trae speechSynthesis); Web Speech en navegador. */
export async function speakText(text: string, lang: string): Promise<void> {
  if (isNative) {
    const { TextToSpeech } = await import("@capacitor-community/text-to-speech");
    await TextToSpeech.stop().catch(() => {});
    await TextToSpeech.speak({ text, lang: lang === "es" ? "es-AR" : "en-US", rate: 1.0, pitch: 1.0, volume: 1.0 }).catch(() => {});
    return;
  }
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang === "es" ? "es-ES" : "en-US";
  const v = window.speechSynthesis.getVoices().find((x) => x.lang.toLowerCase().startsWith(lang));
  if (v) u.voice = v;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

export async function stopSpeaking(): Promise<void> {
  if (isNative) {
    const { TextToSpeech } = await import("@capacitor-community/text-to-speech");
    await TextToSpeech.stop().catch(() => {});
  } else window.speechSynthesis?.cancel();
}

/** GET de JSON sin restricciones CORS (sólo en Android; en web usa fetch normal). */
export async function nativeGetJson<T>(url: string): Promise<T> {
  if (!isNative) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()) as T;
  }
  const r = await CapacitorHttp.get({ url, headers: { Accept: "application/json" }, responseType: "json" });
  if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`);
  return (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as T;
}

/** Botón "atrás" de Android: primero cierra paneles; si no hay nada abierto, minimiza la app. */
export async function setupBackButton(onBack: () => boolean): Promise<void> {
  if (!isNative) return;
  const { App } = await import("@capacitor/app");
  await App.addListener("backButton", () => {
    if (!onBack()) void App.minimizeApp();
  });
}
