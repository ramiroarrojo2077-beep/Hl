"""Pelo procedural en hebras (objeto Curves): cabello peinado, barba corta, bigote y cejas.

Las hebras crecen sobre la superficie de la cabeza siguiendo un campo de peinado y se
mantienen por fuera del cuero cabelludo con proyección sobre un BVH de la malla.
"""
import math
import random
import numpy as np
import bpy
from mathutils import Vector, Matrix, noise
from mathutils.bvhtree import BVHTree

from util import srgb, NodeBuilder, link


def _tri_sample(co, tris, mask_fn, count, rnd):
    v0, v1, v2 = co[tris[:, 0]], co[tris[:, 1]], co[tris[:, 2]]
    area = np.linalg.norm(np.cross(v1 - v0, v2 - v0), axis=1) * 0.5
    cen = (v0 + v1 + v2) / 3
    w = area * mask_fn(cen)
    if w.sum() <= 0:
        return np.zeros((0, 3)), np.zeros((0, 3))
    p = w / w.sum()
    idx = rnd.choice(len(tris), size=count, p=p)
    r1 = rnd.random(count)
    r2 = rnd.random(count)
    s = np.sqrt(r1)
    a, b, c = 1 - s, s * (1 - r2), s * r2
    pts = v0[idx] * a[:, None] + v1[idx] * b[:, None] + v2[idx] * c[:, None]
    nrm = np.cross(v1[idx] - v0[idx], v2[idx] - v0[idx])
    nrm /= np.linalg.norm(nrm, axis=1, keepdims=True)
    return pts, nrm


