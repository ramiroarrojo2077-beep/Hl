"""E2b — Prueba con objetos cotidianos: el imán atrae clips, clavo y tornillo de acero; no atrae cobre, aluminio ni plástico."""
import math
import os
import random
import sys
import bpy
import bmesh
from mathutils import Vector, Matrix, Quaternion

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shotlib as SL
from shotlib import F
import cast, anim, perform, mograph as MG, sets_lab as LAB, props as PR
from props import M, box, cyl, sphere
from anim import KeyBuffer
from util import principled, ease_io

DUR = 18.5
BT = LAB.BENCH_TOP
BOARD_Y = 0.36
BOARD_Z = BT + 0.008


def clip_obj(name, loc, rot, col):
    cv = bpy.data.curves.new(name, 'CURVE')
    cv.dimensions = '3D'
    cv.bevel_depth = 0.0006
    sp = cv.splines.new('POLY')
    w, l = 0.008, 0.032
    pts = [(-w / 2, -l / 2), (-w / 2, l / 2 - w / 2), (w / 2, l / 2 - w / 2), (w / 2, -l / 2 + w * 0.4), (-w * 0.2, -l / 2 + w * 0.4),
           (-w * 0.2, l / 2 - w * 1.3), (w * 0.25, l / 2 - w * 1.3), (w * 0.25, -l / 2 + w)]
    sp.points.add(len(pts) - 1)
    for p, (x, y) in zip(sp.points, pts):
        p.co = (x, y, 0, 1)
    cv.materials.append(M('chrome'))
    ob = bpy.data.objects.new(name, cv)
    col.objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    return ob


def build_items(col):
    rnd = random.Random(3)
    items = []
    box('test_board', (0.68, 0.16, 0.008), (0.0, BOARD_Y, BT + 0.004), col, principled('board_m', '#f4f4f2', 0.5), bevel=0.002)
    # magnéticos
    for k, x in enumerate((-0.27, -0.245)):
        ob = clip_obj('clip%d' % k, (x, BOARD_Y + 0.01 * k, BOARD_Z + 0.0007), (0, 0, rnd.uniform(-0.4, 0.4)), col)
        items.append((ob, True, 'acero'))
    nail = cyl('nail', 0.0018, 0.045, Vector((0, 0, 0)), col, M('steel'), seg=10, rot=(0, math.pi / 2, 0))
    head = cyl('nail_head', 0.004, 0.0015, Vector((0, 0, 0)), col, M('steel'), seg=12, rot=(0, math.pi / 2, 0))
    head.parent = nail
    nail.location = (-0.19, BOARD_Y, BOARD_Z + 0.0018)
    nail.rotation_euler = (0, math.pi / 2, 0.3)
    items.append((nail, True, 'acero'))
    screw = cyl('screw', 0.0025, 0.03, Vector((0, 0, 0)), col, M('brushed'), seg=10)
    sh = cyl('screw_head', 0.005, 0.003, Vector((0, 0, 0.03)), col, M('brushed'), seg=12)
    sh.parent = screw
    screw.location = (-0.11, BOARD_Y, BOARD_Z + 0.0025)
    screw.rotation_euler = (0, math.pi / 2, -0.4)
    items.append((screw, True, 'acero'))
    # no magnéticos
    cv = bpy.data.curves.new('copper_wire', 'CURVE')
    cv.dimensions = '3D'
    cv.bevel_depth = 0.0012
    sp = cv.splines.new('POLY')
    n = 60
    sp.points.add(n - 1)
    for i in range(n):
        a = i / n * 2 * math.pi * 3
        r = 0.011 + 0.0006 * math.sin(a * 2)
        sp.points[i].co = (r * math.cos(a), r * math.sin(a), 0.0012 + i * 0.00008, 1)
    cv.materials.append(M('copper'))
    cu = bpy.data.objects.new('copper_wire', cv)
    col.objects.link(cu)
    cu.location = (0.04, BOARD_Y, BOARD_Z)
    items.append((cu, False, 'cobre'))
    foil = sphere('foil_ball', 0.011, (0.13, BOARD_Y, BOARD_Z + 0.011), col, M('aluminum'), seg=10, ring=6)
    d = foil.modifiers.new('crumple', 'DISPLACE')
    tex = bpy.data.textures.new('crumple_tex', 'VORONOI')
    tex.noise_scale = 0.004
    d.texture = tex
    d.strength = 0.004
    items.append((foil, False, 'aluminio'))
    cap = cyl('plastic_cap', 0.014, 0.011, Vector((0.22, BOARD_Y, BOARD_Z)), col, principled('cap_m', '#d63b3b', 0.35), seg=24)
    items.append((cap, False, 'plástico'))
    return items


