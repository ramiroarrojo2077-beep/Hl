"""Renderiza un rango de frames de una escena guardada a PNG.

Con SM_MAX_FRAMES=N sale con código 3 tras N frames (el proceso de render acumula memoria;
el script envoltorio lo relanza y continúa desde los frames que faltan).

Uso: python render_scene.py escena.blend dir_salida f_ini f_fin [paso]
"""
import sys
import os
import time
import bpy


def claim(out, f):
    """Reserva el frame con un archivo .lock (varios procesos sobre el mismo rango se reparten el trabajo).
    Un lock de más de 10 minutos se considera abandonado (proceso muerto)."""
    lk = os.path.join(out, '.f%05d.lock' % f)
    try:
        os.close(os.open(lk, os.O_CREAT | os.O_EXCL | os.O_WRONLY))
        return True
    except FileExistsError:
        try:
            if time.time() - os.path.getmtime(lk) > 600:
                os.utime(lk)
                return True
        except OSError:
            pass
        return False

blend, out, f0, f1 = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
step = int(sys.argv[5]) if len(sys.argv) > 5 else 1
bpy.ops.wm.open_mainfile(filepath=blend)
sc = bpy.context.scene
os.makedirs(out, exist_ok=True)
sc.render.use_persistent_data = True
max_frames = int(os.environ.get('SM_MAX_FRAMES', '0'))
done = 0
for f in range(f1, f0 - 1, -1):
    p = os.path.join(out, 'f%05d.png' % f)
    if os.path.exists(p) and os.path.getsize(p) > 1000:
        continue
    if not claim(out, f):
        continue
    sc.frame_set(f)
    sc.render.filepath = p
    bpy.ops.render.render(write_still=True)
    print('FRAME', f, flush=True)
    try:
        os.remove(os.path.join(out, '.f%05d.lock' % f))
    except OSError:
        pass
    done += 1
    if max_frames and done >= max_frames:
        sys.exit(3)
