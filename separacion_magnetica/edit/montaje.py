"""Montaje final con FFmpeg: secuencias PNG -> MP4 H.264 1920x1080 30fps + AAC + subtítulos.

Uso: python montaje.py <dir_frames> <timeline.json> <mezcla.wav> <subtitulos.srt> <salida.mp4> [bitrate_video]
"""
import json
import os
import subprocess
import sys

frames_dir, tl_path, wav, subs, out = sys.argv[1:6]   # subs: archivo .ass (subtítulos quemados)
vbit = sys.argv[6] if len(sys.argv) > 6 else '3700k'
tl = json.load(open(tl_path))
items = tl['timeline']
total = tl['total']
inputs = []
filt = []
for i, it in enumerate(items):
    inputs += ['-framerate', '30', '-start_number', '1', '-i', os.path.join(frames_dir, it['scene'], 'f%05d.png')]
    filt.append('[%d:v]scale=1920:1080:flags=lanczos,unsharp=5:5:0.35:5:5:0.0,format=yuv420p,setsar=1,settb=1/30,fps=30[v%d]' % (i, i))
cur = 'v0'
for i in range(1, len(items)):
    it = items[i]
    dur = max(it['xfade'], 1 / 30)
    trans = {'fadewhite': 'fadewhite', 'fadeblack': 'fadeblack'}.get(it['type'], 'fade')
    nxt = 'x%d' % i
    filt.append('[%s][v%d]xfade=transition=%s:duration=%.4f:offset=%.4f[%s]' % (cur, i, trans, dur, it['start'], nxt))
    cur = nxt
filt.append("[%s]ass='%s',fade=t=in:st=0:d=0.8,fade=t=out:st=%.3f:d=1.5[vout]" % (cur, subs.replace("'", "\\'"), total - 1.5))
na = len(items)
filt.append('[%d:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[aout]' % na)
fc = ';'.join(filt)
common = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-stats'] + inputs + ['-i', wav, '-filter_complex', fc,
          '-map', '[vout]', '-map', '[aout]']
venc = ['-c:v', 'libx264', '-preset', 'slow', '-b:v', vbit, '-maxrate', '6000k', '-bufsize', '9000k', '-profile:v', 'high', '-level', '4.1',
        '-pix_fmt', 'yuv420p', '-r', '30', '-g', '60']
aenc = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2',
        '-metadata:s:a:0', 'language=spa', '-metadata', 'title=Separación Magnética — Ciencia en Acción', '-movflags', '+faststart', '-t', '%.3f' % total]
p1 = common + venc + ['-pass', '1', '-passlogfile', out + '.log', '-an', '-sn', '-f', 'mp4', '/dev/null']
p1 = [a for a in p1]
# en el primer pase no se mapean audio/subtítulos
p1 = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-stats'] + inputs + ['-filter_complex', ';'.join(filt[:-1]), '-map', '[vout]'] + venc + \
     ['-pass', '1', '-passlogfile', out + '.log', '-an', '-f', 'mp4', '/dev/null']
p2 = common + venc + ['-pass', '2', '-passlogfile', out + '.log'] + aenc + [out]
print('PASS 1', flush=True)
subprocess.run(p1, check=True)
print('PASS 2', flush=True)
subprocess.run(p2, check=True)
print('OK', out)
