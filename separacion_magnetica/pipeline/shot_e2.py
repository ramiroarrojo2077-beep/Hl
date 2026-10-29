"""E2 — Experimento de laboratorio: separación de limaduras de hierro y arena con un imán enfundado."""
import math
import random
import sys
import os
import numpy as np
import bpy
from mathutils import Vector, Matrix, Quaternion, Euler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shotlib as SL
from shotlib import F
import cast, anim, perform, mograph as MG, sets_lab as LAB
from util import ease, ease_io, smoothstep
from anim import KeyBuffer

DUR = 45.0
# cámara lenta (tiempo real 20.8–23.8 s a 0.45x)
SA, SB, SK = 20.8, 23.8, 0.45


def story(f):
    r = (f - 1) / SL.FPS
    if r < SA:
        return r
    if r < SB:
        return SA + (r - SA) * SK
    return SA + (SB - SA) * SK + (r - SB)


def frame_of_story(s):
    for f in range(1, int(DUR * 30) + 2):
        if story(f) >= s:
            return f
    return int(DUR * 30)


def main():
    sc = SL.new_scene('E2', DUR)
    lab = LAB.build_lab('Lab', experiment=True, corridor=False)
    ex = lab['exp']
    rig, objs = cast.load('scientist')
    A = anim.Actor(rig)
    x0, y0 = LAB.SCI_SPOT
    P = perform.Performer(A, pos=(x0, y0), yaw=0.0)
    P.benches.append(LAB.MAIN_BENCH)
    mag, sleeve = ex['magnet'], ex['sleeve']
    mag_base0 = mag.location.copy()
    DISH, TRAY = LAB.DISH, LAB.TRAY
    sand_top = DISH.z + LAB.SAND_H + 0.004
    hintR = Vector((0.45, -1.0, 0.0))
    hintL = Vector((-0.45, -1.0, 0.0))

    def handR(base):
        return A.grasp_frame('R', Vector(base) + Vector((0, 0, LAB.HANDLE_C)), (0, 0, 1), hintR, radius=0.0095)

    def handL_sleeve(base):
        return A.grasp_frame('L', Vector(base) + Vector((0, 0, LAB.SLEEVE_GRIP)), (0, 0, 1), hintL, radius=0.0145)

    def W(fr):
        return ('world',) + tuple(fr)

    # ---------------- presentación de materiales (0–11 s)
    P.look_at(0.0, (0.3, -2.5, 1.5))
    P.expression(0.0, 'smile_soft')
    P.look_at(0.9, DISH + Vector((0, 0, 0.03)))
    P.expression(1.5, 'explain')
    # mano izquierda: toma el frasquito con arena, lo muestra y lo deja en su lugar
    bottle = ex['sand_bottle']
    b0 = bottle.location.copy()
    hintB = Vector((-0.6, -1.0, 0.0))

    def gL(base):
        return W(A.grasp_frame('L', Vector(base) + Vector((0, 0, 0.048)), (0, 0, 1), hintB, radius=0.024))

    show = Vector((0.32, 0.32, LAB.BENCH_TOP + 0.36))
    P.hand('L', 0.6, 'rest')
    P.hand_pose('L', 0.6, {'relaxed': 1})
    P.hand('L', 1.5, gL(b0 + Vector((0.0, -0.02, 0.07))))
    P.hand_pose('L', 1.4, {'open': 1})
    P.hand('L', 2.0, gL(b0))
    P.hand('L', 2.3, gL(b0))
    P.hand_pose('L', 2.1, {'grip': 1})
    P.attach(bottle, 'L', 2.15, 5.35)
    P.hand('L', 3.0, gL(show))
    P.hand('L', 4.4, gL(show + Vector((0.015, -0.01, 0.01))))
    P.hand('L', 5.2, gL(b0))
    P.hand('L', 5.45, gL(b0))
    P.hand_pose('L', 5.35, {'open': 1})
    P.hand('L', 5.8, gL(b0 + Vector((0.0, -0.02, 0.08))))
    P.hand('L', 6.4, 'rest')
    P.hand_pose('L', 6.4, {'relaxed': 1})
    # para alcanzar la mesada se inclina desde la cintura (piernas rectas)
    P.lean.add(1.2, 0.0).add(1.8, 0.3).add(2.4, 0.3).add(2.9, 0.04).add(4.7, 0.04).add(5.15, 0.3).add(5.6, 0.3).add(6.1, 0.0)
    P.look_at(1.2, b0 + Vector((0, 0, 0.04)))
    P.look_at(2.9, show + Vector((0, 0, 0.03)))
    P.look_at(3.7, (0.3, -2.5, 1.5))
    P.look_at(4.8, b0 + Vector((0, 0, 0.04)))
    P.look_at(5.6, DISH + Vector((0, 0, 0.03)))
    # mano derecha señala las limaduras
    P.hand('R', 5.8, 'rest')
    P.hand_pose('R', 5.8, {'relaxed': 1})
    # señala las limaduras desde arriba: la punta del índice queda ~15 cm sobre la arena
    pt = DISH + Vector((-0.13, 0.07, 0.36))
    pdir = (DISH + Vector((0, -0.02, 0.03)) - pt).normalized()
    P.hand('R', 6.8, W((pt, pdir, Vector((0.3, 0, -1)))))
    P.hand_pose('R', 6.8, {'point': 1})
    P.hand('R', 9.6, W((pt + Vector((0.01, 0, 0.01)), pdir, Vector((0.3, 0, -1)))))
    P.look_at(8.6, (0.4, -2.6, 1.55))
    P.expression(8.8, 'smile')
    P.look_at(10.2, LAB.STAND + Vector((0, 0, 0.12)))
    # ---------------- tomar el imán (11–17)
    pre = handR(mag_base0 + Vector((-0.07, -0.05, 0.03)))
    P.hand('R', 10.4, 'rest')
    P.hand_pose('R', 10.4, {'relaxed': 1})
    P.hand('R', 11.4, W(pre))
    P.hand_pose('R', 11.3, {'open': 1})
    P.hand('R', 11.9, W(handR(mag_base0)))
    P.hand_pose('R', 11.9, {'open': 1})
    P.hand_pose('R', 12.2, {'grip': 1})
    P.lean.add(10.4, 0.0).add(11.6, 0.2).add(13.2, 0.06)
    lifted = Vector((-0.12, 0.30, 1.16))
    P.hand('R', 12.3, W(handR(mag_base0)))
    P.hand('R', 13.4, W(handR(lifted)))
    P.hand('R', 16.4, W(handR(lifted + Vector((0.01, 0.0, 0.01)))))
    P.attach(mag, 'R', 12.25, 999)
    P.attach(sleeve, 'R', 12.25, 26.3)
    P.look_at(12.8, lifted + Vector((0, 0, 0.1)))
    P.expression(13.0, 'curious')
    P.look_at(15.0, (0.4, -2.6, 1.55))
    P.expression(15.2, 'explain')
    P.look_at(16.4, DISH)
    # ---------------- acercar a la mezcla (16.8–22.6, cámara lenta incluida)
    above = DISH + Vector((0, 0, 0.16))
    P.hand('R', 18.0, W(handR(above)))
    low_z = sand_top + 0.016
    P.hand('R', 19.2, W(handR(Vector((DISH.x, DISH.y, low_z)))))
    # inclinarse desde la cintura con las piernas rectas (sin agacharse: las rodillas no se doblan)
    P.lean.add(16.6, 0.08).add(18.6, 0.34).add(23.0, 0.34).add(24.6, 0.12)
    P.expression(18.6, 'focus')
    # barrido circular sobre la mezcla
    sweep_t0, sweep_t1 = 19.2, 22.4
    for k in range(1, 9):
        u = k / 8
        a = -math.pi / 2 + 2 * math.pi * u
        r = 0.035 * math.sin(math.pi * min(u * 1.2, 1.0))
        p = Vector((DISH.x + r * math.cos(a), DISH.y + r * math.sin(a), low_z + 0.002 * math.sin(a * 2)))
        P.hand('R', sweep_t0 + (sweep_t1 - sweep_t0) * u, W(handR(p)))
    lift2 = DISH + Vector((-0.02, 0, 0.19))
    P.hand('R', 23.6, W(handR(lift2)))
    P.look_at(23.0, lift2 + Vector((0, 0, 0.05)))
    P.expression(23.0, 'amazed')
    # ---------------- sobre la bandeja: correrse, sostener la funda, retirar el imán (23.8–29)
    P.side_step(23.8, 24.9, (x0 - 0.17, y0))
    over_tray = TRAY + Vector((0, 0, 0.075))
    P.hand('R', 25.0, W(handR(over_tray)))
    P.look_at(24.6, TRAY)
    P.expression(24.8, 'focus')
    P.hand('L', 24.9, 'rest')
    P.hand_pose('L', 25.1, {'relaxed': 1})
    preL = handL_sleeve(over_tray + Vector((0.06, -0.05, 0.0)))
    P.hand('L', 25.7, W(preL))
    P.hand_pose('L', 25.6, {'open': 1})
    P.hand('L', 26.2, W(handL_sleeve(over_tray)))
    P.hand_pose('L', 26.2, {'open': 1})
    P.hand_pose('L', 26.45, {'grip': 1})
    P.hand('L', 40.0, W(handL_sleeve(over_tray)))
    P.attach(sleeve, 'L', 26.35, 999)
    P.hand('R', 26.6, W(handR(over_tray)))
    pulled = over_tray + Vector((0, 0, 0.165))
    P.hand('R', 27.9, W(handR(pulled)))
    P.hand('R', 33.0, W(handR(pulled + Vector((0.0, 0.01, -0.01)))))
    P.lean.add(25.0, 0.18).add(33.0, 0.14)
    P.look_at(28.4, TRAY + Vector((0, 0, 0.02)))
    P.expression(28.6, 'smile_soft')
    P.look_at(31.0, (0.3, -2.6, 1.5))
    P.expression(31.2, 'smile')
    # resultado
    P.look_at(35.5, DISH)
    P.look_at(37.2, (0.3, -2.6, 1.5))
    P.expression(37.4, 'smile')
    P.hand('R', 36.5, W(handR(pulled + Vector((0.03, 0.02, -0.05)))))
    P.hand('L', 36.5, W(handL_sleeve(over_tray + Vector((0.0, 0.0, 0.0)))))
    nF = sc.frame_end
    cache = P.bake(1, nF, timemap=story)

    # ---------------- simulación de limaduras --------------------------------
    sim_filings(ex, mag, sleeve, nF, sand_top)

    # ---------------- motion graphics ---------------------------------------
    col = bpy.data.collections.new('MoGraph')
    sc.collection.children.link(col)
    cams = cameras(sc, P, ex)
    fs = frame_of_story
    MG.label('lbl_sand', 'ARENA', DISH + Vector((-0.06, -0.04, 0.03)), DISH + Vector((-0.38, -0.3, 0.3)), cams['C1'],
             fs(1.4), fs(10.8), col, size=0.05, color=MG.ORANGE, sub='granos de cuarzo · no magnética')
    MG.label('lbl_iron', 'LIMADURAS DE HIERRO', DISH + Vector((0.0, -0.03, 0.03)), DISH + Vector((-0.07, -0.12, 0.085)), cams['C2'],
             fs(6.6), fs(10.8), col, size=0.011, color=MG.CYAN, sub='Fe · ferromagnéticas')
    MG.label('lbl_mag', 'IMÁN', lifted + Vector((0, 0, 0.06)), lifted + Vector((-0.28, -0.2, 0.14)), cams['C3'],
             fs(13.8), fs(17.0), col, size=0.04, color=MG.RED, sub='dentro de una funda plástica')
    # líneas de campo alrededor del imán (siguen al imán)
    lines = MG.dipole_lines(L=LAB.MAG_LEN, n=9, max_len=0.16, step=0.002, planes=4)
    fl, flm = MG.field_lines_object('field_e2', lines, col, MG.CYAN, radius=0.0006, strength=3.0, parent=mag)
    fl.location = (0, 0, LAB.MAG_LEN / 2)
    MG.grow(fl, fs(17.0), fs(18.4), flm, f_out=fs(27.6))
    parts, pm = MG.flow_particles('fp_e2', lines, col, count=36, color='#bff4ff', size=0.0012, f0=fs(17.4), f1=frame_of_story(27.6), speed=0.06, parent=mag)
    MG.key_fade(pm, fs(17.4), fs(27.6))
    for ob in parts:
        ob.location = ob.location  # local al imán
    MG.label('lbl_field', 'CAMPO MAGNÉTICO', DISH + Vector((0.05, 0, 0.06)), DISH + Vector((0.2, -0.1, 0.17)), cams['C4'],
             frame_of_story(18.9), frame_of_story(22.3), col, size=0.018, color=MG.CYAN, sub='atrae al hierro, no a la arena')
    # flechas de fuerza hacia la punta del imán durante la cámara lenta
    tipw = Vector((DISH.x, DISH.y, sand_top + 0.012))
    for k, d in enumerate(((0.06, -0.03), (-0.055, -0.025), (0.0, -0.065))):
        st = Vector((DISH.x + d[0], DISH.y + d[1], sand_top + 0.003))
        en = st.lerp(tipw, 0.6)
        MG.arrow('force%d' % k, st, en, col, MG.ORANGE, radius=0.0012, f_in=F(SA + 0.2 + k * 0.15), f_out=F(SB - 0.4))
    MG.label('lbl_frac_nm', 'FRACCIÓN NO MAGNÉTICA', DISH + Vector((0.0, 0.0, 0.03)), DISH + Vector((0.42, -0.35, 0.16)), cams['C7'],
             fs(37.0), None, col, size=0.045, color=MG.ORANGE, sub='arena')
    MG.label('lbl_frac_m', 'FRACCIÓN MAGNÉTICA', TRAY + Vector((0.0, 0.0, 0.01)), TRAY + Vector((-0.42, -0.35, 0.16)), cams['C7'],
             fs(37.4), None, col, size=0.045, color=MG.CYAN, sub='hierro')
    # narración (tiempo real)
    for lid, t in (('E2_01', 0.5), ('E2_02', 6.2), ('E2_03', 11.2), ('E2_04', 17.6), ('E2_05', 24.4), ('E2_06', 27.4), ('E2_07', 38.4)):
        SL.narration(sc, lid, t)
    SL.save(sc, 'E2')


