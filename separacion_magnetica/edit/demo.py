"""Demo con los fragmentos ya renderizados: une segmentos (escena, frames) con su audio y subtítulos.

Uso: python demo.py <dir_frames> <timeline.json> <mezcla.wav> <subtitulos.ass> <salida.mp4> ESC:f0:f1 [ESC:f0:f1 ...]
"""
import json
import os
import subprocess
import sys

frames_dir, tl_path, wav, ass, out = sys.argv[1:6]
segs = [s.split(':') for s in sys.argv[6:]]
tl = {t['scene']: t for t in json.load(open(tl_path))['timeline']}
tmp = out + '_parts'
os.makedirs(tmp, exist_ok=True)
parts = []
for i, (sc, f0, f1) in enumerate(segs):
    f0, f1 = int(f0), int(f1)
    g0 = tl[sc]['start'] + (f0 - 1) / 30.0
    dur = (f1 - f0 + 1) / 30.0
    p = os.path.join(tmp, 'p%02d.mp4' % i)
    vf = ("scale=1920:1080:flags=lanczos,unsharp=5:5:0.35:5:5:0.0,setpts=PTS+%.4f/TB,ass='%s',setpts=PTS-STARTPTS,"
          "fade=t=in:st=0:d=0.4,fade=t=out:st=%.3f:d=0.4,format=yuv420p") % (g0, ass, dur - 0.4)
    cmd = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-framerate', '30', '-start_number', str(f0),
           '-i', os.path.join(frames_dir, sc, 'f%05d.png'), '-ss', '%.4f' % g0, '-t', '%.4f' % dur, '-i', wav,
           '-frames:v', str(f1 - f0 + 1), '-vf', vf,
           '-af', 'afade=t=in:d=0.3,afade=t=out:st=%.3f:d=0.4,loudnorm=I=-16:TP=-1.5' % (dur - 0.4),
           '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', p]
    subprocess.run(cmd, check=True)
    parts.append(p)
lst = os.path.join(tmp, 'list.txt')
with open(lst, 'w') as fh:
    for p in parts:
        fh.write("file '%s'\n" % p)
subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy',
                '-movflags', '+faststart', out], check=True)
print('OK', out)
