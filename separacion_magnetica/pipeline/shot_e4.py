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
from util import ease_io, principled

DUR = 31.0


def can_mesh(name, r, h, seg=16):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=h)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    return me


def bottle_mesh(name):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.04, radius2=0.04, depth=0.2)
    bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=0.04, radius2=0.014, depth=0.07, matrix=Matrix.Translation((0, 0, 0.135)))
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
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
        ob.visible_shadow = kind != 'plastic'
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
                    land = cont + Vector((rnd.uniform(-0.9, 0.9), rnd.uniform(-0.6, 0.6), 0.1 + rnd.uniform(0, 0.25)))
            elif state == 'fall':
                tf = t - fall_t
                p = start.lerp(land, min(tf / 0.45, 1))
                p.z = max(land.z, start.z + 0.6 * tf - 4.9 * tf * tf)
                q = Quaternion((0, 1, 0), math.pi / 2) @ Quaternion((1, 0, 0), tf * 9)
                if tf > 0.45 and p.z <= land.z + 1e-3:
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
    # señala el separador
    P.hand('R', 13.4, 'rest')
    P.hand_pose('R', 13.4, {'relaxed': 1})
    P.hand('R', 14.3, ('world', Vector((1.25, -1.75, 1.55)), Vector((-0.7, 0.7, 0.25)), Vector((0, 0, -1))))
    P.hand_pose('R', 14.3, {'point': 1})
    P.hand('R', 17.5, ('world', Vector((1.25, -1.72, 1.57)), Vector((-0.6, 0.75, 0.3)), Vector((0, 0, -1))))
    P.hand('R', 18.4, 'rest')
    P.hand_pose('R', 18.4, {'relaxed': 1})
    P.look_at(16.0, (0.0, 1.5, 1.7))
    P.expression(16.2, 'amazed')
    P.look_at(19.0, (0.0, 2.3, 1.0))
    # toca la consola
    st = Vector((1.6, -1.79, 1.1))
    P.look_at(21.4, st)
    P.expression(21.4, 'focus')
    P.hand('L', 21.0, 'rest')
    P.hand_pose('L', 21.0, {'relaxed': 1})
    P.hand('L', 21.9, ('world', st + Vector((0.08, -0.12, 0.08)), Vector((-0.2, 0.9, -0.4)), Vector((0, 0.3, -1))))
    P.hand_pose('L', 21.8, {'point': 1})
    P.hand('L', 22.4, ('world', st + Vector((0.06, -0.09, 0.045)), Vector((-0.2, 0.9, -0.4)), Vector((0, 0.3, -1))))
    P.hand('L', 23.2, ('world', st + Vector((-0.08, -0.06, 0.05)), Vector((-0.2, 0.9, -0.4)), Vector((0, 0.3, -1))))
    P.hand('L', 24.2, ('world', st + Vector((-0.08, -0.12, 0.12)), Vector((-0.2, 0.9, -0.4)), Vector((0, 0.3, -1))))
    P.hand('L', 25.2, 'rest')
    P.hand_pose('L', 25.4, {'relaxed': 1})
    P.lean.add(21.0, 0.0).add(21.9, 0.12).add(24.4, 0.12).add(25.2, 0.0)
    P.look_at(25.4, (-0.5, -6.0, 1.6))
    P.expression(25.6, 'smile')
    P.bake(1, sc.frame_end)
    # operarios de fondo
    rw, ow = cast.load('worker_a', 'opA')
    Aw = anim.Actor(rw)
    Pw = perform.Performer(Aw, pos=(-6.5, 1.15), yaw=math.pi)
    Pw.look_at(0.0, (-6.5, 0.0, 1.2))
    Pw.lean.add(0, 0.18)
    for k in range(12):
        t = 0.5 + k * 2.4
        Pw.hand('R', t, 'rest')
        Pw.hand('R', t + 0.8, ('world', Vector((-6.55, 0.35, PL.BELT_Z + 0.08)), Vector((0, -1, -0.6)), Vector((0, 0, -1))))
        Pw.hand_pose('R', t + 0.7, {'open': 1})
        Pw.hand_pose('R', t + 1.0, {'grip': 1})
        Pw.hand('R', t + 1.8, ('world', Vector((-7.1, 1.25, 1.05)), Vector((-0.5, 0.2, -0.8)), Vector((0, 0, -1))))
        Pw.hand_pose('R', t + 2.0, {'open': 1})
    Pw.bake(1, sc.frame_end)
    rb, ob_ = cast.load('worker_b', 'opB')
    Ab = anim.Actor(rb)
    Pb = perform.Performer(Ab, pos=(-14.0, 6.0), yaw=math.radians(90))
    Pb.walk(1.0, 16.0, [(-2.0, 6.2), (4.0, 6.6)], step=0.66)
    Pb.turn(17.0, 17.8, math.pi)
    Pb.bake(1, sc.frame_end)
    box_bin = PR.box('pick_bin', (0.6, 0.5, 0.5), (-7.2, 1.45, 0.25 + 0.55), col, principled('pickbin_m', '#2f7a4b', 0.5))

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
    lines = MG.dipole_lines(L=0.25, n=8, max_len=0.8, step=0.01, planes=3)
    fl, flm = MG.field_lines_object('sep_field', lines, mg, MG.CYAN, radius=0.004, strength=5.0)
    fl.location = (PL.MAG_X, 0.0, PL.XBELT_Z + 0.15)
    fl.scale = (1.6, 1.6, 1.6)
    MG.grow(fl, F(15.2), F(16.6), flm, f_out=F(21.5))
    MG.label('lbl_sep', 'SEPARADOR MAGNÉTICO DE BANDA', (PL.MAG_X, -0.3, PL.XBELT_Z + 0.4), (PL.MAG_X - 1.4, -1.0, PL.XBELT_Z + 0.75),
             cams['C3'], F(14.0), F(21.0), mg, size=0.09, color=MG.RED, sub='imán permanente + banda transversal')
    MG.label('lbl_steel', 'ACERO → separado', (PL.MAG_X, 0.3, PL.XBELT_Z - 0.05), (PL.MAG_X + 1.4, -0.9, PL.XBELT_Z + 0.35),
             cams['C3'], F(16.4), F(21.0), mg, size=0.08, color=MG.CYAN)
    MG.label('lbl_mix', 'RESIDUOS MEZCLADOS', (-4.0, 0.0, PL.BELT_Z + 0.1), (-3.6, -0.7, PL.BELT_Z + 0.6),
             cams['C2'], F(7.0), F(12.8), mg, size=0.07, color=MG.ORANGE, sub='acero · aluminio · plástico')
    MG.label('lbl_cont', 'Aluminio y plástico siguen en la cinta', (3.5, 0.0, PL.BELT_Z + 0.1), (4.2, -1.0, PL.BELT_Z + 0.9),
             cams['C4'], F(25.5), None, mg, size=0.08, color=MG.ORANGE)
    MG.arrow('arr_steel', (PL.MAG_X, 0.6, PL.XBELT_Z - 0.2), (PL.MAG_X, 2.0, PL.XBELT_Z - 0.2), mg, MG.CYAN, radius=0.025, f_in=F(22.0))
    MG.arrow('arr_rest', (1.0, 0.0, PL.BELT_Z + 0.35), (4.5, 0.0, PL.BELT_Z + 0.35), mg, MG.ORANGE, radius=0.025, f_in=F(24.5))
    for lid, t in (('E4_01', 0.8), ('E4_02', 6.6), ('E4_03', 13.4), ('E4_04', 21.2)):
        SL.narration(sc, lid, t)
    SL.save(sc, 'E4')


