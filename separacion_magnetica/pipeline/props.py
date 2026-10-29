"""Biblioteca de utilería procedural (laboratorio e industria)."""
import math
import random
import numpy as np
import bpy
import bmesh
from mathutils import Vector, Matrix

from util import srgb, NodeBuilder, link, principled, emission_mat, add_modifier


# ---------------------------------------------------------------------------
# Materiales compartidos
# ---------------------------------------------------------------------------

def M(name):
    lib = {
        'glass': lambda: principled('glass', '#cfdde6', rough=0.06, spec=1.0, coat=1.0),
        'glass_hero': lambda: glass_mat('glass_hero', alpha=0.06, refl=0.35),   # menos reflejo: se ve la arena y su volumen
        'steel': lambda: principled('steel', '#b9bcc0', rough=0.28, metal=1.0, noise_color=0.05, noise_scale=30),
        'brushed': lambda: principled('brushed', '#a8acb0', rough=0.38, metal=1.0, noise_color=0.08, noise_scale=80),
        'chrome': lambda: principled('chrome_p', '#e0e0e0', rough=0.08, metal=1.0),
        'white_lam': lambda: principled('white_lam', '#e8e9e6', rough=0.4, noise_color=0.03),
        'bench_top': lambda: principled('bench_top', '#2b2e33', rough=0.35, noise_color=0.08, noise_scale=12, coat=0.3),
        'floor_lab': lambda: principled('floor_lab', '#b8bcbf', rough=0.25, noise_color=0.06, noise_scale=4, coat=0.2),
        'wall': lambda: principled('wall', '#dfe3e6', rough=0.7, noise_color=0.02),
        'wall_accent': lambda: principled('wall_accent', '#2f5d7c', rough=0.6),
        'ceiling': lambda: principled('ceiling', '#eef0f0', rough=0.8),
        'black_plastic': lambda: principled('black_plastic', '#141516', rough=0.35),
        'grey_plastic': lambda: principled('grey_plastic', '#6b6f73', rough=0.45),
        'blue_plastic': lambda: principled('blue_plastic', '#1f5fa8', rough=0.35),
        'rubber': lambda: principled('rubber', '#1a1a1a', rough=0.85),
        'wood': lambda: principled('wood', '#8a6240', rough=0.5, noise_color=0.2, noise_scale=6),
        'paper': lambda: principled('paper', '#f3f1ea', rough=0.9),
        'sand': lambda: sand_mat('sand'),
        'iron': lambda: principled('iron', '#2e3033', rough=0.38, metal=0.9, noise_color=0.35, noise_scale=400),
        'magnet_red': lambda: principled('magnet_red', '#c4242a', rough=0.3, coat=0.5),
        'magnet_blue': lambda: principled('magnet_blue', '#1f4fb5', rough=0.3, coat=0.5),
        'sleeve': lambda: plastic_clear('sleeve', '#6fc3ec', alpha=0.3, edge=0.55),   # celeste: se distingue de la bata
        'tray_white': lambda: principled('tray_white', '#f2f2f0', rough=0.3, coat=0.3),
        'liquid_blue': lambda: principled('liquid_blue', '#2a7fd4', rough=0.05),
        'liquid_green': lambda: principled('liquid_green', '#3fbf6a', rough=0.05),
        'liquid_amber': lambda: principled('liquid_amber', '#d98b1c', rough=0.05),
        'screen_dark': lambda: principled('screen_dark', '#0b0d10', rough=0.15),
        'concrete': lambda: principled('concrete', '#8d8b86', rough=0.85, noise_color=0.2, noise_scale=3, bump=60, bump_scale=0.15),
        'asphalt': lambda: principled('asphalt', '#3d3e40', rough=0.9, noise_color=0.25, noise_scale=8, bump=120, bump_scale=0.2),
        'yellow_paint': lambda: principled('yellow_paint', '#e8b400', rough=0.45, noise_color=0.08),
        'safety_green': lambda: principled('safety_green', '#2e8b57', rough=0.5),
        'rust': lambda: rust_mat('rust'),
        'aluminum': lambda: principled('aluminum', '#d4d7da', rough=0.25, metal=1.0),
        'copper': lambda: principled('copper', '#c46a3b', rough=0.25, metal=1.0),
        'nickel': lambda: principled('nickel', '#c7c3b5', rough=0.25, metal=1.0),
        'cobalt': lambda: principled('cobalt', '#7a8aa6', rough=0.3, metal=1.0),
        'plastic_bottle': lambda: plastic_clear('plastic_bottle', tint='#9fd3e8'),
        'belt': lambda: principled('belt', '#1d1e20', rough=0.8, noise_color=0.15, noise_scale=40),
        'grass': lambda: principled('grass', '#4c7a33', rough=0.9, noise_color=0.25, noise_scale=5),
        'glass_facade': lambda: facade_glass('glass_facade'),
    }
    m = bpy.data.materials.get(name if name not in ('chrome',) else 'chrome_p')
    if m is None:
        m = lib[name]()
    return m