def hair_material(name, color, grey=0.2, root_dark=0.5):
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    p = nb.n('ShaderNodeBsdfPrincipled')
    info = nb.n('ShaderNodeHairInfo')
    base = srgb(color)
    # variación por hebra + canas
    rnd = nb.n('ShaderNodeMath', _operation='GREATER_THAN')
    nb.link(info.outputs['Random'], rnd.inputs[0])
    rnd.inputs[1].default_value = 1.0 - grey
    m1 = nb.n('ShaderNodeMix', _data_type='RGBA')
    nb.link(info.outputs['Random'], m1.inputs['Factor'])
    m1.inputs[6].default_value = tuple(c * 0.7 for c in base[:3]) + (1,)
    m1.inputs[7].default_value = tuple(min(1, c * 1.15) for c in base[:3]) + (1,)
    m2 = nb.n('ShaderNodeMix', _data_type='RGBA')
    nb.link(rnd.outputs[0], m2.inputs['Factor'])
    nb.link(m1.outputs[2], m2.inputs[6])
    m2.inputs[7].default_value = srgb('#8a857e')
    # raíz más oscura
    rr = nb.n('ShaderNodeMapRange', **{'From Min': 0.0, 'From Max': 0.4, 'To Min': 1 - root_dark, 'To Max': 1.0})
    nb.link(info.outputs['Intercept'], rr.inputs['Value'])
    m3 = nb.n('ShaderNodeMix', _data_type='RGBA', _blend_type='MULTIPLY')
    m3.inputs['Factor'].default_value = 1.0
    nb.link(m2.outputs[2], m3.inputs[6])
    cr = nb.n('ShaderNodeCombineColor')
    for k in ('Red', 'Green', 'Blue'):
        nb.link(rr.outputs[0], cr.inputs[k])
    nb.link(cr.outputs[0], m3.inputs[7])
    nb.link(m3.outputs[2], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.55
    p.inputs['Specular IOR Level'].default_value = 0.35
    p.inputs['Anisotropic'].default_value = 0.4
    p.inputs['Coat Weight'].default_value = 0.0
    nb.output(p.outputs['BSDF'])
    return mat


def _curves_object(name, strands, radius_root, radius_tip, col, mat):
    nseg = len(strands[0])
    cv = bpy.data.hair_curves.new(name)
    cv.add_curves([nseg] * len(strands))
    pos = np.asarray(strands, dtype=np.float32).reshape(-1, 3)
    cv.position_data.foreach_set('vector', pos.ravel())
    rad = np.tile(np.linspace(radius_root, radius_tip, nseg), len(strands)).astype(np.float32)
    ra = cv.attributes.get('radius') or cv.attributes.new('radius', 'FLOAT', 'POINT')
    ra.data.foreach_set('value', rad)
    cv.materials.append(mat)
    ob = bpy.data.objects.new(name, cv)
    link(ob, col)
    return ob


def _grow(roots, normals, dir_fn, length_fn, bvh, nseg, lift_fn, rnd, flat=0.0):
    out = []
    for r, n in zip(roots, normals):
        L = length_fn(r)
        if L <= 0.0005:
            continue
        seg = L / (nseg - 1)
        p = Vector(r)
        nv = Vector(n)
        pts = [p.copy()]
        d = Vector(dir_fn(r, n))
        d = (d - nv * d.dot(nv) * flat)
        d = (d + nv * lift_fn(r, 0.0)).normalized()
        for k in range(1, nseg):
            t = k / (nseg - 1)
            jitter = noise.noise_vector(p * 120.0) * 0.15
            nd = Vector(dir_fn(tuple(p), tuple(nv)))
            d = (d * 0.55 + nd * 0.45 + jitter * 0.3).normalized()
            q = p + d * seg
            loc, nrm, idx, dist = bvh.find_nearest(q)
            if loc is not None:
                need = lift_fn(r, t)
                rel = q - loc
                if rel.dot(nrm) < need:
                    q = loc + nrm * need
                nv = nrm
            # gravedad leve hacia el final
            q.z -= seg * 0.15 * t * t
            d = (q - p).normalized()
            p = q
            pts.append(p.copy())
        out.append([tuple(v) for v in pts])
    return out


def build_hair(info, col, color='#3a2c22', grey=0.25, beard=True, seed=3, density=1.0):
    rnd = np.random.default_rng(seed)
    body = info['body']
    me = body.data
    co = np.array([v.co for v in me.vertices])
    me.calc_loop_triangles()
    tris = np.array([t.vertices[:] for t in me.loop_triangles])
    bvh = BVHTree.FromPolygons([tuple(v) for v in co], [tuple(t) for t in tris])
    J = info['joints']
    eL, eR = np.array(J['eye.L']), np.array(J['eye.R'])
    em = (eL + eR) / 2
    H = em + np.array([0, 0.075, 0.03])        # centro aproximado del cráneo
    nose = np.array(J['nose'])
    mouth = np.array(J['mouth'])
    face_y = nose[1]

    def rel(p):
        return np.asarray(p) - H

    # --- Cuero cabelludo ---------------------------------------------------
    def scalp_mask(c):
        r = c - H
        z = r[:, 2]
        y = r[:, 1]
        x = np.abs(r[:, 0])
        # línea de nacimiento: alta en la frente, baja en la nuca
        front = np.clip((-y - 0.02) / 0.06, 0, 1)        # 1 en la frente
        back = np.clip((y - 0.0) / 0.07, 0, 1)            # 1 en la nuca
        zline = 0.028 * front + (-0.03) * (1 - front) * (1 - back) + (-0.105) * back
        # sienes: entradas leves
        temple = np.exp(-((x - 0.055) / 0.02) ** 2) * front * 0.012
        ok = z > zline + temple
        # excluir orejas
        ear = (x > 0.06) & (z < -0.0) & (np.abs(y - 0.005) < 0.04)
        # excluir cara
        facezone = (y < -0.04) & (z < 0.03)
        return (ok & ~ear & ~facezone).astype(float) * (np.abs(r[:, 0]) < 0.11) * (c[:, 2] > em[2] - 0.15)

    # Pelo como malla (shell) sobre el cuero cabelludo: mucho más barato que hebras en EEVEE
    hair = _shell(info, col, co, scalp_mask, H, color, grey, kind='hair')
    objs = [hair]

    # --- Cejas --------------------------------------------------------------
    def brow_mask(c):
        out = np.zeros(len(c))
        for e in (eL, eR):
            r = c - e
            x = r[:, 0] * np.sign(e[0])
            zc = 0.019 + 0.006 * np.exp(-((x - 0.004) / 0.018) ** 2) - 0.004 * np.clip(x / 0.03, 0, 1) ** 2
            w = 0.0055 * (1 - 0.45 * np.clip(x / 0.03, 0, 1))
            ok = (x > -0.02) & (x < 0.032) & (np.abs(r[:, 2] - zc) < w) & (r[:, 1] < -0.005)
            out = np.maximum(out, ok.astype(float))
        return out

    broots, bnrms = _tri_sample(co, tris, brow_mask, int(1600 * density), rnd)

    def brow_dir(p, n):
        s = 1.0 if p[0] > 0 else -1.0
        r = np.asarray(p) - (eL if s > 0 else eR)
        x = r[0] * s
        d = np.array([s * 1.0, 0.0, 0.35 if x < 0 else -0.05])
        n = np.asarray(n)
        d = d - n * np.dot(d, n)
        return d / max(np.linalg.norm(d), 1e-9)

    bstr = _grow(broots, bnrms, brow_dir, lambda p: 0.0075 + 0.003 * random.random(), bvh, 5,
                 lambda p, t: 0.0004 + 0.0012 * t, rnd, flat=1.0)
    bm = hair_material(info['name'] + '_browmat', color, grey=grey * 0.6, root_dark=0.2)
    objs.append(_curves_object(info['name'] + '_brows', bstr, 0.00009, 0.00004, col, bm))

    # --- Barba corta: malla fina con textura de vello ----------------------------
    if beard:
        def beard_mask(c):
            zone = (c[:, 2] < em[2] - 0.035) & (c[:, 1] < H[1] + 0.03) & (c[:, 2] > mouth[2] - 0.085)
            lips = ((np.abs(c[:, 0] - mouth[0]) / 0.03) ** 2 + ((c[:, 2] - mouth[2]) / 0.0115) ** 2) < 1.0
            cheek_hi = (c[:, 2] > mouth[2] + 0.028) & (np.abs(c[:, 0]) < 0.045)
            nosez = (c[:, 2] > nose[2] - 0.012)
            under = (c[:, 1] > mouth[1] + 0.05) & (c[:, 2] < mouth[2] - 0.05)
            neck = c[:, 2] < mouth[2] - 0.075
            return (zone & ~lips & ~cheek_hi & ~nosez & ~under & ~neck).astype(float)
        objs.append(_shell(info, col, co, beard_mask, H, color, grey * 1.1, kind='beard'))

    rig = info['rig']
    hb = rig.data.bones['head']
    for ob in objs:
        ob.visible_shadow = False  # el pelo no proyecta sombras (costo enorme en EEVEE)
        ob.parent = rig
        ob.parent_type = 'BONE'
        ob.parent_bone = 'head'
        ob.matrix_parent_inverse = (rig.matrix_world @ hb.matrix_local @ Matrix.Translation((0, hb.length, 0))).inverted()
    return objs


def _shell(info, col, co, mask_fn, H, color, grey, kind='hair'):
    """Malla de pelo desplazada sobre la piel, con borde de transparencia y textura de mechones."""
    import bmesh as _bm
    from util import mesh_from_data
    body = info['body']
    me = body.data
    m = mask_fn(co) > 0.5
    faces = [list(p.vertices) for p in me.polygons if p.material_index == 0 and all(m[v] for v in p.vertices)]
    used = sorted({v for f in faces for v in f})
    remap = {v: i for i, v in enumerate(used)}
    vco = co[used].copy()
    nrm = np.array([me.vertices[v].normal for v in used])
    ff = [[remap[v] for v in f] for f in faces]
    # distancia al borde (en anillos) para afinar volumen y transparencia
    nb = [set() for _ in used]
    edge_count = {}
    for f in ff:
        for a, b in zip(f, f[1:] + f[:1]):
            nb[a].add(b)
            nb[b].add(a)
            k = (min(a, b), max(a, b))
            edge_count[k] = edge_count.get(k, 0) + 1
    ring = np.full(len(used), 99)
    frontier = {v for k, c in edge_count.items() if c == 1 for v in k}
    d = 0
    while frontier:
        for v in frontier:
            ring[v] = min(ring[v], d)
        nxt = set()
        for v in frontier:
            for w in nb[v]:
                if ring[w] == 99:
                    nxt.add(w)
        frontier = nxt
        d += 1
    r = vco - H
    if kind == 'hair':
        top = np.clip((r[:, 2] - 0.0) / 0.07, 0, 1)
        thick = 0.004 + 0.013 * top
        taper = np.clip(ring / 4.0, 0, 1)
        off = thick * (0.25 + 0.75 * taper)
        fade = np.clip(ring / 2.5, 0, 1)
    else:
        off = np.full(len(used), 0.0022)
        fade = np.clip(ring / 3.0, 0, 1) * 0.9
    vco = vco + nrm * off[:, None]
    ob = mesh_from_data(info['name'] + '_' + kind, vco, ff, col)
    a = ob.data.color_attributes.new('fade', 'FLOAT_COLOR', 'POINT')
    cols = np.stack([fade, fade, fade, np.ones_like(fade)], 1).astype(np.float32)
    a.data.foreach_set('color', cols.ravel())
    ob.data.materials.append(_shell_material(info['name'] + '_' + kind + 'mat', color, grey, kind))
    add = ob.modifiers.new('Subsurf', 'SUBSURF')
    add.levels = 0
    add.render_levels = 1
    ob.visible_shadow = kind == 'hair'
    return ob


def _shell_material(name, color, grey, kind):
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    p = nb.n('ShaderNodeBsdfPrincipled')
    base = srgb(color)
    tc = nb.n('ShaderNodeTexCoord')
    mp = nb.n('ShaderNodeMapping')
    nb.link(tc.outputs['Object'], mp.inputs['Vector'])
    if kind == 'hair':
        mp.inputs['Scale'].default_value = (420.0, 40.0, 420.0)   # mechones alargados de adelante hacia atrás
    else:
        mp.inputs['Scale'].default_value = (900.0, 900.0, 300.0)
    nz = nb.n('ShaderNodeTexNoise', Scale=1.0, Detail=6.0, Roughness=0.7, Distortion=0.3)
    nb.link(mp.outputs['Vector'], nz.inputs['Vector'])
    nz2 = nb.n('ShaderNodeTexNoise', Scale=60.0, Detail=2.0)
    nb.link(tc.outputs['Object'], nz2.inputs['Vector'])
    # color: oscuro/claro + canas
    ramp = nb.n('ShaderNodeMix', _data_type='RGBA')
    nb.link(nz.outputs['Fac'], ramp.inputs['Factor'])
    ramp.inputs[6].default_value = tuple(c * 0.45 for c in base[:3]) + (1,)
    ramp.inputs[7].default_value = tuple(min(1, c * 1.35) for c in base[:3]) + (1,)
    gr = nb.n('ShaderNodeMath', _operation='GREATER_THAN')
    nb.link(nz.outputs['Fac'], gr.inputs[0])
    gr.inputs[1].default_value = 1.0 - grey * 0.55
    grm = nb.n('ShaderNodeMix', _data_type='RGBA')
    nb.link(gr.outputs[0], grm.inputs['Factor'])
    nb.link(ramp.outputs[2], grm.inputs[6])
    grm.inputs[7].default_value = srgb('#8d877f')
    nb.link(grm.outputs[2], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.5 if kind == 'hair' else 0.75
    p.inputs['Specular IOR Level'].default_value = 0.4
    p.inputs['Sheen Weight'].default_value = 0.6
    p.inputs['Sheen Roughness'].default_value = 0.35
    p.inputs['Sheen Tint'].default_value = (0.8, 0.75, 0.7, 1)
    bump = nb.n('ShaderNodeBump', Strength=0.6 if kind == 'hair' else 0.4, Distance=0.002)
    nb.link(nz.outputs['Fac'], bump.inputs['Height'])
    nb.link(bump.outputs['Normal'], p.inputs['Normal'])
    # transparencia en el borde (línea de nacimiento) con ruido para que no sea un corte limpio
    fa = nb.n('ShaderNodeAttribute', _attribute_name='fade')
    mul = nb.n('ShaderNodeMath', _operation='MULTIPLY')
    nb.link(fa.outputs['Fac'], mul.inputs[0])
    nb.link(nz.outputs['Fac'], mul.inputs[1])
    mul2 = nb.n('ShaderNodeMath', _operation='MULTIPLY', _use_clamp=True)
    nb.link(mul.outputs[0], mul2.inputs[0])
    mul2.inputs[1].default_value = 2.6
    stp = nb.n('ShaderNodeMath', _operation='GREATER_THAN')
    stp.name = 'alpha_step'
    nb.link(mul2.outputs[0], stp.inputs[0])
    stp.inputs[1].default_value = 0.45
    nb.link(stp.outputs[0], p.inputs['Alpha'])  # alfa binaria: sin ruido de tramado a 1 muestra
    nb.output(p.outputs['BSDF'])
    mat.surface_render_method = 'DITHERED'
    return mat
