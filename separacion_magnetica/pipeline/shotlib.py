"""Infraestructura de planos: escena, cámaras con cortes, metadatos de narración y guardado."""
import json
import math
import os
import sys
import bpy
from mathutils import Vector, Euler

import render_setup
from util import look_at_rot, ease_io

FPS = 30
BUILD = os.environ.get('SM_BUILD', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build'))


def new_scene(name, duration_s, samples=3):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.name = name
    render_setup.setup(sc, samples=samples, res=(1280, 720), glare=False)
    sc.render.use_compositing = False
    sc.render.filter_size = 1.5   # con 3 muestras de antialiasing: bordes lisos sin titileo
    sc.frame_start = 1
    sc.frame_end = int(round(duration_s * FPS))
    sc['narration'] = '[]'
    return sc


def F(t):
    """Segundos -> frame (1-indexado)."""
    return int(round(t * FPS)) + 1


class CameraRig:
    """Cámara con claves (t, pos, objetivo, lente) interpoladas suavemente. Opcional: f-stop."""

    def __init__(self, name, keys, fstop=None, focus=None, shake=0.0, sensor=36):
        cam = bpy.data.cameras.new(name)
        cam.sensor_width = sensor
        cam.clip_start = 0.01
        cam.clip_end = 400
        ob = bpy.data.objects.new(name, cam)
        bpy.context.scene.collection.objects.link(ob)
        self.ob = ob
        self.keys = sorted(keys, key=lambda k: k[0])
        if fstop:
            cam.dof.use_dof = True
            cam.dof.aperture_fstop = fstop
        self.focus = focus
        self.shake = shake

    def sample(self, t):
        ks = self.keys
        if t <= ks[0][0]:
            k0 = k1 = ks[0]
            u = 0
        elif t >= ks[-1][0]:
            k0 = k1 = ks[-1]
            u = 0
        else:
            for a, b in zip(ks[:-1], ks[1:]):
                if a[0] <= t <= b[0]:
                    k0, k1 = a, b
                    u = ease_io((t - a[0]) / max(b[0] - a[0], 1e-6), 1.8)
                    break
        lerp = lambda a, b: Vector(a).lerp(Vector(b), u)
        pos = lerp(k0[1], k1[1])
        tgt = lerp(k0[2], k1[2])
        lens = k0[3] + (k1[3] - k0[3]) * u
        if self.shake:
            pos = pos + Vector((math.sin(t * 1.3) * self.shake, math.sin(t * 0.9 + 1) * self.shake * 0.6, math.sin(t * 1.7 + 2) * self.shake * 0.5))
        return pos, tgt, lens

    def bake(self, f0, f1):
        ob = self.ob
        for f in range(f0, f1 + 1):
            t = (f - 1) / FPS
            pos, tgt, lens = self.sample(t)
            ob.location = pos
            ob.rotation_euler = look_at_rot(pos, tgt)
            ob.data.lens = lens
            ob.keyframe_insert('location', frame=f)
            ob.keyframe_insert('rotation_euler', frame=f)
            ob.data.keyframe_insert('lens', frame=f)
            if ob.data.dof.use_dof:
                fd = self.focus(t) if callable(self.focus) else (pos - tgt).length
                ob.data.dof.focus_distance = fd
                ob.data.dof.keyframe_insert('focus_distance', frame=f)
        for fc in _fcurves(ob) + _fcurves(ob.data):
            for kp in fc.keyframe_points:
                kp.interpolation = 'LINEAR'
        return ob


def _fcurves(idb):
    ad = idb.animation_data
    if not ad or not ad.action:
        return []
    out = []
    act = ad.action
    try:
        for layer in act.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    out.extend(cb.fcurves)
    except Exception:
        pass
    return out


def cut(t, cam_ob):
    sc = bpy.context.scene
    m = sc.timeline_markers.new('cut_%s' % cam_ob.name, frame=F(t))
    m.camera = cam_ob
    if t <= 0:
        sc.camera = cam_ob


def narration(sc, line_id, t):
    lst = json.loads(sc['narration'])
    lst.append([line_id, t])
    sc['narration'] = json.dumps(lst)


def save(sc, name):
    os.makedirs(os.path.join(BUILD, 'scenes'), exist_ok=True)
    meta = dict(name=name, frames=sc.frame_end, narration=json.loads(sc['narration']))
    with open(os.path.join(BUILD, 'scenes', name + '.json'), 'w') as fh:
        json.dump(meta, fh, indent=1)
    path = os.path.join(BUILD, 'scenes', name + '.blend')
    bpy.ops.wm.save_as_mainfile(filepath=path, compress=False)
    print('SAVED', path, sc.frame_end)
    return path
