"use client";

import { create } from "zustand";

export type QualityLevel = "low" | "medium" | "high" | "ultra";

export interface QualityProfile {
  label: string;
  dpr: [number, number];
  shadows: boolean;
  shadowMapSize: number;
  bloom: boolean;
  antialias: boolean;
  /** Distancia máxima de dibujo de vegetación y decoración. */
  detailDistance: number;
  /** Multiplicador de las distancias de LOD del terreno. */
  lodScale: number;
  weatherParticles: number;
  /** Luces puntuales dinámicas para faroles cercanos de noche. */
  lightPool: number;
  /** Personajes animados a máxima frecuencia hasta esta distancia. */
  animationDistance: number;
}

export const QUALITY: Record<QualityLevel, QualityProfile> = {
  low: { label: "Bajo", dpr: [0.75, 1], shadows: false, shadowMapSize: 512, bloom: false, antialias: false, detailDistance: 150, lodScale: 0.6, weatherParticles: 1500, lightPool: 0, animationDistance: 50 },
  medium: { label: "Medio", dpr: [1, 1.5], shadows: true, shadowMapSize: 1024, bloom: false, antialias: true, detailDistance: 240, lodScale: 1, weatherParticles: 3500, lightPool: 6, animationDistance: 90 },
  high: { label: "Alto", dpr: [1, 2], shadows: true, shadowMapSize: 2048, bloom: true, antialias: true, detailDistance: 360, lodScale: 1.4, weatherParticles: 6000, lightPool: 10, animationDistance: 140 },
  ultra: { label: "Ultra", dpr: [1, 2], shadows: true, shadowMapSize: 4096, bloom: true, antialias: true, detailDistance: 600, lodScale: 2, weatherParticles: 9000, lightPool: 16, animationDistance: 220 },
};

export function detectQuality(): QualityLevel {
  if (typeof window === "undefined") return "medium";
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  if (coarse || small || mobileUA) return "low";
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  if (cores >= 8 && memory >= 8) return "high";
  return "medium";
}

export type AiProviderId = "local" | "openai-compatible";

interface SettingsState {
  quality: QualityLevel;
  qualityAuto: boolean;
  provider: AiProviderId;
  setQuality(q: QualityLevel): void;
  setProvider(p: AiProviderId): void;
  hydrate(): void;
}

const KEY = "worldforge.settings";

function read(): Partial<SettingsState> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Partial<SettingsState>) : {};
  } catch {
    return {};
  }
}

function write(s: Pick<SettingsState, "quality" | "qualityAuto" | "provider">) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Almacenamiento no disponible (modo privado): se usan los valores en memoria.
  }
}

export const useSettings = create<SettingsState>()((set, get) => ({
  quality: "medium",
  qualityAuto: true,
  provider: "local",
  setQuality(q) {
    set({ quality: q, qualityAuto: false });
    write({ quality: q, qualityAuto: false, provider: get().provider });
  },
  setProvider(p) {
    set({ provider: p });
    write({ quality: get().quality, qualityAuto: get().qualityAuto, provider: p });
  },
  hydrate() {
    const saved = read();
    const qualityAuto = saved.qualityAuto ?? true;
    const quality = qualityAuto ? detectQuality() : (saved.quality ?? "medium");
    set({ quality, qualityAuto, provider: saved.provider === "openai-compatible" ? "openai-compatible" : "local" });
  },
}));

export const useQuality = () => QUALITY[useSettings((s) => s.quality)];
