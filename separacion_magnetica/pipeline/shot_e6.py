"""E6 — De vuelta en el laboratorio: tres maquetas animadas que resumen los procesos + título final."""
import math
import os
import random
import sys
import bpy
from mathutils import Vector, Matrix

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shotlib as SL
from shotlib import F
import cast, anim, perform, mograph as MG, sets_lab as LAB, props as PR
from props import M, box, cyl, sphere
from anim import KeyBuffer
from util import ease_io, principled, emission_mat

DUR = 22.0
BT = LAB.BENCH_TOP
Y = 0.28


def key_loc(ob, f, loc):
    ob.location = loc
    ob.keyframe_insert('location', frame=f)


def key_rotz(ob, f, a):
    ob.rotation_euler.z = a
    ob.keyframe_insert('rotation_euler', index=2, frame=f)


def button(name, loc, col, t_press):
    b = cyl(name + '_base', 0.022, 0.012, loc, col, M('black_plastic'))
    cap = cyl(name, 0.014, 0.008, loc + Vector((0, 0, 0.012)), col, None)
    em = emission_mat(name + '_e', '#3aff7a', 0.3)
    cap.data.materials.append(em)
    node = em.node_tree.nodes['Emission'].inputs['Strength']
    for f, v in ((F(t_press) - 1, 0.3), (F(t_press) + 2, 6.0), (F(DUR), 4.0)):
        node.default_value = v
        node.keyframe_insert('default_value', frame=f)
    for f, z in ((F(t_press) - 2, 0.012), (F(t_press) + 1, 0.006), (F(t_press) + 6, 0.012)):
        key_loc(cap, f, loc + Vector((0, 0, z)))
    return loc + Vector((0, 0, 0.02))


def plate(name, x, col, color):
    box(name + '_plate', (0.34, 0.26, 0.012), Vector((x, Y, BT + 0.006)), col, principled(name + '_pm', color, 0.4), bevel=0.003)


def maquette_lab(col, x, t0):
    plate('mq1', x, col, '#e9ecef')
    c = Vector((x, Y + 0.03, BT + 0.012))
    PR.lathe('mq1_dish', [(0.001, 0), (0.05, 0), (0.052, 0.003), (0.052, 0.025)], c, col, M('glass_hero'))
    cyl('mq1_sand', 0.049, 0.012, c, col, M('sand'))
    tray = box('mq1_tray', (0.08, 0.06, 0.004), c + Vector((0.1, -0.02, 0.002)), col, M('tray_white'))
    # brazo con imán que baja, toma las partículas y las lleva a la bandeja
    post = cyl('mq1_post', 0.006, 0.16, c + Vector((-0.1, 0.06, 0)), col, M('steel'))
    arm = bpy.data.objects.new('mq1_arm', None)
    col.objects.link(arm)
    arm.location = c + Vector((-0.1, 0.06, 0.15))
    bar = box('mq1_bar', (0.12, 0.008, 0.008), Vector((0.06, 0, 0)), col, M('steel'))
    bar.parent = arm
    mag = bpy.data.objects.new('mq1_mag', None)
    col.objects.link(mag)
    mag.parent = arm
    mag.location = (0.1, 0, 0)
    mr = cyl('mq1_magR', 0.006, 0.03, Vector((0, 0, -0.06)), col, M('magnet_red'))
    mb = cyl('mq1_magB', 0.006, 0.03, Vector((0, 0, -0.09)), col, M('magnet_blue'))
    rod = cyl('mq1_rod', 0.002, 0.03, Vector((0, 0, -0.03)), col, M('steel'))
    for p in (mr, mb, rod):
        p.parent = mag
    # ciclo: bajar (z), subir, girar hacia la bandeja
    ks = [(t0, 0.0, 0.0), (t0 + 0.6, -0.05, 0.0), (t0 + 1.0, -0.05, 0.0), (t0 + 1.6, 0.0, 0.0), (t0 + 2.4, 0.0, -1.2),
          (t0 + 3.0, 0.0, -1.2)]
    for t, dz, a in ks:
        key_loc(arm, F(t), c + Vector((-0.1, 0.06, 0.15 + dz)))
        key_rotz(arm, F(t), a)
    # partículas de hierro: en la arena -> pegadas al imán -> caen en la bandeja
    rnd = random.Random(2)
    fm = bpy.data.meshes.new('mq1_fil')
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=0.003)
    bm.to_mesh(fm)
    bm.free()
    fm.materials.append(M('iron'))
    for i in range(24):
        ob = bpy.data.objects.new('mq1_f%d' % i, fm)
        col.objects.link(ob)
        r = 0.04 * math.sqrt(rnd.random())
        a = rnd.uniform(0, 6.28)
        p0 = c + Vector((r * math.cos(a), r * math.sin(a), 0.013))
        off = Vector((rnd.uniform(-0.006, 0.006), rnd.uniform(-0.006, 0.006), -0.106 - rnd.uniform(0, 0.006)))
        kb = KeyBuffer(ob)
        land = c + Vector((0.1 + rnd.uniform(-0.02, 0.02), -0.02 + rnd.uniform(-0.015, 0.015), 0.006))
        for f in range(F(t0) - 2, F(t0 + 4.2)):
            t = (f - 1) / 30
            bpy.context.scene.frame_set(f)
            mw = mag.matrix_world.translation
            if t < t0 + 0.75:
                p = p0
            elif t < t0 + 0.85:
                u = (t - t0 - 0.75) / 0.1
                p = p0.lerp(mw + off, u)
            elif t < t0 + 3.05:
                p = mw + off
            else:
                u = min((t - t0 - 3.05) / 0.2, 1)
                p = (mw + off).lerp(land, u * u)
            kb.key_vec('location', f, p)
        kb.write()


