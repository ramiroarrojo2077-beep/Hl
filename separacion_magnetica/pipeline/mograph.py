"""Motion graphics científicos integrados en el mundo 3D.

Etiquetas flotantes (con línea guía), líneas de campo magnético calculadas (dipolo),
flechas de fuerza, títulos 3D y partículas emisivas. Todo se anima con keyframes.
"""
import math
import random
import numpy as np
import bpy
from mathutils import Vector, Matrix

from util import srgb, NodeBuilder, link, emission_mat, add_modifier
from anim import KeyBuffer

FPS = 30
CYAN = '#38d6ff'
ORANGE = '#ff9a2e'
RED = '#ff4b4b'
BLUE = '#4b8bff'
GREEN = '#57e38a'
WHITE = '#f4f7fb'

_font = None


def font():
    global _font
    if _font is None:
        for p in ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
                  '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'):
            try:
                _font = bpy.data.fonts.load(p, check_existing=True)
                break
            except Exception:
                continue
    return _font


def fade_material(name, color, strength=3.0, alpha=1.0):
    """Material emisivo con factor de opacidad animable (nodo 'fade')."""
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    e = nb.n('ShaderNodeEmission', Color=srgb(color) if isinstance(color, str) else color, Strength=strength)
    tr = nb.n('ShaderNodeBsdfTransparent')
    v = nb.n('ShaderNodeValue')
    v.name = 'fade'
    v.outputs[0].default_value = alpha
    mix = nb.n('ShaderNodeMixShader')
    nb.link(v.outputs[0], mix.inputs['Fac'])
    nb.link(tr.outputs[0], mix.inputs[1])
    nb.link(e.outputs[0], mix.inputs[2])
    nb.output(mix.outputs[0])
    mat.surface_render_method = 'BLENDED'
    return mat


def panel_material(name, color='#050c14', alpha=0.88):
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    e = nb.n('ShaderNodeEmission', Color=srgb(color), Strength=1.0)
    tr = nb.n('ShaderNodeBsdfTransparent')
    v = nb.n('ShaderNodeValue')
    v.name = 'fade'
    v.outputs[0].default_value = alpha
    mul = nb.n('ShaderNodeMath', _operation='MULTIPLY')
    nb.link(v.outputs[0], mul.inputs[0])
    mul.inputs[1].default_value = alpha
    mix = nb.n('ShaderNodeMixShader')
    nb.link(mul.outputs[0], mix.inputs['Fac'])
    nb.link(tr.outputs[0], mix.inputs[1])
    nb.link(e.outputs[0], mix.inputs[2])
    nb.output(mix.outputs[0])
    mat.surface_render_method = 'BLENDED'
    return mat


def key_fade(mat, f_in, f_out=None, dur=8, peak=1.0):
    """Anima el nodo 'fade' de un material: 0 -> peak en f_in, peak -> 0 en f_out."""
    node = mat.node_tree.nodes['fade']
    sock = node.outputs[0]
    pts = [(f_in - 1, 0.0), (f_in + dur, peak)]
    if f_out is not None:
        pts += [(f_out, peak), (f_out + dur, 0.0)]
    for f, v in pts:
        sock.default_value = v
        sock.keyframe_insert('default_value', frame=f)
    sock.default_value = 0.0


def _rounded_rect(name, w, h, r, col, mat):
    verts = []
    seg = 6
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(seg + 1):
            a = math.radians(a0 + 90 * k / seg)
            verts.append((cx + r * math.cos(a), 0, cy + r * math.sin(a)))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], [list(range(len(verts)))])
    ob = bpy.data.objects.new(name, me)
    (col or bpy.context.scene.collection).objects.link(ob)
    me.materials.append(mat)
    ob.visible_shadow = False
    return ob


