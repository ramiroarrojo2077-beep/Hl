"""Renderiza un rango de frames de una escena guardada a PNG.

Con SM_MAX_FRAMES=N sale con código 3 tras N frames (el proceso de render acumula memoria;
el script envoltorio lo relanza y continúa desde los frames que faltan).

Uso: python render_scene.py escena.blend dir_salida f_ini f_fin [paso]
"""
import sys
import os
import bpy

blend, out, f0, f1 = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
step = int(sys.argv[5]) if len(sys.argv) > 5 else 1
bpy.ops.wm.open_mainfile(filepath=blend)
sc = bpy.context.scene
os.makedirs(out, exist_ok=True)
sc.render.use_persistent_data = True
max_frames = int(os.environ.get('SM_MAX_FRAMES', '0'))
done = 0
for f in range(f0, f1 + 1, step):
    p = os.path.join(out, 'f%05d.png' % f)
    if os.path.exists(p) and os.path.getsize(p) > 1000:
        continue
    sc.frame_set(f)
    sc.render.filepath = p
    bpy.ops.render.render(write_still=True)
    print('FRAME', f, flush=True)
    done += 1
    if max_frames and done >= max_frames:
        sys.exit(3)
