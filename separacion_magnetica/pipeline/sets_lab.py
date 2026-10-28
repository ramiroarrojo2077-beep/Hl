"""Set: laboratorio de materiales + pasillo de acceso + utilería del experimento."""
import math
import random
import numpy as np
import bpy
from mathutils import Vector, Matrix

import props as P
from props import M, box, cyl, lathe, sphere, text3d
from util import srgb, principled, emission_mat, collection, add_modifier, NodeBuilder

BENCH_TOP = 0.92
SCI_SPOT = (0.05, 0.66)       # dónde se para el científico detrás de la mesada (mira hacia -Y)


def build_room(col):
    # piso, paredes, techo
    box('lab_floor', (12.4, 9.8, 0.1), (0, -0.25, -0.05), col, M('floor_lab'))
    box('lab_ceiling', (12.4, 9.8, 0.1), (0, -0.25, 3.25), col, M('ceiling'))
    wall = M('wall')
    box('lab_wall_back', (12.4, 0.15, 3.3), (0, 4.6, 1.6), col, wall)
    box('lab_wall_front', (12.4, 0.15, 3.3), (0, -5.15, 1.6), col, wall)
    # pared izquierda con puerta (hueco en y 1.9..3.1)
    box('lab_wall_left_a', (0.15, 6.8, 3.3), (-6.2, -1.6, 1.6), col, wall)
    box('lab_wall_left_b', (0.15, 1.45, 3.3), (-6.2, 3.875, 1.6), col, wall)
    box('lab_wall_left_c', (0.15, 1.2, 0.95), (-6.2, 2.5, 2.775), col, wall)
    # marco de puerta
    for dy in (-0.62, 0.62):
        box('door_jamb%d' % (dy > 0), (0.2, 0.06, 2.3), (-6.2, 2.5 + dy, 1.15), col, M('brushed'))
    box('door_head', (0.2, 1.3, 0.06), (-6.2, 2.5, 2.3), col, M('brushed'))
    # pared derecha con ventanas
    box('lab_wall_right_low', (0.15, 9.8, 0.9), (6.2, -0.25, 0.45), col, wall)
    box('lab_wall_right_top', (0.15, 9.8, 0.55), (6.2, -0.25, 2.98), col, wall)
    for k, y in enumerate((-4.1, -1.5, 1.1, 3.7)):
        box('lab_wall_right_post%d' % k, (0.15, 0.5, 1.8), (6.2, y, 1.8), col, wall)
    out = emission_mat('window_outside', '#cfe4f5', 1.6)
    box('window_outside', (0.05, 9.8, 1.8), (7.4, -0.25, 1.8), col, out).visible_shadow = False
    # árboles difusos afuera (siluetas)
    rnd = random.Random(4)
    tm = emission_mat('tree_far', '#6d8a5e', 0.8)
    for i in range(10):
        s = sphere('tree_out%d' % i, rnd.uniform(0.6, 1.1), (7.2, -5 + i * 1.0 + rnd.uniform(-0.3, 0.3), rnd.uniform(1.4, 2.4)), col, tm, seg=12, ring=6)
        s.visible_shadow = False
    for k, y in enumerate((-2.8, -0.2, 2.4)):
        box('window_mullion%d' % k, (0.08, 0.05, 1.8), (6.2, y, 1.8), col, M('brushed'))
    box('window_sill', (0.3, 9.8, 0.04), (6.1, -0.25, 0.92), col, M('white_lam'))
    # franja de color institucional
    box('lab_stripe_back', (12.3, 0.02, 0.12), (0, 4.52, 1.05), col, M('wall_accent'))
    # zócalo
    box('lab_skirting', (12.3, 0.02, 0.1), (0, 4.52, 0.05), col, M('grey_plastic'))
    # luminarias
    for x in (-4, -1.3, 1.3, 4):
        for y in (-3, -0.5, 2):
            P.ceiling_panel('led_%d_%d' % (x * 10, y * 10), (x, y, 3.18), (1.2, 0.3), col)
    # cartel
    sign = text3d('lab_sign', 'LABORATORIO DE MATERIALES', (0, 4.5, 2.55), 0.16, col, principled('sign_txt', '#2f5d7c', 0.4), extrude=0.005)