def label(name, text, anchor, panel_pos, cam, f_in, f_out=None, col=None, size=0.05, color=CYAN, sub=None):
    """Etiqueta flotante: panel + texto + línea guía hacia 'anchor'. Mira siempre a la cámara."""
    root = bpy.data.objects.new(name, None)
    (col or bpy.context.scene.collection).objects.link(root)
    root.location = panel_pos
    tc = root.constraints.new('DAMPED_TRACK') if False else root.constraints.new('TRACK_TO')
    tc.target = cam
    tc.track_axis = 'TRACK_NEGATIVE_Y' if False else 'TRACK_Y'
    tc.up_axis = 'UP_Z'
    # texto (local: X derecha, Z arriba, mira a -Y local -> la restricción orienta +Y hacia la cámara)
    tm = fade_material(name + '_txt', WHITE, 2.2)
    cu = bpy.data.curves.new(name + '_t', 'FONT')
    cu.body = text
    cu.size = size
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    if font():
        cu.font = font()
    t = bpy.data.objects.new(name + '_t', cu)
    (col or bpy.context.scene.collection).objects.link(t)
    t.parent = root
    t.rotation_euler = (math.pi / 2, 0, math.pi)
    t.location = (0, 0.002, 0.012 if sub else 0)
    cu.materials.append(tm)
    t.visible_shadow = False
    mats = [tm]
    lines = 1
    if sub:
        cu2 = bpy.data.curves.new(name + '_s', 'FONT')
        cu2.body = sub
        cu2.size = size * 0.62
        cu2.align_x = 'CENTER'
        cu2.align_y = 'CENTER'
        if font():
            cu2.font = font()
        sm = fade_material(name + '_sub', color, 2.5)
        s2 = bpy.data.objects.new(name + '_s', cu2)
        (col or bpy.context.scene.collection).objects.link(s2)
        s2.parent = root
        s2.rotation_euler = (math.pi / 2, 0, math.pi)
        s2.location = (0, 0.002, -size * 0.55)
        cu2.materials.append(sm)
        s2.visible_shadow = False
        mats.append(sm)
        lines = 2
    w = max(len(text), len(sub or '') * 0.62) * size * 0.62 + size * 0.8
    h = size * (1.5 if lines == 1 else 2.3)
    pm = panel_material(name + '_panel')
    pnl = _rounded_rect(name + '_panel', w, h, size * 0.25, col, pm)
    pnl.parent = root
    pnl.location = (0, 0.006, 0.012 * (0 if not sub else 0) - (size * 0.25 if sub else 0))
    pnl.rotation_euler = (0, 0, math.pi)
    mats.append(pm)
    # barra de color a la izquierda
    bm = fade_material(name + '_bar', color, 4.0)
    bar = _rounded_rect(name + '_bar', size * 0.12, h * 0.8, size * 0.04, col, bm)
    bar.parent = root
    bar.location = (w / 2 - size * 0.2, 0.004, pnl.location.z)
    bar.rotation_euler = (0, 0, math.pi)
    mats.append(bm)
    # línea guía + punto en el ancla
    lm = fade_material(name + '_line', color, 4.0)
    cv = bpy.data.curves.new(name + '_lead', 'CURVE')
    cv.dimensions = '3D'
    cv.bevel_depth = size * 0.035
    sp = cv.splines.new('POLY')
    sp.points.add(1)
    sp.points[0].co = (*anchor, 1)
    sp.points[1].co = (*panel_pos, 1)
    lead = bpy.data.objects.new(name + '_lead', cv)
    (col or bpy.context.scene.collection).objects.link(lead)
    cv.materials.append(lm)
    lead.visible_shadow = False
    dot = bpy.data.objects.new(name + '_dot', bpy.data.meshes.new(name + '_dotm'))
    import bmesh
    bmm = bmesh.new()
    bmesh.ops.create_uvsphere(bmm, u_segments=12, v_segments=8, radius=size * 0.12)
    bmm.to_mesh(dot.data)
    bmm.free()
    dot.data.materials.append(lm)
    dot.location = anchor
    (col or bpy.context.scene.collection).objects.link(dot)
    dot.visible_shadow = False
    mats.append(lm)
    for m in mats:
        key_fade(m, f_in, f_out)
    # pop de escala
    for f, s in ((f_in - 1, 0.6), (f_in + 8, 1.0)):
        root.scale = (s, s, s)
        root.keyframe_insert('scale', frame=f)
    cv.bevel_factor_end = 0.0
    cv.keyframe_insert('bevel_factor_end', frame=f_in - 1)
    cv.bevel_factor_end = 1.0
    cv.keyframe_insert('bevel_factor_end', frame=f_in + 10)
    return root


# ---------------------------------------------------------------------------
# Campo magnético
# ---------------------------------------------------------------------------

