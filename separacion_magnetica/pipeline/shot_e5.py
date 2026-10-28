"""E5 — Chatarrería: grúa con electroimán (posicionar, activar, levantar, trasladar, desactivar)."""
import math
import os
import random
import sys
import bpy
import bmesh
from mathutils import Vector, Matrix, Quaternion, Euler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shotlib as SL
from shotlib import F
import cast, anim, perform, mograph as MG, props as PR
from props import M, box, cyl, sphere
from anim import KeyBuffer
from util import ease_io, principled, emission_mat, collection
import sets_plant as PL

DUR = 28.0
PIVOT_H = 3.0
R_TIP = 8.5
TIP_H = 9.5
PILE = Vector((R_TIP, 0.0, 0.0))
CONT = Vector((0.0, R_TIP, 0.0))
SCI = (-7.0, -10.5)


def scrap_piece(name, rnd, col, mats):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    k = rnd.random()
    if k < 0.35:
        bmesh.ops.create_cube(bm, size=1)
        bmesh.ops.scale(bm, vec=(rnd.uniform(0.3, 1.2), rnd.uniform(0.1, 0.4), rnd.uniform(0.02, 0.08)), verts=bm.verts)
    elif k < 0.6:
        bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=rnd.uniform(0.04, 0.12), radius2=rnd.uniform(0.04, 0.12), depth=rnd.uniform(0.4, 1.4))
    elif k < 0.8:
        # perfil en L / viga
        bmesh.ops.create_cube(bm, size=1)
        bmesh.ops.scale(bm, vec=(rnd.uniform(0.6, 1.6), 0.12, 0.02), verts=bm.verts)
        bmesh.ops.create_cube(bm, size=1, matrix=Matrix.Translation((0, 0.05, 0.05)) @ Matrix.Diagonal((1, 1, 1, 1)))
        for v in bm.verts[-8:]:
            v.co.x *= rnd.uniform(0.6, 1.6)
            v.co.y *= 0.02
            v.co.z *= 0.12
    else:
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=rnd.uniform(0.12, 0.3))
        for v in bm.verts:
            v.co *= rnd.uniform(0.7, 1.3)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(rnd.choice(mats))
    ob = bpy.data.objects.new(name, me)
    col.objects.link(ob)
    return ob