def build_furniture(col):
    # mesadas perimetrales en la pared del fondo
    P.cabinet_run('back_bench', -5.6, -1.2, 4.18, col, depth=0.7)
    P.cabinet_run('back_bench2', 1.2, 5.6, 4.18, col, depth=0.7)
    P.shelf_unit('shelf_a', (-0.0, 4.32, 0.0), 2.0, 0.4, 2.3, col, rot=0.0, seed=2)
    P.shelf_unit('shelf_b', (-3.4, 4.38, 1.15), 2.6, 0.32, 1.1, col, seed=5)
    P.shelf_unit('shelf_c', (3.4, 4.38, 1.15), 2.6, 0.32, 1.1, col, seed=8)
    # campana de laboratorio (sin uso de separación)
    box('hood_body', (1.5, 0.8, 2.2), (-5.0, 3.95, 1.1 + 0.9), col, M('white_lam'), bevel=0.01)
    box('hood_glass', (1.3, 0.02, 0.9), (-5.0, 3.54, 1.45), col, P.glass_mat('hood_glass', alpha=0.2))
    # equipos sobre mesadas del fondo
    for k, (x, kind) in enumerate(((-4.2, 'graph'), (-2.6, 'graph'), (2.2, 'graph'), (4.4, 'graph'))):
        sm = P.screen_material('scr%d' % k, color=['#3fc1ff', '#7cf29a', '#ffb347', '#3fc1ff'][k], seed=k)
        P.monitor('mon%d' % k, (x, 4.12, 0.92), 0.6, 0.36, col, sm, rot=0.0)
    P.microscope('scope_back', (-1.8, 4.1, 0.92), col, rot=math.radians(180))
    for k in range(5):
        P.beaker('bb%d' % k, (3.0 + k * 0.18, 4.0, 0.92), 0.035, 0.09, col, liquid=['liquid_blue', 'liquid_green', 'liquid_amber'][k % 3])
    # pizarra/pantalla mural
    sm = P.screen_material('wallscreen', color='#5fd0ff', strength=1.6, seed=3)
    box('wallscreen_fr', (2.2, 0.05, 1.2), (-6.1, -1.6, 1.9), col, M('black_plastic')).rotation_euler = (0, 0, math.radians(90))
    sc = box('wallscreen', (2.1, 0.01, 1.1), (-6.07, -1.6, 1.9), col, sm)
    sc.rotation_euler = (0, 0, math.radians(90))
    # mesas laterales
    P.cabinet_run('side_bench_r', -3.5, 3.5, 0, col, depth=0.7, rot=math.radians(90))
    bpy.data.objects['side_bench_r'].location = (5.75, -0.6, 0)
    # banquetas
    for k, (x, y) in enumerate(((-2.4, -0.9), (2.0, -1.0), (5.0, -2.0))):
        cyl('stool_seat%d' % k, 0.18, 0.05, (x, y, 0.68), col, M('black_plastic'))
        cyl('stool_leg%d' % k, 0.025, 0.66, (x, y, 0.02), col, M('chrome'))
        cyl('stool_base%d' % k, 0.22, 0.03, (x, y, 0.0), col, M('chrome'))
    # planta decorativa
    cyl('pot', 0.18, 0.4, (-5.6, -4.4, 0), col, principled('pot_m', '#d9d4c7', 0.6))
    rnd = random.Random(1)
    lm = principled('leaf_m', '#3f7a3a', 0.6)
    for i in range(14):
        s = sphere('leaf%d' % i, 0.16, (-5.6 + rnd.uniform(-0.2, 0.2), -4.4 + rnd.uniform(-0.2, 0.2), 0.55 + rnd.uniform(0, 0.7)), col, lm, seg=10, ring=6, scale=(1, 0.5, 0.25))
        s.rotation_euler = (rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(0, 6))


def build_main_bench(col):
    """Isla central (el científico trabaja detrás, mirando a cámara)."""
    root = P.cabinet_run('main_bench', -1.4, 1.4, 0.0, col, depth=0.95, h=BENCH_TOP)
    root.rotation_euler = (0, 0, math.pi)  # puertas hacia el científico (+Y)
    return root


def build_lights(col, world_strength=0.32):
    P.world_sky('LabWorld', top='#c9d6e0', horizon='#e6ebee', ground='#8d8f8f', strength=world_strength)
    key = P.area_light('key_bench', (-0.6, -1.4, 2.95), (0, 0.3, 0.9), 230, size=2.4, size_y=1.4, shadow=True, col=col)
    P.area_light('fill_ceiling_a', (-3, 0.5, 3.1), (-3, 0.5, 0), 140, size=3.0, shadow=False, col=col)
    P.area_light('fill_ceiling_b', (3, 0.5, 3.1), (3, 0.5, 0), 140, size=3.0, shadow=False, col=col)
    P.area_light('fill_back', (0, 3.2, 3.1), (0, 3.2, 0), 110, size=4.0, shadow=False, col=col)
    P.area_light('window_light', (6.0, -0.5, 1.8), (0, -0.5, 1.0), 380, size=8.0, size_y=1.8, color=(0.85, 0.92, 1.0), shadow=False, col=col)
    P.area_light('front_fill', (0, -4.8, 2.4), (0, 0.5, 1.2), 140, size=3.0, shadow=False, col=col)
    return key


