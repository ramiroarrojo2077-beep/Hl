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
    for name in ('E1a', 'E1b', 'E2', 'E3', 'E4', 'E5', 'E6'):
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
                h0 = R.translation.z
                path = 'pose.bones["%s"].location' % bn
                prev_up = False
                for f in range(1, sc.frame_end + 1):
                    loc = Vector([fc_eval(act, slot, path, i, f) for i in range(3)])
                    z = (R.to_3x3() @ loc).z + h0
                    up = z > h0 + 0.012
                    if prev_up and not up:
                        steps.append(dict(f=f, who=who, side=side))
                    prev_up = up
        res[name] = dict(frames=sc.frame_end, steps=sorted(steps, key=lambda s: s['f']))
        print(name, len(steps), flush=True)
    json.dump(res, open(out, 'w'), indent=1)


main()
