"""E1b — Pasillo -> laboratorio -> presentación del tema y título 3D."""
import math
import os
import sys
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import shotlib as SL
from shotlib import F
import cast, anim, perform, mograph as MG, sets_lab as LAB

DUR = 25.0


def main():
    sc = SL.new_scene('E1b', DUR)
    lab = LAB.build_lab('Lab', experiment=True, corridor=True)
    rig, objs = cast.load('scientist')
    A = anim.Actor(rig)
    sx, sy = LAB.SCI_SPOT
    P = perform.Performer(A, pos=(-17.0, 2.5), yaw=math.radians(90))  # mirando a +X
    P.look_at(0.0, 'fwd')
    P.expression(0.0, 'smile_soft')
    w = P.walk(0.3, 13.2, [(-6.2, 2.5), (-3.0, 2.0), (-0.9, 1.15), (sx, sy + 0.04)], step=0.72)
    P.turn(13.8, 14.6, 0.0)
    P.look_at(9.5, (-1.5, 3.6, 1.5))
    P.look_at(11.5, LAB.DISH + Vector((0, 0, 0.3)))
    P.look_at(14.4, LAB.DISH)
    P.expression(14.0, 'curious')
    P.lean.add(14.4, 0.0).add(15.4, 0.16).add(17.0, 0.12).add(17.8, 0.0)
    P.hand('R', 14.6, 'rest')
    P.hand_pose('R', 14.6, {'relaxed': 1})
    _pt = LAB.DISH + Vector((-0.13, 0.07, 0.36))
    P.hand('R', 15.6, ('world', _pt, (LAB.DISH + Vector((0, 0, 0.03)) - _pt).normalized(), Vector((0.3, 0, -1))))
    P.hand_pose('R', 15.6, {'point': 1})
    P.hand('R', 17.0, 'rest')
    P.hand_pose('R', 17.2, {'relaxed': 1})
    # presenta el tema: mira a cámara, gesto de manos abiertas
    P.look_at(17.4, (0.0, -3.0, 1.6))
    P.expression(17.6, 'smile')
    for side, s in (('L', 1), ('R', -1)):
        P.hand(side, 18.0, 'rest')
        P.hand_pose(side, 18.0, {'relaxed': 1})
        P.hand(side, 19.0, ('world', Vector((sx + s * 0.32, sy - 0.3, 1.12)), Vector((s * 0.5, -1, 0.1)), Vector((s * 0.3, -0.3, 1))))
        P.hand_pose(side, 19.0, {'open': 1})
        P.hand(side, 21.5, ('world', Vector((sx + s * 0.34, sy - 0.28, 1.14)), Vector((s * 0.5, -1, 0.1)), Vector((s * 0.3, -0.3, 1))))
        P.hand(side, 22.8, 'rest')
        P.hand_pose(side, 22.8, {'relaxed': 1})
    P.bake(1, sc.frame_end)

    col = bpy.data.collections.new('MoGraph')
    sc.collection.children.link(col)
    # cámaras
    cams = {}
    c = SL.CameraRig('C1', [(0.0, (-9.5, 2.0, 1.55), (-15.5, 2.6, 1.4), 30), (8.0, (-7.0, 2.3, 1.6), (-9.5, 2.5, 1.45), 26)])
    cams['C1'] = c.bake(1, F(8.4))
    c = SL.CameraRig('C2', [(8.0, (2.6, -3.4, 1.9), (-5.0, 2.4, 1.2), 24), (13.0, (2.2, -3.0, 1.8), (-0.8, 1.2, 1.2), 26),
                             (16.5, (1.3, -2.2, 1.6), (0.0, 0.6, 1.2), 32)])
    cams['C2'] = c.bake(F(7.9), F(17.0))
    c = SL.CameraRig('C3', [(16.8, (0.1, -1.7, 1.5), (0.03, 0.6, 1.32), 32), (25.0, (0.05, -3.2, 1.6), (0.02, 0.4, 1.55), 28)])
    cams['C3'] = c.bake(F(16.7), F(25.0))
    SL.cut(0.0, cams['C1'])
    SL.cut(8.0, cams['C2'])
    SL.cut(16.8, cams['C3'])
    # título 3D con líneas de campo
    tc = Vector((0.03, -0.3, 2.12))
    MG.title_text('title_main', 'SEPARACIÓN MAGNÉTICA', tc, (math.pi / 2, 0, 0), 0.16, col, MG.WHITE, f_in=F(19.6), extrude=0.012, strength=2.6)
    lines = MG.dipole_lines(L=0.9, n=10, max_len=1.2, step=0.01, planes=2)
    fl, flm = MG.field_lines_object('title_field', lines, col, MG.CYAN, radius=0.0025, strength=3.5)
    fl.location = tc + Vector((0, 0.08, 0.0))
    fl.rotation_euler = (0, math.pi / 2, 0)
    MG.grow(fl, F(19.0), F(21.0), flm)
    parts, pm = MG.flow_particles('title_fp', lines, col, count=50, color='#c8f6ff', size=0.006, f0=F(19.0), f1=F(25.0), speed=0.35, parent=fl)
    MG.sparkles('title_sp', tc, 0.9, col, count=60, color=MG.CYAN, f0=F(19.4), f1=F(25.0), size=0.004)
    for lid, t in (('E1_02', 0.8), ('E1_03', 9.2), ('E1_04', 17.6)):
        SL.narration(sc, lid, t)
    SL.save(sc, 'E1b')


if __name__ == '__main__':
    main()