def build_yard(col):
    rnd = random.Random(31)
    PR.world_sky('YardWorld', top='#3f7fcf', horizon='#cfe0ee', ground='#6b6359', strength=1.0)
    PR.sun('yard_sun', (math.radians(42), math.radians(8), math.radians(-35)), energy=4.0, angle=0.02)
    PR.area_light('yard_fill', (0, -30, 20), (0, 0, 0), 30000, size=40, shadow=False, col=col)
    ground = box('yard_ground', (140, 140, 0.2), (0, 0, -0.1), col, principled('yard_ground_m', '#77706a', 0.92, noise_color=0.35, noise_scale=0.6, bump=30, bump_scale=0.2))
    box('yard_road', (8, 140, 0.02), (-14, 0, 0.005), col, M('asphalt'))
    mats = [M('rust'), PR.paint_mat('scrap_paint1', '#5f6f7a', 0.55, 0.4), PR.paint_mat('scrap_paint2', '#7b5a3c', 0.7, 0.4), M('rust'), M('brushed')]
    # pilas de chatarra
    piles = [(PILE, 3.2, 260), (Vector((14.0, -6.0, 0)), 4.0, 220), (Vector((16.0, 10.0, 0)), 4.5, 240), (Vector((-4.0, 16.0, 0)), 3.5, 160)]
    pile_objs = []
    for pi, (c, r, n) in enumerate(piles):
        cone_h = r * 0.55
        base = PR.lathe('pile_base%d' % pi, [(0.001, cone_h * 0.85), (r * 0.5, cone_h * 0.55), (r, 0.05), (r * 1.05, 0.0)], c, col, M('rust'), seg=24)
        for i in range(n):
            ob = scrap_piece('scrap_%d_%d' % (pi, i), rnd, col, mats)
            rr = r * math.sqrt(rnd.random())
            a = rnd.uniform(0, 6.28)
            h = cone_h * (1 - rr / r) * 0.85 + rnd.uniform(0, 0.15)
            ob.location = c + Vector((rr * math.cos(a), rr * math.sin(a), h))
            ob.rotation_euler = (rnd.uniform(0, 3.1), rnd.uniform(0, 3.1), rnd.uniform(0, 6.2))
            if pi == 0:
                pile_objs.append(ob)
    # contenedor abierto (volquete)
    green = PR.paint_mat('cont_green', '#2f6b3f', 0.55, 0.3)
    for dx, dy, sx, sy in ((0, -1.3, 4.8, 0.1), (0, 1.3, 4.8, 0.1), (-2.4, 0, 0.1, 2.6), (2.4, 0, 0.1, 2.6)):
        box('dump_w%d%d' % (int(dx), int(dy)), (sx, sy, 1.6), CONT + Vector((dx, dy, 0.8)), col, green)
    box('dump_floor', (4.8, 2.6, 0.12), CONT + Vector((0, 0, 0.06)), col, green)
    for i in range(30):
        ob = scrap_piece('dump_s%d' % i, rnd, col, mats)
        ob.location = CONT + Vector((rnd.uniform(-2, 2), rnd.uniform(-1.0, 1.0), rnd.uniform(0.15, 0.5)))
        ob.rotation_euler = (rnd.uniform(0, 3), rnd.uniform(0, 3), rnd.uniform(0, 6))
    # camión
    truck = PR.paint_mat('truck_red', '#a8322d', 0.4, 0.1)
    box('truck_cab', (2.4, 2.4, 2.6), (-14, 9, 1.8), col, truck, bevel=0.08)
    box('truck_win', (2.2, 0.05, 1.0), (-14, 7.78, 2.4), col, principled('truck_glass', '#1d2b36', 0.05, metal=0.5))
    box('truck_bed', (2.5, 7.0, 1.6), (-14, 14, 1.9), col, PR.paint_mat('truck_bed', '#6a6f73', 0.6, 0.3))
    for y in (8.5, 12.5, 15.5):
        for x in (-15.3, -12.7):
            cyl('wheel_%d_%d' % (int(x), int(y)), 0.55, 0.45, (x - 0.22, y, 0.55), col, M('rubber'), rot=(0, math.pi / 2, 0))
    # cerco perimetral y galpón de fondo
    for i in range(-30, 31, 3):
        cyl('fpost%d' % i, 0.04, 2.4, (i, 26, 0), col, M('steel'), seg=8)
    box('fence_mesh', (60, 0.02, 2.2), (0, 26, 1.2), col, principled('fence_m', '#9aa1a6', 0.4, metal=0.8, alpha=0.35))
    box('shed', (30, 14, 9), (6, 36, 4.5), col, PL.corrugated('shed_corr'))
    box('shed_roof', (31, 15, 0.4), (6, 36, 9.2), col, principled('shed_roof_m', '#5e6a72', 0.5))
    # zona segura: barreras de hormigón + vallado amarillo/negro + cartel
    for k in range(6):
        b = box('jersey%d' % k, (2.0, 0.6, 0.85), (SCI[0] - 3.0 + k * 2.05, SCI[1] + 1.4, 0.42), col, M('concrete'), bevel=0.04)
    stripe = PR.paint_mat('stripe_y', '#e8b400', 0.5, 0.1)
    for k in range(6):
        box('jstripe%d' % k, (1.9, 0.62, 0.12), (SCI[0] - 3.0 + k * 2.05, SCI[1] + 1.4, 0.6), col, stripe)
    PL.sign('sign_safe', 'ZONA SEGURA', Vector((SCI[0] - 3.5, SCI[1] + 1.75, 1.6)), col, 0.0, 0.3, '#2e8b57')
    cyl('sign_post', 0.05, 1.3, (SCI[0] - 3.5, SCI[1] + 1.8, 0.0), col, M('steel'))
    PL.sign('sign_danger', 'PELIGRO: CARGAS SUSPENDIDAS', Vector((3.0, -6.0, 2.2)), col, math.radians(-20), 0.28, '#c0392b')
    cyl('sign_post2', 0.05, 1.9, (3.0, -6.0, 0.0), col, M('steel'))
    return pile_objs