def dipole_lines(L=0.12, n=14, max_len=0.6, step=0.003, ring_r=None, planes=4, seed=0):
    """Líneas de campo de un imán de barra modelado como dos cargas magnéticas (polo N en +z).

    Devuelve lista de polilíneas (en coordenadas locales del imán, centro en el origen).
    """
    N = np.array([0, 0, L / 2])
    S = np.array([0, 0, -L / 2])
    rr = ring_r or L * 0.12

    def B(p):
        a = p - N
        b = p - S
        return a / (np.linalg.norm(a) ** 3 + 1e-12) - b / (np.linalg.norm(b) ** 3 + 1e-12)

    lines = []
    for pl in range(planes):
        phi = math.pi * pl / planes
        for k in range(n):
            th = math.radians(12 + 156 * (k + 0.5) / n)
            # punto de partida alrededor del polo N
            d = np.array([math.sin(th) * math.cos(phi), math.sin(th) * math.sin(phi), math.cos(th)])
            p = N + d * rr
            pts = [p.copy()]
            total = 0
            for _ in range(int(max_len / step) * 3):
                v = B(p)
                nv = np.linalg.norm(v)
                if nv < 1e-9:
                    break
                p = p + v / nv * step
                pts.append(p.copy())
                total += step
                if np.linalg.norm(p - S) < rr * 0.9 or total > max_len * 3:
                    break
            if np.linalg.norm(p - S) < rr * 1.5 or total > 0.02:
                lines.append(np.array(pts[::2]))
    return lines


def field_lines_object(name, lines, col, color=CYAN, radius=0.0012, strength=4.0, parent=None):
    mat = fade_material(name + '_mat', color, strength)
    cv = bpy.data.curves.new(name, 'CURVE')
    cv.dimensions = '3D'
    cv.bevel_depth = radius
    cv.bevel_resolution = 1
    for pts in lines:
        sp = cv.splines.new('POLY')
        sp.points.add(len(pts) - 1)
        for q, p in zip(sp.points, pts):
            q.co = (*p, 1)
    cv.materials.append(mat)
    ob = bpy.data.objects.new(name, cv)
    (col or bpy.context.scene.collection).objects.link(ob)
    ob.visible_shadow = False
    if parent is not None:
        ob.parent = parent
    return ob, mat


def grow(curve_obj, f0, f1, mat=None, f_out=None):
    cv = curve_obj.data
    cv.bevel_factor_end = 0.0
    cv.keyframe_insert('bevel_factor_end', frame=f0)
    cv.bevel_factor_end = 1.0
    cv.keyframe_insert('bevel_factor_end', frame=f1)
    if mat is not None:
        key_fade(mat, f0, f_out, dur=max(4, (f1 - f0) // 3))


def flow_particles(name, lines, col, count=60, color=CYAN, size=0.0025, f0=1, f1=300, speed=0.25, parent=None, seed=1):
    """Partículas emisivas que viajan a lo largo de las líneas de campo (N -> S)."""
    rnd = random.Random(seed)
    mat = fade_material(name + '_mat', color, 8.0)
    import bmesh
    me = bpy.data.meshes.new(name + '_m')
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=size)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    obs = []
    for i in range(count):
        ln = lines[rnd.randrange(len(lines))]
        seg = np.linalg.norm(np.diff(ln, axis=0), axis=1)
        cum = np.concatenate([[0], np.cumsum(seg)])
        ob = bpy.data.objects.new('%s%03d' % (name, i), me)
        (col or bpy.context.scene.collection).objects.link(ob)
        ob.visible_shadow = False
        if parent is not None:
            ob.parent = parent
        kb = KeyBuffer(ob)
        off = rnd.random() * cum[-1]
        for f in range(f0, f1 + 1, 2):
            s = (off + (f - f0) / FPS * speed) % cum[-1]
            i0 = min(np.searchsorted(cum, s) - 1, len(ln) - 2)
            i0 = max(i0, 0)
            u = (s - cum[i0]) / max(seg[i0], 1e-9)
            p = ln[i0] + (ln[i0 + 1] - ln[i0]) * u
            kb.key_vec('location', f, p)
        kb.write()
        obs.append(ob)
    key_fade(mat, f0, None)
    return obs, mat


def arrow(name, start, end, col, color=ORANGE, radius=0.004, f_in=1, f_out=None, strength=4.0):
    start = Vector(start)
    end = Vector(end)
    d = end - start
    L = d.length
    import bmesh
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    head = min(L * 0.3, radius * 6)
    bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=radius, radius2=radius, depth=L - head,
                          matrix=Matrix.Translation((0, 0, (L - head) / 2)))
    bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=radius * 2.6, radius2=0.0, depth=head,
                          matrix=Matrix.Translation((0, 0, L - head / 2)))
    bm.to_mesh(me)
    bm.free()
    mat = fade_material(name + '_mat', color, strength)
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    (col or bpy.context.scene.collection).objects.link(ob)
    ob.location = start
    ob.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    ob.visible_shadow = False
    key_fade(mat, f_in, f_out)
    for f, s in ((f_in - 1, 0.01), (f_in + 10, 1.0)):
        ob.scale = (1, 1, s)
        ob.keyframe_insert('scale', frame=f)
    return ob, mat


