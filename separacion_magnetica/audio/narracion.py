"""Genera la narración (es_AR) línea por línea con Piper y verifica con Whisper.

Uso: python narracion.py <dir_modelos_tts> <dir_salida>
Salida: <dir_salida>/<id>.wav (22.05 kHz mono) y <dir_salida>/lineas.json con duraciones.
"""
import json
import os
import sys
import wave

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
GUION = os.path.join(HERE, '..', 'guion', 'narracion.json')


def synth(voice, text, path, length_scale):
    from piper import SynthesisConfig
    cfg = SynthesisConfig(length_scale=length_scale, noise_scale=0.6, noise_w_scale=0.75)
    with wave.open(path, 'wb') as wf:
        voice.synthesize_wav(text, wf, syn_config=cfg)


def trim_silence(path, thr=0.006, pad=0.06):
    import soundfile as sf
    a, sr = sf.read(path, dtype='float32')
    env = np.abs(a)
    idx = np.where(env > thr)[0]
    if len(idx) == 0:
        return len(a) / sr
    s = max(0, idx[0] - int(pad * sr))
    e = min(len(a), idx[-1] + int(pad * sr))
    a = a[s:e]
    # fundidos cortos para evitar clics
    n = int(0.01 * sr)
    a[:n] *= np.linspace(0, 1, n)
    a[-n:] *= np.linspace(1, 0, n)
    sf.write(path, a, sr)
    return len(a) / sr


def main():
    models, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    from piper import PiperVoice
    g = json.load(open(GUION))
    voice = PiperVoice.load(os.path.join(models, 'vits-piper-es_AR-daniela-high', 'es_AR-daniela-high.onnx'))
    res = []
    for esc in g['escenas']:
        for ln in esc['lineas']:
            p = os.path.join(out, ln['id'] + '.wav')
            synth(voice, ln['texto'], p, g['length_scale'])
            dur = trim_silence(p)
            res.append(dict(id=ln['id'], escena=esc['id'], texto=ln['texto'], dur=round(dur, 3)))
            print(ln['id'], round(dur, 2), flush=True)
    json.dump(res, open(os.path.join(out, 'lineas.json'), 'w'), ensure_ascii=False, indent=1)
    print('total voz', round(sum(r['dur'] for r in res), 1))


if __name__ == '__main__':
    main()