def build_crane(col):
    yel = PR.paint_mat('crane_yellow', '#f0b400', 0.4, 0.12)
    dark = PR.paint_mat('crane_dark', '#2b2d30', 0.5, 0.1)
    # orugas y chasis fijos
    for y in (-1.3, 1.3):
        box('track%d' % (y > 0), (5.0, 0.8, 1.0), (0, y, 0.5), col, dark, bevel=0.15)
    box('undercarriage', (3.0, 2.0, 0.6), (0, 0, 1.2), col, dark)
    slew = bpy.data.objects.new('crane_slew', None)
    col.objects.link(slew)
    slew.location = (0, 0, 1.5)
    parts = []
    parts.append(box('upper', (4.2, 2.6, 1.3), (-0.8, 0, 0.65), col, yel, bevel=0.08))
    parts.append(box('counterweight', (1.2, 2.6, 1.0), (-2.7, 0, 0.9), col, dark, bevel=0.08))
    cab = box('cab', (1.4, 1.2, 1.7), (0.8, -1.4, 2.15), col, yel, bevel=0.06)
    parts.append(cab)
    glass = principled('cab_glass', '#2a3c48', 0.05, alpha=0.12)
    parts.append(box('cab_glass_f', (0.02, 1.0, 1.0), (1.51, -1.4, 2.4), col, glass))
    parts.append(box('cab_glass_s', (1.2, 0.02, 1.0), (0.8, -2.01, 2.4), col, glass))
    # pluma: dos tramos hasta la punta
    tip = Vector((R_TIP, 0, TIP_H - 1.5))
    knee = Vector((4.0, 0, 7.6))
    for nm, a, b, w in (('boom1', Vector((0.6, 0, 1.3)), knee, 0.55), ('boom2', knee, tip, 0.4)):
        d = b - a
        ob = box(nm, (d.length, w, w), (a + b) / 2, col, yel, bevel=0.03)
        ob.rotation_euler = (0, -math.atan2(d.z, d.x), 0)
        parts.append(ob)
    parts.append(cyl('hyd', 0.12, (knee - Vector((1.6, 0, 1.4))).length, Vector((1.6, 0, 1.4)), col, M('chrome'),
                     rot=(0, math.pi / 2 - math.atan2(knee.z - 1.4, knee.x - 1.6), 0)))
    for p in parts:
        p.parent = slew
    # cable + electroimán (se mueven con la pluma y bajan/suben)
    hook = bpy.data.objects.new('crane_hook', None)
    col.objects.link(hook)
    hook.parent = slew
    hook.location = tip
    cable = cyl('cable', 0.025, 1.0, Vector((0, 0, -1.0)), col, M('black_plastic'), seg=8)
    cable.parent = hook
    mag = bpy.data.objects.new('emag', None)
    col.objects.link(mag)
    mag.parent = slew
    disc = cyl('emag_disc', 0.85, 0.45, Vector((0, 0, -0.45)), col, dark, seg=32)
    disc.parent = mag
    rim = cyl('emag_rim', 0.87, 0.08, Vector((0, 0, -0.2)), col, PR.paint_mat('emag_or', '#e67e22', 0.4, 0.1), seg=32)
    rim.parent = mag
    glow = emission_mat('emag_glow', '#8fe3ff', 0.0)
    gl = cyl('emag_glow', 0.8, 0.02, Vector((0, 0, -0.47)), col, glow, seg=32)
    gl.parent = mag
    gl.visible_shadow = False
    cap = cyl('emag_cap', 0.25, 0.25, Vector((0, 0, 0.0)), col, dark)
    cap.parent = mag
    return dict(slew=slew, hook=hook, mag=mag, glow=glow, cab=cab, tip=tip)


