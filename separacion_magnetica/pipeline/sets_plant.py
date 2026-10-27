"""Set: planta de reciclaje (nave, cinta transportadora, separador magnético de banda, contenedores)."""
import math
import random
import bpy
import bmesh
from mathutils import Vector, Matrix

import props as PR
from props import M, box, cyl, sphere, text3d
from util import srgb, principled, emission_mat, collection, add_modifier, NodeBuilder

BELT_Z = 1.15          # altura de la superficie de la cinta
BELT_W = 1.0
BELT_X0, BELT_X1 = -15.0, 11.0
MAG_X = 0.0            # posición del separador sobre la cinta
XBELT_Z = 1.62         # cara inferior de la banda transversal
CONT = Vector((0.0, 2.35, 0.0))   # contenedor de acero (lado +Y)
SPEED = 0.55


def corrugated(name):
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    p = nb.n('ShaderNodeBsdfPrincipled')
    tc = nb.n('ShaderNodeTexCoord')
    w = nb.n('ShaderNodeTexWave', Scale=1.2, _wave_type='BANDS', _bands_direction='X', _wave_profile='SIN')
    nb.link(tc.outputs['Object'], w.inputs['Vector'])
    nz = nb.n('ShaderNodeTexNoise', Scale=2.0, Detail=6.0)
    nb.link(tc.outputs['Object'], nz.inputs['Vector'])
    mix = nb.n('ShaderNodeMix', _data_type='RGBA')
    nb.link(nz.outputs['Fac'], mix.inputs['Factor'])
    mix.inputs[6].default_value = srgb('#7f8a91')
    mix.inputs[7].default_value = srgb('#a7b0b5')
    nb.link(mix.outputs[2], p.inputs['Base Color'])
    p.inputs['Metallic'].default_value = 0.7
    p.inputs['Roughness'].default_value = 0.45
    m2 = nb.n('ShaderNodeMix', _data_type='RGBA')
    m2.inputs['Factor'].default_value = 0.12
    nb.link(mix.outputs[2], m2.inputs[6])
    nb.link(w.outputs['Fac'], m2.inputs[7])
    nb.link(m2.outputs[2], p.inputs['Base Color'])
    nb.output(p.outputs['BSDF'])
    return mat


