"""E3 — Explicación científica en la mesa holográfica: campo magnético y respuesta de distintos materiales."""
import math
import os
import random
import sys
import bpy
import bmesh
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shotlib as SL
from shotlib import F
import cast, anim, perform, mograph as MG, sets_lab as LAB, props as PR
from anim import KeyBuffer
from util import ease_io, smoothstep

DUR = 27.0
HOLO = Vector((3.2, 1.2, 0.92))
MAGC = HOLO + Vector((0, 0, 0.36))      # centro del imán holográfico
MAGL = 0.30


def holo_mat(name, color, strength=2.5, alpha=0.55):
    m = MG.fade_material(name, color, strength, alpha=0.0)
    return m


def holo_obj(name, kind, size, color, col, loc):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    if kind == 'cube':
        bmesh.ops.create_cube(bm, size=size)
    elif kind == 'coin':
        bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=size * 0.6, radius2=size * 0.6, depth=size * 0.25)
    elif kind == 'bolt':
        bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=size * 0.35, radius2=size * 0.35, depth=size * 0.3,
                              matrix=Matrix.Translation((0, 0, size * 0.35)))
        bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=size * 0.15, radius2=size * 0.15, depth=size * 0.9,
                              matrix=Matrix.Translation((0, 0, -size * 0.2)))
    elif kind == 'bottle':
        bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=size * 0.35, radius2=size * 0.35, depth=size * 0.9)
        bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=size * 0.35, radius2=size * 0.12, depth=size * 0.35,
                              matrix=Matrix.Translation((0, 0, size * 0.6)))
    elif kind == 'can':
        bmesh.ops.create_cone(bm, cap_ends=True, segments=20, radius1=size * 0.33, radius2=size * 0.33, depth=size * 0.95)
    elif kind == 'coil':
        for k in range(5):
            bmesh.ops.create_cone(bm, cap_ends=False, segments=20, radius1=size * 0.4, radius2=size * 0.4, depth=size * 0.08,
                                  matrix=Matrix.Translation((0, 0, -size * 0.3 + k * size * 0.15)))
    elif kind == 'sphere':
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=size * 0.5)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    ob.location = loc
    ob.visible_shadow = False
    mat = MG.fade_material(name + '_m', color, 3.5, alpha=0.0)
    me.materials.append(mat)
    # contorno brillante (wireframe) para look holográfico
    wf = ob.modifiers.new('wire', 'WIREFRAME')
    wf.thickness = size * 0.04
    wf.use_replace = False
    wf.material_offset = 1
    me.materials.append(MG.fade_material(name + '_w', '#e8fbff', 5.0, alpha=0.0))
    return ob, [mat, me.materials[1]]


