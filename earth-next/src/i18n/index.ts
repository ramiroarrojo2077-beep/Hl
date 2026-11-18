/**
 * Internacionalización estilo gettext: el texto fuente está en español y los
 * diccionarios traducen a otros idiomas. Las cadenas faltantes caen al español.
 * Interpolación: t("Hola {name}", { name: "Ana" }).
 */
import { settings } from "../state/store.ts";
import { en } from "./en.ts";

const dictionaries: Record<string, Record<string, string>> = { en };

export function t(source: string, vars?: Record<string, string | number>): string {
  const lang = settings.value.lang;
  let text = lang === "es" ? source : (dictionaries[lang]?.[source] ?? source);
  if (vars) for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
  return text;
}

export function locale(): string {
  return settings.value.lang === "es" ? "es-AR" : "en-US";
}

export const LANGUAGES: { id: "es" | "en"; name: string }[] = [
  { id: "es", name: "Español" },
  { id: "en", name: "English" },
];
