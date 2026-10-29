"""E4b — Polea magnética al final de la cinta: el acero se adhiere a la banda y cae aparte; el resto sale despedido."""
import math
import os
import random
import sys
import bpy
from mathutils import Vector, Matrix, Quaternion

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shotlib as SL
from shotlib import F
import cast, anim, perform, mograph as MG, sets_plant as PL, props as PR
from props import M, box, cyl
from anim import KeyBuffer
from util import principled
import shot_e4 as E4

DUR = 18.0
V = 1.8                      # velocidad de la banda en el tramo final (m/s)
R = 0.3                      # radio de la polea magnética
PC = Vector((PL.BELT_X1, 0.0, PL.BELT_Z - R))   # centro de la polea
FAR_BIN = Vector((12.15, 0.0, 0.0))   # empieza donde realmente caen los no magnéticos (tiro horizontal desde la polea)
NEAR_BIN = Vector((10.95, 0.0, 0.0))


def main():
    sc = SL.new_scene('E4b', DUR)
    plant = PL.build_plant(DUR)
    col = bpy.data.collections.new('Pulley')
    sc.collection.children.link(col)
    for n in ('end_bin',):
        ob = bpy.data.objects.get(n)
        if ob:
            ob.hide_render = True
    # banda más rápida en este tramo
    plant['belt'].data.materials.clear()
    plant['belt'].data.materials.append(PL.belt_material('belt_fast', V, DUR + 2, 'X'))
    # polea magnética (roja) y tambor
    pul = cyl('mag_pulley', R, 1.1, Vector((PC.x, -0.55, PC.z)), col, principled('pulley_m', '#b8262c', 0.35, coat=0.3), seg=40,
              rot=(-math.pi / 2, 0, 0))
    for y in (-0.56, 0.56):
        cyl('pulley_cap%d' % (y > 0), R * 0.4, 0.04, Vector((PC.x, y - 0.02, PC.z)), col, M('steel'), rot=(-math.pi / 2, 0, 0))
    kb = KeyBuffer(pul)
    for f in (1, int(DUR * 30) + 1):
        kb.key('rotation_euler', 1, f, (f - 1) / 30 * V / R)
    kb.write()
    for fc in SL._fcurves(pul):
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    # banda envolviendo la polea (media caña oscura)
    import bmesh
    me = bpy.data.meshes.new('belt_wrap')
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=40, radius1=R + 0.012, radius2=R + 0.012, depth=1.0)
    bm.to_mesh(me)
    bm.free()
    wrap = bpy.data.objects.new('belt_wrap', me)
    col.objects.link(wrap)
    wrap.location = PC
    wrap.rotation_euler = (math.pi / 2, 0, 0)
    me.materials.append(M('belt'))
    # contenedores y separador
    cont_g = PR.paint_mat('bin_nm', '#3a8a55', 0.5, 0.2)
    cont_b = PR.paint_mat('bin_m', '#2b5f97', 0.5, 0.2)
    for c, (sx, sy, h), m in ((FAR_BIN, (1.4, 1.6, 0.7), cont_g), (NEAR_BIN, (0.9, 1.4, 0.5), cont_b)):
        for dx, dy, ax, ay in ((0, -sy / 2, sx, 0.05), (0, sy / 2, sx, 0.05), (-sx / 2, 0, 0.05, sy), (sx / 2, 0, 0.05, sy)):
            box('bin_%d_%d_%d' % (int(c.x * 10), int(dx * 10), int(dy * 10)), (ax, ay, h), c + Vector((dx, dy, h / 2)), col, m)
        box('binfloor_%d' % int(c.x * 10), (sx, sy, 0.04), c + Vector((0, 0, 0.02)), col, m)
    # divisor bajo entre los dos contenedores: el acero cae antes, lo demás pasa por encima
    box('splitter', (0.03, 1.4, 0.74), Vector((11.41, 0, 0.37)), col, M('brushed'))
    # carteles en el frente de cada contenedor (no delante de la polea)
    PL.sign('sign_nm', 'NO MAGNÉTICOS', FAR_BIN + Vector((0, -0.84, 0.42)), col, 0.0, 0.14, '#3a8a55')
    PL.sign('sign_m', 'ACERO', NEAR_BIN + Vector((0, -0.74, 0.3)), col, 0.0, 0.12, '#2b5f97')
    PL.railing('rail_end', (8, -1.2, 0), (13.5, -1.2, 0), col)
    # ---- residuos: no magnéticos salen despedidos; acero gira con la polea y cae atrás
    rnd = random.Random(44)
    steel_me = E4.can_mesh('steelcan_s', 0.03, 0.08)
    alu_me = E4.can_mesh('alucan_s', 0.033, 0.12)
    bot_me = E4.bottle_mesh('bottle_s')
    mats = {'steel': [E4.label_mat('st_lb%d' % i, c, '#9aa0a6') for i, c in enumerate(('#c0392b', '#2e86c1'))],
            'alu': [E4.label_mat('al_lb%d' % i, c, '#d9dde1') for i, c in enumerate(('#e74c3c', '#f1c40f'))],
            'plastic': [principled('pl_s%d' % i, c, 0.15, alpha=0.7) for i, c in enumerate(('#7fc8f8', '#8ee08e'))]}
    x = PL.BELT_X1 - V * (DUR + 1)
    i = 0
    nF = int(DUR * 30) + 1
    while x < PL.BELT_X1 - 0.2:
        kind = rnd.choices(['steel', 'alu', 'plastic'], weights=[3, 4, 3])[0]
        mesh = {'steel': steel_me, 'alu': alu_me, 'plastic': bot_me}[kind].copy()
        mesh.materials.append(rnd.choice(mats[kind]))
        ob = bpy.data.objects.new('pu_it%03d' % i, mesh)
        col.objects.link(ob)
        ob.rotation_mode = 'QUATERNION'
        y = rnd.uniform(-0.35, 0.35)
        zoff = {'steel': 0.03, 'alu': 0.033, 'plastic': 0.04}[kind]
        q0 = Quaternion((0, 0, 1), rnd.uniform(0, 6.28)) @ Quaternion((1, 0, 0), math.pi / 2)
        kbi = KeyBuffer(ob)
        prev = None
        land = None
        for f in range(1, nF + 1):
            t = (f - 1) / 30
            xb = x + V * t
            q = q0
            if xb <= PL.BELT_X1:
                p = Vector((xb, y, PL.BELT_Z + zoff))
            else:
                s = xb - PL.BELT_X1            # distancia recorrida desde el punto de tangencia
                if kind == 'steel':
                    th = s / (R + zoff)          # ángulo recorrido alrededor de la polea
                    th_rel = math.radians(205)
                    if th < th_rel:
                        p = PC + Vector((math.sin(th) * (R + zoff), y, math.cos(th) * (R + zoff)))
                        q = Quaternion((0, 1, 0), th) @ q0
                    else:
                        tf = (s - th_rel * (R + zoff)) / V
                        p0 = PC + Vector((math.sin(th_rel) * (R + zoff), y, math.cos(th_rel) * (R + zoff)))
                        if land is None:
                            land = Vector((min(p0.x + rnd.uniform(-0.12, 0.08), NEAR_BIN.x + 0.3), y * 0.85, 0.08 + rnd.uniform(0, 0.1)))
                        # se despega de la polea y cae casi vertical al contenedor de acero (sin deslizarse en el aire)
                        p = p0.lerp(Vector((land.x, land.y, p0.z)), min(tf / 0.35, 1))
                        p.z = max(land.z, p0.z - 4.9 * tf * tf)
                        q = Quaternion((0, 1, 0), th_rel) @ q0 @ Quaternion((1, 0, 0), tf * 6)
                else:
                    # tiro horizontal: sale con la velocidad de la banda y cae por gravedad (sin atravesar paredes)
                    tf = s / V
                    z0 = PL.BELT_Z + zoff
                    if land is None:
                        lz = 0.06 + rnd.uniform(0, 0.16)
                        t_land = math.sqrt(max(z0 - lz, 0.0) / 4.9)
                        lx = min(PL.BELT_X1 + V * t_land, FAR_BIN.x + 0.6)
                        land = Vector((lx, y * 0.9, lz))
                        t_land = (lx - PL.BELT_X1) / V
                    if tf < t_land:
                        p = Vector((PL.BELT_X1 + V * tf, y, max(land.z, z0 - 4.9 * tf * tf)))
                    else:
                        p = land.copy()
                    q = q0 @ Quaternion((0, 1, 0), min(tf, t_land) * 4)
            if prev is not None and prev.dot(q) < 0:
                q = -q
            prev = q
            kbi.key_vec('location', f, p)
            kbi.key_vec('rotation_quaternion', f, q)
        kbi.write()
        x += rnd.uniform(0.35, 0.65)
        i += 1
    # acumulado previo en los contenedores
    for k in range(25):
        m = (steel_me if k % 2 else alu_me) if k < 12 else bot_me
        ob = bpy.data.objects.new('pre%d' % k, m.copy())
        col.objects.link(ob)
        ob.data.materials.append(rnd.choice(mats['steel'] if k % 2 and k < 12 else mats['alu']))
        c = NEAR_BIN if (k % 2 and k < 12) else FAR_BIN
        ob.location = c + Vector((rnd.uniform(-0.3, 0.3), rnd.uniform(-0.5, 0.5), 0.06 + rnd.uniform(0, 0.08)))
        ob.rotation_euler = (rnd.uniform(0, 3), rnd.uniform(0, 3), rnd.uniform(0, 3))
    # ---- científico con casco y chaleco, en el pasillo seguro
    rig, objs = cast.load('scientist', safety=True)
    A = anim.Actor(rig)
    P = perform.Performer(A, pos=(8.6, -1.8), yaw=math.radians(90))
    P.walk(0.2, 2.2, [(9.9, -1.8)], step=0.65)
    P.face_dir(2.5, 3.1, (11.0, 0.0))
    P.look_at(0.0, 'fwd')
    P.look_at(2.4, PC + Vector((0, 0, 0.3)))
    P.expression(2.8, 'curious')
    P.hand('R', 3.8, 'rest')
    P.hand_pose('R', 3.8, {'relaxed': 1})
    P.hand('R', 4.6, ('world', Vector((10.15, -1.45, 1.52)), Vector((0.5, 0.75, -0.15)), Vector((0, 0, -1))))
    P.hand_pose('R', 4.6, {'point': 1})
    P.hand('R', 7.2, ('world', Vector((10.15, -1.45, 1.5)), Vector((0.45, 0.8, -0.2)), Vector((0, 0, -1))))
    P.hand('R', 8.0, 'rest')
    P.hand_pose('R', 8.0, {'relaxed': 1})
    P.look_at(8.5, FAR_BIN + Vector((0, 0, 0.6)))
    # los dos contenedores quedan a su derecha: señala con la mano derecha (sin cruzar el cuerpo)
    P.hand('R', 9.0, 'rest')
    P.hand('R', 9.8, ('world', Vector((10.25, -1.5, 1.45)), Vector((0.9, 0.45, -0.2)), Vector((0, 0, -1))))
    P.hand_pose('R', 9.8, {'point': 1})
    P.look_at(11.0, NEAR_BIN + Vector((0, 0, 0.4)))
    P.hand('R', 11.4, ('world', Vector((10.2, -1.5, 1.4)), Vector((0.35, 0.85, -0.4)), Vector((0, 0, -1))))
    P.hand('R', 13.0, 'rest')
    P.hand_pose('R', 13.0, {'relaxed': 1})
    P.face_dir(13.4, 14.1, (11.6, -4.2))
    P.look_at(14.0, (11.6, -4.2, 1.75))
    P.expression(14.2, 'smile')
    P.bake(1, nF - 1)
    # ---- cámaras
    cams = {}
    # corrida a la derecha: el brazo del científico (a la izquierda) ya no entra por el borde del cuadro
    c = SL.CameraRig('C1', [(0.0, (11.75, -3.6, 2.6), (11.55, 0.0, 0.8), 26), (7.0, (12.05, -3.3, 2.45), (11.65, 0.0, 0.8), 28)])
    cams['C1'] = c.bake(1, F(7.2))
    c = SL.CameraRig('C2', [(7.0, (11.95, -2.75, 3.25), (11.85, 0.0, 0.62), 28), (14.0, (12.15, -2.55, 3.15), (11.85, 0.0, 0.62), 30)])
    cams['C2'] = c.bake(F(6.9), F(14.2))
    c = SL.CameraRig('C3', [(14.0, (11.6, -4.2, 1.75), (10.2, -1.6, 1.45), 32), (18.0, (11.9, -4.6, 1.85), (10.4, -1.4, 1.4), 30)])
    cams['C3'] = c.bake(F(13.9), F(DUR))
    SL.cut(0.0, cams['C1'])
    SL.cut(7.0, cams['C2'])
    SL.cut(14.0, cams['C3'])
    # ---- gráficos: campo de la polea, trayectorias y etiquetas
    mg = bpy.data.collections.new('MoGraph')
    sc.collection.children.link(mg)
    arcs = []
    for k in range(9):
        a0 = math.radians(95 + k * 18)
        a1 = a0 + math.radians(14)
        rr = 0.06 + 0.02 * (k % 3)
        p0 = PC + Vector((math.sin(a0) * R, 0, math.cos(a0) * R))
        p1 = PC + Vector((math.sin(a1) * R, 0, math.cos(a1) * R))
        mid = (p0 + p1) / 2
        nrm = (mid - PC).normalized()
        pts = []
        for j in range(17):
            u = j / 16
            b = p0.lerp(p1, u) + nrm * rr * math.sin(math.pi * u)
            pts.append(b)
        for yy in (-0.3, 0.0, 0.3):
            arcs.append([Vector((q.x, yy, q.z)) for q in pts])
    fl, flm = MG.field_lines_object('pulley_field', arcs, mg, MG.CYAN, radius=0.004, strength=5.0)
    MG.grow(fl, F(7.4), F(8.6), flm)
    MG.label('lbl_pulley', 'POLEA MAGNÉTICA', PC + Vector((0, -0.55, 0.1)), PC + Vector((-0.6, -0.9, 0.75)), cams['C1'], F(1.6), F(7.0), mg,
             size=0.09, color=MG.RED, sub='al final de la cinta')
    MG.label('lbl_nm', 'NO MAGNÉTICOS', FAR_BIN + Vector((-0.2, 0, 0.5)), Vector((12.3, -0.45, 1.75)),
             cams['C2'], F(8.0), F(14.0), mg, size=0.09, color=MG.ORANGE, sub='salen despedidos', flat=True)
    MG.label('lbl_m', 'ACERO', NEAR_BIN + Vector((0.2, 0, 0.5)), Vector((10.9, -0.35, 1.8)),
             cams['C2'], F(9.6), F(14.0), mg, size=0.09, color=MG.CYAN, sub='sigue la banda y cae atrás', flat=True)
    MG.arrow('arr_nm', PC + Vector((0.35, -0.6, 0.45)), Vector((11.95, -0.6, 0.85)), mg, MG.ORANGE, radius=0.015, f_in=F(8.2), f_out=F(14.0))
    MG.arrow('arr_m', PC + Vector((0.42, -0.6, -0.1)), NEAR_BIN + Vector((0.2, -0.6, 0.6)), mg, MG.CYAN, radius=0.015, f_in=F(9.8), f_out=F(14.0))
    for lid, t in (('E4b_01', 0.6), ('E4b_02', 7.0)):
        SL.narration(sc, lid, t)
    SL.save(sc, 'E4b')


if __name__ == '__main__':
    main()