def maquette_conveyor(col, x, t0, t1):
    plate('mq2', x, col, '#dfe6ec')
    c = Vector((x, Y, BT + 0.012))
    box('mq2_belt', (0.3, 0.06, 0.008), c + Vector((0, 0, 0.05)), col, M('belt'))
    for sx in (-0.13, 0.13):
        for sy in (-0.025, 0.025):
            cyl('mq2_leg%d%d' % (sx * 100, sy * 100), 0.003, 0.046, c + Vector((sx, sy, 0)), col, M('steel'))
    # separador de banda sobre la cinta (en cruz)
    box('mq2_mag', (0.05, 0.1, 0.025), c + Vector((0.0, 0.0, 0.11)), col, principled('mq2_magm', '#c4242a', 0.4))
    box('mq2_xbelt', (0.06, 0.16, 0.006), c + Vector((0.0, 0.02, 0.095)), col, M('belt'))
    box('mq2_bin', (0.06, 0.05, 0.03), c + Vector((0.0, 0.11, 0.015)), col, principled('mq2_binm', '#2f6fb0', 0.5))
    box('mq2_bin2', (0.05, 0.06, 0.025), c + Vector((0.165, 0, 0.0125)), col, principled('mq2_bin2m', '#3a9a5a', 0.5))
    rnd = random.Random(7)
    kinds = ['steel', 'alu', 'plastic', 'steel', 'alu', 'steel', 'plastic', 'steel']
    for i, k in enumerate(kinds):
        mat = {'steel': M('steel'), 'alu': M('aluminum'), 'plastic': principled('mq2_pl', '#3fa9f5', 0.3)}[k]
        ob = cyl('mq2_item%d' % i, 0.007, 0.016, Vector((0, 0, 0)), col, mat, seg=12)
        kb = KeyBuffer(ob)
        start = t0 + i * 0.45
        y = rnd.uniform(-0.012, 0.012)
        for f in range(F(t0) - 1, F(t1)):
            t = (f - 1) / 30
            s = (t - start) * 0.09
            px = c.x - 0.14 + max(s, 0)
            p = Vector((px, c.y + y, c.z + 0.054))
            if t < start:
                p = Vector((c.x - 0.14, c.y + y, c.z + 0.054))
            if k == 'steel' and px > c.x - 0.005:
                # levantado por el imán y llevado al contenedor lateral
                u = min((px - (c.x - 0.005)) / 0.05, 1)
                p = Vector((c.x, c.y + y + u * 0.11, c.z + 0.054 + 0.03 * math.sin(math.pi * min(u * 1.3, 1)) + (0.0 if u < 1 else -0.03)))
                if u >= 1:
                    p.z = c.z + 0.035
            elif px > c.x + 0.15:
                p = Vector((c.x + 0.165, c.y + y * 0.5, c.z + 0.02))
            kb.key_vec('location', f, p)
        kb.write()


