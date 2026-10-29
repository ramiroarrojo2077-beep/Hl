"""Mezcla final: narración + música original procedural + efectos sonoros sincronizados.

Uso: python mix.py <dir_narracion> <dir_escenas> <steps.json> <salida_dir>
Genera: mezcla.wav (48 kHz estéreo), subtitulos.srt, timeline.json
"""
import json
import math
import os
import sys

import numpy as np
import soundfile as sf
from scipy import signal

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
EDL = json.load(open(os.path.join(HERE, '..', 'guion', 'edl.json')))
rng = np.random.default_rng(7)


# ---------------------------------------------------------------------------
# utilidades
# ---------------------------------------------------------------------------

def t2s(t):
    return int(round(t * SR))


def env_adsr(n, a=0.01, d=0.1, s=0.6, r=0.2):
    a, d, r = t2s(a), t2s(d), t2s(r)
    e = np.ones(n) * s
    a = min(a, n)
    e[:a] = np.linspace(0, 1, a)
    dd = min(d, max(0, n - a))
    e[a:a + dd] = np.linspace(1, s, dd)
    rr = min(r, n)
    e[n - rr:] *= np.linspace(1, 0, rr)
    return e


def lp(x, fc, order=2):
    b, a = signal.butter(order, min(fc / (SR / 2), 0.99), 'low')
    return signal.lfilter(b, a, x)


def hp(x, fc, order=2):
    b, a = signal.butter(order, min(fc / (SR / 2), 0.99), 'high')
    return signal.lfilter(b, a, x)


def bp(x, f1, f2, order=2):
    b, a = signal.butter(order, [f1 / (SR / 2), min(f2 / (SR / 2), 0.99)], 'band')
    return signal.lfilter(b, a, x)


def noise(n):
    return rng.standard_normal(n)


def pink(n):
    w = noise(n)
    b = [0.049922035, -0.095993537, 0.050612699, -0.004408786]
    a = [1, -2.494956002, 2.017265875, -0.522189400]
    return signal.lfilter(b, a, w) * 3


def brown(n):
    x = np.cumsum(noise(n))
    x = hp(x, 15)
    return x / (np.abs(x).max() + 1e-9)


def reverb_ir(seconds=2.2, damp=3.0):
    n = t2s(seconds)
    t = np.arange(n) / SR
    ir = noise(n) * np.exp(-damp * t)
    ir = lp(ir, 6000)
    ir[0] = 1.0
    return ir / np.abs(ir).sum() * 40


IR_ROOM = reverb_ir(0.9, 6.0)
IR_HALL = reverb_ir(2.6, 2.2)


class Bus:
    def __init__(self, dur):
        self.n = t2s(dur) + SR
        self.x = np.zeros((self.n, 2))

    def add(self, t, sig, gain=1.0, pan=0.0):
        s = t2s(t)
        if s >= self.n:
            return
        sig = np.asarray(sig)
        if sig.ndim == 1:
            l = sig * math.cos((pan + 1) * math.pi / 4)
            r = sig * math.sin((pan + 1) * math.pi / 4)
            sig = np.stack([l, r], 1) * math.sqrt(2)
        e = min(self.n, s + len(sig))
        if s < 0:
            sig = sig[-s:]
            s = 0
        self.x[s:e] += sig[:e - s] * gain


# ---------------------------------------------------------------------------
# síntesis de efectos
# ---------------------------------------------------------------------------

def footstep(surface='hard'):
    n = t2s(0.18)
    t = np.arange(n) / SR
    heel = noise(n) * np.exp(-t * 60)
    heel = bp(heel, 300, 4000 if surface == 'hard' else 2500)
    thump = np.sin(2 * math.pi * 90 * t) * np.exp(-t * 40) * 0.6
    scuff = bp(noise(n), 2000, 8000) * np.exp(-((t - 0.05) / 0.03) ** 2) * 0.25
    if surface == 'gravel':
        g = bp(noise(n), 800, 6000) * np.exp(-t * 18) * 0.8
        return (heel * 0.5 + thump * 0.6 + g) * rng.uniform(0.7, 1.0)
    return (heel + thump + scuff) * rng.uniform(0.75, 1.0)