def build_corridor(col):
    """Pasillo de vidrio y aluminio que conduce a la puerta del laboratorio (x < -6.2)."""
    L0, L1 = -24.0, -6.3
    cx = (L0 + L1) / 2
    box('cor_floor', (L1 - L0, 2.4, 0.1), (cx, 2.5, -0.05), col, principled('cor_floor_m', '#9ea3a6', 0.22, noise_color=0.05, noise_scale=3, coat=0.3))
    box('cor_ceiling', (L1 - L0, 2.4, 0.1), (cx, 2.5, 3.05), col, M('ceiling'))
    box('cor_wall_n', (L1 - L0, 0.12, 3.1), (cx, 3.76, 1.5), col, M('wall'))
    # pared sur: vidrio con montantes
    box('cor_glass_s', (L1 - L0, 0.03, 2.6), (cx, 1.25, 1.55), col, P.glass_mat('cor_glass', '#dfefff', 0.1))
    box('cor_base_s', (L1 - L0, 0.12, 0.25), (cx, 1.25, 0.125), col, M('brushed'))
    x = L0
    while x < L1:
        box('cor_mull_%d' % int(-x * 10), (0.06, 0.08, 3.0), (x, 1.25, 1.5), col, M('brushed'))
        x += 1.5
    # exterior visible por el vidrio
    box('cor_outside', (L1 - L0 + 10, 0.05, 6), (cx, -6.0, 2.0), col, emission_mat('cor_out_e', '#d8e8f4', 2.2)).visible_shadow = False
    rnd = random.Random(9)
    tm = emission_mat('tree_far2', '#5f7f52', 1.2)
    for i in range(14):
        s = sphere('cor_tree%d' % i, rnd.uniform(0.8, 1.4), (L0 + i * 1.4, -4.5 + rnd.uniform(-1, 1), rnd.uniform(1.0, 2.2)), col, tm, seg=12, ring=6)
        s.visible_shadow = False
    box('cor_lawn', (L1 - L0 + 10, 7, 0.05), (cx, -2.4, -0.05), col, M('grass'))
    # luces de techo del pasillo
    for i in range(6):
        P.ceiling_panel('cor_led%d' % i, (L0 + 1.5 + i * 3.0, 2.5, 2.98), (0.25, 1.4), col, strength=10)
    # cuadros / señalética
    for i in range(3):
        box('cor_frame%d' % i, (0.9, 0.03, 0.6), (L0 + 4 + i * 5, 3.69, 1.6), col, M('black_plastic'))
        sm = P.screen_material('cor_poster%d' % i, color=['#ff9b3d', '#3fc1ff', '#7cf29a'][i], strength=0.9, seed=i + 4)
        box('cor_poster%d' % i, (0.85, 0.01, 0.55), (L0 + 4 + i * 5, 3.67, 1.6), col, sm)
    lab_sign = text3d('cor_lab_sign', 'LAB. MATERIALES', (-6.6, 3.68, 2.55), 0.13, col, principled('cor_sign_m', '#2f5d7c', 0.4), extrude=0.004)

    P.area_light('cor_fill', (cx, 2.5, 2.9), (cx, 2.5, 0), 900, size=17.0, size_y=1.5, shadow=False, col=col)
    P.area_light('cor_sun', (cx, -3.0, 4.0), (cx, 2.8, 0.5), 1800, size=12.0, size_y=3.0, color=(1.0, 0.95, 0.86), shadow=True, col=col)


# ---------------------------------------------------------------------------
# Utilería del experimento
# ---------------------------------------------------------------------------

DISH = Vector((0.12, 0.33, BENCH_TOP))
TRAY = Vector((-0.18, 0.33, BENCH_TOP))
STAND = Vector((-0.42, 0.40, BENCH_TOP))
SAND_BOTTLE = Vector((0.30, 0.47, BENCH_TOP))   # al alcance de la mano izquierda (inclinándose un poco)
HANDLE_C = 0.165   # centro del mango (desde la base del imán)
SLEEVE_GRIP = 0.085
DISH_R = 0.095
SAND_H = 0.022
MAG_LEN = 0.125
SLEEVE_LEN = 0.135