def cameras(sc, P, ex):
    DISH, TRAY = LAB.DISH, LAB.TRAY
    cams = {}
    c = SL.CameraRig('C1', [(0.0, (-1.2, -1.9, 1.55), (0.0, 0.5, 1.12), 32), (6.0, (-0.9, -1.55, 1.45), (0.02, 0.45, 1.1), 34)])
    cams['C1'] = c.bake(1, F(6.2))
    c = SL.CameraRig('C2', [(6.0, DISH + Vector((0.2, -0.3, 0.12)), DISH + Vector((0, 0, 0.025)), 55),
                             (11.0, DISH + Vector((0.13, -0.24, 0.08)), DISH + Vector((0.0, 0, 0.025)), 62)], fstop=2.8)
    cams['C2'] = c.bake(F(5.9), F(11.2))
    c = SL.CameraRig('C3', [(11.0, (-1.25, -1.15, 1.45), (-0.22, 0.5, 1.22), 32), (17.5, (-1.1, -1.0, 1.45), (-0.12, 0.5, 1.25), 34)])
    cams['C3'] = c.bake(F(10.9), F(17.7))
    c = SL.CameraRig('C4', [(17.5, DISH + Vector((0.32, -0.42, 0.2)), DISH + Vector((0, 0, 0.06)), 45),
                             (24.2, DISH + Vector((0.2, -0.33, 0.1)), DISH + Vector((0, 0, 0.04)), 52)], fstop=4.0)
    cams['C4'] = c.bake(F(17.4), F(24.4))
    c = SL.CameraRig('C5', [(24.2, DISH + Vector((0.1, -0.28, 0.14)), DISH + Vector((0, 0, 0.02)), 55),
                             (27.0, DISH + Vector((0.06, -0.24, 0.12)), DISH + Vector((0, 0, 0.02)), 58)], fstop=4.0)
    cams['C5'] = c.bake(F(24.1), F(27.2))
    c = SL.CameraRig('C6', [(27.0, TRAY + Vector((-0.45, -0.6, 0.35)), TRAY + Vector((0.02, 0.05, 0.12)), 40),
                             (37.5, TRAY + Vector((-0.38, -0.5, 0.3)), TRAY + Vector((0.02, 0.05, 0.12)), 42)])
    cams['C6'] = c.bake(F(26.9), F(37.7))
    c = SL.CameraRig('C7', [(37.5, (0.15, -1.9, 1.5), (-0.03, 0.45, 1.12), 34), (45.0, (0.3, -2.4, 1.6), (-0.03, 0.45, 1.15), 32)])
    cams['C7'] = c.bake(F(37.4), F(45.0))
    for t, k in ((0.0, 'C1'), (6.0, 'C2'), (11.0, 'C3'), (17.5, 'C4'), (24.2, 'C5'), (27.0, 'C6'), (37.5, 'C7')):
        SL.cut(t, cams[k])
    return cams