def main():
    sc = SL.new_scene('E3', DUR)
    lab = LAB.build_lab('Lab', experiment=True, corridor=False)
    rig, objs = cast.load('scientist')
    A = anim.Actor(rig)
    sx, sy = LAB.SCI_SPOT
    P = perform.Performer(A, pos=(sx, sy), yaw=0.0)
    P.look_at(0.0, (3.2, 1.2, 1.2))
    P.expression(0.0, 'smile_soft')
    stand = (HOLO.x, HOLO.y + 0.73)
    P.walk(0.4, 3.6, [(1.4, 1.55), stand], step=0.66)
    P.turn(4.0, 4.6, 0.0)
    P.look_at(3.8, HOLO + Vector((0, 0, 0.1)))
    P.lean.add(4.6, 0.0).add(5.2, 0.15).add(6.4, 0.05).add(8.4, 0.12).add(12.6, 0.12).add(13.4, 0.04)
    # gesto de activación: barrido con la mano derecha sobre la mesa
    P.hand('R', 4.4, 'rest')
    P.hand_pose('R', 4.4, {'relaxed': 1})
    sw0 = HOLO + Vector((-0.24, 0.34, 0.2))
    sw1 = HOLO + Vector((0.18, 0.3, 0.22))
    P.hand('R', 5.0, ('world', sw0, Vector((0.3, -1, -0.2)), Vector((0, 0, -1))))
    P.hand_pose('R', 5.0, {'open': 1})
    P.hand('R', 5.7, ('world', sw1, Vector((0.6, -1, -0.2)), Vector((0, 0, -1))))
    P.hand('R', 6.6, 'rest')
    P.hand_pose('R', 6.8, {'relaxed': 1})
    P.look_at(5.6, MAGC)
    P.expression(5.8, 'explain')
    P.look_at(7.4, (3.0, -2.2, 1.55))
    # señala el polo y los materiales atraídos
    P.hand('L', 8.0, 'rest')
    P.hand_pose('L', 8.0, {'relaxed': 1})
    pl = MAGC + Vector((0.32, 0.25, -0.02))
    P.hand('L', 8.8, ('world', pl, Vector((-0.4, -1, -0.15)), Vector((0, 0, -1))))
    P.hand_pose('L', 8.8, {'point': 1})
    P.hand('L', 11.8, ('world', pl + Vector((0.02, 0, 0.01)), Vector((-0.4, -1, -0.15)), Vector((0, 0, -1))))
    P.hand('L', 12.8, 'rest')
    P.hand_pose('L', 12.8, {'relaxed': 1})
    P.look_at(9.0, MAGC + Vector((0.2, 0, 0)))
    P.look_at(12.6, MAGC + Vector((-0.25, -0.1, -0.05)))
    P.expression(13.4, 'focus')
    # gesto de "no" con la mano derecha abierta
    P.hand('R', 14.0, 'rest')
    P.hand('R', 15.0, ('world', MAGC + Vector((-0.3, 0.3, -0.05)), Vector((-0.3, -1, 0.2)), Vector((0.2, -1, 0))))
    P.hand_pose('R', 15.0, {'open': 1})
    P.hand('R', 18.0, ('world', MAGC + Vector((-0.32, 0.3, -0.03)), Vector((-0.3, -1, 0.2)), Vector((0.2, -1, 0))))
    P.hand('R', 19.0, 'rest')
    P.hand_pose('R', 19.2, {'relaxed': 1})
    P.look_at(17.0, (3.0, -2.2, 1.55))
    P.expression(17.2, 'explain')
    # diagrama final: dos manos separan
    for side, s in (('L', 1), ('R', -1)):
        P.hand(side, 20.6, 'rest')
        P.hand(side, 21.6, ('world', HOLO + Vector((s * 0.34, 0.3, 0.32)), Vector((s * 0.6, -1, 0)), Vector((0, -0.3, 1))))
        P.hand_pose(side, 21.6, {'open': 1})
        P.hand(side, 24.5, ('world', HOLO + Vector((s * 0.4, 0.3, 0.33)), Vector((s * 0.6, -1, 0)), Vector((0, -0.3, 1))))
        P.hand(side, 25.6, 'rest')
        P.hand_pose(side, 25.6, {'relaxed': 1})
    P.look_at(21.0, HOLO + Vector((0, 0, 0.3)))
    P.look_at(24.0, (3.0, -2.2, 1.55))
    P.expression(24.2, 'smile')
    P.bake(1, sc.frame_end)

    col = bpy.data.collections.new('Holo')
    sc.collection.children.link(col)
    # campo de proyección: media cáscara oscura detrás del holograma (mejora la lectura)
    verts, faces = [], []
    nseg = 24
    for j, z in enumerate((0.93, 1.72)):
        for i in range(nseg + 1):
            a = math.radians(8 + 164 * i / nseg)
            verts.append((HOLO.x + math.cos(a) * 0.46, HOLO.y + math.sin(a) * 0.46, z))
    for i in range(nseg):
        faces.append([i, i + 1, nseg + 2 + i, nseg + 1 + i])
    me = bpy.data.meshes.new('holo_volume')
    me.from_pydata(verts, [], faces)
    vol = bpy.data.objects.new('holo_volume', me)
    col.objects.link(vol)
    vm = MG.panel_material('holo_volume_m', '#03101c', 0.8)
    me.materials.append(vm)
    vol.visible_shadow = False
    MG.key_fade(vm, F(5.2), None, dur=12)
    grid = []
    for k in range(7):
        z = 0.95 + k * 0.12
        cv = bpy.data.curves.new('holo_grid%d' % k, 'CURVE')
        cv.dimensions = '3D'
        cv.bevel_depth = 0.0012
        sp = cv.splines.new('POLY')
        sp.points.add(nseg)
        for i in range(nseg + 1):
            a = math.radians(8 + 164 * i / nseg)
            sp.points[i].co = (HOLO.x + math.cos(a) * 0.455, HOLO.y + math.sin(a) * 0.455, z, 1)
        gm = MG.fade_material('holo_grid_m%d' % k, '#1f8fbf', 2.0, 0.0)
        cv.materials.append(gm)
        go = bpy.data.objects.new('holo_grid%d' % k, cv)
        col.objects.link(go)
        go.visible_shadow = False
        MG.key_fade(gm, F(5.4 + k * 0.05), None, dur=10, peak=0.6)
    # ---- imán holográfico (horizontal, N a la derecha +X)
    magnet = bpy.data.objects.new('holo_magnet', None)
    col.objects.link(magnet)
    magnet.location = MAGC
    nb_, nmats = holo_obj('holo_N', 'cube', 1.0, MG.RED, col, (0, 0, 0))
    sb_, smats = holo_obj('holo_S', 'cube', 1.0, MG.BLUE, col, (0, 0, 0))
    for o, x in ((nb_, MAGL / 4), (sb_, -MAGL / 4)):
        o.parent = magnet
        o.location = (x, 0, 0)
        o.scale = (MAGL / 2, 0.07, 0.07)
    for m in nmats + smats:
        MG.key_fade(m, F(5.6), None, dur=10)
    tN = PR.text3d('holo_txtN', 'N', (MAGC.x + MAGL / 4, MAGC.y - 0.04, MAGC.z - 0.02), 0.05, col, MG.fade_material('txtN', MG.WHITE, 3.0, 0.0))
    tS = PR.text3d('holo_txtS', 'S', (MAGC.x - MAGL / 4, MAGC.y - 0.04, MAGC.z - 0.02), 0.05, col, MG.fade_material('txtS', MG.WHITE, 3.0, 0.0))
    for t in (tN, tS):
        t.data.align_y = 'CENTER'
        MG.key_fade(t.data.materials[0], F(6.0), None)
        t.visible_shadow = False
    # líneas de campo en 3D (eje del imán a lo largo de X)
    lines = MG.dipole_lines(L=MAGL, n=8, max_len=0.55, step=0.006, planes=3)
    fl, flm = MG.field_lines_object('holo_field', lines, col, MG.CYAN, radius=0.0035, strength=6.0)
    fl.location = MAGC
    fl.rotation_euler = (0, math.pi / 2, 0)
    MG.grow(fl, F(6.0), F(7.6), flm)
    MG.flow_particles('holo_fp', lines, col, count=60, color='#d8faff', size=0.004, f0=F(6.2), f1=F(DUR), speed=0.18, parent=fl)
    # ---- materiales
    rnd = random.Random(5)
    attracted = [('Fe', 'hierro', 'cube', 0.06, '#9fb3c8', Vector((0.36, -0.05, 0.04)), 'N'),
                 ('Ni', 'níquel', 'coin', 0.07, '#c9c2a8', Vector((0.34, 0.12, -0.08)), 'N'),
                 ('Co', 'cobalto', 'sphere', 0.06, '#8fa0d8', Vector((-0.36, -0.06, 0.06)), 'S'),
                 ('Acero', 'acero', 'bolt', 0.08, '#b8c4cc', Vector((-0.34, 0.12, -0.07)), 'S')]
    nonatt = [('Plástico', 'plastic', 'bottle', 0.09, '#ffcf6b', Vector((0.0, -0.05, 0.27))),
              ('Aluminio', 'aluminio', 'can', 0.08, '#e3e6ea', Vector((-0.2, 0.0, 0.25))),
              ('Cobre', 'cobre', 'coil', 0.08, '#ff9a5a', Vector((0.2, 0.0, 0.25)))]
    cams = cameras()
    for i, (sym, nm, kind, sz, colr, off, pole) in enumerate(attracted):
        ob, mats = holo_obj('att_%s' % sym, kind, sz, colr, col, MAGC + off)
        f_in = F(7.6 + i * 0.35)
        for m in mats:
            MG.key_fade(m, f_in, F(20.0), dur=8)
        # atracción: se mueve hacia el polo más cercano (aceleración creciente)
        polep = MAGC + Vector(((MAGL / 2 + sz * 0.45) * (1 if pole == 'N' else -1), off.y * 0.35, off.z * 0.3))
        kb = KeyBuffer(ob)
        t0 = 9.0 + i * 0.45
        for f in range(F(7.4), F(20.5)):
            t = (f - 1) / 30
            u = min(max((t - t0) / 0.9, 0), 1)
            p = (MAGC + off).lerp(polep, u ** 2.2)
            kb.key_vec('location', f, p)
        kb.write()
        MG.arrow('arr_%s' % sym, MAGC + off * 1.35, MAGC + off * 0.75, col, MG.ORANGE, radius=0.004, f_in=F(t0 - 0.3), f_out=F(t0 + 1.2))
        lbl = PR.text3d('lbl_%s' % sym, sym, MAGC + off * 1.5 + Vector((0, -0.02, 0.05)), 0.035, col, MG.fade_material('lt_%s' % sym, MG.WHITE, 3.0, 0.0))
        lbl.visible_shadow = False
        MG.key_fade(lbl.data.materials[0], f_in, F(20.0))
    for i, (nm, kname, kind, sz, colr, off) in enumerate(nonatt):
        ob, mats = holo_obj('non_%d' % i, kind, sz, colr, col, MAGC + off)
        f_in = F(13.4 + i * 0.4)
        for m in mats:
            MG.key_fade(m, f_in, F(20.0), dur=8)
        kb = KeyBuffer(ob)
        for f in range(F(13.0), F(20.5)):
            t = (f - 1) / 30
            kb.key_vec('location', f, MAGC + off + Vector((0, 0, 0.004 * math.sin(t * 3 + i))))
        kb.write()
        lbl = PR.text3d('lbln_%d' % i, nm, MAGC + off + Vector((0, -0.03, sz * 0.9)), 0.03, col, MG.fade_material('ltn_%d' % i, MG.WHITE, 3.0, 0.0))
        lbl.visible_shadow = False
        MG.key_fade(lbl.data.materials[0], f_in, F(20.0))
        x = PR.text3d('lblx_%d' % i, 'no atraído', MAGC + off + Vector((0, -0.03, -sz * 0.85)), 0.022, col, MG.fade_material('ltx_%d' % i, '#ff6b6b', 3.5, 0.0))
        x.visible_shadow = False
        MG.key_fade(x.data.materials[0], f_in + 20, F(20.0))
    MG.label('lbl_att', 'ATRAÍDOS POR EL IMÁN', MAGC + Vector((0.3, 0, 0.0)), MAGC + Vector((0.42, -0.3, 0.17)), cams['C2'],
             F(9.0), F(13.2), col, size=0.05, color=MG.CYAN, sub='hierro · níquel · cobalto · aceros')
    MG.label('lbl_non', 'NO ATRAÍDOS (imán común)', MAGC + Vector((-0.2, 0, 0.22)), MAGC + Vector((-0.46, -0.3, 0.16)), cams['C3'],
             F(14.6), F(20.0), col, size=0.05, color='#ff6b6b', sub='aluminio · cobre · plástico')
    # ---- diagrama: mezcla -> fracción magnética / no magnética
    mix_c = HOLO + Vector((0, 0, 0.28))
    for i in range(28):
        magnetic = i % 2 == 0
        kind = rnd.choice(['cube', 'sphere'])
        ob, mats = holo_obj('mix_%d' % i, kind, 0.035, '#9fb3c8' if magnetic else '#ffcf6b', col, mix_c)
        for m in mats:
            MG.key_fade(m, F(20.4), None, dur=8)
        start = mix_c + Vector((rnd.uniform(-0.09, 0.09), rnd.uniform(-0.06, 0.06), rnd.uniform(-0.05, 0.05)))
        end = HOLO + Vector(((-0.3 if magnetic else 0.3) + rnd.uniform(-0.07, 0.07), rnd.uniform(-0.06, 0.06), 0.2 + rnd.uniform(-0.05, 0.06)))
        kb = KeyBuffer(ob)
        for f in range(F(20.2), F(DUR) + 1):
            t = (f - 1) / 30
            u = ease_io(min(max((t - 21.6 - (i % 5) * 0.05) / 1.4, 0), 1))
            kb.key_vec('location', f, start.lerp(end, u))
        kb.write()
    MG.label('lbl_fm', 'FRACCIÓN MAGNÉTICA', HOLO + Vector((-0.3, 0, 0.26)), HOLO + Vector((-0.45, -0.32, 0.5)), cams['C4'],
             F(22.6), None, col, size=0.045, color=MG.CYAN)
    MG.label('lbl_fnm', 'FRACCIÓN NO MAGNÉTICA', HOLO + Vector((0.3, 0, 0.26)), HOLO + Vector((0.45, -0.32, 0.5)), cams['C4'],
             F(23.0), None, col, size=0.045, color=MG.ORANGE)
    for lid, t in (('E3_01', 0.6), ('E3_02', 7.0), ('E3_03', 13.2), ('E3_04', 20.4)):
        SL.narration(sc, lid, t)
    SL.save(sc, 'E3')