def belt_material(name, speed=SPEED, dur=40.0, axis='X'):
    """Banda de goma con tacos; la textura se desplaza con keyframes lineales."""
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    p = nb.n('ShaderNodeBsdfPrincipled')
    tc = nb.n('ShaderNodeTexCoord')
    mp = nb.n('ShaderNodeMapping')
    nb.link(tc.outputs['Object'], mp.inputs['Vector'])
    w = nb.n('ShaderNodeTexWave', Scale=1.6, _wave_type='BANDS', _bands_direction=axis)
    nb.link(mp.outputs['Vector'], w.inputs['Vector'])
    nz = nb.n('ShaderNodeTexNoise', Scale=8.0, Detail=4.0)
    nb.link(mp.outputs['Vector'], nz.inputs['Vector'])
    gt = nb.n('ShaderNodeMath', _operation='GREATER_THAN')
    nb.link(w.outputs['Fac'], gt.inputs[0])
    gt.inputs[1].default_value = 0.88
    mix = nb.n('ShaderNodeMix', _data_type='RGBA')
    nb.link(nz.outputs['Fac'], mix.inputs['Factor'])
    mix.inputs[6].default_value = srgb('#16171a')
    mix.inputs[7].default_value = srgb('#2b2d31')
    m2 = nb.n('ShaderNodeMix', _data_type='RGBA')
    nb.link(gt.outputs[0], m2.inputs['Factor'])
    nb.link(mix.outputs[2], m2.inputs[6])
    m2.inputs[7].default_value = srgb('#3c3f44')
    nb.link(m2.outputs[2], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.8
    bump = nb.n('ShaderNodeBump', Strength=0.5, Distance=0.01)
    nb.link(gt.outputs[0], bump.inputs['Height'])
    nb.link(bump.outputs['Normal'], p.inputs['Normal'])
    nb.output(p.outputs['BSDF'])
    idx = {'X': 0, 'Y': 1}[axis]
    sock = mp.inputs['Location']
    for f, v in ((1, 0.0), (int(dur * 30) + 1, -speed * dur)):
        val = [0.0, 0.0, 0.0]
        val[idx] = v
        sock.default_value = val
        sock.keyframe_insert('default_value', frame=f)
    ad = mat.node_tree.animation_data
    if ad and ad.action:
        try:
            for layer in ad.action.layers:
                for strip in layer.strips:
                    for cb in strip.channelbags:
                        for fc in cb.fcurves:
                            for kp in fc.keyframe_points:
                                kp.interpolation = 'LINEAR'
        except Exception:
            pass
    return mat


def ibeam(name, p0, h, col, mat, w=0.3):
    box(name + '_web', (0.03, w, h), Vector(p0) + Vector((0, 0, h / 2)), col, mat)
    box(name + '_f1', (w, 0.03, h), Vector(p0) + Vector((0, w / 2, h / 2)), col, mat)
    box(name + '_f2', (w, 0.03, h), Vector(p0) + Vector((0, -w / 2, h / 2)), col, mat)


def railing(name, p0, p1, col, h=1.05):
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    L = d.length
    n = max(2, int(L / 1.5) + 1)
    ym = PR.paint_mat('rail_yellow', '#f2c200', 0.4, 0.1)
    ang = math.atan2(d.y, d.x)
    for k in range(n):
        p = p0 + d * (k / (n - 1))
        cyl(name + '_post%d' % k, 0.025, h, p, col, ym, seg=10)
    for z in (h, h * 0.55):
        c = cyl(name + '_bar%d' % int(z * 100), 0.022, L, p0 + Vector((0, 0, z)), col, ym, seg=10, rot=(0, math.pi / 2, 0))
        c.rotation_euler = (0, math.pi / 2, ang)
    box(name + '_kick', (L, 0.01, 0.12), (p0 + p1) / 2 + Vector((0, 0, 0.06)), col, ym).rotation_euler = (0, 0, ang)


def sign(name, text, loc, col, rot_z=0.0, size=0.25, bg='#1f5fa8', fg='#ffffff', w=None):
    w = w or len(text) * size * 0.62 + size
    b = box(name + '_bg', (w, 0.03, size * 1.6), loc, col, principled(name + '_bgm', bg, 0.5))
    b.rotation_euler = (0, 0, rot_z)
    t = text3d(name + '_txt', text, Vector(loc) + Matrix.Rotation(rot_z, 3, 'Z') @ Vector((0, -0.02, -size * 0.1)), size, col,
               emission_mat(name + '_tm', fg, 1.2) if fg == '#ffffff' else principled(name + '_tm', fg, 0.4), extrude=0.003)
    t.rotation_euler = (math.pi / 2, 0, rot_z)
    return b


def build_hall(col):
    concrete = M('concrete')
    box('pl_floor', (60, 40, 0.2), (0, 0, -0.1), col, principled('pl_floor_m', '#7d7c78', 0.75, noise_color=0.25, noise_scale=1.5, bump=40, bump_scale=0.1))
    # marcas de seguridad en el piso
    yl = PR.paint_mat('floor_yellow', '#e3b600', 0.6, 0.15)
    for y in (-3.2, -1.15):
        box('pl_lane%d' % int(y * 10), (34, 0.12, 0.005), (-2, y, 0.003), col, yl)
    cm = corrugated('corrugated')
    box('pl_wall_back', (60, 0.2, 12), (0, 12, 6), col, cm)
    box('pl_wall_left', (0.2, 40, 12), (-24, 0, 6), col, cm)
    box('pl_wall_right', (0.2, 40, 12), (24, 0, 6), col, cm)
    box('pl_wall_front', (60, 0.2, 12), (0, -14, 6), col, cm)
    roof = box('pl_roof', (60, 40, 0.3), (0, 0, 12.2), col, principled('pl_roof_m', '#5d6468', 0.6))
    roof.visible_shadow = False
    steel = PR.paint_mat('steel_blue', '#2c5c8a', 0.45, 0.1)
    for x in range(-20, 24, 8):
        for y in (-12.0, 11.6):
            ibeam('col_%d_%d' % (x, y), (x, y, 0), 11.8, col, steel)
        box('truss_%d' % x, (0.3, 24, 0.5), (x, 0, 11.4), col, steel).visible_shadow = False
        box('truss_l_%d' % x, (0.15, 24, 0.15), (x, 0, 10.4), col, steel)
    # claraboyas emisivas
    sky = emission_mat('skylight', '#f3f7fb', 4.0)
    for x in range(-18, 22, 8):
        s = box('skylight_%d' % x, (3.0, 18, 0.05), (x + 4, 0, 12.0), col, sky)
        s.visible_shadow = False
    # luminarias colgantes
    lm = emission_mat('highbay', '#fff4dd', 8.0)
    for x in range(-16, 18, 6):
        for y in (-5, 5):
            cyl('hb_%d_%d' % (x, y), 0.25, 0.25, (x, y, 8.0), col, M('grey_plastic'), r2=0.35)
            d = cyl('hbl_%d_%d' % (x, y), 0.33, 0.01, (x, y, 7.99), col, lm)
            d.visible_shadow = False
            cyl('hbc_%d_%d' % (x, y), 0.01, 3.8, (x, y, 8.2), col, M('black_plastic'))


def build_conveyor(col, dur):
    L = BELT_X1 - BELT_X0
    cx = (BELT_X0 + BELT_X1) / 2
    frame = PR.paint_mat('conv_green', '#2f7a4b', 0.45, 0.12)
    bm = belt_material('belt_main', SPEED, dur + 2, 'X')
    belt = box('belt_main', (L, BELT_W, 0.04), (cx, 0, BELT_Z - 0.02), col, bm)
    for y in (-BELT_W / 2 - 0.06, BELT_W / 2 + 0.06):
        box('conv_side%d' % (y > 0), (L, 0.06, 0.3), (cx, y, BELT_Z + 0.05), col, frame)
        box('conv_skirt%d' % (y > 0), (L, 0.02, 0.18), (cx, y * 0.93, BELT_Z + 0.09), col, M('rubber'))
    x = BELT_X0 + 0.5
    while x < BELT_X1:
        for y in (-0.62, 0.62):
            box('conv_leg_%d_%d' % (int(x * 10), y > 0), (0.1, 0.1, BELT_Z - 0.2), (x, y, (BELT_Z - 0.2) / 2), col, frame)
        box('conv_cross_%d' % int(x * 10), (0.08, 1.3, 0.08), (x, 0, 0.35), col, frame)
        x += 2.5
    # rodillos de retorno
    x = BELT_X0 + 0.3
    while x < BELT_X1:
        cyl('roll_%d' % int(x * 10), 0.05, 1.0, (x, -0.5, BELT_Z - 0.18), col, M('steel'), seg=12, rot=(-math.pi / 2, 0, 0))
        x += 1.2
    # tolva de alimentación y descarga
    box('hopper', (2.0, 1.6, 1.2), (BELT_X0 + 0.6, 0, BELT_Z + 0.75), col, frame)
    box('end_bin', (1.6, 2.0, 1.0), (BELT_X1 + 1.0, 0, 0.5), col, principled('endbin_m', '#2c6ea8', 0.5, noise_color=0.15))
    return belt


def build_separator(col, dur):
    """Separador magnético de banda transversal (overband) suspendido sobre la cinta."""
    red = PR.paint_mat('sep_red', '#b8262c', 0.4, 0.1)
    grey = PR.paint_mat('sep_grey', '#5a6066', 0.45, 0.1)
    root = bpy.data.objects.new('separator', None)
    col.objects.link(root)
    # bastidor
    L = 3.2  # largo a lo largo de Y
    cy = 0.9
    box('sep_frame_a', (1.3, L, 0.12), (MAG_X, cy, XBELT_Z + 0.55), col, grey)
    for dy in (-L / 2, L / 2):
        cyl('sep_drum%d' % (dy > 0), 0.15, 1.25, (MAG_X - 0.625, cy + dy, XBELT_Z + 0.22), col, M('steel'), rot=(0, math.pi / 2, 0))
    xb = belt_material('belt_cross', 0.8, dur + 2, 'Y')
    box('sep_xbelt_low', (1.15, L, 0.025), (MAG_X, cy, XBELT_Z), col, xb)
    box('sep_xbelt_top', (1.15, L, 0.025), (MAG_X, cy, XBELT_Z + 0.44), col, xb)
    # carcasa del imán (con cara frontal que puede hacerse transparente para el corte)
    hm = principled('sep_housing_m', '#b8262c', 0.4, alpha=0.999)
    housing = box('sep_housing', (1.0, 1.25, 0.34), (MAG_X, 0.0, XBELT_Z + 0.22), col, hm)
    front = box('sep_housing_front', (1.0, 0.02, 0.34), (MAG_X, -0.64, XBELT_Z + 0.22), col, red)
    # imán interno (visible en el corte)
    core = box('sep_core_N', (0.8, 1.0, 0.1), (MAG_X, 0.0, XBELT_Z + 0.1), col, principled('core_n', '#d23c3c', 0.35, coat=0.4))
    core2 = box('sep_core_S', (0.8, 1.0, 0.1), (MAG_X, 0.0, XBELT_Z + 0.2), col, principled('core_s', '#2f5fd0', 0.35, coat=0.4))
    # vigas de suspensión
    for dx in (-0.6, 0.6):
        for dy in (-0.4, 2.0):
            box('sep_hang_%d_%d' % (dx > 0, dy > 0), (0.08, 0.08, 9.5), (MAG_X + dx, cy + dy - 0.8, XBELT_Z + 0.6 + 4.75), col, grey)
    # tolva/chute hacia el contenedor
    chute = box('sep_chute', (1.1, 0.7, 0.05), (MAG_X, 2.55, 1.25), col, M('brushed'))
    chute.rotation_euler = (math.radians(-35), 0, 0)
    # contenedor de acero
    cont = PR.paint_mat('cont_blue', '#2b5f97', 0.5, 0.2)
    for dx, dy, sx, sy in ((0, -0.9, 2.4, 0.06), (0, 0.9, 2.4, 0.06), (-1.2, 0, 0.06, 1.8), (1.2, 0, 0.06, 1.8)):
        box('cont_wall_%d_%d' % (int(dx * 10), int(dy * 10)), (sx, sy, 1.0), CONT + Vector((dx, dy, 0.5)), col, cont)
    box('cont_floor', (2.4, 1.8, 0.06), CONT + Vector((0, 0, 0.03)), col, cont)
    sign('sign_acero', 'ACERO', CONT + Vector((0, -0.95, 1.3)), col, 0.0, 0.22, '#2b5f97')
    return dict(housing=housing, front=front, core=(core, core2))


def build_misc(col):
    rnd = random.Random(8)
    # fardos de material compactado
    mats = {'alu': principled('bale_alu', '#b8bcc2', 0.4, metal=0.8, noise_color=0.35, noise_scale=6),
            'pl': principled('bale_pl', '#4f8fc7', 0.4, noise_color=0.45, noise_scale=7),
            'cb': principled('bale_cb', '#a0784a', 0.8, noise_color=0.35, noise_scale=5)}
    for i in range(14):
        k = rnd.choice(list(mats))
        x = -18 + (i % 7) * 1.3
        y = 7.5 + (i // 7) * 1.3
        for z in range(rnd.randint(1, 3)):
            box('bale_%d_%d' % (i, z), (1.1, 1.1, 1.0), (x, y, 0.5 + z * 1.02), col, mats[k], bevel=0.03)
    for i in range(5):
        box('pallet_%d' % i, (1.2, 1.0, 0.14), (8 + i * 1.5, 8, 0.07), col, M('wood'))
    sign('sign_alu', 'ALUMINIO', (13.5, 0.0, 2.2), col, 0.0, 0.2, '#6b7480')
    sign('sign_pl', 'PLÁSTICOS', (-17.5, 9.0, 3.6), col, 0.0, 0.25, '#2f7a4b')
    sign('sign_safe', 'USO OBLIGATORIO DE CASCO', (-6.0, -13.85, 3.0), col, 0.0, 0.3, '#2050a0')
    # bins por material al final de la línea
    for k, (x, c) in enumerate(((12.8, '#6b7480'), (14.6, '#2f7a4b'))):
        box('line_bin%d' % k, (1.5, 1.5, 1.1), (x, 2.2, 0.55), col, principled('lb%d' % k, c, 0.5, noise_color=0.2))


def build_station(col, loc):
    """Consola de observación con pantalla táctil (frente hacia -Y; el científico se para en -Y)."""
    x, y = loc
    box('st_body', (0.7, 0.45, 1.0), (x, y, 0.5), col, M('grey_plastic'), bevel=0.02)
    top = box('st_top', (0.75, 0.5, 0.05), (x, y - 0.03, 1.05), col, M('black_plastic'), bevel=0.01)
    top.rotation_euler = (math.radians(25), 0, 0)
    scr_m = PR.screen_material('st_screen_m', color='#4fd0ff', strength=1.8, seed=6)
    scr = box('st_screen', (0.6, 0.36, 0.01), (x, y - 0.035, 1.085), col, scr_m)
    scr.rotation_euler = (math.radians(25), 0, 0)
    return scr


def build_plant(dur=40.0):
    col = collection('Plant')
    build_hall(col)
    belt = build_conveyor(col, dur)
    sep = build_separator(col, dur)
    build_misc(col)
    railing('rail_walk', (-14, -1.2, 0), (8, -1.2, 0), col)
    st = build_station(col, (1.6, -1.75))
    # iluminación
    PR.world_sky('PlantWorld', top='#b9c6d1', horizon='#c9cfd3', ground='#5c5a55', strength=0.45)
    sun = PR.sun('plant_sun', (math.radians(35), math.radians(10), math.radians(30)), energy=3.0, angle=0.05)
    PR.area_light('plant_fill_a', (-6, -2, 9), (-6, 0, 0), 2500, size=12, size_y=8, shadow=False, col=col)
    PR.area_light('plant_fill_b', (6, -2, 9), (6, 0, 0), 2500, size=12, size_y=8, shadow=False, col=col)
    PR.area_light('plant_fill_c', (0, -10, 5), (0, 0, 1.5), 1200, size=10, shadow=False, col=col)
    return dict(col=col, belt=belt, sep=sep, station=st)