def metal_hit(size=1.0, dur=0.8, bright=1.0):
    n = t2s(dur)
    t = np.arange(n) / SR
    base = 520 / size
    out = np.zeros(n)
    for k, (ratio, amp, dec) in enumerate(((1.0, 1.0, 6), (2.76, 0.6, 9), (5.4, 0.4, 14), (8.9, 0.25 * bright, 20), (13.3, 0.15 * bright, 28))):
        f = base * ratio * rng.uniform(0.97, 1.03)
        if f > SR / 2.2:
            continue
        out += amp * np.sin(2 * math.pi * f * t + rng.uniform(0, 6)) * np.exp(-t * dec / size)
    click = hp(noise(n), 2000) * np.exp(-t * 300) * 0.5
    return (out + click) * 0.5


def clink():
    return metal_hit(size=rng.uniform(0.12, 0.25), dur=0.25, bright=1.5) * rng.uniform(0.3, 0.7)


def rustle(dur, density=400):
    n = t2s(dur)
    out = np.zeros(n)
    for _ in range(int(density * dur)):
        s = rng.integers(0, max(1, n - 400))
        g = bp(noise(300), 3000, 12000) * np.hanning(300) * rng.uniform(0.2, 1.0)
        out[s:s + 300] += g
    return out * 0.25


def whoosh(dur=1.2, f0=300, f1=3000, up=True):
    n = t2s(dur)
    t = np.linspace(0, 1, n)
    x = noise(n)
    out = np.zeros(n)
    seg = 1024
    for i in range(0, n, seg):
        u = t[i]
        fc = f0 + (f1 - f0) * (u if up else 1 - u)
        out[i:i + seg] = bp(x[i:i + seg + 0][:seg], max(60, fc * 0.6), fc * 1.4)[:len(out[i:i + seg])]
    e = np.sin(np.pi * t) ** 1.5
    return lp(out, 9000) * e * 0.9


def shimmer(dur=2.0, base=880):
    n = t2s(dur)
    t = np.arange(n) / SR
    out = np.zeros(n)
    notes = [1, 1.25, 1.5, 2, 2.5, 3]
    for k, r in enumerate(notes):
        st = k * 0.07
        tt = t - st
        m = tt > 0
        out[m] += np.sin(2 * math.pi * base * r * tt[m]) * np.exp(-tt[m] * 2.5) * 0.25
    return out * np.minimum(1, t / 0.02)


def beep(f=1320, dur=0.12):
    n = t2s(dur)
    t = np.arange(n) / SR
    return np.sin(2 * math.pi * f * t) * env_adsr(n, 0.004, 0.03, 0.6, 0.05) * 0.4


def hum(dur, f=100, level=1.0):
    n = t2s(dur)
    t = np.arange(n) / SR
    x = sum(np.sin(2 * math.pi * f * h * t) / h for h in (1, 2, 3, 5))
    x += 0.1 * lp(noise(n), 400)
    return x * level * env_adsr(n, 0.15, 0.1, 1.0, 0.3)


def clunk():
    n = t2s(0.6)
    t = np.arange(n) / SR
    thump = np.sin(2 * math.pi * 55 * t) * np.exp(-t * 12)
    return thump + metal_hit(2.5, 0.6) * 0.5


def hydraulic(dur):
    n = t2s(dur)
    t = np.arange(n) / SR
    f = 260 + 40 * np.sin(2 * math.pi * 0.7 * t)
    ph = 2 * math.pi * np.cumsum(f) / SR
    x = signal.sawtooth(ph) * 0.3 + 0.4 * bp(noise(n), 400, 2500)
    return lp(x, 2000) * env_adsr(n, 0.3, 0.1, 1.0, 0.4) * 0.35


def machinery(dur, rate=1.7):
    n = t2s(dur)
    t = np.arange(n) / SR
    rumble = brown(n) * 0.8
    whine = np.sin(2 * math.pi * 180 * t + 0.4 * np.sin(2 * math.pi * 0.3 * t)) * 0.08
    thumps = np.zeros(n)
    k = 0.0
    while k < dur:
        s = t2s(k)
        m = metal_hit(rng.uniform(0.8, 2.0), 0.5) * rng.uniform(0.1, 0.3)
        e = min(n, s + len(m))
        thumps[s:e] += m[:e - s]
        k += rng.uniform(0.4, 1.4) / rate
    rollers = bp(noise(n), 80, 400) * (0.6 + 0.4 * np.sin(2 * math.pi * 3.1 * t)) * 0.4
    return rumble + whine + thumps + rollers


def wind(dur):
    n = t2s(dur)
    t = np.arange(n) / SR
    x = lp(pink(n), 900) * (0.6 + 0.4 * np.sin(2 * math.pi * 0.08 * t + 1.3))
    return x * 0.6