def cameras():
    cams = {}
    c = SL.CameraRig('C1', [(0.0, (-0.6, -2.6, 1.7), (1.2, 1.0, 1.2), 26), (6.0, (1.6, -1.9, 1.65), (3.2, 1.4, 1.25), 30)])
    cams['C1'] = c.bake(1, F(6.2))
    c = SL.CameraRig('C2', [(6.0, (3.0, -0.55, 1.5), (3.2, 1.3, 1.3), 30), (13.0, (3.3, -0.35, 1.45), (3.2, 1.3, 1.28), 32)])
    cams['C2'] = c.bake(F(5.9), F(13.2))
    c = SL.CameraRig('C3', [(13.0, (2.6, -0.35, 1.55), (3.2, 1.3, 1.3), 30), (20.0, (2.7, -0.2, 1.5), (3.2, 1.3, 1.28), 32)])
    cams['C3'] = c.bake(F(12.9), F(20.2))
    c = SL.CameraRig('C4', [(20.0, (3.2, -0.6, 1.55), (3.2, 1.3, 1.3), 28), (27.0, (3.2, -1.0, 1.6), (3.2, 1.3, 1.32), 27)])
    cams['C4'] = c.bake(F(19.9), F(27.0))
    for t, k in ((0.0, 'C1'), (6.0, 'C2'), (13.0, 'C3'), (20.0, 'C4')):
        SL.cut(t, cams[k])
    return cams


if __name__ == '__main__':
    main()