def sim_filings(ex, mag, sleeve, nF, sand_top):
    """Simulación cinemática de las limaduras: atracción, adhesión a la funda, caída en la bandeja."""
    rnd = random.Random(11)
    sc = bpy.context.scene
    filings = ex['filings']
    # matrices por frame del imán y la funda
    Mm, Ms = {}, {}
    for f in range(1, nF + 1):
        sc.frame_set(f)
        Mm[f] = mag.matrix_world.copy()
        Ms[f] = sleeve.matrix_world.copy()
    TRAY = LAB.TRAY
    tray_floor = TRAY.z + 0.004
    landed = []
    for i, ob in enumerate(filings):
        p0 = ob.matrix_world.copy()
        cap_r = rnd.uniform(0.045, 0.07)
        # punto de adhesión en coordenadas locales de la funda: casquete inferior hasta 2.5 cm de altura
        ang = rnd.uniform(0, 2 * math.pi)
        hz = rnd.random() ** 1.6 * 0.026 - 0.004
        rad = 0.0145 if hz > 0.0 else 0.0145 * math.sqrt(max(0.0, 1 - (hz / 0.006) ** 2))
        bristle = rnd.uniform(0.0, 0.006) * (1 - min(hz / 0.03, 1)) ** 2
        local_pt = Vector((math.cos(ang) * (rad + 0.0015 + bristle), math.sin(ang) * (rad + 0.0015 + bristle), hz - bristle * 0.6))
        fdir = Vector((math.cos(ang) * 0.6, math.sin(ang) * 0.6, -0.8 if hz < 0.006 else -0.2)).normalized()
        local_rot = Vector((0, 0, 1)).rotation_difference(fdir) @ Quaternion((0, 0, 1), rnd.uniform(0, 6.28))
        local_M = Matrix.Translation(local_pt) @ local_rot.to_matrix().to_4x4()
        kb = KeyBuffer(ob)
        ob.rotation_mode = 'QUATERNION'
        state = 'rest'
        f_cap = None
        f_rel = None
        rel_start = None
        fly = int(rnd.uniform(4, 8))
        fall_v = None
        land = None
        prev_q = None
        for f in range(1, nF + 1):
            tip = (Ms[f] @ Vector((0, 0, -0.004)))
            if state == 'rest':
                d = (tip - p0.translation).length
                s = story(f)
                if (d < cap_r and tip.z < sand_top + 0.05) or (s > 22.3 and s < 22.5):
                    state = 'fly'
                    f_cap = f
                    # vuelo continuo: dura más cuanto más lejos está (antes las lejanas "saltaban" en 4 cuadros)
                    fly = int(min(22, max(fly, 5 + d * 180)))
                M = p0
            if state == 'fly':
                u = (f - f_cap) / fly
                target = Ms[f] @ local_M
                if u >= 1:
                    state = 'stuck'
                    M = target
                else:
                    ue = u * u
                    loc = p0.translation.lerp(target.translation, ue)
                    loc.z += 0.006 * math.sin(math.pi * u)
                    q = p0.to_quaternion().slerp(target.to_quaternion(), min(1, u * 1.5))
                    M = Matrix.Translation(loc) @ q.to_matrix().to_4x4()
            if state == 'stuck':
                M = Ms[f] @ local_M
                # suelta cuando la base del imán sube > 3 cm respecto de la funda
                rel = Ms[f].inverted() @ Mm[f].translation
                if rel.z > 0.03 + rnd.random() * 0.0:
                    if f_rel is None:
                        f_rel = f + int(rnd.uniform(0, 7))
                    if f >= f_rel:
                        state = 'fall'
                        rel_start = M.copy()
                        fall_v = Vector((rnd.uniform(-0.05, 0.05), rnd.uniform(-0.05, 0.05), 0.0))
                        spin = Vector((rnd.uniform(-8, 8), rnd.uniform(-8, 8), rnd.uniform(-8, 8)))
                        tf = 0.0
            if state == 'fall':
                tf = (f - f_rel) / 30.0
                start = rel_start.translation
                loc = start + fall_v * tf + Vector((0, 0, -0.5 * 9.81 * tf * tf))
                # pila en la bandeja
                if land is None:
                    dx = rnd.gauss(0, 0.012)
                    dy = rnd.gauss(0, 0.012)
                    pile_h = 0.0025 * math.exp(-(dx * dx + dy * dy) / (2 * 0.012 ** 2))
                    land = Vector((start.x + dx * 0.3 + fall_v.x * 0.15, start.y + dy * 0.3 + fall_v.y * 0.15,
                                   tray_floor + 0.0007 + pile_h * rnd.random()))
                if loc.z <= land.z:
                    state = 'landed'
                    lq = Quaternion((0, 0, 1), rnd.uniform(0, 6.28)) @ Quaternion((1, 0, 0), math.pi / 2 + rnd.uniform(-0.2, 0.2))
                    land_M = Matrix.Translation(land) @ lq.to_matrix().to_4x4()
                    M = land_M
                else:
                    loc.x = start.x + (land.x - start.x) * min(1, tf / 0.18)
                    loc.y = start.y + (land.y - start.y) * min(1, tf / 0.18)
                    q = rel_start.to_quaternion() @ Quaternion(spin.normalized(), spin.length * tf)
                    M = Matrix.Translation(loc) @ q.to_matrix().to_4x4()
            if state == 'landed':
                M = land_M
            loc, q, scl = M.decompose()
            if prev_q is not None and prev_q.dot(q) < 0:
                q.negate()
            prev_q = q
            if state in ('rest', 'landed') and f not in (1, nF) and f % 10:
                continue
            kb.key_vec('location', f, loc)
            kb.key_vec('rotation_quaternion', f, q)
        kb.write()


if __name__ == '__main__':
    main()