def label_material(name, color='#ffffff', stripe='#1e5fa8'):
    return principled(name, color, rough=0.5)


def build_experiment(col, seed=3, n_filings=320):
    rnd = random.Random(seed)
    objs = {}
    # cristalizador de vidrio
    prof = [(0.001, 0.0), (DISH_R * 0.97, 0.0), (DISH_R, 0.004), (DISH_R, 0.05), (DISH_R + 0.004, 0.052)]
    dish = lathe('dish', prof, DISH, col, M('glass_hero'), seg=48)
    add_modifier(dish, 'SOLIDIFY', 'Solidify', thickness=0.0025)
    objs['dish'] = dish
    # superficie de arena con montículo
    verts, faces = [], []
    nr, na = 14, 48
    verts.append((0, 0, SAND_H + 0.004))
    for i in range(1, nr + 1):
        r = (DISH_R - 0.003) * i / nr
        for j in range(na):
            a = 2 * math.pi * j / na
            h = SAND_H + 0.004 * (1 - (r / DISH_R) ** 2) + rnd.uniform(-0.0008, 0.0008)
            verts.append((r * math.cos(a), r * math.sin(a), h))
    for j in range(na):
        faces.append([0, 1 + j, 1 + (j + 1) % na])
    for i in range(nr - 1):
        for j in range(na):
            a = 1 + i * na + j
            b = 1 + i * na + (j + 1) % na
            faces.append([a, b, b + na, a + na])
    me = bpy.data.meshes.new('sand_surface')
    me.from_pydata(verts, [], faces)
    me.shade_smooth()
    sand = bpy.data.objects.new('sand_surface', me)
    col.objects.link(sand)
    sand.location = DISH
    me.materials.append(M('sand'))
    cyl('sand_body', DISH_R - 0.003, SAND_H, DISH, col, M('sand'))
    objs['sand'] = sand
    # bandeja blanca
    tr = box('tray', (0.22, 0.15, 0.004), TRAY + Vector((0, 0, 0.002)), col, M('tray_white'), bevel=0.002)
    for dx, dy, sx, sy in ((0.11, 0, 0.006, 0.15), (-0.11, 0, 0.006, 0.15), (0, 0.075, 0.226, 0.006), (0, -0.075, 0.226, 0.006)):
        box('tray_rim_%d_%d' % (int(dx * 100), int(dy * 100)), (sx, sy, 0.018), TRAY + Vector((dx, dy, 0.009)), col, M('tray_white'), bevel=0.002)
    objs['tray'] = tr
    # soporte del imán
    box('mag_stand', (0.07, 0.07, 0.04), STAND + Vector((0, 0, 0.02)), col, M('wood'), bevel=0.005)
    # imán de barra (cilíndrico) con mango: mitad roja (N) arriba, azul (S) abajo
    mag = bpy.data.objects.new('magnet', None)
    col.objects.link(mag)
    mag.location = STAND + Vector((0, 0, 0.04 + 0.012))
    objs['magnet'] = mag
    lo = cyl('magnet_S', 0.0105, MAG_LEN / 2, (0, 0, 0.0), col, M('magnet_blue'))
    hi = cyl('magnet_N', 0.0105, MAG_LEN / 2, (0, 0, MAG_LEN / 2), col, M('magnet_red'))
    handle = cyl('magnet_handle', 0.0095, 0.08, (0, 0, MAG_LEN), col, M('black_plastic'))
    knob = sphere('magnet_knob', 0.014, (0, 0, MAG_LEN + 0.085), col, M('black_plastic'), scale=(1, 1, 0.7))
    for p in (lo, hi, handle, knob):
        p.parent = mag
    # letras N / S
    # funda de plástico transparente (tubo cerrado abajo con pestaña arriba)
    sl_prof = [(0.001, -0.004), (0.012, -0.004), (0.0145, -0.001), (0.0145, SLEEVE_LEN - 0.01), (0.022, SLEEVE_LEN - 0.006), (0.022, SLEEVE_LEN - 0.002), (0.0145, SLEEVE_LEN)]
    sleeve = lathe('sleeve', sl_prof, (0, 0, 0), col, M('sleeve'), seg=32)
    sleeve.visible_shadow = False
    add_modifier(sleeve, 'SOLIDIFY', 'Solidify', thickness=0.0012)
    sleeve.location = mag.location + Vector((0, 0, -0.002))
    objs['sleeve'] = sleeve
    # frascos con etiquetas
    lab_s = principled('label_sand', '#f4efe2', 0.6)
    lab_i = principled('label_iron', '#e9eef4', 0.6)
    P.jar('jar_sand', (-0.78, 0.3, BENCH_TOP), 0.04, 0.1, col, content='sand', label_mat=lab_s)
    P.jar('jar_iron', (-0.92, 0.22, BENCH_TOP), 0.035, 0.09, col, content='iron', label_mat=lab_i)
    # frasquito con arena: el científico lo toma al presentar los materiales (E2)
    sb = P.jar('sand_bottle', (SAND_BOTTLE.x, SAND_BOTTLE.y, BENCH_TOP), 0.022, 0.075, col, content='sand', label_mat=lab_s)
    bpy.context.view_layer.update()
    for n in ('sand_bottle_cap', 'sand_bottle_c', 'sand_bottle_label'):
        ch = bpy.data.objects.get(n)
        if ch:
            ch.parent = sb
            ch.matrix_parent_inverse = sb.matrix_world.inverted()
    objs['sand_bottle'] = sb
    # resto de la mesada
    P.microscope('scope_main', (1.0, 0.25, BENCH_TOP), col, rot=math.radians(200))
    P.beaker('beaker_a', (-1.1, -0.05, BENCH_TOP), 0.04, 0.1, col, liquid='liquid_blue', fill=0.45)
    P.flask('flask_a', (-1.2, 0.2, BENCH_TOP), 0.05, 0.16, col, liquid='liquid_green')
    box('notebook', (0.21, 0.28, 0.012), (0.78, -0.18, BENCH_TOP + 0.006), col, principled('nb_cover', '#283a52', 0.5), bevel=0.002).rotation_euler = (0, 0, math.radians(12))
    box('notebook_pg', (0.2, 0.27, 0.002), (0.78, -0.18, BENCH_TOP + 0.013), col, M('paper')).rotation_euler = (0, 0, math.radians(12))
    cyl('pen', 0.004, 0.14, (0.68, -0.25, BENCH_TOP + 0.004), col, M('blue_plastic'), rot=(0, math.radians(90), math.radians(40)))
    # limaduras de hierro
    fm = bpy.data.meshes.new('filing_mesh')
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(0.0012, 0.0012, 0.0034), verts=bm.verts)
    for v in bm.verts:
        v.co.x += rnd.uniform(-0.0002, 0.0002)
        v.co.y += rnd.uniform(-0.0002, 0.0002)
    bm.to_mesh(fm)
    bm.free()
    fm.materials.append(M('iron'))
    filings = []
    for i in range(n_filings):
        ob = bpy.data.objects.new('filing%03d' % i, fm)
        col.objects.link(ob)
        r = DISH_R * 0.86 * math.sqrt(rnd.random())
        a = rnd.uniform(0, 2 * math.pi)
        z = SAND_H + 0.004 * (1 - (r / DISH_R) ** 2) + rnd.uniform(-0.0006, 0.0012)
        ob.location = DISH + Vector((r * math.cos(a), r * math.sin(a), z))
        ob.rotation_euler = (rnd.uniform(1.2, 1.9), rnd.uniform(-0.4, 0.4), rnd.uniform(0, 6.28))
        s = rnd.uniform(0.7, 1.4)
        ob.scale = (s, s, s * rnd.uniform(0.7, 1.3))
        ob.visible_shadow = False
        filings.append(ob)
    objs['filings'] = filings
    return objs


def build_hologram_table(col, loc=(3.2, 1.2)):
    x, y = loc
    cyl('holo_base', 0.38, 0.85, (x, y, 0), col, M('black_plastic'), seg=48)
    cyl('holo_top', 0.45, 0.06, (x, y, 0.85), col, M('bench_top'), seg=48)
    ring = cyl('holo_ring', 0.39, 0.012, (x, y, 0.91), col, emission_mat('holo_ring_e', '#3fd2ff', 6.0), seg=64)
    disc = cyl('holo_disc', 0.35, 0.004, (x, y, 0.912), col, emission_mat('holo_disc_e', '#0f4c66', 1.5), seg=64)
    ring.visible_shadow = False
    disc.visible_shadow = False
    return Vector((x, y, 0.92))


def build_lab(col_name='Lab', experiment=True, corridor=True):
    col = collection(col_name)
    build_room(col)
    build_furniture(col)
    build_main_bench(col)
    key = build_lights(col)
    holo = build_hologram_table(col)
    if corridor:
        build_corridor(col)
    exp = build_experiment(col) if experiment else None
    return dict(col=col, key=key, holo=holo, exp=exp)