def glass_mat(name, tint='#ffffff', alpha=0.12, method='BLENDED', refl=0.7):
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    gl = nb.n('ShaderNodeBsdfGlossy', Roughness=0.03)
    tr = nb.n('ShaderNodeBsdfTransparent', Color=srgb(tint))
    fr = nb.n('ShaderNodeLayerWeight', Blend=0.25)
    mf = nb.n('ShaderNodeMath', _operation='MULTIPLY_ADD')
    nb.link(fr.outputs['Fresnel'], mf.inputs[0])
    mf.inputs[1].default_value = refl
    mf.inputs[2].default_value = alpha
    mix = nb.n('ShaderNodeMixShader')
    nb.link(mf.outputs[0], mix.inputs['Fac'])
    nb.link(tr.outputs[0], mix.inputs[1])
    nb.link(gl.outputs[0], mix.inputs[2])
    nb.output(mix.outputs[0])
    mat.surface_render_method = method
    mat.use_backface_culling = False
    return mat


def plastic_clear(name, tint='#e8f2f7', alpha=0.35, edge=0.0):
    """Plástico translúcido. edge > 0: los bordes (vistos de costado) se ven más opacos, así la pieza se
    distingue sobre fondos claros sin tapar lo que hay adentro."""
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    p = nb.n('ShaderNodeBsdfPrincipled')
    p.inputs['Base Color'].default_value = srgb(tint)
    p.inputs['Roughness'].default_value = 0.15
    if edge > 0:
        lw = nb.n('ShaderNodeLayerWeight', Blend=0.35)
        ma = nb.n('ShaderNodeMath', _operation='MULTIPLY_ADD')
        nb.link(lw.outputs['Facing'], ma.inputs[0])
        ma.inputs[1].default_value = edge
        ma.inputs[2].default_value = alpha
        nb.link(ma.outputs[0], p.inputs['Alpha'])
    else:
        p.inputs['Alpha'].default_value = alpha
    nb.output(p.outputs['BSDF'])
    mat.surface_render_method = 'BLENDED'
    mat.use_backface_culling = False
    return mat


def facade_glass(name):
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    p = nb.n('ShaderNodeBsdfPrincipled')
    p.inputs['Base Color'].default_value = srgb('#4d6f86')
    p.inputs['Metallic'].default_value = 0.7
    p.inputs['Roughness'].default_value = 0.06
    lw = nb.n('ShaderNodeLayerWeight', Blend=0.4)
    mix = nb.n('ShaderNodeMix', _data_type='RGBA')
    nb.link(lw.outputs['Facing'], mix.inputs['Factor'])
    mix.inputs[6].default_value = srgb('#203848')
    mix.inputs[7].default_value = srgb('#9cc3dc')
    nb.link(mix.outputs[2], p.inputs['Base Color'])
    nb.output(p.outputs['BSDF'])
    return mat