def birds(dur, count=8):
    n = t2s(dur)
    out = np.zeros(n)
    for _ in range(count):
        s = rng.integers(0, max(1, n - SR))
        for k in range(rng.integers(2, 5)):
            m = t2s(0.08)
            tt = np.arange(m) / SR
            f = rng.uniform(2800, 4200) + 1500 * np.sin(np.pi * tt / tt[-1])
            ph = 2 * math.pi * np.cumsum(f) / SR
            c = np.sin(ph) * np.hanning(m) * 0.12
            st = s + k * t2s(0.12)
            out[st:st + m] += c[:max(0, min(m, n - st))]
    return out


def room_tone(dur, level=1.0):
    n = t2s(dur)
    return lp(pink(n), 500) * 0.15 * level + hum(dur, 60, 0.01)


def engine(dur):
    n = t2s(dur)
    t = np.arange(n) / SR
    f = 32 + 2 * np.sin(2 * math.pi * 0.2 * t)
    ph = 2 * math.pi * np.cumsum(f) / SR
    x = signal.sawtooth(ph) * 0.5 + 0.3 * np.sin(ph * 2)
    x = lp(x, 300) + 0.15 * bp(noise(n), 100, 600)
    return x * 0.5


def crash(dur=1.2, n_hits=14):
    n = t2s(dur)
    out = np.zeros(n)
    for _ in range(n_hits):
        s = rng.integers(0, max(1, n - SR // 2))
        m = metal_hit(rng.uniform(0.6, 2.2), 0.8) * rng.uniform(0.3, 1.0)
        e = min(n, s + len(m))
        out[s:e] += m[:e - s]
    out += bp(noise(n), 200, 3000) * np.exp(-np.arange(n) / SR * 4) * 0.4
    return out


def door_slide(dur=1.3):
    n = t2s(dur)
    t = np.linspace(0, 1, n)
    x = bp(noise(n), 150, 900) * np.sin(np.pi * t) * 0.5
    return x + whoosh(dur, 200, 900) * 0.4


# ---------------------------------------------------------------------------
# música original (ambiental, instrumental)
# ---------------------------------------------------------------------------

NOTE = {'C': 0, 'C#': 1, 'D': 2, 'D#': 3, 'E': 4, 'F': 5, 'F#': 6, 'G': 7, 'G#': 8, 'A': 9, 'A#': 10, 'B': 11}


def hz(name, octv):
    return 440.0 * 2 ** ((NOTE[name] + 12 * (octv - 4) - 9) / 12)


CHORDS = [('D', ['D', 'F#', 'A', 'C#']), ('B', ['B', 'D', 'F#', 'A']), ('G', ['G', 'B', 'D', 'F#']), ('A', ['A', 'C#', 'E', 'G'])]


def pad_voice(f, dur):
    n = t2s(dur)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for det in (-0.12, 0.0, 0.13):
        ff = f * 2 ** (det / 12)
        x += np.sin(2 * math.pi * ff * t) + 0.3 * np.sin(4 * math.pi * ff * t) + 0.12 * np.sin(6 * math.pi * ff * t)
    return x * env_adsr(n, 1.6, 0.5, 0.85, 2.0) / 3


def pluck(f, dur=0.6):
    n = t2s(dur)
    t = np.arange(n) / SR
    x = (np.sin(2 * math.pi * f * t) + 0.35 * np.sin(4 * math.pi * f * t) * np.exp(-t * 8))
    return x * np.exp(-t * 5) * np.minimum(1, t / 0.004)


def music(total, energy):
    """energy(t) -> 0..1 controla la presencia de pulso/percusión."""
    bus = Bus(total)
    bar = 4.0
    t = 0.0
    k = 0
    while t < total:
        root, notes = CHORDS[k % 4]
        x = np.zeros(t2s(bar + 2.5))
        for nn in notes:
            x[:t2s(bar + 2.5)] += pad_voice(hz(nn, 3), bar + 2.5)[:len(x)]
        bus.add(t, lp(x, 1800) * 0.13, pan=rng.uniform(-0.2, 0.2))
        # bajo
        b = pad_voice(hz(root, 2), bar + 1.0) * 0.5
        bus.add(t, lp(b, 400) * 0.22)
        # arpegio (corcheas a 120 bpm)
        e = energy(t)
        step = 0.25
        seq = [0, 1, 2, 3, 2, 1, 2, 3, 0, 2, 1, 3, 2, 1, 3, 2]
        for i in range(int(bar / step)):
            nn = notes[seq[i % len(seq)]]
            oc = 5 if i % 8 < 4 else 4
            p = pluck(hz(nn, oc), 0.7) * (0.05 + 0.05 * e)
            bus.add(t + i * step, p, pan=0.5 * math.sin(i * 0.8))
        # pulso suave (planta / chatarrería)
        if e > 0.35:
            for i in range(int(bar / 0.5)):
                tt = t + i * 0.5
                n = t2s(0.25)
                tk = np.arange(n) / SR
                kick = np.sin(2 * math.pi * (50 + 60 * np.exp(-tk * 30)) * tk) * np.exp(-tk * 18)
                bus.add(tt, kick * 0.18 * (e - 0.3))
                if i % 2 == 1:
                    hat = hp(noise(t2s(0.05)), 7000) * np.exp(-np.arange(t2s(0.05)) / SR * 80)
                    bus.add(tt, hat * 0.05 * e, pan=0.3)
        t += bar
        k += 1
    x = bus.x
    wet = np.stack([signal.fftconvolve(x[:, c], IR_HALL)[:len(x)] for c in range(2)], 1)
    return x * 0.7 + wet * 0.5


# ---------------------------------------------------------------------------
# subtítulos
# ---------------------------------------------------------------------------

MAX_LINE = 42


def wrap2(txt):
    if len(txt) <= MAX_LINE:
        return txt
    words = txt.split()
    best, bi = 1e9, 1
    for i in range(1, len(words)):
        l1 = len(' '.join(words[:i]))
        l2 = len(' '.join(words[i:]))
        sc = max(l1, l2) + (0 if l1 <= l2 + 6 else 3)
        if sc < best:
            best, bi = sc, i
    return ' '.join(words[:bi]) + '\n' + ' '.join(words[bi:])


def split_cue(a, b, txt):
    """Divide una línea de narración en bloques de <= 2 líneas, cortando en puntuación."""
    import re
    parts = re.split(r'(?<=[\.\?\!:;,])\s+', txt)
    chunks, cur = [], ''
    for p in parts:
        cand = (cur + ' ' + p).strip()
        if len(cand) <= MAX_LINE * 2 - 4 or not cur:
            cur = cand
        else:
            chunks.append(cur)
            cur = p
    if cur:
        chunks.append(cur)
    out = []
    for c in chunks:
        while len(c) > MAX_LINE * 2:
            w = c.split()
            half = len(w) // 2
            out.append(' '.join(w[:half]))
            c = ' '.join(w[half:])
        out.append(c)
    total = sum(len(c) for c in out)
    t = a
    res = []
    for c in out:
        d = (b - a) * len(c) / total
        res.append((t, t + d + (0.25 if c is out[-1] else 0.0), wrap2(c)))
        t += d
    return res


def write_ass(path, cues):
    head = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,Montserrat SemiBold,50,&H00FFFFFF,&H00FFFFFF,&H00141414,&H96000000,0,0,0,0,100,100,0.5,0,1,2.6,1.4,2,160,160,34,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    def ts(x):
        h = int(x // 3600)
        m = int(x % 3600 // 60)
        s_ = x % 60
        return '%d:%02d:%05.2f' % (h, m, s_)
    with open(path, 'w') as fh:
        fh.write(head)
        for a, b, txt in cues:
            fh.write('Dialogue: 0,%s,%s,Sub,,0,0,0,,{\\fad(120,120)}%s\n' % (ts(a), ts(b), txt.replace('\n', '\\N')))


# ---------------------------------------------------------------------------
# mezcla
# ---------------------------------------------------------------------------

def main():
    narr_dir, scenes_dir, steps_path, out_dir = sys.argv[1:5]
    os.makedirs(out_dir, exist_ok=True)
    lines = {l['id']: l for l in json.load(open(os.path.join(narr_dir, 'lineas.json')))}
    steps = json.load(open(steps_path))
    # offsets de la línea de tiempo
    off = {}
    t = 0.0
    prev_end = 0.0
    timeline = []
    for i, e in enumerate(EDL):
        meta = json.load(open(os.path.join(scenes_dir, e['scene'] + '.json')))
        dur = meta['frames'] / 30.0
        start = 0.0 if i == 0 else prev_end - e.get('xfade', 0.0)
        off[e['scene']] = start
        prev_end = start + dur
        timeline.append(dict(scene=e['scene'], start=start, dur=dur, xfade=e.get('xfade', 0.0), type=e.get('type', 'fade'), narration=meta['narration']))
    total = prev_end
    print('duración total', round(total, 2))
    voice = Bus(total)
    sfx = Bus(total)
    amb = Bus(total)
    subs = []
    for tl in timeline:
        for lid, tr in tl['narration']:
            a, sr = sf.read(os.path.join(narr_dir, lid + '.wav'), dtype='float32')
            if a.ndim > 1:
                a = a.mean(1)
            a = signal.resample_poly(a, SR, sr)
            g = tl['start'] + tr
            voice.add(g, a * 0.9)
            subs.append((g, g + len(a) / SR, lines[lid]['texto']))
    # ambientes por escena
    def scene_rng(name):
        s = off[name]
        d = [x for x in timeline if x['scene'] == name][0]['dur']
        return s, d
    s, d = scene_rng('E1a')
    amb.add(s, wind(d + 0.5) * 0.5)
    amb.add(s, birds(d, 10) * 0.6, pan=0.3)
    sfx.add(s + 7.2, door_slide() * 0.5)
    for name in ('E1b', 'E2', 'E2b', 'E3', 'E6'):
        s, d = scene_rng(name)
        amb.add(s, room_tone(d + 0.5) * 0.7)
    # E2b: objetos de acero saltando al imán
    s, d = scene_rng('E2b')
    for tt in (3.4, 3.6, 4.6, 5.6):
        sfx.add(s + tt, metal_hit(0.2, 0.3) * 0.35)
    # E4b: maquinaria, golpes de latas en los contenedores
    s, d = scene_rng('E4b')
    amb.add(s, machinery(d + 0.5) * 0.25)
    amb.add(s, hum(d, 100, 0.05))
    k = s + 0.6
    while k < s + d:
        sfx.add(k, metal_hit(rng.uniform(0.15, 0.3), 0.4) * 0.15, pan=rng.uniform(-0.3, 0.6))
        k += rng.uniform(0.25, 0.6)
    s, d = scene_rng('E1b')
    sfx.add(s + 18.8, whoosh(1.4, 200, 4000) * 0.35)
    sfx.add(s + 19.6, shimmer(2.5, 880) * 0.25)
    # E2
    s, d = scene_rng('E2')
    sfx.add(s + 12.25, metal_hit(0.3, 0.3) * 0.25)                        # toma el imán
    r = rustle(4.2, 500)
    r = signal.resample_poly(r, 3, 2)[: len(r)]
    sfx.add(s + 19.4, r * 0.6)                                             # limaduras saltando (cámara lenta)
    for k in range(40):
        sfx.add(s + 19.6 + rng.uniform(0, 4.0), clink() * 0.18, pan=rng.uniform(-0.3, 0.3))
    sfx.add(s + 28.1, bp(noise(t2s(0.15)), 800, 3000) * np.hanning(t2s(0.15)) * 0.15)   # funda
    sfx.add(s + 28.25, whoosh(1.2, 400, 1500) * 0.2)                       # retira el imán
    for k in range(60):
        sfx.add(s + 28.6 + rng.uniform(0, 0.7), clink() * 0.35, pan=rng.uniform(-0.4, 0.4))
    # E3
    s, d = scene_rng('E3')
    sfx.add(s + 5.2, whoosh(1.0, 300, 5000) * 0.3)
    sfx.add(s + 5.7, shimmer(2.0, 660) * 0.3)
    amb.add(s + 6.0, hum(d - 6.0, 120, 0.02))
    for i in range(4):
        sfx.add(s + 9.0 + i * 0.45 + 0.85, metal_hit(0.25, 0.35) * 0.3)
        sfx.add(s + 9.0 + i * 0.45 + 0.85, beep(1760, 0.08) * 0.2)
    for i in range(3):
        sfx.add(s + 13.6 + i * 0.4, beep(440, 0.15) * 0.18)
    sfx.add(s + 21.4, whoosh(1.4, 300, 3000) * 0.3)
    # E4
    s, d = scene_rng('E4')
    amb.add(s, machinery(d + 0.5) * 0.25)
    amb.add(s, hum(d, 100, 0.05))
    k = s + 1.0
    while k < s + d:
        sfx.add(k, metal_hit(rng.uniform(0.15, 0.3), 0.4) * 0.12, pan=rng.uniform(-0.5, 0.5))
        k += rng.uniform(0.5, 1.2)
    for tt in (22.4, 23.2):
        sfx.add(s + tt, beep(1320, 0.1) * 0.3)
    # E5
    s, d = scene_rng('E5')
    amb.add(s, wind(d + 0.5) * 0.45)
    amb.add(s, engine(d + 0.5) * 0.3)
    amb.add(s, birds(d, 6) * 0.3, pan=-0.4)
    sfx.add(s + 3.0, hydraulic(6.0) * 0.5)
    sfx.add(s + 9.0, hydraulic(2.2) * 0.35)
    sfx.add(s + 12.2, clunk() * 0.6)
    sfx.add(s + 12.2, hum(8.4, 100, 0.12))
    sfx.add(s + 12.35, crash(0.8, 10) * 0.35)
    sfx.add(s + 15.0, hydraulic(4.2) * 0.5)
    sfx.add(s + 20.6, clunk() * 0.4)
    sfx.add(s + 20.75, crash(1.4, 20) * 0.6)
    # E6
    s, d = scene_rng('E6')
    for tt in (1.4, 3.4, 5.6):
        sfx.add(s + tt, beep(990, 0.1) * 0.35)
        sfx.add(s + tt + 0.3, hp(bp(noise(t2s(1.6)), 300, 1200), 200) * env_adsr(t2s(1.6), 0.1, 0.1, 0.8, 0.4) * 0.05)
    sfx.add(s + 15.4, whoosh(1.6, 200, 4000) * 0.35)
    sfx.add(s + 16.0, shimmer(3.0, 880) * 0.3)
    # pisadas
    for name, st in steps.items():
        surface = 'gravel' if name == 'E5' else 'hard'
        for ev in st['steps']:
            tt = off[name] + (ev['f'] - 1) / 30.0
            g = 0.32 if ev['who'] == 'sci' else 0.12
            sfx.add(tt, footstep(surface) * g, pan=rng.uniform(-0.15, 0.15))
    # reverb de sala sobre efectos
    sx = sfx.x
    wet = np.stack([signal.fftconvolve(sx[:, c], IR_ROOM)[:len(sx)] for c in range(2)], 1)
    sfx_mix = sx * 0.85 + wet * 0.3
    # música con energía según escena y ducking bajo la voz
    def energy(t):
        if t < off['E4']:
            return 0.15 if t < off['E2b'] else 0.25
        if t < off['E6']:
            return 0.65
        return 0.3
    mus = music(total + 1, energy)[:voice.n]
    if len(mus) < voice.n:
        mus = np.pad(mus, ((0, voice.n - len(mus)), (0, 0)))
    venv = np.abs(voice.x).max(1)
    venv = lp(venv, 4) * 3
    duck = 1.0 - 0.65 * np.clip(venv / (venv.max() + 1e-9) * 3, 0, 1)
    fade_in = np.minimum(1, np.arange(voice.n) / t2s(2.0))
    fade_out = np.clip((t2s(total) - np.arange(voice.n)) / t2s(2.5), 0, 1)   # igual que el fundido de imagen
    mus = mus * (duck * fade_in * fade_out)[:, None]
    # voz: compresión suave + leve EQ
    vx = voice.x
    vx = np.stack([hp(vx[:, c], 90) for c in range(2)], 1)
    mix = vx * 1.0 + sfx_mix * 0.75 + amb.x * 0.5 + mus * 0.5
    mix *= (fade_out)[:, None]
    mix = mix[:t2s(total)]
    peak = np.abs(mix).max()
    mix = mix / peak * 0.89
    sf.write(os.path.join(out_dir, 'mezcla.wav'), mix.astype(np.float32), SR, subtype='PCM_24')
    # subtítulos: bloques de hasta 2 líneas, tiempos proporcionales al largo del texto
    cues = []
    for a, b, txt in subs:
        for (ca, cb, ct) in split_cue(a, b, txt):
            cues.append((ca, cb, ct))

    def fmt(x):
        h = int(x // 3600)
        m = int(x % 3600 // 60)
        s_ = x % 60
        return '%02d:%02d:%06.3f' % (h, m, s_)
    with open(os.path.join(out_dir, 'subtitulos.srt'), 'w') as fh:
        for i, (a, b, txt) in enumerate(cues, 1):
            fh.write('%d\n%s --> %s\n%s\n\n' % (i, fmt(a).replace('.', ','), fmt(b).replace('.', ','), txt))
    write_ass(os.path.join(out_dir, 'subtitulos.ass'), cues)
    json.dump(dict(total=total, timeline=timeline), open(os.path.join(out_dir, 'timeline.json'), 'w'), indent=1, ensure_ascii=False)
    print('ok', total)


if __name__ == '__main__':
    main()