def maquette_crane(col, x, t0):
    plate('mq3', x, col, '#ece6dd')
    c = Vector((x, Y, BT + 0.012))
    box('mq3_cab', (0.05, 0.05, 0.04), c + Vector((0, 0, 0.02)), col, M('yellow_paint'))
    cyl('mq3_mast', 0.006, 0.12, c + Vector((0, 0, 0.04)), col, M('yellow_paint'))
    boom = bpy.data.objects.new('mq3_boom', None)
    col.objects.link(boom)
    boom.location = c + Vector((0, 0, 0.16))
    arm = box('mq3_arm', (0.14, 0.012, 0.012), Vector((0.07, 0, 0)), col, M('yellow_paint'))
    arm.parent = boom
    hook = bpy.data.objects.new('mq3_hook', None)
    col.objects.link(hook)
    hook.parent = boom
    hook.location = (0.13, 0, 0)
    cable = cyl('mq3_cable', 0.0012, 1.0, Vector((0, 0, -1.0)), col, M('black_plastic'))
    cable.parent = hook
    disc = bpy.data.objects.new('mq3_disc', None)
    col.objects.link(disc)
    disc.parent = boom
    dm = cyl('mq3_discm', 0.02, 0.008, Vector((0, 0, -0.008)), col, None)
    glow = emission_mat('mq3_glow', '#7fd8ff', 0.0)
    dm.data.materials.append(M('steel'))
    dm.data.materials.append(glow)
    dm.parent = disc
    ring = cyl('mq3_ring', 0.021, 0.002, Vector((0, 0, -0.009)), col, glow)
    ring.parent = disc
    # pila de chatarra y contenedor
    box('mq3_cont', (0.07, 0.06, 0.03), c + Vector((-0.02, 0.1, 0.015)), col, principled('mq3_contm', '#2e7d4f', 0.5))
    rnd = random.Random(4)
    pile_c = c + Vector((0.13, 0.0, 0.0))
    # ciclo del brazo: baja disco sobre la pila, activa, sube, gira, desactiva
    def disc_z(t):
        if t < t0 + 0.6:
            return 0.14 - 0.11 * ease_io((t - t0) / 0.6) if t > t0 else 0.14
        if t < t0 + 1.2:
            return 0.03
        if t < t0 + 1.8:
            return 0.03 + 0.08 * ease_io((t - t0 - 1.2) / 0.6)
        return 0.11
    def boom_a(t):
        if t < t0 + 1.9:
            return 0.0
        return 1.75 * ease_io(min((t - t0 - 1.9) / 1.2, 1))
    on0, on1 = t0 + 0.7, t0 + 3.3
    for f in range(F(t0) - 2, F(t0 + 4.6)):
        t = (f - 1) / 30
        key_rotz(boom, f, boom_a(t))
        key_loc(disc, f, Vector((0.13, 0, -disc_z(t))))
        hook.scale = (1, 1, max(disc_z(t) - 0.01, 0.001))
        hook.keyframe_insert('scale', frame=f)
    node = glow.node_tree.nodes['Emission'].inputs['Strength']
    for f, v in ((F(on0) - 1, 0.0), (F(on0) + 2, 6.0), (F(on1), 6.0), (F(on1) + 2, 0.0)):
        node.default_value = v
        node.keyframe_insert('default_value', frame=f)
    fm = bpy.data.meshes.new('mq3_scrap')
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=0.008)
    bm.to_mesh(fm)
    bm.free()
    fm.materials.append(M('rust'))
    cont = c + Vector((-0.02, 0.1, 0.008))
    for i in range(16):
        ob = bpy.data.objects.new('mq3_s%d' % i, fm)
        col.objects.link(ob)
        p0 = pile_c + Vector((rnd.gauss(0, 0.012), rnd.gauss(0, 0.012), 0.004 + rnd.random() * 0.01))
        ob.rotation_euler = (rnd.uniform(0, 3), rnd.uniform(0, 3), rnd.uniform(0, 3))
        ob.scale = (rnd.uniform(0.6, 1.4), rnd.uniform(0.4, 1.0), rnd.uniform(0.3, 0.8))
        caught = i < 11
        off = Vector((rnd.uniform(-0.012, 0.012), rnd.uniform(-0.012, 0.012), -0.012 - rnd.uniform(0, 0.008)))
        land = cont + Vector((rnd.uniform(-0.025, 0.025), rnd.uniform(-0.02, 0.02), rnd.uniform(0, 0.008)))
        kb = KeyBuffer(ob)
        for f in range(F(t0) - 2, F(t0 + 4.6)):
            t = (f - 1) / 30
            bpy.context.scene.frame_set(f)
            dw = disc.matrix_world.translation
            if not caught or t < on0 + 0.05:
                p = p0
            elif t < on1:
                p = p0.lerp(dw + off, min((t - on0 - 0.05) / 0.12, 1))
            else:
                u = min((t - on1) / 0.25, 1)
                p = (dw + off).lerp(land, u * u)
            kb.key_vec('location', f, p)
        kb.write()


