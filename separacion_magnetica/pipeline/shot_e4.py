"""E4 — Planta de reciclaje: cinta con residuos mezclados y separador magnético de banda."""
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
import cast, anim, perform, mograph as MG, sets_plant as PL, props as PR
from props import M
from anim import KeyBuffer
from util import emission_mat, ease_io, principled

DUR = 31.0


def can_mesh(name, r, h, seg=16):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=max(seg, 24), radius1=r, radius2=r, depth=h)
    # rebordes de lata (anillos) en las tapas
    for zz in (-h / 2, h / 2):
        bmesh.ops.create_cone(bm, cap_ends=False, segments=24, radius1=r * 1.03, radius2=r * 1.03, depth=h * 0.04,
                              matrix=Matrix.Translation((0, 0, zz)))
    bm.to_mesh(me)
    bm.free()
    _smooth_sides(me)
    return me


def _smooth_sides(me):
    """Costados suaves y tapas planas (con todo suave las latas parecían cápsulas)."""
    for pl in me.polygons:
        pl.use_smooth = abs(pl.normal.z) < 0.5


def bottle_mesh(name):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.04, radius2=0.04, depth=0.2)
    bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.04, radius2=0.014, depth=0.07, matrix=Matrix.Translation((0, 0, 0.135)))
    # pico y tapa: se reconoce como botella
    bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.016, radius2=0.016, depth=0.025, matrix=Matrix.Translation((0, 0, 0.18)))
    bm.to_mesh(me)
    bm.free()
    _smooth_sides(me)
    return me


def label_mat(name, c1, c2):
    mat = bpy.data.materials.new(name)
    from util import NodeBuilder, srgb
    nb = NodeBuilder(mat)
    p = nb.n('ShaderNodeBsdfPrincipled')
    tc = nb.n('ShaderNodeTexCoord')
    sep = nb.n('ShaderNodeSeparateXYZ')
    nb.link(tc.outputs['Generated'], sep.inputs[0])
    gt = nb.n('ShaderNodeMath', _operation='GREATER_THAN')
    nb.link(sep.outputs['Z'], gt.inputs[0])
    gt.inputs[1].default_value = 0.5
    mix = nb.n('ShaderNodeMix', _data_type='RGBA')
    nb.link(gt.outputs[0], mix.inputs['Factor'])
    mix.inputs[6].default_value = srgb(c1)
    mix.inputs[7].default_value = srgb(c2)
    nb.link(mix.outputs[2], p.inputs['Base Color'])
    p.inputs['Metallic'].default_value = 0.6
    p.inputs['Roughness'].default_value = 0.3
    nb.output(p.outputs['BSDF'])
    return mat


