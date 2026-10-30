// Sonidos ambientales generados en el dispositivo con Web Audio (sin archivos
// ni conexión): ruido blanco, rosa, marrón y lluvia (ruido filtrado con ráfagas).

export type AmbientKind = 'white' | 'pink' | 'brown' | 'rain';

let ctx: AudioContext | null = null;
let current: { stop: () => void; gain: GainNode } | null = null;

function noiseBuffer(c: AudioContext, kind: Exclude<AmbientKind, 'rain'> | 'pink') {
  const len = c.sampleRate * 4;
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w * 0.35;
      else if (kind === 'pink') {
        // Filtro de Paul Kellet
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.2;
      }
    }
  }
  return buf;
}

export function playAmbient(kind: AmbientKind, volume: number) {
  stopAmbient();
  ctx ??= new AudioContext();
  const c = ctx;
  c.resume();
  const gain = c.createGain();
  gain.gain.value = volume;
  gain.connect(c.destination);
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, kind === 'rain' ? 'pink' : kind);
  src.loop = true;
  let lfo: OscillatorNode | null = null;
  if (kind === 'rain') {
    const bp = c.createBiquadFilter();
    bp.type = 'highpass';
    bp.frequency.value = 900;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7000;
    const mod = c.createGain();
    mod.gain.value = 0.8;
    lfo = c.createOscillator();
    lfo.frequency.value = 0.15;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 0.2;
    lfo.connect(lfoGain).connect(mod.gain);
    src.connect(bp).connect(lp).connect(mod).connect(gain);
    lfo.start();
  } else {
    src.connect(gain);
  }
  src.start();
  current = {
    gain,
    stop: () => {
      src.stop();
      lfo?.stop();
      gain.disconnect();
    },
  };
}

export function setAmbientVolume(v: number) {
  if (current) current.gain.gain.value = v;
}

export function stopAmbient() {
  current?.stop();
  current = null;
}

/** Campana suave al cambiar de fase. */
export function chime() {
  ctx ??= new AudioContext();
  const c = ctx;
  const o = c.createOscillator();
  const g = c.createGain();
  o.frequency.value = 880;
  o.type = 'sine';
  g.gain.setValueAtTime(0.0001, c.currentTime);
  g.gain.exponentialRampToValueAtTime(0.3, c.currentTime + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1.4);
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + 1.5);
}
