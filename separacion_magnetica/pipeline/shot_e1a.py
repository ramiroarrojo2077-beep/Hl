"""E1a — Toma exterior del complejo científico: acercamiento aéreo hasta la entrada vidriada."""
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
import props as PR
from props import M, box, cyl, sphere, text3d
from util import principled, emission_mat, collection, add_modifier
import mograph as MG

DUR = 9.0


def tree(name, loc, col, rnd, h=None):
    h = h or rnd.uniform(4.0, 6.5)
    cyl(name + '_trunk', 0.18, h * 0.55, loc, col, principled('bark', '#5a4532', 0.85, noise_color=0.3), seg=10)
    leaf = bpy.data.materials.get('foliage') or principled('foliage', '#3f6e32', 0.8, noise_color=0.35, noise_scale=3)
    for k in range(5):
        r = rnd.uniform(0.9, 1.6) * h / 5.5
        s = sphere(name + '_f%d' % k, r, Vector(loc) + Vector((rnd.uniform(-0.8, 0.8), rnd.uniform(-0.8, 0.8), h * 0.55 + rnd.uniform(0.2, 1.6))), col, leaf, seg=14, ring=8)
        d = s.modifiers.new('disp', 'DISPLACE')
        tex = bpy.data.textures.get('leafnoise') or bpy.data.textures.new('leafnoise', 'CLOUDS')
        tex.noise_scale = 0.5
        d.texture = tex
        d.strength = 0.35


def facade(name, x0, x1, y, z0, z1, col, floors=3, bay=2.2, rot=0.0):
    """Muro cortina vidriado con montantes y bandejas de losa."""
    root = bpy.data.objects.new(name, None)
    col.objects.link(root)
    root.rotation_euler = (0, 0, rot)
    L = x1 - x0
    parts = [box(name + '_glass', (L, 0.06, z1 - z0), ((x0 + x1) / 2, y, (z0 + z1) / 2), col, M('glass_facade'))]
    mull = PR.paint_mat('mullion', '#d9dcdf', 0.35, 0.05)
    x = x0
    while x <= x1 + 1e-6:
        parts.append(box(name + '_m%d' % int(x * 10), (0.12, 0.2, z1 - z0), (x, y - 0.06, (z0 + z1) / 2), col, mull))
        x += bay
    for k in range(floors + 1):
        z = z0 + k * (z1 - z0) / floors
        parts.append(box(name + '_slab%d' % k, (L + 0.2, 0.35, 0.35 if 0 < k < floors else 0.5), ((x0 + x1) / 2, y - 0.1, z), col,
                         PR.paint_mat('slab_white', '#eef0f0', 0.5, 0.04)))
    for p in parts:
        p.parent = root
    return root