def sand_mat(name):
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    p = nb.n('ShaderNodeBsdfPrincipled')
    tc = nb.n('ShaderNodeTexCoord')
    v = nb.n('ShaderNodeTexVoronoi', Scale=450.0)
    nb.link(tc.outputs['Object'], v.inputs['Vector'])
    nz = nb.n('ShaderNodeTexNoise', Scale=150.0, Detail=2.0)
    nb.link(tc.outputs['Object'], nz.inputs['Vector'])
    mix = nb.n('ShaderNodeMix', _data_type='RGBA')
    nb.link(nz.outputs['Fac'], mix.inputs['Factor'])
    mix.inputs[6].default_value = srgb('#b99a6b')
    mix.inputs[7].default_value = srgb('#e2cfa3')
    m2 = nb.n('ShaderNodeMix', _data_type='RGBA')
    nb.link(v.outputs['Color'], m2.inputs['Factor'])
    nb.link(mix.outputs[2], m2.inputs[6])
    m2.inputs[7].default_value = srgb('#f1e6cf')
    nb.link(m2.outputs[2], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.85
    bump = nb.n('ShaderNodeBump', Strength=0.7, Distance=0.001)
    nb.link(v.outputs['Distance'], bump.inputs['Height'])
    nb.link(bump.outputs['Normal'], p.inputs['Normal'])
    nb.output(p.outputs['BSDF'])
    return mat


def rust_mat(name):
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    p = nb.n('ShaderNodeBsdfPrincipled')
    tc = nb.n('ShaderNodeTexCoord')
    nz = nb.n('ShaderNodeTexNoise', Scale=6.0, Detail=8.0, Roughness=0.65)
    nb.link(tc.outputs['Object'], nz.inputs['Vector'])
    ramp = nb.n('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = srgb('#5b5e62')
    ramp.color_ramp.elements[1].position = 0.65
    ramp.color_ramp.elements[1].color = srgb('#7a3e1d')
    nb.link(nz.outputs['Fac'], ramp.inputs['Fac'])
    nb.link(ramp.outputs['Color'], p.inputs['Base Color'])
    mr = nb.n('ShaderNodeMapRange', **{'From Min': 0.35, 'From Max': 0.65, 'To Min': 0.9, 'To Max': 0.1})
    nb.link(nz.outputs['Fac'], mr.inputs['Value'])
    nb.link(mr.outputs[0], p.inputs['Metallic'])
    rr = nb.n('ShaderNodeMapRange', **{'From Min': 0.35, 'From Max': 0.65, 'To Min': 0.35, 'To Max': 0.9})
    nb.link(nz.outputs['Fac'], rr.inputs['Value'])
    nb.link(rr.outputs[0], p.inputs['Roughness'])
    bump = nb.n('ShaderNodeBump', Strength=0.4, Distance=0.004)
    nb.link(nz.outputs['Fac'], bump.inputs['Height'])
    nb.link(bump.outputs['Normal'], p.inputs['Normal'])
    nb.output(p.outputs['BSDF'])
    return mat


def paint_mat(name, color, rough=0.45, dirt=0.15):
    return principled(name, color, rough=rough, noise_color=dirt, noise_scale=5)


# ---------------------------------------------------------------------------
# Primitivas
# ---------------------------------------------------------------------------

def _obj(name, me, col, mat=None, loc=(0, 0, 0), rot=(0, 0, 0)):
    ob = bpy.data.objects.new(name, me)
    (col or bpy.context.scene.collection).objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    if mat is not None:
        me.materials.append(mat)
    return ob


def box(name, size, loc, col=None, mat=None, bevel=0.0, rot=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    ob = _obj(name, me, col, mat, loc, rot)
    if bevel > 0:
        m = add_modifier(ob, 'BEVEL', 'Bevel', width=bevel, segments=2, limit_method='ANGLE')
        me.shade_smooth()
        me.set_sharp_from_angle(angle=math.radians(40)) if hasattr(me, 'set_sharp_from_angle') else None
    return ob


def cyl(name, r, h, loc, col=None, mat=None, seg=32, rot=(0, 0, 0), r2=None, cap=True, smooth=True):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    bmesh.ops.translate(bm, vec=(0, 0, h / 2), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    if smooth:
        me.shade_smooth()
        if hasattr(me, 'set_sharp_from_angle'):
            me.set_sharp_from_angle(angle=math.radians(40))
    return _obj(name, me, col, mat, loc, rot)


def sphere(name, r, loc, col=None, mat=None, seg=24, ring=12, scale=(1, 1, 1)):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=ring, radius=r)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    return _obj(name, me, col, mat, loc)


def lathe(name, profile, loc, col=None, mat=None, seg=40, rot=(0, 0, 0)):
    """Sólido de revolución: profile = [(r, z), ...] de abajo hacia arriba."""
    verts, faces = [], []
    n = len(profile)
    for i in range(seg):
        a = 2 * math.pi * i / seg
        for r, z in profile:
            verts.append((r * math.cos(a), r * math.sin(a), z))
    for i in range(seg):
        j = (i + 1) % seg
        for k in range(n - 1):
            faces.append([i * n + k, j * n + k, j * n + k + 1, i * n + k + 1])
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.shade_smooth()
    return _obj(name, me, col, mat, loc, rot)


def text3d(name, body, loc, size=0.1, col=None, mat=None, extrude=0.0, rot=(math.pi / 2, 0, 0), align='CENTER', font=None):
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.align_x = align
    cu.align_y = 'CENTER'
    if font:
        cu.font = font
    ob = _obj(name, cu, col, mat, loc, rot)
    return ob


# ---------------------------------------------------------------------------
# Utilería de laboratorio
# ---------------------------------------------------------------------------

def beaker(name, loc, r=0.04, h=0.1, col=None, liquid=None, fill=0.5):
    g = lathe(name, [(r * 0.98, 0.001), (r, 0.003), (r, h), (r * 1.06, h + 0.004)], loc, col, M('glass'))
    add_modifier(g, 'SOLIDIFY', 'Solidify', thickness=0.0015)
    bottom = cyl(name + '_base', r * 0.97, 0.003, loc, col, M('glass'))
    if liquid:
        cyl(name + '_liq', r * 0.95, h * fill, (loc[0], loc[1], loc[2] + 0.003), col, M(liquid))
    return g


def flask(name, loc, r=0.05, h=0.16, col=None, liquid=None):
    prof = [(0.001, 0.0), (r * 0.9, 0.002), (r, 0.01), (r * 0.98, h * 0.35), (r * 0.35, h * 0.75), (r * 0.25, h * 0.8), (r * 0.25, h), (r * 0.3, h + 0.004)]
    g = lathe(name, prof, loc, col, M('glass'))
    if liquid:
        lp = [(0.001, 0.003), (r * 0.88, 0.004), (r * 0.94, 0.012), (r * 0.9, h * 0.3), (0.001, h * 0.3)]
        lathe(name + '_liq', lp, loc, col, M(liquid))
    return g


def jar(name, loc, r=0.035, h=0.08, col=None, content=None, label_mat=None):
    g = lathe(name, [(r * 0.95, 0.0), (r, 0.004), (r, h * 0.85), (r * 0.8, h * 0.92), (r * 0.8, h)], loc, col, M('glass'))
    cap = cyl(name + '_cap', r * 0.85, 0.015, (loc[0], loc[1], loc[2] + h), col, M('black_plastic'))
    if content:
        cyl(name + '_c', r * 0.93, h * 0.55, (loc[0], loc[1], loc[2] + 0.003), col, M(content))
    if label_mat:
        lab = cyl(name + '_label', r * 1.01, h * 0.3, (loc[0], loc[1], loc[2] + h * 0.25), col, label_mat, cap=False)
    return g


def microscope(name, loc, col=None, rot=0.0):
    parts = []
    base = box(name + '_base', (0.16, 0.22, 0.03), (0, 0, 0.015), col, M('white_lam'), bevel=0.006)
    arm = box(name + '_arm', (0.05, 0.05, 0.3), (0, 0.08, 0.17), col, M('white_lam'), bevel=0.01)
    arm.rotation_euler = (math.radians(-12), 0, 0)
    stage = box(name + '_stage', (0.13, 0.12, 0.012), (0, -0.01, 0.13), col, M('black_plastic'), bevel=0.003)
    head = box(name + '_head', (0.07, 0.11, 0.06), (0, 0.02, 0.31), col, M('white_lam'), bevel=0.01)
    tube = cyl(name + '_tube', 0.016, 0.1, (0, -0.03, 0.18), col, M('black_plastic'))
    ep1 = cyl(name + '_ep1', 0.011, 0.07, (0.018, 0.05, 0.33), col, M('black_plastic'), rot=(math.radians(-40), 0, 0))
    ep2 = cyl(name + '_ep2', 0.011, 0.07, (-0.018, 0.05, 0.33), col, M('black_plastic'), rot=(math.radians(-40), 0, 0))
    knob = cyl(name + '_knob', 0.025, 0.012, (0.04, 0.08, 0.1), col, M('grey_plastic'), rot=(0, math.radians(90), 0))
    root = bpy.data.objects.new(name, None)
    (col or bpy.context.scene.collection).objects.link(root)
    root.location = loc
    root.rotation_euler = (0, 0, rot)
    for p in (base, arm, stage, head, tube, ep1, ep2, knob):
        p.parent = root
    return root


def monitor(name, loc, w=0.55, h=0.33, col=None, screen_mat=None, rot=0.0, stand=True):
    root = bpy.data.objects.new(name, None)
    (col or bpy.context.scene.collection).objects.link(root)
    root.location = loc
    root.rotation_euler = (0, 0, rot)
    fr = box(name + '_frame', (w, 0.025, h), (0, 0, h / 2 + (0.12 if stand else 0)), col, M('black_plastic'), bevel=0.004)
    sc = box(name + '_screen', (w - 0.02, 0.002, h - 0.02), (0, -0.0135, h / 2 + (0.12 if stand else 0)), col, screen_mat or M('screen_dark'))
    parts = [fr, sc]
    if stand:
        parts.append(box(name + '_neck', (0.04, 0.03, 0.14), (0, 0.02, 0.07), col, M('grey_plastic')))
        parts.append(box(name + '_foot', (0.2, 0.14, 0.012), (0, 0.02, 0.006), col, M('grey_plastic'), bevel=0.003))
    for p in parts:
        p.parent = root
    return root, sc


def screen_material(name, kind='graph', color='#3fc1ff', strength=2.0, seed=0):
    """Pantalla emisiva procedural: gráficos/curvas o interfaz."""
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    tc = nb.n('ShaderNodeTexCoord')
    sep = nb.n('ShaderNodeSeparateXYZ')
    nb.link(tc.outputs['Generated'], sep.inputs[0])
    # rejilla
    # rejilla y curva de trazo grueso: las líneas finas producían muaré y titileo en movimiento
    # pocas líneas, con bordes suaves (umbral duro + líneas muy juntas = interferencia/titileo)
    w1 = nb.n('ShaderNodeTexWave', Scale=1.6, _wave_type='BANDS', _bands_direction='X', Distortion=0.0)
    nb.link(tc.outputs['Generated'], w1.inputs['Vector'])
    g1 = nb.n('ShaderNodeMapRange', _interpolation_type='SMOOTHSTEP', **{'From Min': 0.7, 'From Max': 0.97})
    nb.link(w1.outputs['Fac'], g1.inputs['Value'])
    # curva senoidal
    sw = nb.n('ShaderNodeMath', _operation='MULTIPLY')
    nb.link(sep.outputs['X'], sw.inputs[0])
    sw.inputs[1].default_value = 9.0 + seed * 1.5
    sn = nb.n('ShaderNodeMath', _operation='SINE')
    nb.link(sw.outputs[0], sn.inputs[0])
    sc = nb.n('ShaderNodeMath', _operation='MULTIPLY_ADD')
    nb.link(sn.outputs[0], sc.inputs[0])
    sc.inputs[1].default_value = 0.18
    sc.inputs[2].default_value = 0.5
    dz = nb.n('ShaderNodeMath', _operation='SUBTRACT')
    nb.link(sep.outputs['Z'], dz.inputs[0])
    nb.link(sc.outputs[0], dz.inputs[1])
    ab = nb.n('ShaderNodeMath', _operation='ABSOLUTE')
    nb.link(dz.outputs[0], ab.inputs[0])
    lt = nb.n('ShaderNodeMapRange', _interpolation_type='SMOOTHSTEP', **{'From Min': 0.05, 'From Max': 0.02})
    nb.link(ab.outputs[0], lt.inputs['Value'])
    add = nb.n('ShaderNodeMath', _operation='MAXIMUM')
    nb.link(lt.outputs[0], add.inputs[0])
    g1m = nb.n('ShaderNodeMath', _operation='MULTIPLY')
    nb.link(g1.outputs[0], g1m.inputs[0])
    g1m.inputs[1].default_value = 0.15
    nb.link(g1m.outputs[0], add.inputs[1])
    base = nb.n('ShaderNodeMix', _data_type='RGBA')
    nb.link(add.outputs[0], base.inputs['Factor'])
    base.inputs[6].default_value = srgb('#06121c')
    base.inputs[7].default_value = srgb(color)
    em = nb.n('ShaderNodeEmission', Strength=strength)
    nb.link(base.outputs[2], em.inputs['Color'])
    nb.output(em.outputs[0])
    return mat


def shelf_unit(name, loc, w=1.6, d=0.4, h=2.0, col=None, rot=0.0, seed=1):
    rnd = random.Random(seed)
    before = set(bpy.data.objects)
    root = bpy.data.objects.new(name, None)
    (col or bpy.context.scene.collection).objects.link(root)
    root.location = loc
    root.rotation_euler = (0, 0, rot)
    parts = []
    for sx in (-1, 1):
        parts.append(box(name + '_side%d' % sx, (0.03, d, h), (sx * (w / 2 - 0.015), 0, h / 2), col, M('white_lam')))
    parts.append(box(name + '_back', (w, 0.02, h), (0, d / 2 - 0.01, h / 2), col, M('white_lam')))
    nshelf = 5
    for k in range(nshelf):
        z = 0.08 + k * (h - 0.15) / (nshelf - 1)
        parts.append(box(name + '_sh%d' % k, (w - 0.06, d - 0.02, 0.025), (0, 0, z), col, M('white_lam')))
        if k == nshelf - 1:
            continue
        x = -w / 2 + 0.1
        while x < w / 2 - 0.1:
            kind = rnd.random()
            r = rnd.uniform(0.03, 0.055)
            if kind < 0.35:
                o = jar(name + '_j%d_%d' % (k, int(x * 100)), (x, rnd.uniform(-0.05, 0.05), z + 0.0125), r, rnd.uniform(0.08, 0.16), col,
                        content=rnd.choice(['liquid_amber', 'sand', 'iron', None, 'liquid_blue']))
            elif kind < 0.6:
                o = beaker(name + '_b%d_%d' % (k, int(x * 100)), (x, rnd.uniform(-0.05, 0.05), z + 0.0125), r, rnd.uniform(0.08, 0.14), col,
                           liquid=rnd.choice(['liquid_blue', 'liquid_green', 'liquid_amber', None]), fill=rnd.uniform(0.3, 0.7))
            elif kind < 0.8:
                o = box(name + '_box%d_%d' % (k, int(x * 100)), (rnd.uniform(0.12, 0.25), rnd.uniform(0.15, 0.3), rnd.uniform(0.1, 0.25)),
                        (x, 0, z + 0.0125 + 0.06), col, M(rnd.choice(['blue_plastic', 'grey_plastic', 'paper', 'white_lam'])), bevel=0.004)
                o.location.z = z + 0.0125 + o.dimensions.z / 2 if False else o.location.z
            else:
                o = flask(name + '_f%d_%d' % (k, int(x * 100)), (x, 0, z + 0.0125), r * 1.1, rnd.uniform(0.12, 0.2), col,
                          liquid=rnd.choice(['liquid_blue', 'liquid_green', 'liquid_amber']))
            parts.append(o)
            x += r * 2 + rnd.uniform(0.04, 0.12)
    for ob in set(bpy.data.objects) - before:
        if ob.parent is None and ob is not root:
            ob.parent = root
    return root


def cabinet_run(name, x0, x1, y, col=None, depth=0.6, h=0.9, top_mat=None, rot=0.0, z=0.0):
    """Mesada con bajomesada (frente con puertas y manijas)."""
    root = bpy.data.objects.new(name, None)
    (col or bpy.context.scene.collection).objects.link(root)
    root.location = ((x0 + x1) / 2, y, z)
    root.rotation_euler = (0, 0, rot)
    L = x1 - x0
    parts = [box(name + '_body', (L, depth - 0.04, h - 0.1), (0, 0.02, (h - 0.1) / 2 + 0.06), col, M('white_lam')),
             box(name + '_plinth', (L, depth - 0.1, 0.07), (0, 0.05, 0.035), col, M('grey_plastic')),
             box(name + '_top', (L + 0.02, depth + 0.02, 0.04), (0, 0, h - 0.02), col, top_mat or M('bench_top'), bevel=0.004)]
    n = max(1, int(L / 0.6))
    for i in range(n):
        cx = -L / 2 + (i + 0.5) * L / n
        parts.append(box(name + '_door%d' % i, (L / n - 0.012, 0.012, h - 0.2), (cx, -(depth - 0.04) / 2 + 0.014, (h - 0.1) / 2 + 0.06), col, M('white_lam'), bevel=0.002))
        parts.append(box(name + '_hdl%d' % i, (0.12, 0.018, 0.012), (cx, -(depth - 0.04) / 2 + 0.0, h - 0.17), col, M('brushed'), bevel=0.003))
    for p in parts:
        p.parent = root
    return root


def ceiling_panel(name, loc, size=(1.2, 0.3), col=None, strength=5.0):
    m = emission_mat('led_panel', '#fff6e8', strength)
    fr = box(name + '_fr', (size[0] + 0.04, size[1] + 0.04, 0.03), loc, col, M('grey_plastic'))
    pn = box(name, (size[0], size[1], 0.01), (loc[0], loc[1], loc[2] - 0.016), col, m)
    pn.visible_shadow = False
    fr.visible_shadow = False
    return pn


def area_light(name, loc, target, energy, size=1.0, color=(1, 1, 1), shadow=True, col=None, size_y=None, spread=None):
    l = bpy.data.lights.new(name, 'AREA')
    l.energy = energy
    l.color = color
    if size_y:
        l.shape = 'RECTANGLE'
        l.size = size
        l.size_y = size_y
    else:
        l.size = size
    l.use_shadow = shadow
    l.shadow_filter_radius = 1.5
    if spread:
        l.spread = spread
    ob = bpy.data.objects.new(name, l)
    (col or bpy.context.scene.collection).objects.link(ob)
    ob.location = loc
    d = Vector(target) - Vector(loc)
    ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return ob


def point_light(name, loc, energy, radius=0.1, color=(1, 1, 1), shadow=False, col=None):
    l = bpy.data.lights.new(name, 'POINT')
    l.energy = energy
    l.color = color
    l.shadow_soft_size = radius
    l.use_shadow = shadow
    ob = bpy.data.objects.new(name, l)
    (col or bpy.context.scene.collection).objects.link(ob)
    ob.location = loc
    return ob


def sun(name, rot, energy=3.0, color=(1, 0.96, 0.9), angle=0.03, shadow=True, col=None):
    l = bpy.data.lights.new(name, 'SUN')
    l.energy = energy
    l.color = color
    l.angle = angle
    l.use_shadow = shadow
    l.shadow_filter_radius = 1.5
    ob = bpy.data.objects.new(name, l)
    (col or bpy.context.scene.collection).objects.link(ob)
    ob.rotation_euler = rot
    return ob


def world_sky(name='World', top='#8fb6dd', horizon='#dfe8ef', ground='#5a5650', strength=1.0, sun_dir=None):
    w = bpy.data.worlds.new(name)
    bpy.context.scene.world = w
    nt = w.node_tree if w.node_tree else None
    if nt is None:
        w.use_nodes = True
        nt = w.node_tree
    nt.nodes.clear()
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    norm = nt.nodes.new('ShaderNodeVectorMath')
    norm.operation = 'NORMALIZE'
    nt.links.new(tc.outputs['Generated'], norm.inputs[0])
    sepn = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(norm.outputs[0], sepn.inputs[0])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    cr = ramp.color_ramp
    cr.elements[0].position = 0.45
    cr.elements[0].color = srgb(ground)
    cr.elements[1].position = 0.75
    cr.elements[1].color = srgb(top)
    e = cr.elements.new(0.52)
    e.color = srgb(horizon)
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -1
    mr.inputs['From Max'].default_value = 1
    nt.links.new(sepn.outputs['Z'], mr.inputs['Value'])
    nt.links.new(mr.outputs[0], ramp.inputs['Fac'])
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs['Strength'].default_value = strength
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(bg.outputs[0], out.inputs['Surface'])
    return w
