// Guardado local: configuración, campeonato, trayectoria, récords de contrarreloj y repeticiones.
// localStorage para datos chicos e IndexedDB para repeticiones (con try/catch: modo privado, etc.).

const PREFIX = 'f1ur:';

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

export function save(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch { return false; }
}

export function remove(key) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* nada */ }
}

export const DEFAULT_SETTINGS = {
  quality: 'alto', dynamicRes: true, shadows: true, post: true, showFps: false,
  volMaster: 0.8, volEngine: 0.8, volSfx: 0.8, volAmb: 0.6, volVoice: 0.9,
  commentary: true, radio: true, voice: true, subtitles: true, voiceAny: false,
  device: 'auto', steerSens: 1, padCurve: 1.6, vibration: true, wheel: null, keys: {},
  abs: true, tc: true, stability: true, autoGear: true, racingLine: true, pitAssist: true,
  difficulty: 'normal', wearMode: 'proporcional', damage: 'realista', failures: true, units: 'kmh',
  camera: 'chase', touch: 'auto',
};

export function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...load('settings', {}) };
}

// ---------- IndexedDB para repeticiones ----------
function db() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open('f1ur', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('replays', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}

export async function saveReplay(rep) {
  try {
    const d = await db();
    await new Promise((res, rej) => {
      const tx = d.transaction('replays', 'readwrite');
      tx.objectStore('replays').put(rep);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    return true;
  } catch { return false; }
}

export async function listReplays() {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const tx = d.transaction('replays', 'readonly');
      const req = tx.objectStore('replays').getAll();
      req.onsuccess = () => res(req.result.map(r => ({ id: r.id, title: r.title, date: r.date, duration: r.duration, trackId: r.trackId })));
      req.onerror = () => rej(req.error);
    });
  } catch { return []; }
}

export async function getReplay(id) {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const tx = d.transaction('replays', 'readonly');
      const req = tx.objectStore('replays').get(id);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  } catch { return null; }
}

export async function deleteReplay(id) {
  try {
    const d = await db();
    await new Promise((res, rej) => {
      const tx = d.transaction('replays', 'readwrite');
      tx.objectStore('replays').delete(id);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
  } catch { /* nada */ }
}
