import { create } from 'zustand';

export type Gesture = 'explain' | 'point' | 'nod' | 'wave' | 'think' | 'shake';

interface AvatarBus {
  gesture: { type: Gesture; at: number } | null;
  mood: 'neutral' | 'happy' | 'thinking' | 'surprised';
  play: (g: Gesture) => void;
  setMood: (m: AvatarBus['mood']) => void;
}

export const useAvatar = create<AvatarBus>((set) => ({
  gesture: null,
  mood: 'neutral',
  play: (type) => set({ gesture: { type, at: performance.now() } }),
  setMood: (mood) => set({ mood }),
}));

export const CHARACTERS = {
  seed: { label: 'Profesora Seed', file: 'models/seed-san.vrm', kind: 'vrm' as const, credit: 'Seed-san © VirtualCast, Inc. (VRM Public License 1.0)', lipSync: true },
  twist: { label: 'Profesora Aiko', file: 'models/vrm-twist-sample.vrm', kind: 'vrm' as const, credit: 'VRM sample © pixiv Inc. (VRM Public License 1.0)', lipSync: true },
  robot: { label: 'Profe Robo', file: 'models/robot-expressive.glb', kind: 'glb' as const, credit: 'RobotExpressive de Tomás Laulhé (CC0)', lipSync: false },
};