def title_text(name, text, loc, rot, size, col, color=WHITE, f_in=1, f_out=None, extrude=0.01, strength=3.0, sub=None, panel=True):
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = text
    cu.size = size
    cu.extrude = extrude
    cu.bevel_depth = extrude * 0.3
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    if font():
        cu.font = font()
    mat = fade_material(name + '_mat', color, strength)
    cu.materials.append(mat)
    ob = bpy.data.objects.new(name, cu)
    (col or bpy.context.scene.collection).objects.link(ob)
    ob.location = loc
    ob.rotation_euler = rot
    ob.visible_shadow = False
    key_fade(mat, f_in, f_out, dur=14)
    if panel:
        w = len(text) * size * 0.68 + size * 1.2
        pm = panel_material(name + '_panel', '#08131f', 0.78)
        pnl = _rounded_rect(name + '_panel', w, size * 1.9, size * 0.3, col, pm)
        pnl.location = Vector(loc) + Matrix.Rotation(rot[2], 3, 'Z') @ Vector((0, 0.02, 0))
        pnl.rotation_euler = (0, 0, rot[2])
        key_fade(pm, f_in, f_out, dur=14)
        bar = _rounded_rect(name + '_line', w * 0.9, size * 0.07, size * 0.03, col, fade_material(name + '_linem', CYAN, 5.0))
        bar.location = Vector(loc) + Matrix.Rotation(rot[2], 3, 'Z') @ Vector((0, -0.005, -size * 0.78))
        bar.rotation_euler = (0, 0, rot[2])
        key_fade(bar.data.materials[0], f_in + 6, f_out, dur=14)
        for f, s in ((f_in + 5, 0.01), (f_in + 25, 1.0)):
            bar.scale = (s, 1, 1)
            bar.keyframe_insert('scale', frame=f)
    # entrada: leve escala + desplazamiento
    for f, s, dz in ((f_in - 1, 0.85, -0.02), (f_in + 20, 1.0, 0.0)):
        ob.scale = (s, s, s)
        ob.keyframe_insert('scale', frame=f)
    return ob, mat


def sparkles(name, center, radius, col, count=80, color=CYAN, f0=1, f1=200, size=0.003, seed=3, swirl=1.0):
    """Partículas que orbitan suavemente alrededor de un centro (decoración de títulos)."""
    rnd = random.Random(seed)
    import bmesh
    me = bpy.data.meshes.new(name + '_m')
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=size)
    bm.to_mesh(me)
    bm.free()
    mat = fade_material(name + '_mat', color, 10.0)
    me.materials.append(mat)
    c = Vector(center)
    for i in range(count):
        ob = bpy.data.objects.new('%s%03d' % (name, i), me)
        (col or bpy.context.scene.collection).objects.link(ob)
        ob.visible_shadow = False
        kb = KeyBuffer(ob)
        r = radius * rnd.uniform(0.3, 1.0)
        a0 = rnd.uniform(0, 2 * math.pi)
        z0 = rnd.uniform(-0.35, 0.35) * radius
        w = rnd.uniform(0.2, 0.6) * swirl * (1 if rnd.random() < 0.5 else -1)
        for f in range(f0, f1 + 1, 2):
            t = (f - f0) / FPS
            a = a0 + w * t
            p = c + Vector((math.cos(a) * r * 1.6, math.sin(a) * r * 0.5, z0 + 0.02 * math.sin(t * 1.3 + i)))
            kb.key_vec('location', f, p)
        kb.write()
    key_fade(mat, f0, None, dur=20)
    return mat
