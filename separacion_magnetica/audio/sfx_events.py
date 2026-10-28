"""Extrae eventos de pisadas desde las escenas .blend (IK de pies) para sincronizar el sonido.

Uso: python sfx_events.py dir_escenas salida.json
"""
import json
import os
import sys
import bpy
from mathutils import Vector


def fc_eval(act, slot, path, idx, frame):
    for layer in act.layers:
        for strip in layer.strips:
            cb = strip.channelbag(slot)
            if cb is None:
                continue
            fc = cb.fcurves.find(path, index=idx)
            if fc:
                return fc.evaluate(frame)
    return 0.0


def main():
    scenes_dir, out = sys.argv[-2], sys.argv[-1]
    res = {}
    for name in ('E1a', 'E1b', 'E2', 'E2b', 'E3', 'E4', 'E4b', 'E5', 'E6'):
        p = os.path.join(scenes_dir, name + '.blend')
        if not os.path.exists(p):
            continue
        bpy.ops.wm.open_mainfile(filepath=p)
        sc = bpy.context.scene
        steps = []
        for ob in bpy.data.objects:
            if ob.type != 'ARMATURE' or not ob.animation_data or not ob.animation_data.action:
                continue
            act = ob.animation_data.action
            slot = ob.animation_data.action_slot
            who = 'sci' if ob.name.startswith('Cientifico') else 'other'
            for side in 'LR':
                bn = 'IK_foot.' + side
                if bn not in ob.data.bones:
                    continue
                R = ob.data.bones[bn].matrix_local
                path = 'pose.bones["%s"].location' % bn
                # paso = el pie se venía desplazando (>3 cm) y se detiene: sirve para caminata, giros y
                # pasos laterales (con piernas rectas el pie casi no sube, así que no se mide la altura)
                prev = None
                moving = False
                travel = 0.0
                for f in range(1, sc.frame_end + 1):
                    loc = Vector([fc_eval(act, slot, path, i, f) for i in range(3)])
                    p = R.to_3x3() @ loc + R.translation
                    if prev is not None:
                        v = (p.xy - prev.xy).length
                        if v > 0.004:
                            moving = True
                            travel += v
                        elif moving and v < 0.0015:
                            if travel > 0.03:
                                steps.append(dict(f=f, who=who, side=side))
                            moving = False
                            travel = 0.0
                    prev = p
        res[name] = dict(frames=sc.frame_end, steps=sorted(steps, key=lambda s: s['f']))
        print(name, len(steps), flush=True)
    json.dump(res, open(out, 'w'), indent=1)


main()