def main():
    sc = SL.new_scene('E6', DUR)
    lab = LAB.build_lab('Lab', experiment=False, corridor=False)
    col = bpy.data.collections.new('Maquetas')
    sc.collection.children.link(col)
    rig, objs = cast.load('scientist')
    A = anim.Actor(rig)
    sx, sy = LAB.SCI_SPOT
    sy += 0.1   # un paso atrás: el botón del medio quedaba pegado a la bata y la mano entraba en el cuerpo
    P = perform.Performer(A, pos=(sx, sy), yaw=0.0)
    xs = (-0.42, 0.0, 0.42)
    tp = (1.4, 3.4, 5.6)
    btn = []
    for i, (x, t) in enumerate(zip(xs, tp)):
        btn.append(button('btn%d' % i, Vector((x, 0.46, BT)), col, t))
    maquette_lab(col, xs[0], tp[0] + 0.3)
    maquette_conveyor(col, xs[1], tp[1] + 0.2, DUR)
    maquette_crane(col, xs[2], tp[2] + 0.3)
    # actuación
    P.look_at(0.0, (0.0, 0.3, 1.0))
    P.expression(0.0, 'smile_soft')
    P.lean.add(0.6, 0.0).add(1.2, 0.22).add(6.4, 0.22).add(7.4, 0.04)
    # mientras está inclinado, la mano libre se apoya en el borde de la mesada (antes colgaba y se metía en ella)
    # (al alcance del brazo: muñeca un poco alta y dedos inclinados hacia la mesada, que es lo que toca)
    bench = {sd: ('world', Vector((sx + k * 0.26, 0.5, BT + 0.06)), Vector((k * 0.1, -1, -0.45)), Vector((0, 0, -1)))
             for sd, k in (('L', 1), ('R', -1))}
    P.hand('L', 0.6, 'rest')
    P.hand('L', 1.3, bench['L'])
    P.hand('L', 4.4, bench['L'])
    P.hand_pose('L', 1.3, {'relaxed': 1})
    for i, (side, t) in enumerate((('R', tp[0]), ('R', tp[1]), ('L', tp[2]))):
        b = btn[i]
        fdir = Vector((0, -0.6, -1))
        pdn = Vector((0, 0, -1))
        # la punta del índice apoya sobre el botón (antes la muñeca iba al botón y el dedo atravesaba la mesada)
        tw = lambda p, side=side: ('world', P.tip_to_wrist(side, p, fdir, pdn), fdir, pdn)
        P.hand(side, t - 0.9, ('rest' if i == 0 else tw(btn[0] + Vector((0.0, 0.0, 0.06))) if i == 1 else bench['L']))
        P.hand(side, t - 0.25, tw(b + Vector((0, 0, 0.03))))
        P.hand_pose(side, t - 0.5, {'point': 1})
        P.hand(side, t, tw(b + Vector((0, 0, -0.005))))
        P.hand(side, t + 0.35, tw(b + Vector((0, 0, 0.05))))
        P.look_at(t - 0.6, b)
        P.look_at(t + 0.5, Vector((xs[i], Y, BT + 0.1)))
        if i != 0:
            P.hand(side, t + 1.4, 'rest')
            P.hand_pose(side, t + 1.4, {'relaxed': 1})
    P.hand('R', tp[1] + 1.1, bench['R'])
    P.hand('R', 6.6, bench['R'])
    P.hand('R', 7.4, 'rest')
    P.hand_pose('R', tp[1] + 1.1, {'relaxed': 1})
    P.expression(6.6, 'smile')
    P.look_at(8.4, (0.0, -2.6, 1.55))
    P.expression(8.6, 'explain')
    for side, s in (('L', 1), ('R', -1)):
        P.hand(side, 9.0, 'rest')
        P.hand(side, 10.0, ('world', Vector((sx + s * 0.3, sy - 0.28, 1.1)), Vector((s * 0.5, -1, 0.1)), Vector((s * 0.3, -0.3, 1))))
        P.hand_pose(side, 10.0, {'open': 1})
        P.hand(side, 13.5, ('world', Vector((sx + s * 0.33, sy - 0.27, 1.12)), Vector((s * 0.5, -1, 0.1)), Vector((s * 0.3, -0.3, 1))))
        P.hand(side, 14.6, 'rest')
        P.hand_pose(side, 14.6, {'relaxed': 1})
    P.look_at(15.2, (0.0, -3.2, 1.6))
    P.expression(15.4, 'smile')
    P.bake(1, sc.frame_end)
    # cámaras
    cams = {}
    c = SL.CameraRig('C1', [(0.0, (0.55, -0.85, 1.55), (0.0, 0.32, 1.0), 30), (8.2, (0.35, -0.75, 1.5), (0.0, 0.35, 1.02), 32)])
    cams['C1'] = c.bake(1, F(8.4))
    c = SL.CameraRig('C2', [(8.2, (0.0, -1.35, 1.45), (0.0, 0.4, 1.2), 32), (15.0, (0.0, -1.6, 1.5), (0.0, 0.4, 1.22), 30)])
    cams['C2'] = c.bake(F(8.1), F(15.2))
    c = SL.CameraRig('C3', [(15.0, (0.0, -1.9, 1.55), (0.0, 0.4, 1.35), 30), (22.0, (0.6, -4.6, 1.9), (0.0, 0.6, 1.6), 26)])
    cams['C3'] = c.bake(F(14.9), F(22.0))
    SL.cut(0.0, cams['C1'])
    SL.cut(8.2, cams['C2'])
    SL.cut(15.0, cams['C3'])
    mg = bpy.data.collections.new('MoGraph')
    sc.collection.children.link(mg)
    for i, (txt, colr, t) in enumerate((('RECUPERACIÓN DE MATERIALES', MG.ORANGE, 9.0), ('CLASIFICACIÓN DE RESIDUOS', MG.GREEN, 10.4),
                                        ('APROVECHAMIENTO INDUSTRIAL', MG.CYAN, 11.8))):
        x = xs[i]
        MG.label('ben%d' % i, txt, Vector((x, Y, BT + 0.08)), Vector((x * 1.25, Y - 0.38, BT + 0.2 + 0.09 * (i % 2))), cams['C2'],
                 F(t), F(15.0), mg, size=0.036, color=colr)
    tc = Vector((0.0, -0.2, 2.15))
    MG.title_text('final_title', 'SEPARACIÓN MAGNÉTICA', tc, (math.pi / 2, 0, 0), 0.17, mg, MG.WHITE, f_in=F(16.0), extrude=0.012)
    MG.title_text('final_sub', 'CIENCIA EN ACCIÓN', tc + Vector((0, -0.01, -0.32)), (math.pi / 2, 0, 0), 0.1, mg, MG.CYAN, f_in=F(17.0), extrude=0.008, strength=4.0)
    lines = MG.dipole_lines(L=1.0, n=10, max_len=1.3, step=0.012, planes=2)
    fl, flm = MG.field_lines_object('final_field', lines, mg, MG.CYAN, radius=0.003, strength=3.5)
    fl.location = tc + Vector((0, 0.1, -0.12))
    fl.rotation_euler = (0, math.pi / 2, 0)
    MG.grow(fl, F(15.6), F(17.6), flm)
    MG.flow_particles('final_fp', lines, mg, count=50, color='#c8f6ff', size=0.007, f0=F(15.6), f1=F(DUR), speed=0.35, parent=fl)
    MG.sparkles('final_sp', tc, 1.0, mg, count=70, color=MG.CYAN, f0=F(16.0), f1=F(DUR), size=0.005)
    for lid, t in (('E6_01', 0.8), ('E6_02', 8.6), ('E6_03', 16.6)):
        SL.narration(sc, lid, t)
    SL.save(sc, 'E6')


if __name__ == '__main__':
    main()