def main():
    sc = SL.new_scene('E1a', DUR)
    col = collection('Campus')
    rnd = random.Random(12)
    PR.world_sky('CampusWorld', top='#3a7fd0', horizon='#b9d4ee', ground='#7b766c', strength=1.0)
    PR.sun('campus_sun', (math.radians(50), math.radians(12), math.radians(-40)), energy=4.2, color=(1.0, 0.93, 0.82), angle=0.02)
    PR.area_light('campus_fill', (0, -60, 30), (0, 0, 0), 60000, size=60, shadow=False, col=col)
    # terreno
    box('ground', (300, 300, 0.2), (0, 0, -0.1), col, M('grass'))
    box('plaza', (36, 22, 0.06), (0, -16, 0.03), col, principled('plaza_m', '#c9c3b6', 0.6, noise_color=0.12, noise_scale=1.2))
    box('road', (300, 9, 0.05), (0, -36, 0.02), col, M('asphalt'))
    box('path', (5, 14, 0.07), (0, -30, 0.035), col, principled('path_m', '#b9b3a6', 0.7, noise_color=0.1))
    # edificio principal (3 pisos) con entrada vidriada al centro
    W, D, H = 46.0, 18.0, 13.0
    box('bld_core', (W, D, H), (0, 0, H / 2), col, PR.paint_mat('bld_white', '#e9ebea', 0.55, 0.05))
    facade('fac_front', -W / 2 + 1, W / 2 - 1, -D / 2 - 0.05, 1.0, H - 0.6, col, floors=3)
    # cuerpo de entrada saliente
    # cuerpo de entrada: vestíbulo hueco con hall iluminado detrás de las puertas
    ed = PR.paint_mat('entr_dark', '#2a3540', 0.4, 0.05)
    yf = -D / 2 - 4.05
    box('entr_wall_l', (0.3, 4, 6.0), (-4.85, -D / 2 - 2.0, 3.0), col, ed)
    box('entr_wall_r', (0.3, 4, 6.0), (4.85, -D / 2 - 2.0, 3.0), col, ed)
    box('entr_roof', (10, 4, 0.4), (0, -D / 2 - 2.0, 5.8), col, ed)
    # muro cortina con vano de puerta (2.5 m x 2.7 m) abierto en el centro
    facade('fac_entr_l', -4.6, -1.3, yf, 0.0, 5.2, col, floors=1, bay=1.1)
    facade('fac_entr_r', 1.3, 4.6, yf, 0.0, 5.2, col, floors=1, bay=1.1)
    facade('fac_entr_t', -1.3, 1.3, yf, 2.75, 5.2, col, floors=1, bay=1.3)
    box('door_jamb_l', (0.1, 0.25, 2.75), (-1.3, yf - 0.05, 1.375), col, M('brushed'))
    box('door_jamb_r', (0.1, 0.25, 2.75), (1.3, yf - 0.05, 1.375), col, M('brushed'))
    # hall interior
    box('lobby_floor', (9.4, 4.4, 0.05), (0, -D / 2 - 2.0, 0.025), col, principled('lobby_floor_m', '#d9d6cf', 0.25, coat=0.3, noise_color=0.05))
    box('lobby_back', (9.4, 0.1, 5.6), (0, -D / 2 + 0.05, 2.8), col, principled('lobby_back_m', '#eef0f1', 0.6))
    box('lobby_ceiling', (9.4, 4.4, 0.05), (0, -D / 2 - 2.0, 5.55), col, principled('lobby_ceil_m', '#f4f5f5', 0.8))
    for k, x in enumerate((-3.0, 0.0, 3.0)):
        p = box('lobby_led%d' % k, (2.2, 0.3, 0.02), (x, -D / 2 - 2.0, 5.52), col, emission_mat('lobby_led_e', '#fff6e6', 6.0))
        p.visible_shadow = False
    box('lobby_desk', (3.0, 0.8, 1.05), (0, -D / 2 - 0.9, 0.525), col, principled('desk_m', '#f2f2f0', 0.35, coat=0.4), bevel=0.05)
    box('lobby_desk_top', (3.1, 0.9, 0.05), (0, -D / 2 - 0.9, 1.07), col, M('wood'))
    box('lobby_stripe', (9.3, 0.02, 0.18), (0, -D / 2 - 0.01, 2.2), col, M('wall_accent'))
    t2 = text3d('lobby_sign', 'LABORATORIOS', (0, -D / 2 - 0.02, 3.2), 0.32, col, principled('lobby_sign_m', '#1f4e79', 0.4), extrude=0.02)
    for k, x in enumerate((-3.6, 3.6)):
        cyl('lobby_pot%d' % k, 0.3, 0.6, (x, -D / 2 - 1.0, 0.05), col, principled('pot_l', '#3c3f43', 0.5))
        sphere('lobby_plant%d' % k, 0.55, (x, -D / 2 - 1.0, 1.1), col, principled('plant_l', '#3f7a3a', 0.7, noise_color=0.3), seg=12, ring=8)
    PR.point_light('lobby_light', (0, -D / 2 - 2.2, 4.6), 900, radius=1.5, color=(1.0, 0.96, 0.9), shadow=False, col=col)
    canopy = box('canopy', (14, 7, 0.4), (0, -D / 2 - 3.5, 6.2), col, PR.paint_mat('canopy_m', '#f2f3f3', 0.4, 0.03))
    for x in (-6.5, 6.5):
        cyl('canopy_col%d' % (x > 0), 0.2, 6.0, (x, -D / 2 - 6.6, 0), col, M('brushed'))
    # puertas de vidrio deslizantes (se abren al final)
    dm = PR.glass_mat('door_glass', '#cfe8ff', 0.18)
    doors = []
    for s in (-1, 1):
        d = box('door%d' % (s > 0), (1.2, 0.05, 2.6), (s * 0.6, -D / 2 - 4.12, 1.3), col, dm)
        fr = box('doorfr%d' % (s > 0), (1.24, 0.07, 0.08), (s * 0.6, -D / 2 - 4.12, 2.62), col, M('brushed'))
        fr.parent = d
        fr.location = (0, 0, 1.32)
        doors.append((d, s))
    for d, s in doors:
        for f, x in ((F(7.2), s * 0.6), (F(8.6), s * 1.75)):
            d.location.x = x
            d.keyframe_insert('location', index=0, frame=f)
    # cartel institucional
    txtm = principled('sign_letters', '#1f4e79', 0.35, metal=0.4)
    t = text3d('campus_sign', 'CENTRO DE INVESTIGACIÓN EN MATERIALES', (0, -D / 2 - 5.75, 6.75), 0.55, col, txtm, extrude=0.06)
    t.data.font = MG.font() or t.data.font
    # ala lateral y edificio de laboratorio
    box('wing', (16, 30, 9), (34, 4, 4.5), col, PR.paint_mat('wing_m', '#d8dcdd', 0.55, 0.05))
    facade('fac_wing', 26.5, 41.5, -11.05, 0.8, 8.4, col, floors=2)
    box('tower', (10, 10, 22), (-30, 6, 11), col, PR.paint_mat('tower_m', '#cfd5d8', 0.5, 0.05))
    facade('fac_tower', -34.5, -25.5, 0.95, 1.0, 21.4, col, floors=6)
    # cubierta técnica y paneles solares
    for i in range(8):
        p = box('solar%d' % i, (3.0, 1.6, 0.06), (-15 + i * 4.2, 2, H + 0.6), col, principled('solar_m', '#1b2a44', 0.2, metal=0.5))
        p.rotation_euler = (math.radians(-25), 0, 0)
    # árboles, faroles, bancos, autos
    for i in range(18):
        x = rnd.uniform(-60, 60)
        y = rnd.uniform(-34, -14)
        if abs(x) < 20 and y > -28:
            x = math.copysign(rnd.uniform(20, 60), x)
        tree('tree%d' % i, (x, y, 0), col, rnd)
    for i in range(8):
        tree('treeb%d' % i, (rnd.uniform(-70, 70), rnd.uniform(12, 30), 0), col, rnd, h=rnd.uniform(6, 9))
    for i, x in enumerate((-14, -7, 7, 14)):
        cyl('lamp%d' % i, 0.07, 4.2, (x, -25.5, 0), col, M('steel'), seg=10)
        cyl('lamph%d' % i, 0.25, 0.12, (x, -25.5, 4.2), col, emission_mat('lampe', '#fff2d0', 2.0))
        box('bench%d' % i, (1.8, 0.5, 0.45), (x + 2.5, -24.5, 0.22), col, M('wood'))
    cols = ['#b8322d', '#2b5f97', '#d9d9d9', '#222222', '#6a7a3a']
    for i in range(10):
        x = -50 + i * 3.0
        car = box('car%d' % i, (1.9, 4.3, 1.0), (x, -42, 0.75), col, PR.paint_mat('car%d' % (i % 5), cols[i % 5], 0.25, 0.05), bevel=0.25)
        box('carroof%d' % i, (1.6, 2.3, 0.6), (x, -42.2, 1.5), col, principled('carglass', '#1a232b', 0.1, metal=0.4), bevel=0.15)
    # cámara: acercamiento aéreo descendente hasta la entrada
    c = SL.CameraRig('C1', [(0.0, (-34.0, -70.0, 26.0), (0.0, -6.0, 6.0), 30), (5.0, (-10.0, -40.0, 9.0), (0.0, -10.0, 4.0), 30),
                             (9.0, (0.0, -18.0, 1.9), (0.0, -9.0, 1.7), 26)])
    cam = c.bake(1, F(DUR))
    SL.cut(0.0, cam)
    SL.narration(sc, 'E1_01', 1.6)
    SL.save(sc, 'E1a')


if __name__ == '__main__':
    main()
