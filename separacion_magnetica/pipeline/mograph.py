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
        for p in ('/usr/share/fonts/truetype/montserrat/Montserrat-SemiBold.ttf',
                  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'):
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


def _cam_rot_at(cam, f):
    """Rotación (euler) animada de la cámara en el frame f, leída de sus curvas."""
    e = list(cam.rotation_euler)
    ad = cam.animation_data
    if ad and ad.action:
        for layer in ad.action.layers:
            for strip in layer.strips:
                cb = strip.channelbag(ad.action_slot)
                if cb is None:
                    continue
                for i in range(3):
                    fc = cb.fcurves.find('rotation_euler', index=i)
                    if fc:
                        e[i] = fc.evaluate(f)
    from mathutils import Euler
    return Euler(e, cam.rotation_mode if cam.rotation_mode != 'QUATERNION' else 'XYZ')


def flat_to_camera(root, cam, f0, f1):
    """Reemplaza el TRACK_TO por una orientación paralela al plano de imagen (sin giro aparente
    en etiquetas alejadas del centro cuando la cámara mira muy en picado)."""
    for c in list(root.constraints):
        root.constraints.remove(c)
    # ejes de la etiqueta en coordenadas de cámara: X -> izquierda, Y -> hacia el espectador, Z -> arriba
    R = Matrix(((-1, 0, 0), (0, 0, 1), (0, 1, 0)))
    prev = None
    for f in range(f0, f1 + 1):
        m = _cam_rot_at(cam, f).to_matrix() @ R
        e = m.to_euler('XYZ', prev) if prev else m.to_euler('XYZ')
        prev = e
        root.rotation_euler = e
        root.keyframe_insert('rotation_euler', frame=f)


def label(name, text, anchor, panel_pos, cam, f_in, f_out=None, col=None, size=0.05, color=CYAN, sub=None, flat=False):
    """Etiqueta flotante: panel + texto + línea guía hacia 'anchor'. Mira siempre a la cámara
    (flat=True: paralela al plano de imagen durante f_in..f_out)."""
    root = bpy.data.objects.new(name, None)
    (col or bpy.context.scene.collection).objects.link(root)
    root.location = panel_pos
    # datos para fit_labels(): cámara destino y ventana visible
    root['lbl_cam'] = cam.name
    root['lbl_in'] = int(f_in)
    root['lbl_out'] = int(f_out) if f_out else int(bpy.context.scene.frame_end)
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
    t.location = (0, 0.010, size * 0.24 if sub else 0)   # proporcional al tamaño (en etiquetas chicas el título quedaba fuera del panel)
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
        s2.location = (0, 0.010, -size * 0.55)
        cu2.materials.append(sm)
        s2.visible_shadow = False
        mats.append(sm)
        lines = 2
    w = max(len(text), len(sub or '') * 0.62) * size * 0.62 + size * 0.8
    h = size * (1.5 if lines == 1 else 2.3)
    pm = panel_material(name + '_panel')
    pnl = _rounded_rect(name + '_panel', w, h, size * 0.25, col, pm)
    pnl.parent = root
    pnl.location = (0, 0.0, -(size * 0.25 if sub else 0))
    pnl.rotation_euler = (0, 0, math.pi)
    mats.append(pm)
    # barra de color a la izquierda
    bm = fade_material(name + '_bar', color, 4.0)
    bar = _rounded_rect(name + '_bar', size * 0.12, h * 0.8, size * 0.04, col, bm)
    bar.parent = root
    bar.location = (w / 2 - size * 0.2, 0.005, pnl.location.z)
    bar.rotation_euler = (0, 0, math.pi)
    mats.append(bm)
    # línea guía + punto en el ancla
    lm = fade_material(name + '_line', color, 4.0)
    cv = bpy.data.curves.new(name + '_lead', 'CURVE')
    cv.dimensions = '3D'
    cv.bevel_depth = size * 0.016   # línea fina: se lee como anotación, no como un objeto
    sp = cv.splines.new('POLY')
    sp.points.add(1)
    sp.points[0].co = (*anchor, 1)
    root['lbl_drop'] = h / 2 + (size * 0.25 if sub else 0.0)
    root['lbl_k'] = 1.0
    sp.points[1].co = (*(Vector(panel_pos) - Vector((0, 0, root['lbl_drop']))), 1)   # la guía llega al borde inferior del panel
    lead = bpy.data.objects.new(name + '_lead', cv)
    (col or bpy.context.scene.collection).objects.link(lead)
    cv.materials.append(lm)
    lead.visible_shadow = False
    dot = bpy.data.objects.new(name + '_dot', bpy.data.meshes.new(name + '_dotm'))
    import bmesh
    bmm = bmesh.new()
    bmesh.ops.create_uvsphere(bmm, u_segments=12, v_segments=8, radius=size * 0.06)
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
    if flat:
        flat_to_camera(root, cam, f_in - 1, (f_out or bpy.context.scene.frame_end) + 1)
    return root


def _label_parts(root):
    parts = list(root.children)
    for suf in ('_lead', '_dot'):
        o = bpy.data.objects.get(root.name + suf)
        if o:
            parts.append(o)
    return parts


def fit_labels(sc, margin=0.035, sub_zone=0.2, max_w=0.4):
    """Revisión automática de etiquetas, al guardar cada plano:
    1) cada etiqueta se ve solo mientras está activa la cámara para la que fue pensada
       (antes quedaban líneas guía sueltas después de un corte);
    2) si en su cámara queda cortada por el borde o sobre la zona de subtítulos, se desplaza
       en el plano de la imagen hasta quedar entera y por encima de los subtítulos."""
    from bpy_extras.object_utils import world_to_camera_view as w2c
    marks = sorted([(m.frame, m.camera) for m in sc.timeline_markers if m.camera], key=lambda k: k[0])

    def active(f):
        c = marks[0][1] if marks else sc.camera
        for fr, cm in marks:
            if fr <= f:
                c = cm
        return c

    for root in [o for o in bpy.data.objects if o.get('lbl_cam')]:
        cam = bpy.data.objects.get(root['lbl_cam'])
        if cam is None:
            continue
        f0, f1 = max(1, root['lbl_in']), min(sc.frame_end, root['lbl_out'] + 12)
        parts = _label_parts(root)
        # 1) solo en su cámara
        state = None
        for f in range(1, sc.frame_end + 1):
            on = active(f) is cam
            if on != state:
                for o in parts:
                    o.hide_render = not on
                    o.keyframe_insert('hide_render', frame=f)
                state = on
        # 2) encuadre
        frames = [f for f in range(f0, f1 + 1, 3) if active(f) is cam]
        pnl = bpy.data.objects.get(root.name + '_panel')
        if not frames or pnl is None:
            continue
        # 2a) tamaño máximo en pantalla (~40 % del ancho): en planos macro la etiqueta quedaba gigante
        wmax = 0.0
        for f in frames[::2]:
            sc.frame_set(f)
            cs = [w2c(sc, cam, pnl.matrix_world @ Vector(c)) for c in pnl.bound_box]
            if min(c.z for c in cs) > 0:
                wmax = max(wmax, max(c.x for c in cs) - min(c.x for c in cs))
        if wmax > max_w:
            _scale_label_keys(root, max_w / wmax)
            bpy.context.view_layer.update()
        for _ in range(3):
            dxs, dys = [], []
            for f in frames:
                sc.frame_set(f)
                cs = [w2c(sc, cam, pnl.matrix_world @ Vector(c)) for c in pnl.bound_box]
                if min(c.z for c in cs) <= 0:
                    continue
                xmin, xmax = min(c.x for c in cs), max(c.x for c in cs)
                ymin, ymax = min(c.y for c in cs), max(c.y for c in cs)
                dxs.append(margin - xmin if xmin < margin else ((1 - margin) - xmax if xmax > 1 - margin else 0.0))
                dys.append(sub_zone - ymin if ymin < sub_zone else ((1 - margin) - ymax if ymax > 1 - margin else 0.0))
            if not dxs:
                break
            dx = max(dxs, key=abs)
            dy = max(dys, key=abs)
            if abs(dx) < 1e-3 and abs(dy) < 1e-3:
                break
            sc.frame_set(frames[len(frames) // 2])
            R = cam.matrix_world.to_3x3()
            right, up = (R @ Vector((1, 0, 0))).normalized(), (R @ Vector((0, 1, 0))).normalized()
            p = root.matrix_world.translation.copy()
            c0 = w2c(sc, cam, p)
            kx = (w2c(sc, cam, p + right * 0.01).x - c0.x) / 0.01
            ky = (w2c(sc, cam, p + up * 0.01).y - c0.y) / 0.01
            if abs(kx) < 1e-6 or abs(ky) < 1e-6:
                break
            root.location = root.location + right * (dx / kx * 1.05) + up * (dy / ky * 1.05)
            lead = bpy.data.objects.get(root.name + '_lead')
            if lead:
                lead.data.splines[0].points[1].co = (*_lead_end(root), 1)
            bpy.context.view_layer.update()
        # 3) si con la cámara en movimiento no hay posición fija que sirva, la etiqueta acompaña
        #    a la cámara: se ubica cuadro a cuadro junto a lo que señala, dentro del encuadre
        if cam.data.dof.use_dof:
            # planos macro con poca profundidad de campo: la etiqueta va en el plano de foco (si no, sale borrosa)
            ff = [f for f in range(f0, f1 + 1) if active(f) is cam]
            sc.frame_set(ff[len(ff) // 2])
            d0 = w2c(sc, cam, root.matrix_world.translation).z
            fd = cam.data.dof.focus_distance
            if d0 > 1e-4:
                _scale_label_keys(root, fd / d0)
            _label_follow(sc, cam, root, pnl, ff, margin, sub_zone, focus=True)
            continue
        if _label_bad(sc, cam, pnl, frames, margin, sub_zone):
            ff = [f for f in range(f0, f1 + 1) if active(f) is cam]
            _label_follow(sc, cam, root, pnl, ff, margin, sub_zone)
            r = _occlusion_ratio(sc, cam, pnl, frames[::2])
            if r < 0.97:
                _scale_label_keys(root, r * 0.9)
                _label_follow(sc, cam, root, pnl, ff, margin, sub_zone, depth_k=r * 0.9)
            continue
        # 4) si algún objeto de la escena la tapa, acercarla a la cámara (mismo tamaño aparente)
        r = _occlusion_ratio(sc, cam, pnl, frames[::2])
        if r < 0.97:
            k = r * 0.9
            sc.frame_set(frames[len(frames) // 2])
            cpos = cam.matrix_world.translation.copy()
            root.location = cpos + (root.location - cpos) * k
            _scale_label_keys(root, k)
            lead = bpy.data.objects.get(root.name + '_lead')
            if lead:
                lead.data.splines[0].points[1].co = (*_lead_end(root), 1)
            bpy.context.view_layer.update()


def _is_overlay(ob):
    if ob is None:
        return True
    if ob.name.startswith('lbl_') or ob.name.startswith('arr_') or ob.name.startswith('title'):
        return True
    return any(c.name.startswith('MoGraph') for c in ob.users_collection)


def _occlusion_ratio(sc, cam, pnl, frames):
    """Fracción de la distancia cámara→etiqueta a la que aparece el primer objeto que la tapa (1 = libre)."""
    best = 1.0
    for f in frames:
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        o0 = cam.matrix_world.translation.copy()
        bb = [pnl.matrix_world @ Vector(c) for c in pnl.bound_box]
        lbb = [Vector(c) for c in pnl.bound_box]
        lo = Vector((min(c.x for c in lbb), min(c.y for c in lbb), min(c.z for c in lbb)))
        hi = Vector((max(c.x for c in lbb), max(c.y for c in lbb), max(c.z for c in lbb)))
        pts = []
        for i in range(5):
            for j in range(3):
                u, v = 0.08 + 0.84 * i / 4, 0.15 + 0.7 * j / 2
                # rejilla sobre la cara del panel (plano local de mayor extensión)
                loc = Vector((lo.x + (hi.x - lo.x) * u, lo.y + (hi.y - lo.y) * (u if (hi.y - lo.y) > (hi.z - lo.z) else 0.5),
                              lo.z + (hi.z - lo.z) * v))
                pts.append(pnl.matrix_world @ loc)
        for pt in pts:
            d = pt - o0
            dist = d.length
            dn = d / dist
            o = o0.copy()
            for _ in range(8):
                rem = dist - (o - o0).length
                if rem <= 0.002:
                    break
                hit, loc, n, i, ob, m = sc.ray_cast(dg, o, dn, distance=rem)
                if not hit:
                    break
                if _is_overlay(ob) or ob.hide_render:
                    o = loc + dn * 0.002
                    continue
                best = min(best, (loc - o0).length / dist)
                break
    return best


def separate_labels(sc, pad=0.015):
    """Si dos etiquetas fijas de la misma cámara se superponen en pantalla al mismo tiempo,
    desplaza la segunda hacia abajo (o arriba si no entra) en el plano de la imagen."""
    from bpy_extras.object_utils import world_to_camera_view as w2c
    roots = [o for o in bpy.data.objects if o.get('lbl_cam') and not (o.animation_data and o.animation_data.action
             and any(fc.data_path == 'location' for l in o.animation_data.action.layers for st in l.strips
                     for cb in st.channelbags for fc in cb.fcurves))]
    roots.sort(key=lambda o: o['lbl_in'])
    for i, b in enumerate(roots):
        for a in roots[:i]:
            if a['lbl_cam'] != b['lbl_cam']:
                continue
            lo, hi = max(a['lbl_in'], b['lbl_in']), min(a['lbl_out'], b['lbl_out'])
            if hi <= lo:
                continue
            cam = bpy.data.objects[b['lbl_cam']]
            sc.frame_set((lo + hi) // 2)
            pa, pb = bpy.data.objects.get(a.name + '_panel'), bpy.data.objects.get(b.name + '_panel')
            if not pa or not pb:
                continue
            ca = [w2c(sc, cam, pa.matrix_world @ Vector(c)) for c in pa.bound_box]
            cb_ = [w2c(sc, cam, pb.matrix_world @ Vector(c)) for c in pb.bound_box]
            ax0, ax1, ay0, ay1 = min(c.x for c in ca), max(c.x for c in ca), min(c.y for c in ca), max(c.y for c in ca)
            bx0, bx1, by0, by1 = min(c.x for c in cb_), max(c.x for c in cb_), min(c.y for c in cb_), max(c.y for c in cb_)
            if bx1 < ax0 or bx0 > ax1 or by1 < ay0 or by0 > ay1:
                continue
            dy = (ay0 - pad) - by1 if (by0 + by1) / 2 < (ay0 + ay1) / 2 else (ay1 + pad) - by0
            if by0 + dy < 0.2:
                dy = (ay1 + pad) - by0
            R = cam.matrix_world.to_3x3()
            up = (R @ Vector((0, 1, 0))).normalized()
            p = b.matrix_world.translation.copy()
            c0 = w2c(sc, cam, p)
            ky = (w2c(sc, cam, p + up * 0.01).y - c0.y) / 0.01
            if abs(ky) > 1e-6:
                b.location = b.location + up * (dy / ky)
                lead = bpy.data.objects.get(b.name + '_lead')
                if lead:
                    lead.data.splines[0].points[1].co = (*_lead_end(b), 1)
                bpy.context.view_layer.update()


def _label_bad(sc, cam, pnl, frames, margin, sub_zone):
    from bpy_extras.object_utils import world_to_camera_view as w2c
    for f in frames:
        sc.frame_set(f)
        cs = [w2c(sc, cam, pnl.matrix_world @ Vector(c)) for c in pnl.bound_box]
        if min(c.z for c in cs) <= 0:
            return True
        if min(c.x for c in cs) < margin * 0.5 or max(c.x for c in cs) > 1 - margin * 0.5:
            return True
        if min(c.y for c in cs) < sub_zone * 0.9 or max(c.y for c in cs) > 1 - margin * 0.5:
            return True
    return False


def _lead_end(root, loc=None):
    loc = Vector(root.location if loc is None else loc)
    return loc - Vector((0, 0, root.get('lbl_drop', 0.0) * root.get('lbl_k', 1.0)))


def _scale_label_keys(root, k):
    root['lbl_k'] = root.get('lbl_k', 1.0) * k
    ad = root.animation_data
    if ad and ad.action:
        for layer in ad.action.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    for fc in cb.fcurves:
                        if fc.data_path == 'scale':
                            for kp in fc.keyframe_points:
                                kp.co.y *= k
                                kp.handle_left.y *= k
                                kp.handle_right.y *= k
    else:
        root.scale = root.scale * k


def _label_follow(sc, cam, root, pnl, frames, margin, sub_zone, depth_k=1.0, focus=False):
    from bpy_extras.object_utils import world_to_camera_view as w2c
    dot = bpy.data.objects.get(root.name + '_dot')
    lead = bpy.data.objects.get(root.name + '_lead')
    if not frames or dot is None:
        return
    anchor = dot.matrix_world.translation.copy()
    sc.frame_set(frames[0])
    a0 = w2c(sc, cam, anchor)
    p0 = w2c(sc, cam, root.matrix_world.translation)
    off = Vector((p0.x - a0.x, p0.y - a0.y))
    if off.length < 0.08:
        off = Vector((0.0, 0.14))
    depth = p0.z * depth_k
    if depth_k != 1.0:
        off = Vector((p0.x - a0.x, p0.y - a0.y)) if root.get('lbl_off') is None else Vector(root['lbl_off'])
    root['lbl_off'] = (off.x, off.y)
    for f in frames:
        sc.frame_set(f)
        a = w2c(sc, cam, anchor)
        if focus:
            depth = cam.data.dof.focus_distance
        for _ in range(2):
            cs = [w2c(sc, cam, pnl.matrix_world @ Vector(c)) for c in pnl.bound_box]
            c = w2c(sc, cam, root.matrix_world.translation)
            hx = max(abs(k.x - c.x) for k in cs) + 0.01
            hy = max(abs(k.y - c.y) for k in cs) + 0.01
            x = min(max(a.x + off.x, margin + hx + 0.01), 1 - margin - hx - 0.01)
            y = min(max(a.y + off.y, sub_zone + hy), 1 - margin - hy)
            vf = cam.data.view_frame(scene=sc)          # esquinas: sup-der, inf-der, inf-izq, sup-izq
            tr, br, bl, tl = vf

            def place(yy):
                pl = bl + (br - bl) * x + (tl - bl) * yy
                pl = pl * (depth / -pl.z)
                w = cam.matrix_world @ pl
                root.location = w
                bpy.context.view_layer.update()
                return w
            w = place(y)
            if focus:
                # en foco no se puede adelantar: si algo la tapa (p. ej. el vidrio del recipiente), subirla
                ymax = 1 - margin - hy - 0.03
                while y < ymax and _occlusion_ratio(sc, cam, pnl, [f]) < 0.98:
                    y = min(y + 0.03, ymax)
                    w = place(y)
        root.keyframe_insert('location', frame=f)
        if lead:
            pt = lead.data.splines[0].points[1]
            pt.co = (*_lead_end(root, w), 1)
            pt.keyframe_insert('co', frame=f)


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


FIELD_BLUE = '#1d8fe6'   # azul saturado: las líneas de campo se leen sobre paredes blancas y cielo claro


def field_lines_object(name, lines, col, color=CYAN, radius=0.0012, strength=4.0, parent=None):
    if color == CYAN:
        color, strength = FIELD_BLUE, min(strength, 3.2)
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