def main():
    sc = SL.new_scene('E2b', DUR)
    lab = LAB.build_lab('Lab', experiment=True, corridor=False)
    ex = lab['exp']
    col = bpy.data.collections.new('Prueba')
    sc.collection.children.link(col)
    # continuidad: limaduras ya en la bandeja, funda apoyada sobre la mesada
    rnd = random.Random(9)
    for ob in ex['filings']:
        dx, dy = rnd.gauss(0, 0.012), rnd.gauss(0, 0.012)
        ob.location = LAB.TRAY + Vector((dx, dy, 0.0045 + 0.002 * math.exp(-(dx * dx + dy * dy) / 0.0003) * rnd.random()))
        ob.rotation_euler = (math.pi / 2 + rnd.uniform(-0.2, 0.2), 0, rnd.uniform(0, 6.28))
    sl = ex['sleeve']
    sl.location = (0.72, 0.3, BT + 0.016)
    sl.rotation_euler = (0, math.pi / 2, 0.3)
    # se corren el cristalizador y la bandeja hacia el fondo para hacer lugar a la prueba
    for ob in list(bpy.data.objects):
        if ob.name.startswith(('dish', 'sand_', 'tray')):
            ob.location += Vector((0.3 if ob.name.startswith(('dish', 'sand_')) else -0.3, -0.24, 0)) if not ob.parent else Vector()
    for ob in ex['filings']:
        ob.location += Vector((-0.3, -0.24, 0))
    items = build_items(col)
    rig, objs = cast.load('scientist')
    A = anim.Actor(rig)
    sx, sy = 0.0, LAB.SCI_SPOT[1]
    P = perform.Performer(A, pos=(sx, sy), yaw=0.0)
    mag = ex['magnet']
    hintR = Vector((0.45, -1.0, 0.0))

    def handR(base):
        return ('world',) + tuple(A.grasp_frame('R', Vector(base) + Vector((0, 0, LAB.HANDLE_C)), (0, 0, 1), hintR, radius=0.0095))

    start = Vector((-0.12, 0.3, 1.2))
    mag.location = start
    mag.rotation_euler = (0, 0, 0)
    P.hand('R', 0.0, handR(start))
    P.hand_pose('R', 0.0, {'grip': 1})
    P.attach(mag, 'R', 0.0, 999)
    zlow = BOARD_Z + 0.03
    x0, x1 = -0.33, 0.29
    t0, t1 = 2.6, 10.4
    P.hand('R', 2.0, handR(Vector((x0, BOARD_Y, zlow + 0.04))))
    for k in range(9):
        u = k / 8
        t = t0 + (t1 - t0) * u
        P.hand('R', t, handR(Vector((x0 + (x1 - x0) * u, BOARD_Y, zlow + 0.003 * math.sin(u * 9)))))
    lift = Vector((0.12, 0.32, 1.17))
    P.hand('R', 11.8, handR(lift))
    P.hand('R', 17.5, handR(lift + Vector((0.0, 0.0, 0.01))))
    P.side_step(6.2, 7.3, (0.16, sy))
    # inclinarse desde la cintura con las piernas rectas
    P.lean.add(1.0, 0.04).add(2.4, 0.25).add(10.4, 0.25).add(11.8, 0.05)
    P.look_at(0.0, (0.3, -2.5, 1.5))
    P.expression(0.0, 'smile_soft')
    P.look_at(1.9, Vector((x0, BOARD_Y, BT)))
    P.look_at(10.3, Vector((x1, BOARD_Y, BT)))
    P.expression(3.0, 'focus')
    P.look_at(11.6, lift + Vector((0, 0, -0.05)))
    P.expression(11.6, 'amazed')
    P.look_at(13.0, (0.2, -2.6, 1.55))
    P.expression(13.2, 'smile')
    P.hand('L', 13.2, 'rest')
    P.hand_pose('L', 13.2, {'relaxed': 1})
    P.hand('L', 14.0, ('world', Vector((0.45, 0.42, 1.12)), Vector((0.5, -1, 0.1)), Vector((0.3, -0.3, 1))))
    P.hand_pose('L', 14.0, {'open': 1})
    P.hand('L', 16.6, ('world', Vector((0.47, 0.42, 1.13)), Vector((0.5, -1, 0.1)), Vector((0.3, -0.3, 1))))
    nF = sc.frame_end
    P.bake(1, nF)
    # ---- respuesta de los objetos al imán (solo los de acero)
    Mm = {}
    for f in range(1, nF + 1):
        sc.frame_set(f)
        Mm[f] = mag.matrix_world.copy()
    for i, (ob, magnetic, kind) in enumerate(items):
        if not magnetic:
            continue
        ob.rotation_mode = 'QUATERNION'
        M0 = ob.matrix_world.copy()
        att = Vector((rnd.uniform(-0.006, 0.006), rnd.uniform(-0.006, 0.006), -0.004 - (0.012 if i < 2 else 0.0) * (i % 2)))
        q_att = Quaternion((1, 0, 0), math.pi / 2 * (1 if i < 2 else 0.2)) @ Quaternion((0, 0, 1), rnd.uniform(0, 6.28))
        local = Matrix.Translation(att) @ q_att.to_matrix().to_4x4()
        kb = KeyBuffer(ob)
        f_cap = None
        prev = None
        for f in range(1, nF + 1):
            tip = Mm[f].translation
            if f_cap is None and (Vector((tip.x, tip.y)) - Vector((M0.translation.x, M0.translation.y))).length < 0.035 and tip.z < BOARD_Z + 0.06:
                f_cap = f
            if f_cap is None:
                Mx = M0
            else:
                u = min((f - f_cap) / 5.0, 1.0)
                tg = Mm[f] @ local
                loc = M0.translation.lerp(tg.translation, u * u)
                q = M0.to_quaternion().slerp(tg.to_quaternion(), u)
                Mx = Matrix.Translation(loc) @ q.to_matrix().to_4x4()
            loc, q, s = Mx.decompose()
            if prev is not None and prev.dot(q) < 0:
                q.negate()
            prev = q
            kb.key_vec('location', f, loc)
            kb.key_vec('rotation_quaternion', f, q)
        kb.write()
    # ---- cámaras
    cams = {}
    c = SL.CameraRig('C1', [(0.0, (0.3, -1.45, 1.45), (0.0, 0.45, 1.15), 35), (2.7, (0.2, -1.3, 1.42), (-0.05, 0.45, 1.1), 36)])
    cams['C1'] = c.bake(1, F(2.8))
    c = SL.CameraRig('C2', [(2.6, (-0.36, -0.12, 1.02), (-0.22, BOARD_Y, BT + 0.02), 32), (10.6, (0.24, -0.12, 1.02), (0.2, BOARD_Y, BT + 0.02), 32)], fstop=4.0)
    cams['C2'] = c.bake(F(2.5), F(10.8))
    c = SL.CameraRig('C3', [(10.6, (0.22, -1.45, 1.6), (0.12, 0.45, 1.37), 34), (18.5, (0.22, -1.7, 1.63), (0.12, 0.45, 1.37), 32)])
    cams['C3'] = c.bake(F(10.5), F(18.5))
    SL.cut(0.0, cams['C1'])
    SL.cut(2.6, cams['C2'])
    SL.cut(10.6, cams['C3'])
    # ---- gráficos
    mg = bpy.data.collections.new('MoGraph')
    sc.collection.children.link(mg)
    lines = MG.dipole_lines(L=LAB.MAG_LEN, n=8, max_len=0.14, step=0.002, planes=3)
    fl, flm = MG.field_lines_object('field_e2b', lines, mg, MG.CYAN, radius=0.0005, strength=3.0, parent=mag)
    fl.location = (0, 0, LAB.MAG_LEN / 2)
    MG.grow(fl, F(2.4), F(3.6), flm, f_out=F(11.0))
    seen = set()
    for i, (ob, magnetic, kind) in enumerate(items):
        x = ob.location.x
        t_pass = t0 + (t1 - t0) * (x - x0) / (x1 - x0)
        key = (kind, magnetic)
        if magnetic and key in seen:
            continue
        seen.add(key)
        txt = 'ACERO: atraído' if magnetic else '%s: no' % kind.upper()
        colr = MG.CYAN if magnetic else '#ff6b6b'
        anchor = Vector((x + (0.03 if magnetic else 0.0), BOARD_Y, BOARD_Z + 0.01))
        MG.label('lbl_%s' % kind, txt, anchor, anchor + Vector((0.0, -0.07, 0.06)), cams['C2'], F(t_pass + 0.2), F(10.6), mg,
                 size=0.012, color=colr)
    MG.label('lbl_res', 'EL IMÁN SEPARA EL ACERO', lift + Vector((0, 0, -0.03)), Vector((0.7, 0.2, 1.5)), cams['C3'],
             F(12.6), None, mg, size=0.04, color=MG.CYAN, sub='el resto queda en la tabla')
    for lid, t in (('E2b_01', 0.4), ('E2b_02', 3.1), ('E2b_03', 7.2), ('E2b_04', 12.9)):
        SL.narration(sc, lid, t)
    SL.save(sc, 'E2b')


if __name__ == '__main__':
    main()