def main():
    sc = SL.new_scene('E4', DUR)
    plant = PL.build_plant(DUR)
    col = bpy.data.collections.new('Items')
    sc.collection.children.link(col)
    rnd = random.Random(21)
    steel_m = [label_mat('steel_lbl%d' % i, c, '#9aa0a6') for i, c in enumerate(('#c0392b', '#2e86c1', '#27ae60'))]
    alu_m = [label_mat('alu_lbl%d' % i, c, '#d9dde1') for i, c in enumerate(('#e74c3c', '#f1c40f', '#8e44ad'))]
    pl_m = [principled('pl_%d' % i, c, 0.15, alpha=0.7) for i, c in enumerate(('#7fc8f8', '#8ee08e', '#f5f5f5'))]
    cb_m = principled('cardboard', '#a37b4f', 0.85, noise_color=0.3)
    steel_me = can_mesh('steelcan', 0.042, 0.12)
    alu_me = can_mesh('alucan', 0.033, 0.12)
    bot_me = bottle_mesh('bottle')
    v = PL.SPEED
    items = []
    steel_landed = 0
    x = PL.BELT_X0 - v * DUR
    i = 0
    while x < PL.BELT_X1:
        kind = rnd.choices(['steel', 'alu', 'plastic', 'cb'], weights=[4, 3, 3, 1])[0]
        if kind == 'steel':
            ob = bpy.data.objects.new('it%03d' % i, steel_me)
            ob.data = steel_me.copy()
            ob.data.materials.append(rnd.choice(steel_m))
        elif kind == 'alu':
            ob = bpy.data.objects.new('it%03d' % i, alu_me.copy())
            ob.data.materials.append(rnd.choice(alu_m))
        elif kind == 'plastic':
            ob = bpy.data.objects.new('it%03d' % i, bot_me.copy())
            ob.data.materials.append(rnd.choice(pl_m))
        else:
            me = bpy.data.meshes.new('cb%d' % i)
            bm = bmesh.new()
            bmesh.ops.create_cube(bm, size=1)
            bmesh.ops.scale(bm, vec=(rnd.uniform(0.12, 0.22), rnd.uniform(0.1, 0.18), 0.01), verts=bm.verts)
            bm.to_mesh(me)
            bm.free()
            ob = bpy.data.objects.new('it%03d' % i, me)
            me.materials.append(cb_m)
        col.objects.link(ob)
        ob.rotation_mode = 'QUATERNION'
        ob.visible_shadow = True    # todos con sombra de contacto sobre la cinta
        y = rnd.uniform(-0.36, 0.36)
        lying = kind in ('steel', 'alu', 'plastic') and rnd.random() < 0.7
        q0 = Quaternion((0, 0, 1), rnd.uniform(0, 6.28))
        if lying:
            q0 = q0 @ Quaternion((1, 0, 0), math.pi / 2)
        zoff = {'steel': 0.042 if lying else 0.06, 'alu': 0.033 if lying else 0.06, 'plastic': 0.04 if lying else 0.1, 'cb': 0.006}[kind]
        items.append((ob, kind, x, y, q0, zoff))
        x += rnd.uniform(0.18, 0.42)
        i += 1
    # trayectorias
    cont = PL.CONT
    for ob, kind, x0, y, q0, zoff in items:
        kb = KeyBuffer(ob)
        state = 'belt'
        land = None
        prev = None
        lift_t = None
        for f in range(1, int(DUR * 30) + 2):
            t = (f - 1) / 30
            xb = x0 + v * t
            q = q0
            if kind == 'steel' and xb > PL.MAG_X - 0.45 and state == 'belt':
                state = 'lift'
                lift_t = t
                lx = xb
            if state == 'belt':
                if xb > PL.BELT_X1:
                    p = Vector((PL.BELT_X1 + 0.6, y * 0.6, -1.0))
                else:
                    p = Vector((xb, y, PL.BELT_Z + zoff))
            elif state == 'lift':
                u = min((t - lift_t) / 0.35, 1)
                ue = u * u
                tgt = Vector((PL.MAG_X + rnd.uniform(-0.0, 0.0), y, PL.XBELT_Z - 0.045))
                p = Vector((lx, y, PL.BELT_Z + zoff)).lerp(tgt, ue)
                q = q0.slerp(Quaternion((0, 1, 0), math.pi / 2), u)
                if u >= 1:
                    state = 'cross'
                    cross_t = t
            elif state == 'cross':
                yy = y + (t - cross_t) * 0.8
                p = Vector((PL.MAG_X, yy, PL.XBELT_Z - 0.045))
                q = Quaternion((0, 1, 0), math.pi / 2)
                if yy > 2.25:
                    state = 'fall'
                    fall_t = t
                    start = p.copy()
                    # cae casi vertical desde el extremo de la banda transversal, dentro del contenedor
                    land = Vector((start.x + rnd.uniform(-0.35, 0.35), min(start.y + 0.35 + rnd.uniform(0, 0.3), cont.y + 0.6),
                                   0.1 + rnd.uniform(0, 0.25)))
                    t_fall = math.sqrt(max(start.z - land.z, 0.01) / 4.9)
            elif state == 'fall':
                tf = t - fall_t
                p = start.lerp(land, min(tf / t_fall, 1))
                p.z = max(land.z, start.z - 4.9 * tf * tf)
                q = Quaternion((0, 1, 0), math.pi / 2) @ Quaternion((1, 0, 0), min(tf, t_fall) * 6)
                if tf >= t_fall:
                    state = 'in'
                    qin = q
            elif state == 'in':
                p = land
                q = qin
            if prev is not None and prev.dot(q) < 0:
                q = -q
            prev = q
            kb.key_vec('location', f, p)
            kb.key_vec('rotation_quaternion', f, q)
        kb.write()
    # chatarra de acero ya acumulada en el contenedor
    for k in range(40):
        ob = bpy.data.objects.new('cont_can%d' % k, steel_me)
        col.objects.link(ob)
        ob.location = cont + Vector((rnd.uniform(-1.0, 1.0), rnd.uniform(-0.7, 0.7), 0.1 + rnd.uniform(0, 0.15)))
        ob.rotation_euler = (rnd.uniform(0, 3), rnd.uniform(0, 3), rnd.uniform(0, 3))

    # científico (con casco y chaleco)
    rig, objs = cast.load('scientist', safety=True)
    A = anim.Actor(rig)
    P = perform.Performer(A, pos=(-9.0, -2.15), yaw=math.radians(90))
    P.look_at(0.0, 'fwd')
    P.expression(0.0, 'smile_soft')
    P.walk(0.2, 8.6, [(-4.0, -2.2), (1.6, -2.25)], step=0.7)
    P.look_at(3.0, (-5.0, 0.0, 1.3))
    P.look_at(5.5, (0.0, 0.0, 1.6))
    P.turn(9.2, 9.9, math.pi)
    P.look_at(9.6, (0.0, 0.0, 1.5))
    P.expression(10.0, 'curious')
    # señala el separador (queda a su izquierda: señala con la mano izquierda, sin cruzar el cuerpo)
    P.hand('L', 13.4, 'rest')
    P.hand_pose('L', 13.4, {'relaxed': 1})
    P.hand('L', 14.3, ('world', Vector((1.3, -1.82, 1.52)), Vector((-0.5, 0.8, 0.25)), Vector((0, 0, -1))))
    P.hand_pose('L', 14.3, {'point': 1})
    P.hand('L', 17.5, ('world', Vector((1.3, -1.8, 1.54)), Vector((-0.45, 0.82, 0.3)), Vector((0, 0, -1))))
    P.hand('L', 18.4, 'rest')
    P.hand_pose('L', 18.4, {'relaxed': 1})
    P.look_at(16.0, (0.0, 1.5, 1.7))
    P.expression(16.2, 'amazed')
    P.look_at(19.0, (0.0, 2.3, 1.0))
    # toca la consola
    st = Vector((1.6, -1.79, 1.1))
    P.look_at(21.4, st)
    P.expression(21.4, 'focus')
    P.hand('L', 21.0, 'rest')
    P.hand_pose('L', 21.0, {'relaxed': 1})
    # la punta del índice toca la superficie de la pantalla (inclinada 25°) y la pantalla responde
    a25 = math.radians(25)
    scr_c = Vector((1.6, -1.785, 1.085))
    scr_n = Vector((0, -math.sin(a25), math.cos(a25)))
    scr_u = Vector((0, math.cos(a25), math.sin(a25)))
    surf = scr_c + scr_n * 0.005
    # los dos botones del lado izquierdo de la pantalla (los toca la mano izquierda sin cruzar el cuerpo)
    T1 = surf + Vector((-0.13, 0, 0)) + scr_u * 0.04
    T2 = surf + Vector((-0.02, 0, 0)) - scr_u * 0.03
    fd, pdl = Vector((-0.2, 0.9, -0.4)), Vector((0, 0.3, -1))
    tw = lambda p: ('world', P.tip_to_wrist('L', p, fd, pdl), fd, pdl)
    P.hand('L', 21.9, tw(T1 + scr_n * 0.07))
    P.hand_pose('L', 21.8, {'point': 1})
    P.hand('L', 22.4, tw(T1 - scr_n * 0.002))
    P.hand('L', 22.7, tw(T1 + scr_n * 0.03))
    P.hand('L', 23.2, tw(T2 - scr_n * 0.002))
    P.hand('L', 23.5, tw(T2 + scr_n * 0.03))
    P.hand('L', 24.2, tw(T2 + scr_n * 0.12))
    # botones de la pantalla que se iluminan al tocarlos
    for k, (T, tt) in enumerate(((T1, 22.4), (T2, 23.2))):
        bt = PR.cyl('st_touch%d' % k, 0.022, 0.002, T + scr_n * 0.0005, col, None)
        bt.rotation_euler = (a25, 0, 0)
        em = emission_mat('st_touch%d_m' % k, '#7fe6ff', 0.6)
        bt.data.materials.append(em)
        node = em.node_tree.nodes['Emission'].inputs['Strength']
        for f, v in ((F(tt) - 1, 0.6), (F(tt) + 1, 9.0), (F(tt) + 8, 3.0)):
            node.default_value = v
            node.keyframe_insert('default_value', frame=f)
    P.hand('L', 25.2, 'rest')
    P.hand_pose('L', 25.4, {'relaxed': 1})
    P.lean.add(21.0, 0.0).add(21.9, 0.12).add(24.4, 0.12).add(25.2, 0.0)
    P.look_at(25.4, (-0.5, -6.0, 1.6))
    P.expression(25.6, 'smile')
    P.bake(1, sc.frame_end)
    # operarios de fondo
    rw, ow = cast.load('worker_a', 'opA')
    Aw = anim.Actor(rw)
    Pw = perform.Performer(Aw, pos=(-6.5, 0.8), yaw=0.0)   # de frente a la cinta (mira hacia -Y)
    Pw.look_at(0.0, (-6.5, 0.0, 1.2))
    Pw.lean.add(0, 0.24)
    # la operaria saca botellas plásticas reales de la cinta y las tira al contenedor (antes cerraba la mano en el aire)
    picks = []
    q_lay = Quaternion((0, 1, 0), math.pi / 2)          # botella acostada a lo largo de la cinta
    for k in range(12):
        t = 0.5 + k * 2.4
        tg, tr = t + 1.0, t + 2.0
        pick = Vector((-6.55, 0.42, PL.BELT_Z + 0.04))
        g = Aw.grasp_frame('R', pick, (1, 0, 0), Vector((0, -0.6, -1)), radius=0.04)
        Pw.hand('R', t, 'rest')
        Pw.hand('R', t + 0.75, ('world', g[0] + Vector((0, 0, 0.08)), g[1], g[2]))
        Pw.hand_pose('R', t + 0.7, {'open': 1})
        Pw.hand('R', tg, ('world',) + tuple(g))
        Pw.hand('R', tg + 0.12, ('world',) + tuple(g))
        Pw.hand_pose('R', tg, {'grip': 1})
        Pw.hand('R', t + 1.8, ('world', Vector((-7.0, 0.7, 1.24)), Vector((-0.7, 0.1, -0.7)), Vector((0, 0, -1))))
        Pw.hand_pose('R', tr, {'open': 1})
        # mirada: sigue la botella que viene por la cinta, la toma y la mira caer al contenedor
        Pw.look_at(t + 0.2, pick + Vector((-0.6, 0, 0.05)))
        Pw.look_at(t + 0.9, pick)
        Pw.look_at(t + 1.6, Vector((-7.2, 0.85, 1.05)))
        bo = bpy.data.objects.new('pick%02d' % k, bot_me.copy())
        bo.data.materials.append(pl_m[k % len(pl_m)])
        col.objects.link(bo)
        bo.rotation_mode = 'QUATERNION'
        bo.visible_shadow = False
        kb = KeyBuffer(bo)
        # viaja sobre la cinta hasta el punto de agarre
        for f in range(1, F(tg) + 1):
            tt = (f - 1) / 30.0
            kb.key_vec('location', f, pick - Vector((v * (tg - tt), 0, 0)))
            kb.key_vec('rotation_quaternion', f, q_lay)
        kb.write()
        Pw.attach(bo, 'R', tg + 0.03, tr)
        picks.append((bo, tr))
    Pw.bake(1, sc.frame_end)
    # al soltarla cae dentro del contenedor y desaparece en su interior
    bin_top = Vector((-7.2, 0.85, 1.06))
    for bo, tr in picks:
        fr = F(tr)
        sc.frame_set(fr)
        p0 = bo.matrix_world.translation.copy()
        q0r = bo.matrix_world.to_quaternion()
        kb = KeyBuffer(bo)
        n = 9
        for j in range(1, n + 1):
            u = j / n
            p = p0.lerp(bin_top, u)
            p.z = p0.z + (bin_top.z - p0.z) * u * u
            kb.key_vec('location', fr + j, p)
            kb.key_vec('rotation_quaternion', fr + j, q0r)
        kb.key_vec('scale', fr + n, (1, 1, 1))
        kb.key_vec('scale', fr + n + 2, (0.001, 0.001, 0.001))
        kb.write()
    rb, ob_ = cast.load('worker_b', 'opB')
    Ab = anim.Actor(rb)
    Pb = perform.Performer(Ab, pos=(-14.0, 6.0), yaw=math.radians(90))
    Pb.walk(1.0, 16.0, [(-2.0, 6.2), (4.0, 6.6)], step=0.66)
    Pb.turn(17.0, 17.8, math.pi)
    Pb.bake(1, sc.frame_end)
    box_bin = PR.box('pick_bin', (0.6, 0.5, 0.5), (-7.2, 0.85, 0.25 + 0.55), col, principled('pickbin_m', '#2f7a4b', 0.5))

    # motion graphics
    mg = bpy.data.collections.new('MoGraph')
    sc.collection.children.link(mg)
    cams = cameras()
    sep = plant['sep']
    # vista en corte del imán: la cara frontal se vuelve transparente
    front = sep['front']
    fm = MG.fade_material('front_cut', '#b8262c', 0.6, alpha=1.0)
    front.data.materials.clear()
    front.data.materials.append(fm)
    node = fm.node_tree.nodes['fade'].outputs[0]
    for f, val in ((F(14.8), 1.0), (F(15.4), 0.0)):
        node.default_value = val
        node.keyframe_insert('default_value', frame=f)
    hous = sep['housing']
    hm = hous.data.materials[0]
    pa = [n for n in hm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'][0].inputs['Alpha']
    for f, val in ((F(14.8), 1.0), (F(15.6), 0.22), (F(21.0), 0.22), (F(21.8), 1.0)):
        pa.default_value = val
        pa.keyframe_insert('default_value', frame=f)
    for f, val in ((F(21.0), 0.0), (F(21.8), 1.0)):
        node.default_value = val
        node.keyframe_insert('default_value', frame=f)
    lines = MG.dipole_lines(L=0.25, n=6, max_len=0.5, step=0.01, planes=2)
    fl, flm = MG.field_lines_object('sep_field', lines, mg, MG.CYAN, radius=0.004, strength=5.0)
    fl.location = (PL.MAG_X, 0.0, PL.XBELT_Z + 0.15)
    fl.scale = (1.2, 1.2, 1.2)
    MG.grow(fl, F(15.2), F(16.6), flm, f_out=F(21.5))
    MG.label('lbl_sep', 'SEPARADOR MAGNÉTICO', (PL.MAG_X, -0.3, PL.XBELT_Z + 0.4), (PL.MAG_X - 0.5, 0.3, PL.XBELT_Z + 0.7),
             cams['C3'], F(14.0), F(21.0), mg, size=0.06, color=MG.RED, sub='de banda: imán + banda transversal')
    MG.label('lbl_steel', 'ACERO', (PL.MAG_X, 0.3, PL.XBELT_Z - 0.05), (PL.MAG_X + 1.4, -0.9, PL.XBELT_Z + 0.35),
             cams['C3'], F(16.4), F(21.0), mg, size=0.08, color=MG.CYAN, sub='separado de la cinta')
    MG.label('lbl_mix', 'RESIDUOS MEZCLADOS', (-4.0, 0.0, PL.BELT_Z + 0.1), (-3.6, -0.7, PL.BELT_Z + 0.6),
             cams['C2'], F(7.0), F(12.8), mg, size=0.07, color=MG.ORANGE, sub='acero · aluminio · plástico')
    MG.label('lbl_cont', 'ALUMINIO Y PLÁSTICO', (3.5, 0.0, PL.BELT_Z + 0.1), (3.6, -1.0, PL.BELT_Z + 0.95),
             cams['C4'], F(25.5), None, mg, size=0.08, color=MG.ORANGE, sub='siguen en la cinta')
    # la consola maneja la línea: cada toque enciende un indicador en la máquina y su flecha de recorrido
    MG.arrow('arr_steel', (PL.MAG_X, 0.6, PL.XBELT_Z - 0.2), (PL.MAG_X, 2.0, PL.XBELT_Z - 0.2), mg, MG.CYAN, radius=0.025, f_in=F(22.5))
    MG.arrow('arr_rest', (1.0, 0.0, PL.BELT_Z + 0.35), (4.5, 0.0, PL.BELT_Z + 0.35), mg, MG.ORANGE, radius=0.025, f_in=F(23.3))
    for k, (pos, colr, tt) in enumerate((((PL.MAG_X - 0.35, -0.62, PL.XBELT_Z + 0.5), '#35e06a', 22.4),
                                          ((PL.MAG_X + 0.35, -0.62, PL.XBELT_Z + 0.5), '#ffb02e', 23.2))):
        lamp = PR.cyl('st_lamp%d' % k, 0.05, 0.09, Vector(pos), col, None, seg=20)
        lm = emission_mat('st_lamp%d_m' % k, colr, 0.3)
        lamp.data.materials.append(lm)
        PR.cyl('st_lamp_base%d' % k, 0.055, 0.03, Vector(pos) - Vector((0, 0, 0.03)), col, M('black_plastic'), seg=20)
        nd = lm.node_tree.nodes['Emission'].inputs['Strength']
        for f, v_ in ((F(tt) - 1, 0.3), (F(tt) + 2, 12.0), (F(tt) + 12, 6.0)):
            nd.default_value = v_
            nd.keyframe_insert('default_value', frame=f)
    for lid, t in (('E4_01', 0.8), ('E4_02', 6.6), ('E4_03', 13.4), ('E4_04', 21.2)):
        SL.narration(sc, lid, t)
    SL.save(sc, 'E4')


def cameras():
    cams = {}
    # presentación más cercana: se ve la nave y enseguida los residuos que avanzan por la cinta
    c = SL.CameraRig('C1', [(0.0, (-14.5, -6.0, 4.4), (-7.5, 0.0, 1.2), 26), (6.5, (-10.6, -2.7, 2.2), (-7.2, 0.0, 1.22), 30)])
    cams['C1'] = c.bake(1, F(6.8))
    c = SL.CameraRig('C2', [(6.5, (-6.2, -1.0, 1.55), (-3.0, 0.0, 1.2), 28), (13.0, (-4.2, -0.95, 1.5), (-1.0, 0.0, 1.25), 30)])
    cams['C2'] = c.bake(F(6.4), F(13.2))
    # más alta: antes quedaba detrás de la baranda verde y la tapaba
    # plano abierto: se ven la cinta, el separador y el contenedor de acero a la vez
    c = SL.CameraRig('C3', [(13.0, (-3.2, -2.6, 2.6), (0.0, 0.6, 1.4), 24), (21.0, (-2.8, -2.4, 2.6), (0.0, 0.9, 1.35), 24)])
    cams['C3'] = c.bake(F(12.9), F(21.2))
    # primero la mano en la pantalla, luego se abre para mostrar qué hace la máquina con cada toque
    c = SL.CameraRig('C4', [(21.0, (2.6, -3.1, 1.85), (1.55, -1.75, 1.12), 32), (22.9, (2.7, -3.2, 1.9), (1.4, -1.6, 1.15), 32),
                             (25.0, (3.6, -4.4, 2.5), (0.4, 0.0, 1.4), 26), (31.0, (5.2, -5.3, 3.0), (0.8, 0.6, 1.1), 26)])
    cams['C4'] = c.bake(F(20.9), F(31.0))
    for t, k in ((0.0, 'C1'), (6.5, 'C2'), (13.0, 'C3'), (21.0, 'C4')):
        SL.cut(t, cams[k])
    return cams


if __name__ == '__main__':
    main()