def cameras():
    cams = {}
    c = SL.CameraRig('C1', [(0.0, (-16.0, -9.0, 8.5), (-4.0, 0.0, 1.0), 24), (6.5, (-11.0, -7.5, 5.0), (-4.5, -1.0, 1.2), 26)])
    cams['C1'] = c.bake(1, F(6.8))
    c = SL.CameraRig('C2', [(6.5, (-6.2, -1.0, 1.55), (-3.0, 0.0, 1.2), 28), (13.0, (-4.2, -0.95, 1.5), (-1.0, 0.0, 1.25), 30)])
    cams['C2'] = c.bake(F(6.4), F(13.2))
    c = SL.CameraRig('C3', [(13.0, (-2.0, -1.3, 1.25), (0.0, 0.5, 1.55), 28), (21.0, (-1.7, -1.0, 1.2), (0.0, 0.9, 1.5), 30)])
    cams['C3'] = c.bake(F(12.9), F(21.2))
    c = SL.CameraRig('C4', [(21.0, (3.2, -3.6, 2.1), (1.2, 0.2, 1.2), 30), (31.0, (5.5, -5.5, 3.2), (0.8, 0.8, 1.0), 26)])
    cams['C4'] = c.bake(F(20.9), F(31.0))
    for t, k in ((0.0, 'C1'), (6.5, 'C2'), (13.0, 'C3'), (21.0, 'C4')):
        SL.cut(t, cams[k])
    return cams


if __name__ == '__main__':
    main()