def main():
    sc = SL.new_scene('E5', DUR)
    col = collection('Yard')
    pile = build_yard(col)
    cr = build_crane(col)
    slew, hook, mag, tip = cr['slew'], cr['hook'], cr['mag'], cr['tip']
    # ---- coreografía de la grúa
    pick_z = 1.9            # altura de la base del imán sobre la pila
    T = dict(start=0.0, over=9.0, down=11.2, on=12.2, up=15.0, slew_end=19.0, low=20.0, off=20.6, up2=23.0)

    def slew_a(t):
        if t < 3.0:
            return math.radians(-25)
        if t < T['over']:
            return math.radians(-25) + math.radians(25) * ease_io((t - 3.0) / (T['over'] - 3.0))
        if t < T['up']:
            return 0.0
        if t < T['slew_end']:
            return math.radians(90) * ease_io((t - T['up']) / (T['slew_end'] - T['up']))
        return math.radians(90)

    def mag_z(t):
        hi = 5.5
        if t < T['over']:
            return hi
        if t < T['down']:
            return hi + (pick_z - hi) * ease_io((t - T['over']) / (T['down'] - T['over']))
        if t < T['on'] + 0.4:
            return pick_z
        if t < T['up']:
            return pick_z + (hi - pick_z) * ease_io((t - T['on'] - 0.4) / (T['up'] - T['on'] - 0.4))
        if t < T['slew_end']:
            return hi
        if t < T['low']:
            return hi + (3.6 - hi) * ease_io((t - T['slew_end']) / (T['low'] - T['slew_end']))
        if t < T['off'] + 0.6:
            return 3.6
        return 3.6 + (hi - 3.6) * ease_io(min((t - T['off'] - 0.6) / 2.0, 1))

    nF = sc.frame_end
    for f in range(1, nF + 1):
        t = (f - 1) / 30
        sw = 0.02 * math.sin(t * 2.1) * (1 if T['up'] < t < T['slew_end'] + 1.5 else 0.3)
        slew.rotation_euler = (0, 0, slew_a(t))
        slew.keyframe_insert('rotation_euler', index=2, frame=f)
        z = mag_z(t)
        mag.location = (tip.x + sw * 3, 0, z - 1.5 + 0.45)
        mag.keyframe_insert('location', frame=f)
        hook.scale = (1, 1, max(tip.z - (z - 1.5 + 0.45), 0.01))
        hook.keyframe_insert('scale', frame=f)
    node = cr['glow'].node_tree.nodes['Emission'].inputs['Strength']
    for f, vv in ((F(T['on']) - 1, 0.0), (F(T['on']) + 3, 8.0), (F(T['off']), 8.0), (F(T['off']) + 3, 0.0)):
        node.default_value = vv
        node.keyframe_insert('default_value', frame=f)
    # ---- piezas levantadas
    sc.frame_set(F(T['on']))
    mw_on = {}
    caught = []
    rnd = random.Random(5)
    mpos = mag.matrix_world.translation
    for ob in pile:
        d = (ob.location.xy - mpos.xy).length
        if d < 1.05 and ob.location.z > 0.6:
            caught.append(ob)
    print('caught', len(caught))
    Mw = {}
    for f in range(F(T['on']) - 2, nF + 1):
        sc.frame_set(f)
        Mw[f] = mag.matrix_world.copy()
    for i, ob in enumerate(caught):
        ob.rotation_mode = 'QUATERNION'
        M0 = ob.matrix_world.copy()
        f_on = F(T['on'] + 0.05 + rnd.uniform(0, 0.25))
        att = Vector((rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), -0.55 - rnd.uniform(0, 0.35)))
        q_att = Quaternion((0, 0, 1), rnd.uniform(0, 6.28)) @ Quaternion((1, 0, 0), rnd.uniform(-0.4, 0.4))
        local = Matrix.Translation(att) @ q_att.to_matrix().to_4x4()
        land = CONT + Vector((rnd.uniform(-1.8, 1.8), rnd.uniform(-0.9, 0.9), 0.5 + rnd.uniform(0, 0.4)))
        f_off = F(T['off'] + rnd.uniform(0, 0.12))
        kb = KeyBuffer(ob)
        prev = None
        for f in range(F(T['on']) - 2, nF + 1):
            if f < f_on:
                Mx = M0
            elif f < f_on + 6:
                u = (f - f_on) / 6
                tg = Mw[f] @ local
                loc = M0.translation.lerp(tg.translation, u * u)
                q = M0.to_quaternion().slerp(tg.to_quaternion(), u)
                Mx = Matrix.Translation(loc) @ q.to_matrix().to_4x4()
            elif f < f_off:
                Mx = Mw[f] @ local
            else:
                st = Mw[f_off] @ local
                tf = (f - f_off) / 30
                z = st.translation.z - 4.9 * tf * tf
                if z <= land.z:
                    z = land.z
                xy = st.translation.lerp(land, min(tf / 0.7, 1))
                q = st.to_quaternion() @ Quaternion((1, 0, 0), min(tf, 0.7) * 2.0)
                Mx = Matrix.Translation(Vector((xy.x, xy.y, z))) @ q.to_matrix().to_4x4()
            loc, q, s = Mx.decompose()
            if prev is not None and prev.dot(q) < 0:
                q.negate()
            prev = q
            kb.key_vec('location', f, loc)
            kb.key_vec('rotation_quaternion', f, q)
        kb.write()
    # ---- operador en la cabina (pose sentado aproximada, manos en los comandos)
    ro, oo = cast.load('worker_b', 'operator')
    Ao = anim.Actor(ro)
    Po = perform.Performer(Ao, pos=(0, 0), yaw=math.radians(90))
    Po.crouch.add(0, 0.42)
    Po.lean.add(0, 0.1)
    for side, dy in (('L', 0.2), ('R', -0.2)):
        Po.hand(side, 0.0, ('world', Vector((0.32, dy, 0.82)), Vector((1, 0, -0.3)), Vector((0, 0, -1))))
        Po.hand_pose(side, 0.0, {'grip': 1})
    for k in range(10):
        t = k * 2.8
        Po.hand('R', t + 1.4, ('world', Vector((0.34, -0.2, 0.84)), Vector((1, 0.15, -0.3)), Vector((0, 0, -1))))
        Po.hand('R', t + 2.8, ('world', Vector((0.31, -0.22, 0.81)), Vector((1, -0.1, -0.3)), Vector((0, 0, -1))))
    Po.look_at(0.0, (6, 0, 0.0))
    Po.bake(1, nF)
    ro.parent = slew
    ro.matrix_parent_inverse = Matrix.Identity(4)
    ro.location = (0.75, -1.4, 1.3 - 0.0)
    # palancas de mando bajo las manos del operador (la derecha acompaña el movimiento de la mano)
    cab_o = Vector((0.75, -1.4, 1.3))
    pfd = Vector((1, 0, -0.3)).normalized()
    stick_keys = {'L': [(0.0, Vector((0.32, 0.2, 0.82)))], 'R': [(0.0, Vector((0.32, -0.2, 0.82)))]}
    for k in range(10):
        t = k * 2.8
        stick_keys['R'] += [(t + 1.4, Vector((0.34, -0.2, 0.84))), (t + 2.8, Vector((0.31, -0.22, 0.81)))]
    for side, keys in stick_keys.items():
        palm0 = keys[0][1] + pfd * 0.085
        base = palm0 - Vector((0, 0, 0.17))
        pod = PR.box('joy_base_' + side, (0.09, 0.09, 0.05), cab_o + base + Vector((0, 0, -0.02)), None, PR.M('black_plastic'), bevel=0.006)
        pod.parent = slew
        pod.matrix_parent_inverse = Matrix.Identity(4)
        pod.location = cab_o + base + Vector((0, 0, -0.02))
        piv = bpy.data.objects.new('joy_pivot_' + side, None)
        bpy.context.scene.collection.objects.link(piv)
        piv.parent = slew
        piv.location = cab_o + base
        piv.rotation_mode = 'QUATERNION'
        stick = PR.cyl('joy_stick_' + side, 0.007, 0.15, Vector((0, 0, 0)), None, PR.M('steel'))
        knob = PR.sphere('joy_knob_' + side, 0.022, Vector((0, 0, 0.165)), None, PR.M('black_plastic'), scale=(1, 1, 1.3))
        for o in (stick, knob):
            o.parent = piv
        kbj = KeyBuffer(piv)
        for t, w in keys:
            d = (w + pfd * 0.085) - base
            q = Vector((0, 0, 1)).rotation_difference(d.normalized())
            kbj.key_vec('rotation_quaternion', F(t), q)
        kbj.write()
    # ---- científico en la zona segura (con casco y chaleco)
    rig, objs = cast.load('scientist', safety=True)
    A = anim.Actor(rig)
    P = perform.Performer(A, pos=(SCI[0] - 6.0, SCI[1] - 1.0), yaw=math.radians(90))
    P.walk(0.3, 5.6, [(SCI[0], SCI[1])], step=0.7)
    P.face_dir(5.9, 6.6, (0.0, 0.0))
    P.look_at(0.0, 'fwd')
    P.look_at(5.8, (2.0, 0.0, 4.0))
    P.expression(6.0, 'curious')
    P.look_at(10.0, PILE + Vector((0, 0, 2.5)))
    P.look_at(14.5, (6.0, 4.0, 5.0))
    P.look_at(19.0, CONT + Vector((0, 0, 3.0)))
    P.expression(20.8, 'amazed')
    # señala la grúa y el contenedor
    P.hand('R', 16.0, 'rest')
    P.hand_pose('R', 16.0, {'relaxed': 1})
    P.hand('R', 17.0, ('world', Vector((SCI[0] + 0.25, SCI[1] + 0.45, 1.5)), Vector((0.45, 0.85, 0.35)), Vector((0, 0, -1))))
    P.hand_pose('R', 17.0, {'point': 1})
    P.hand('R', 20.0, ('world', Vector((SCI[0] + 0.15, SCI[1] + 0.5, 1.45)), Vector((0.1, 1.0, 0.25)), Vector((0, 0, -1))))
    P.hand('R', 21.2, 'rest')
    P.hand_pose('R', 21.2, {'relaxed': 1})
    P.face_dir(22.4, 23.0, (SCI[0] + 1.6, SCI[1] - 3.2))
    P.look_at(23.0, (-3.6, -14.5, 1.7))
    P.expression(23.2, 'explain')
    P.hand('L', 23.4, 'rest')
    P.hand('L', 24.4, ('world', Vector((SCI[0] + 0.3, SCI[1] - 0.25, 1.15)), Vector((0.2, -1, 0.2)), Vector((0.3, -0.3, 1))))
    P.hand_pose('L', 24.4, {'open': 1})
    P.hand('L', 27.0, ('world', Vector((SCI[0] + 0.32, SCI[1] - 0.25, 1.17)), Vector((0.2, -1, 0.2)), Vector((0.3, -0.3, 1))))
    P.expression(26.0, 'smile')
    P.bake(1, nF)
    # ---- cámaras
    cams = {}
    c = SL.CameraRig('C1', [(0.0, (-26.0, -24.0, 15.0), (2.0, 2.0, 1.5), 26), (7.0, (-20.0, -21.0, 9.0), (0.0, 0.0, 2.5), 28)])
    cams['C1'] = c.bake(1, F(7.2))
    c = SL.CameraRig('C2', [(7.0, (2.6, -6.2, 3.4), (0.9, -1.4, 3.6), 30), (9.5, (3.0, -6.6, 3.3), (4.5, -0.5, 3.4), 28),
                             (14.0, (3.6, -7.2, 3.0), (8.0, 0.3, 2.4), 28)])
    cams['C2'] = c.bake(F(6.9), F(14.2))
    c = SL.CameraRig('C3', [(14.0, (16.0, -14.0, 6.0), (4.0, 4.0, 3.5), 28), (23.0, (15.0, -9.0, 5.0), (1.0, 7.0, 2.5), 30)])
    cams['C3'] = c.bake(F(13.9), F(23.2))
    c = SL.CameraRig('C4', [(23.0, (SCI[0] + 1.6, SCI[1] - 3.2, 1.75), (SCI[0], SCI[1], 1.55), 34), (28.0, (SCI[0] + 2.4, SCI[1] - 4.0, 1.9), (SCI[0] - 0.2, SCI[1], 1.6), 32)])
    cams['C4'] = c.bake(F(22.9), F(28.0))
    for t, k in ((0.0, 'C1'), (7.0, 'C2'), (14.0, 'C3'), (23.0, 'C4')):
        SL.cut(t, cams[k])
    # ---- motion graphics
    mg = bpy.data.collections.new('MoGraph')
    sc.collection.children.link(mg)
    lines = MG.dipole_lines(L=0.5, n=8, max_len=2.2, step=0.03, planes=3)
    fl, flm = MG.field_lines_object('emag_field', lines, mg, MG.CYAN, radius=0.02, strength=5.0, parent=mag)
    fl.location = (0, 0, -0.2)
    fl.scale = (1.6, 1.6, 1.6)
    MG.grow(fl, F(T['on']), F(T['on'] + 1.0), flm, f_out=F(T['off']))
    MG.label('lbl_on', 'ELECTROIMÁN ACTIVADO', PILE + Vector((0, 0, 2.6)), PILE + Vector((-2.2, -2.8, 1.9)), cams['C2'],
             F(T['on'] + 0.2), F(14.0), mg, size=0.26, color=MG.CYAN, sub='corriente ON → campo magnético')
    MG.label('lbl_off', 'CORRIENTE OFF', CONT + Vector((0, 0, 3.4)), CONT + Vector((3.0, -3.0, 5.6)), cams['C3'],
             F(T['off']), F(23.0), mg, size=0.4, color='#ff6b6b', sub='el campo desaparece y la carga cae')
    MG.label('lbl_carry', 'hierro y acero', PILE + Vector((-2.0, 4.5, 4.0)), Vector((2.0, 2.5, 7.0)), cams['C3'],
             F(15.5), F(19.5), mg, size=0.4, color=MG.CYAN)
    for lid, t in (('E5_01', 0.8), ('E5_02', 7.4), ('E5_03', 14.2), ('E5_04', 23.6)):
        SL.narration(sc, lid, t)
    SL.save(sc, 'E5')


if __name__ == '__main__':
    main()
