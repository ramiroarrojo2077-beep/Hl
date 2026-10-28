"""Vestuario del científico generado a partir de los helpers de MakeHuman (tights / skirt).

Las prendas heredan los pesos de esqueleto de los helpers, por lo que deforman con el rig.
Incluye: bata de laboratorio (con cuello, solapas, bolsillos, botones, lapiceras e
identificación), camisa con corbata, pantalón, zapatos, reloj y anteojos.
"""
import math
import numpy as np
import bpy
import bmesh
from mathutils import Vector, Matrix
from scipy.spatial import cKDTree

import mh_loader as mh
from util import srgb, NodeBuilder, link, mesh_from_data, principled, add_modifier


# ---------------------------------------------------------------------------
# Geometría auxiliar (numpy)
# ---------------------------------------------------------------------------

def helper_part(human, group, offset, face_pred=None):
    """Extrae caras de un grupo helper. face_pred(centroides)->máscara booleana."""
    fidx = [i for i, g in enumerate(human.face_groups) if g == group]
    faces = [human.faces[i] for i in fidx]
    co_all = mh.mh_to_blender(human.co) - offset
    if face_pred is not None:
        cents = np.array([co_all[f].mean(0) for f in faces])
        keep = face_pred(cents, faces, co_all)
        faces = [f for f, k in zip(faces, keep) if k]
    used = sorted({v for f in faces for v in f})
    remap = {v: i for i, v in enumerate(used)}
    return co_all[used].copy(), [[remap[v] for v in f] for f in faces], np.array(used)


def adjacency(nv, faces):
    nb = [set() for _ in range(nv)]
    for f in faces:
        for a, b in zip(f, f[1:] + f[:1]):
            nb[a].add(b)
            nb[b].add(a)
    return [np.array(sorted(s)) for s in nb]


def boundary_verts(nv, faces):
    cnt = {}
    for f in faces:
        for a, b in zip(f, f[1:] + f[:1]):
            k = (min(a, b), max(a, b))
            cnt[k] = cnt.get(k, 0) + 1
    bd = np.zeros(nv, bool)
    edges = [k for k, c in cnt.items() if c == 1]
    for a, b in edges:
        bd[a] = bd[b] = True
    return bd, edges


def vertex_normals(co, faces):
    n = np.zeros_like(co)
    for f in faces:
        p = co[f]
        fn = np.zeros(3)
        for i in range(len(f)):
            fn += np.cross(p[i], p[(i + 1) % len(f)])
        for v in f:
            n[v] += fn
    ln = np.linalg.norm(n, axis=1, keepdims=True)
    return n / np.maximum(ln, 1e-9)


def laplacian(co, nbrs, iters=5, lam=0.5, mu=-0.53, pin=None):
    """Suavizado de Taubin (no encoge el volumen)."""
    co = co.copy()
    for _ in range(iters):
        for f in (lam, mu):
            avg = np.array([co[nb].mean(0) if len(nb) else co[i] for i, nb in enumerate(nbrs)])
            d = (avg - co) * f
            if pin is not None:
                d[pin] = 0
            co += d
    return co


def weights_matrix(human, idx_list):
    W = human.weights()
    bones = list(W.keys())
    pos = {v: i for i, v in enumerate(idx_list)}
    M = np.zeros((len(idx_list), len(bones)), np.float32)
    for j, b in enumerate(bones):
        arr = W[b]
        for v, w in arr:
            i = pos.get(int(v))
            if i is not None:
                M[i, j] = w
    return bones, M


def assign_weights(ob, bones, M, top=4):
    for b in bones:
        if ob.vertex_groups.get(b) is None:
            ob.vertex_groups.new(name=b)
    order = np.argsort(-M, axis=1)[:, :top]
    for i in range(M.shape[0]):
        ws = M[i, order[i]]
        s = ws.sum()
        if s <= 0:
            continue
        for j, w in zip(order[i], ws):
            if w > 0.001:
                ob.vertex_groups[bones[j]].add([i], float(w / s), 'REPLACE')


def make_obj(name, co, faces, col, rig, bones=None, M=None, mats=(), mat_idx=None, smooth=True):
    ob = mesh_from_data(name, co, faces, col, smooth=smooth)
    for m in mats:
        ob.data.materials.append(m)
    if mat_idx is not None:
        ob.data.polygons.foreach_set('material_index', np.asarray(mat_idx, dtype=np.int32))
    if bones is not None:
        assign_weights(ob, bones, M)
        ob.parent = rig
        add_modifier(ob, 'ARMATURE', 'Armature', object=rig, use_deform_preserve_volume=False)
    return ob


def transfer_weights(src_co, src_M, dst_co, k=4):
    tree = cKDTree(src_co)
    d, i = tree.query(dst_co, k=k)
    w = 1.0 / np.maximum(d, 1e-5) ** 2
    w /= w.sum(1, keepdims=True)
    return np.einsum('nk,nkb->nb', w, src_M[i])


# ---------------------------------------------------------------------------
# Materiales textiles
# ---------------------------------------------------------------------------

def fabric_material(name, color, rough=0.8, weave_scale=900.0, sheen=0.4, bump=0.12, stripes=None):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    p = nb.n('ShaderNodeBsdfPrincipled')
    base = srgb(color)
    tc = nb.n('ShaderNodeTexCoord')
    # Variación sutil de tono (suciedad / pliegues de uso)
    nz = nb.n('ShaderNodeTexNoise', Scale=8.0, Detail=4.0)
    nb.link(tc.outputs['Object'], nz.inputs['Vector'])
    mixc = nb.n('ShaderNodeMix', _data_type='RGBA')
    nb.link(nz.outputs['Fac'], mixc.inputs['Factor'])
    mixc.inputs[6].default_value = tuple(c * 0.965 for c in base[:3]) + (1,)
    mixc.inputs[7].default_value = base
    col_out = mixc.outputs[2]
    if stripes:
        # rayas diagonales (corbata)
        wv = nb.n('ShaderNodeTexWave', Scale=stripes[0], _wave_type='BANDS', _bands_direction='DIAGONAL')
        nb.link(tc.outputs['Object'], wv.inputs['Vector'])
        th = nb.n('ShaderNodeMath', _operation='GREATER_THAN')
        nb.link(wv.outputs['Fac'], th.inputs[0])
        th.inputs[1].default_value = 0.82
        m2 = nb.n('ShaderNodeMix', _data_type='RGBA')
        nb.link(th.outputs[0], m2.inputs['Factor'])
        nb.link(col_out, m2.inputs[6])
        m2.inputs[7].default_value = srgb(stripes[1])
        col_out = m2.outputs[2]
    nb.link(col_out, p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = rough
    p.inputs['Sheen Weight'].default_value = sheen
    p.inputs['Sheen Roughness'].default_value = 0.5
    p.inputs['Specular IOR Level'].default_value = 0.3
    # Tejido: dos ondas cruzadas
    w1 = nb.n('ShaderNodeTexWave', Scale=weave_scale, _wave_type='BANDS', _bands_direction='X')
    w2 = nb.n('ShaderNodeTexWave', Scale=weave_scale, _wave_type='BANDS', _bands_direction='Z')
    nb.link(tc.outputs['Object'], w1.inputs['Vector'])
    nb.link(tc.outputs['Object'], w2.inputs['Vector'])
    add = nb.n('ShaderNodeMath', _operation='ADD')
    nb.link(w1.outputs['Fac'], add.inputs[0])
    nb.link(w2.outputs['Fac'], add.inputs[1])
    # Arrugas finas
    wn = nb.n('ShaderNodeTexNoise', Scale=25.0, Detail=3.0, Distortion=0.8)
    nb.link(tc.outputs['Object'], wn.inputs['Vector'])
    bn1 = nb.n('ShaderNodeBump', Strength=bump, Distance=0.0004)
    nb.link(add.outputs[0], bn1.inputs['Height'])
    bn2 = nb.n('ShaderNodeBump', Strength=0.18, Distance=0.003)
    nb.link(wn.outputs['Fac'], bn2.inputs['Height'])
    nb.link(bn1.outputs['Normal'], bn2.inputs['Normal'])
    nb.link(bn2.outputs['Normal'], p.inputs['Normal'])
    nb.output(p.outputs['BSDF'])
    return mat


# ---------------------------------------------------------------------------
# Prendas
# ---------------------------------------------------------------------------

def landmarks(info):
    rig = info['rig']
    B = rig.data.bones
    g = lambda n: np.array(B[n].head_local)
    return dict(
        hip=g('upperleg01.L'), knee=g('lowerleg01.L'), ankle=g('foot.L'),
        neck=g('neck01'), head=g('head'), chest=g('spine01'), waist=g('spine04'),
        shoulderL=g('upperarm01.L'), shoulderR=g('upperarm01.R'),
        elbowL=g('lowerarm01.L'), elbowR=g('lowerarm01.R'), wristL=g('wrist.L'), wristR=g('wrist.R'),
    )


def _arm_param(co, L, side):
    """Coordenada a lo largo del brazo (0 hombro .. 1 muñeca) y distancia al eje."""
    s = L['shoulder' + side]
    e = L['elbow' + side]
    w = L['wrist' + side]
    out_t = np.full(len(co), -1.0)
    for a, b, t0, t1 in ((s, e, 0.0, 0.5), (e, w, 0.5, 1.0)):
        d = b - a
        t = np.clip(((co - a) @ d) / (d @ d), 0, 1)
        proj = a + t[:, None] * d
        dist = np.linalg.norm(co - proj, axis=1)
        sel = (dist < 0.09)
        val = t0 + t * (t1 - t0)
        out_t = np.where(sel & (out_t < 0), val, out_t)
    return out_t


def build_coat(info, col, mats):
    human, off, rig = info['human'], info['offset'], info['rig']
    L = landmarks(info)
    hip_z = L['hip'][2]
    neck_z = L['neck'][2]
    v_bottom = L['chest'][2] - 0.06

    def top_pred(c, faces, co_all):
        keep = c[:, 2] > hip_z - 0.05
        ta = np.maximum(_arm_param(c, L, 'L'), _arm_param(c, L, 'R'))
        keep &= ta < 0.955
        # cuello: cortar por encima de la base del cuello
        keep &= c[:, 2] < neck_z + 0.01
        # escote en V (frente)
        front = c[:, 1] < L['chest'][1] - 0.02
        hw = np.clip((c[:, 2] - v_bottom) / (neck_z - v_bottom), 0, 1) * 0.075 + 0.004
        vcut = front & (np.abs(c[:, 0]) < hw) & (c[:, 2] > v_bottom - 0.01)
        return keep & ~vcut

    co, faces, used = helper_part(human, 'helper-tights', off, top_pred)
    bones, M = weights_matrix(human, list(used))
    M = _no_hand_weights(bones, M)
    nrm = vertex_normals(co, faces)
    nbrs = adjacency(len(co), faces)
    tL = _arm_param(co, L, 'L')
    tR = _arm_param(co, L, 'R')
    tarm = np.maximum(tL, tR)
    is_arm = tarm >= 0
    d = np.where(is_arm, 0.017 - 0.004 * np.clip(tarm, 0, 1), 0.021)
    d = np.where(co[:, 2] > neck_z - 0.04, 0.012, d)
    co = co + nrm * d[:, None]
    bd, edges = boundary_verts(len(co), faces)
    co = laplacian(co, nbrs, iters=6)
    # Arrugas de manga: anillos en codo y muñeca
    nrm = vertex_normals(co, faces)
    for t_arm in (tL, tR):
        sel = t_arm >= 0
        wr = np.exp(-((t_arm - 0.5) / 0.08) ** 2) * 0.004 + np.exp(-((t_arm - 0.95) / 0.05) ** 2) * 0.003
        ph = np.sin(t_arm * 2 * math.pi * 9 + co[:, 0] * 40) * wr
        co[sel] += nrm[sel] * ph[sel, None]
    # Faldón: helper-skirt recortado a la altura de la rodilla, abierto adelante
    knee_z = L['knee'][2]

    def skirt_pred(c, faces, co_all):
        keep = c[:, 2] > knee_z + 0.02
        slit = (c[:, 1] < -0.02) & (np.abs(c[:, 0]) < 0.012)
        return keep & ~slit

    sco, sfaces, sused = helper_part(human, 'helper-skirt', off, skirt_pred)
    sb, sM = weights_matrix(human, list(sused))
    # el faldón sigue en parte a las piernas (60 %): el resto del peso de muslo pasa a la pelvis
    leg = [i for i, b in enumerate(sb) if b.startswith('upperleg') or b.startswith('lowerleg')]
    spine5 = sb.index('spine05')
    rootb = sb.index('root')
    for i in leg:
        moved = sM[:, i] * (0.4 if 'lowerleg' not in sb[i] else 1.0)
        sM[:, i] -= moved
        sM[:, rootb] += moved * 0.7
        sM[:, spine5] += moved * 0.3
    sn = vertex_normals(sco, sfaces)
    depth = np.clip((hip_z + 0.1 - sco[:, 2]) / 0.5, 0, 1)
    sco = sco + sn * (0.03 + 0.022 * depth)[:, None]
    # pliegues verticales (más marcados abajo y atrás)
    th = np.arctan2(sco[:, 0], sco[:, 1])
    fold = (0.5 + 0.5 * np.sin(th * 7 + 0.7) * np.sin(th * 3.0 + 1.3)) * depth * 0.012
    back = np.clip(sco[:, 1] * 12, 0.3, 1.0)
    sco = sco + sn * (fold * back)[:, None]
    sco[:, 2] -= depth * 0.0  # mantener largo
    snb = adjacency(len(sco), sfaces)
    sco = laplacian(sco, snb, iters=2)
    # Unir en un solo objeto
    nv = len(co)
    allco = np.vstack([co, sco])
    allf = faces + [[v + nv for v in f] for f in sfaces]
    if sb != bones:
        raise RuntimeError('bone order mismatch')
    Mall = np.vstack([M, sM])
    coat = make_obj(info['name'] + '_coat', allco, allf, col, rig, bones, Mall, mats=[mats['coat']])
    add_modifier(coat, 'SOLIDIFY', 'Solidify', thickness=0.0035, offset=-1.0, use_even_offset=True)
    add_modifier(coat, 'SUBSURF', 'Subsurf', levels=0, render_levels=1)
    coat.modifiers.move(len(coat.modifiers) - 1, len(coat.modifiers) - 1)

    # --- cuello y solapas: tira a lo largo del borde superior/escote ---
    bdv = np.where(bd)[0]
    edges_top = [(a, b) for a, b in edges if co[a, 2] > v_bottom - 0.02 and co[b, 2] > v_bottom - 0.02
                 and not is_arm[a] and not is_arm[b]]
    loop = _order_loop(edges_top)
    if loop:
        _build_collar(info, col, rig, co[loop], M[loop], bones, mats['coat'], v_bottom, neck_z, L)
    # --- detalles: bolsillos, botones, lapiceras, credencial ---
    _coat_details(info, col, rig, coat, allco, Mall, bones, mats, L, v_bottom)
    return coat


def _no_hand_weights(bones, M):
    """Pasa los pesos de muñeca/dedos al antebrazo (las mangas no siguen la mano)."""
    M = M.copy()
    for side in 'LR':
        tgt = bones.index('lowerarm02.' + side)
        for i, b in enumerate(bones):
            if b.endswith('.' + side) and (b.startswith('wrist') or b.startswith('finger') or b.startswith('metacarpal')):
                M[:, tgt] += M[:, i]
                M[:, i] = 0
    return M


def _order_loop(edges):
    if not edges:
        return []
    adj = {}
    for a, b in edges:
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)
    # buscar la cadena más larga (puede ser abierta si el corte la separa)
    best = []
    seen = set()
    for start in adj:
        if start in seen:
            continue
        ends = [v for v in adj if len(adj[v]) == 1]
        s = start
        # recorrer componente
        comp = []
        stack = [start]
        while stack:
            v = stack.pop()
            if v in seen:
                continue
            seen.add(v)
            comp.append(v)
            stack.extend(adj[v])
        cend = [v for v in comp if len(adj[v]) == 1]
        s = cend[0] if cend else comp[0]
        path = [s]
        prev = None
        cur = s
        while True:
            nxt = [v for v in adj[cur] if v != prev and v not in path]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            path.append(cur)
        if len(path) > len(best):
            best = path
    return best


def _build_collar(info, col, rig, pts, Mp, bones, mat, v_bottom, neck_z, L):
    """Cuello volcado + solapas: tira de 4 filas apoyada sobre la bata."""
    n = len(pts)
    center = np.array([0.0, L['neck'][1] + 0.01, 0.0])
    rows = []
    for i in range(n):
        p = pts[i]
        prv = pts[max(i - 1, 0)]
        nxt = pts[min(i + 1, n - 1)]
        tang = nxt - prv
        tang /= max(np.linalg.norm(tang), 1e-9)
        out = p - np.array([0.0, center[1], p[2]])
        out[2] = 0
        out /= max(np.linalg.norm(out), 1e-9)
        # dirección de caída de la solapa: perpendicular a la tangente, hacia afuera/abajo
        surf_out = out
        side_dir = np.cross(tang, surf_out)
        if side_dir[2] > 0:
            side_dir = -side_dir
        hgt = np.clip((p[2] - v_bottom) / (neck_z - v_bottom), 0, 1)
        is_back = p[1] > L['neck'][1] - 0.02
        width = 0.012 + 0.045 * hgt ** 0.8 if not is_back else 0.04
        lift = 0.022 if is_back else 0.004 + 0.012 * hgt
        lat = np.array([np.sign(p[0]) if abs(p[0]) > 1e-4 else 0.0, 0, 0])
        flap = side_dir * 0.6 + lat * 0.4 * (0 if is_back else 1)
        flap /= max(np.linalg.norm(flap), 1e-9)
        r0 = p + surf_out * 0.002
        r1 = p + np.array([0, 0, lift]) + surf_out * 0.006
        r2 = p + np.array([0, 0, lift * 0.6]) + surf_out * 0.012 + flap * width * 0.35
        r3 = p + surf_out * 0.007 + flap * width
        rows.append([r0, r1, r2, r3])
    rows = np.array(rows)
    co = rows.reshape(-1, 3)
    faces = []
    for i in range(n - 1):
        for j in range(3):
            a = i * 4 + j
            faces.append([a, a + 1, a + 5, a + 4])
    Mc = np.repeat(Mp, 4, axis=0)
    ob = make_obj(info['name'] + '_collar', co, faces, col, rig, bones, Mc, mats=[mat])
    add_modifier(ob, 'SOLIDIFY', 'Solidify', thickness=0.003, offset=0.0)
    add_modifier(ob, 'SUBSURF', 'Subsurf', levels=1, render_levels=2)
    return ob


def _surface_patch(bvh, center, right, up, w, h, res=(6, 8), lift=0.003):
    """Parche rectangular proyectado sobre la superficie (bolsillos)."""
    pts = []
    for j in range(res[1] + 1):
        for i in range(res[0] + 1):
            p = center + right * (i / res[0] - 0.5) * w + up * (j / res[1] - 0.5) * h
            loc, nrm, idx, dist = bvh.find_nearest(Vector(p))
            pts.append(np.array(loc) + np.array(nrm) * lift)
    pts = np.array(pts)
    faces = []
    for j in range(res[1]):
        for i in range(res[0]):
            a = j * (res[0] + 1) + i
            faces.append([a, a + 1, a + res[0] + 2, a + res[0] + 1])
    return pts, faces


def _coat_details(info, col, rig, coat, co, M, bones, mats, L, v_bottom):
    name = info['name']
    from mathutils.bvhtree import BVHTree
    me = coat.data
    me.calc_loop_triangles()
    bvh = BVHTree.FromPolygons([tuple(v.co) for v in me.vertices], [tuple(t.vertices) for t in me.loop_triangles])
    front = lambda x, z: _front_point(co, x, z)
    parts = []
    # Bolsillos laterales y bolsillo de pecho
    for sx in (1, -1):
        c = front(sx * 0.115, L['hip'][2] - 0.17)
        parts.append(('pocket_hip_%d' % sx, c, 0.15, 0.15))
    c = front(0.085, L['chest'][2] - 0.01)
    parts.append(('pocket_chest', c, 0.10, 0.11))
    pc = []
    pf = []
    for nm, c, w, h in parts:
        pts, faces = _surface_patch(bvh, c, np.array([1.0, 0, 0]), np.array([0, 0, 1.0]), w, h, lift=0.004)
        base = len(pc)
        pc.extend(pts)
        pf.extend([[v + base for v in f] for f in faces])
    pc = np.array(pc)
    Mp = transfer_weights(co, M, pc)
    pockets = make_obj(name + '_pockets', pc, pf, col, rig, bones, Mp, mats=[mats['coat']])
    add_modifier(pockets, 'SOLIDIFY', 'Solidify', thickness=0.002, offset=0.0)
    add_modifier(pockets, 'BEVEL', 'Bevel', width=0.0012, segments=2)
    # Botones sobre la línea central
    bverts, bfaces = [], []
    zs = np.linspace(v_bottom - 0.005, L['hip'][2] - 0.02, 4)
    for z in zs:
        c = front(0.0, z) + np.array([0, -0.006, 0])
        vv, ff = _disc(c, np.array([0, -1.0, 0]), 0.0075, 0.003, 12)
        base = len(bverts)
        bverts.extend(vv)
        bfaces.extend([[v + base for v in f] for f in ff])
    bverts = np.array(bverts)
    Mb = transfer_weights(co, M, bverts)
    buttons = make_obj(name + '_buttons', bverts, bfaces, col, rig, bones, Mb, mats=[mats['button']], smooth=False)
    add_modifier(buttons, 'BEVEL', 'Bevel', width=0.001, segments=2)
    # Lapiceras en el bolsillo del pecho
    pv, pfc, pmi = [], [], []
    cpk = front(0.085, L['chest'][2] + 0.045)
    for k, (dx, colr) in enumerate(((-0.025, 1), (-0.01, 2), (0.012, 1))):
        c = cpk + np.array([dx, -0.006 - 0.004 * k % 2 * 0.002, -0.02])
        vv, ff = _cylinder(c, np.array([0, 0, 1.0]), 0.0045, 0.11, 10)
        base = len(pv)
        pv.extend(vv)
        pfc.extend([[v + base for v in f] for f in ff])
        pmi.extend([colr] * len(ff))
        # clip
        vv, ff = _box(c + np.array([0, -0.005, 0.035]), (0.0025, 0.0015, 0.03))
        base = len(pv)
        pv.extend(vv)
        pfc.extend([[v + base for v in f] for f in ff])
        pmi.extend([0] * len(ff))
    pv = np.array(pv)
    Mpn = transfer_weights(co, M, pv)
    pens = make_obj(name + '_pens', pv, pfc, col, rig, bones, Mpn,
                    mats=[mats['chrome'], mats['pen_blue'], mats['pen_black']], mat_idx=pmi)
    # Credencial colgada del bolsillo
    cb = front(-0.09, L['chest'][2] - 0.03) + np.array([0, -0.009, 0])
    vv, ff = _box(cb, (0.032, 0.0012, 0.045))
    bv = np.array(vv)
    Mbd = transfer_weights(co, M, bv)
    badge = make_obj(name + '_badge', bv, ff, col, rig, bones, Mbd, mats=[mats['badge']], smooth=False)
    _badge_uv(badge)


def _badge_uv(ob):
    uv = ob.data.uv_layers.new(name='UVMap')
    co = np.array([v.co for v in ob.data.vertices])
    mn, mx = co.min(0), co.max(0)
    vals = []
    for p in ob.data.polygons:
        for li in p.loop_indices:
            v = ob.data.vertices[ob.data.loops[li].vertex_index].co
            vals.append(((v.x - mn[0]) / (mx[0] - mn[0] + 1e-9), (v.z - mn[2]) / (mx[2] - mn[2] + 1e-9)))
    uv.data.foreach_set('uv', np.array(vals, np.float32).ravel())


def _front_point(co, x, z):
    sel = (np.abs(co[:, 2] - z) < 0.02) & (np.abs(co[:, 0] - x) < 0.02) & (co[:, 1] < 0.0)
    if not sel.any():
        sel = (np.abs(co[:, 2] - z) < 0.05) & (co[:, 1] < 0.0)
    cand = co[sel]
    return cand[cand[:, 1].argmin()].copy() if len(cand) else np.array([x, -0.15, z])


def _disc(c, n, r, h, seg):
    n = n / np.linalg.norm(n)
    a = np.cross(n, [0, 0, 1.0])
    if np.linalg.norm(a) < 1e-6:
        a = np.cross(n, [1.0, 0, 0])
    a /= np.linalg.norm(a)
    b = np.cross(n, a)
    verts = []
    for k in (0, 1):
        for i in range(seg):
            t = 2 * math.pi * i / seg
            verts.append(c + n * h * k + (a * math.cos(t) + b * math.sin(t)) * r)
    verts.append(c)
    verts.append(c + n * h)
    faces = []
    for i in range(seg):
        j = (i + 1) % seg
        faces.append([i, j, seg + j, seg + i])
        faces.append([2 * seg, j, i])
        faces.append([2 * seg + 1, seg + i, seg + j])
    return verts, faces


def _cylinder(c, axis, r, length, seg):
    axis = axis / np.linalg.norm(axis)
    vv, ff = _disc(c, axis, r, length, seg)
    return vv, ff


def _box(c, half):
    hx, hy, hz = half
    v = [c + np.array([sx * hx, sy * hy, sz * hz]) for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)]
    f = [[0, 1, 3, 2], [4, 6, 7, 5], [0, 4, 5, 1], [2, 3, 7, 6], [0, 2, 6, 4], [1, 5, 7, 3]]
    return v, f


def build_shirt(info, col, mats):
    human, off, rig = info['human'], info['offset'], info['rig']
    L = landmarks(info)

    def pred(c, faces, co_all):
        tL = _arm_param(c, L, 'L')
        tR = _arm_param(c, L, 'R')
        arm = (tL > 0.45) | (tR > 0.45)
        return (c[:, 2] > L['hip'][2] + 0.0) & (c[:, 2] < L['neck'][2] + 0.035) & ~arm

    co, faces, used = helper_part(human, 'helper-tights', off, pred)
    bones, M = weights_matrix(human, list(used))
    nrm = vertex_normals(co, faces)
    co = co + nrm * 0.005
    co = laplacian(co, adjacency(len(co), faces), iters=3)
    shirt = make_obj(info['name'] + '_shirt', co, faces, col, rig, bones, M, mats=[mats['shirt']])
    shirt.visible_shadow = False
    add_modifier(shirt, 'SUBSURF', 'Subsurf', levels=0, render_levels=1)
    # Cuello de camisa: anillo alrededor del cuello
    nz = L['neck'][2] + 0.005
    ring = co[np.abs(co[:, 2] - nz) < 0.012]
    cx, cy = 0.0, ring[:, 1].mean() if len(ring) else L['neck'][1]
    rad = np.median(np.hypot(ring[:, 0] - cx, ring[:, 1] - cy)) + 0.004 if len(ring) else 0.065
    seg = 28
    rows = []
    for i in range(seg + 1):
        # abierto adelante: de -150 a 150 grados alrededor de +Y (atrás)
        a = math.radians(-160 + 320 * i / seg)
        d = np.array([math.sin(a), math.cos(a), 0])
        p0 = np.array([cx, cy, nz]) + d * rad
        front_drop = max(0.0, math.cos(a)) * 0.0 + (1 - abs(a) / math.radians(160)) * 0.0
        rows.append([p0 - np.array([0, 0, 0.006]), p0 + np.array([0, 0, 0.026]) + d * 0.003,
                     p0 + np.array([0, 0, 0.023]) + d * 0.008, p0 + d * 0.014 + np.array([0, 0, 0.002])])
    rows = np.array(rows)
    cco = rows.reshape(-1, 3)
    cf = []
    for i in range(seg):
        for j in range(3):
            a = i * 4 + j
            cf.append([a, a + 1, a + 5, a + 4])
    Mc = transfer_weights(co, M, cco)
    collar = make_obj(info['name'] + '_shirtcollar', cco, cf, col, rig, bones, Mc, mats=[mats['shirt']])
    add_modifier(collar, 'SOLIDIFY', 'Solidify', thickness=0.0015)
    add_modifier(collar, 'SUBSURF', 'Subsurf', levels=1, render_levels=2)
    # Corbata: nudo + hoja siguiendo el pecho (raycast frontal sobre la camisa)
    from mathutils.bvhtree import BVHTree
    tri = []
    for f in faces:
        for k in range(1, len(f) - 1):
            tri.append((f[0], f[k], f[k + 1]))
    bvh = BVHTree.FromPolygons([tuple(v) for v in co], tri)
    tie_pts = []
    zs = np.linspace(nz - 0.012, L['waist'][2] - 0.04, 20)
    for k, z in enumerate(zs):
        hit = bvh.ray_cast(Vector((0.0, -0.5, z)), Vector((0, 1, 0)))
        p = np.array(hit[0]) if hit[0] is not None else np.array([0, L['chest'][1] - 0.1, z])
        t = k / (len(zs) - 1)
        w = (0.012 if k < 2 else 0.011 + 0.03 * t)
        tie_pts.append((p + np.array([0, -0.006 if k < 2 else -0.004, 0]), w))
    tv, tf = [], []
    for k, (p, w) in enumerate(tie_pts):
        tv.extend([p + np.array([-w, 0.002, 0]), p + np.array([0, -0.003, 0]), p + np.array([w, 0.002, 0])])
    for k in range(len(tie_pts) - 1):
        a = k * 3
        tf.append([a, a + 1, a + 4, a + 3])
        tf.append([a + 1, a + 2, a + 5, a + 4])
    last = tie_pts[-1][0]
    tv.append(last + np.array([0, -0.003, -0.028]))
    a = (len(tie_pts) - 1) * 3
    tf.append([a, a + 1, len(tv) - 1])
    tf.append([a + 1, a + 2, len(tv) - 1])
    tv = np.array(tv)
    Mt = transfer_weights(co, M, tv)
    tie = make_obj(info['name'] + '_tie', tv, tf, col, rig, bones, Mt, mats=[mats['tie']])
    add_modifier(tie, 'SOLIDIFY', 'Solidify', thickness=0.004, offset=0.0)
    add_modifier(tie, 'SUBSURF', 'Subsurf', levels=1, render_levels=2)
    return shirt


def build_pants(info, col, mats):
    human, off, rig = info['human'], info['offset'], info['rig']
    L = landmarks(info)
    ank = L['ankle'][2]

    def pred(c, faces, co_all):
        return (c[:, 2] < L['waist'][2]) & (c[:, 2] > ank + 0.015)

    co, faces, used = helper_part(human, 'helper-tights', off, pred)
    bones, M = weights_matrix(human, list(used))
    nrm = vertex_normals(co, faces)
    co = co + nrm * 0.011
    # piernas rectas: radio mínimo por debajo de la rodilla
    for side in (1, -1):
        sel = (np.sign(co[:, 0]) == side) & (co[:, 2] < L['knee'][2] + 0.1)
        if not sel.any():
            continue
        for zc in np.unique(np.round(co[sel, 2], 2)):
            pass
        knee = L['knee'] * np.array([side, 1, 1])
        ank_c = L['ankle'] * np.array([side, 1, 1]) + np.array([0, -0.01, 0])
        p = co[sel]
        t = np.clip((knee[2] - p[:, 2]) / (knee[2] - ank_c[2]), 0, 1)
        axis_pt = knee + (ank_c - knee) * t[:, None]
        rel = p - axis_pt
        rel[:, 2] = 0
        r = np.linalg.norm(rel, axis=1)
        rmin = 0.058 + 0.004 * t
        scale = np.maximum(1.0, rmin / np.maximum(r, 1e-6))
        p[:, :2] = axis_pt[:, :2] + rel[:, :2] * scale[:, None]
        co[sel] = p
    co = laplacian(co, adjacency(len(co), faces), iters=4)
    # bajada del ruedo
    low = co[:, 2] < ank + 0.05
    co[low, 2] -= 0.025 * np.clip((ank + 0.05 - co[low, 2]) / 0.04, 0, 1)
    pants = make_obj(info['name'] + '_pants', co, faces, col, rig, bones, M, mats=[mats['pants']])
    add_modifier(pants, 'SOLIDIFY', 'Solidify', thickness=0.003, offset=-1.0)
    add_modifier(pants, 'SUBSURF', 'Subsurf', levels=0, render_levels=1)
    return pants


def build_shoes(info, col, mats):
    human, off, rig = info['human'], info['offset'], info['rig']
    L = landmarks(info)
    ank = L['ankle'][2]

    def pred(c, faces, co_all):
        return c[:, 2] < ank + 0.03

    co, faces, used = helper_part(human, 'helper-tights', off, pred)
    bones, M = weights_matrix(human, list(used))
    nb = adjacency(len(co), faces)
    co = laplacian(co, nb, iters=8)
    nrm = vertex_normals(co, faces)
    co = co + nrm * 0.008
    co[:, 2] = np.maximum(co[:, 2], 0.0)
    # alargar punta levemente
    front = co[:, 1] < (L['ankle'][1] - 0.08)
    co[front, 1] -= 0.008
    co[:, 2] = np.where(co[:, 2] < 0.012, 0.0, co[:, 2])
    cents = np.array([co[f].mean(0) for f in faces])
    mi = (cents[:, 2] < 0.016).astype(int)
    shoes = make_obj(info['name'] + '_shoes', co, faces, col, rig, bones, M,
                     mats=[mats['leather'], mats['sole']], mat_idx=mi)
    add_modifier(shoes, 'SUBSURF', 'Subsurf', levels=0, render_levels=1)
    return shoes


def build_watch(info, col, mats):
    rig = info['rig']
    B = rig.data.bones['wrist.L']
    lb = rig.data.bones['lowerarm02.L']
    axis = np.array(B.head_local - lb.head_local)
    axis /= np.linalg.norm(axis)
    c = np.array(B.head_local) - axis * 0.03
    verts, faces = [], []
    seg = 20
    a = np.cross(axis, [0, 0, 1.0])
    a /= np.linalg.norm(a)
    b = np.cross(axis, a)
    rx, ry = 0.031, 0.024
    for k, dz in enumerate((-0.009, 0.009)):
        for i in range(seg):
            t = 2 * math.pi * i / seg
            verts.append(c + axis * dz + a * math.cos(t) * rx + b * math.sin(t) * ry)
    for i in range(seg):
        j = (i + 1) % seg
        faces.append([i, j, seg + j, seg + i])
    strap = mesh_from_data(info['name'] + '_watchstrap', verts, faces, col)
    strap.data.materials.append(mats['strap'])
    add_modifier(strap, 'SOLIDIFY', 'Solidify', thickness=0.003, offset=1.0)
    # esfera del reloj sobre el dorso de la muñeca
    up = b if b[2] > 0 else -b
    face_c = c + up * (ry + 0.002)
    vv, ff = _disc(face_c, up, 0.017, 0.006, 24)
    dial = mesh_from_data(info['name'] + '_watchface', vv, ff, col, smooth=False)
    dial.data.materials.append(mats['chrome'])
    for ob in (strap, dial):
        vg = ob.vertex_groups.new(name='wrist.L')
        vg.add(list(range(len(ob.data.vertices))), 1.0, 'REPLACE')
        ob.parent = rig
        add_modifier(ob, 'ARMATURE', 'Armature', object=rig)
    return strap


def build_glasses(info, col, mats):
    rig = info['rig']
    J = info['joints']
    eL, eR = np.array(J['eye.L']), np.array(J['eye.R'])
    y_front = min(eL[1], eR[1]) - 0.026
    objs = []
    curve = bpy.data.curves.new(info['name'] + '_glassframe', 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = 0.0012
    curve.bevel_resolution = 2
    lens_verts, lens_faces = [], []
    for e in (eL, eR):
        sp = curve.splines.new('POLY')
        pts = []
        n = 28
        for i in range(n):
            t = 2 * math.pi * i / n
            x = math.cos(t) * 0.024
            z = math.sin(t) * 0.017
            # forma rectangular redondeada
            x = np.sign(x) * abs(x) ** 0.8 * 0.024 ** 0.2
            z = np.sign(z) * abs(z) ** 0.8 * 0.017 ** 0.2
            curv = 0.004 * (x / 0.024) ** 2
            pts.append((e[0] + x, y_front + curv, e[2] + 0.002 + z))
        sp.points.add(len(pts) - 1)
        for p, q in zip(sp.points, pts):
            p.co = (*q, 1)
        sp.use_cyclic_u = True
        base = len(lens_verts)
        lens_verts.append((e[0], y_front + 0.0005, e[2] + 0.002))
        lens_verts.extend([(q[0], q[1] + 0.0003, q[2]) for q in pts])
        for i in range(n):
            lens_faces.append([base, base + 1 + i, base + 1 + (i + 1) % n])
    # puente
    sp = curve.splines.new('POLY')
    br = [(eR[0] + 0.024, y_front, eR[2] + 0.005), (0, y_front - 0.002, eR[2] + 0.006),
          (eL[0] - 0.024, y_front, eL[2] + 0.005)]
    sp.points.add(2)
    for p, q in zip(sp.points, br):
        p.co = (*q, 1)
    # patillas hasta las orejas
    for e, s in ((eL, 1), (eR, -1)):
        sp = curve.splines.new('POLY')
        x0 = e[0] + s * 0.026
        tp = [(x0, y_front + 0.002, e[2] + 0.008), (x0 + s * 0.012, y_front + 0.03, e[2] + 0.008),
              (x0 + s * 0.016, y_front + 0.09, e[2] - 0.0), (x0 + s * 0.012, y_front + 0.105, e[2] - 0.025)]
        sp.points.add(3)
        for p, q in zip(sp.points, tp):
            p.co = (*q, 1)
    frame = bpy.data.objects.new(info['name'] + '_glasses', curve)
    link(frame, col)
    curve.materials.append(mats['frame'])
    lens = mesh_from_data(info['name'] + '_lenses', lens_verts, lens_faces, col)
    lens.data.materials.append(mats['lens'])
    for ob in (frame, lens):
        ob.parent = rig
        ob.parent_type = 'BONE'
        ob.parent_bone = 'head'
        ob.visible_shadow = False   # la sombra del marco dibujaba arcos oscuros bajo los ojos
        hb = rig.data.bones['head']
        ob.matrix_parent_inverse = (rig.matrix_world @ hb.matrix_local @ Matrix.Translation((0, hb.length, 0))).inverted()
    return frame


def default_materials(prefix, style):
    from util import principled
    mats = {}
    if style == 'labcoat':
        mats['coat'] = fabric_material(prefix + '_coatmat', '#e6e8e8', rough=0.82, weave_scale=1100, bump=0.0)
        mats['shirt'] = fabric_material(prefix + '_shirtmat', '#8fb2d6', rough=0.7, weave_scale=1400)
        mats['tie'] = fabric_material(prefix + '_tiemat', '#1f2a44', rough=0.45, weave_scale=1600, stripes=(70, '#8a6d2b'))
        mats['pants'] = fabric_material(prefix + '_pantsmat', '#3a3d44', rough=0.75, weave_scale=1300, bump=0.0)
    else:
        mats['coat'] = fabric_material(prefix + '_coatmat', '#f2a01f', rough=0.7)
        mats['shirt'] = fabric_material(prefix + '_shirtmat', '#2f4a6b', rough=0.8)
        mats['tie'] = mats['shirt']
        mats['pants'] = fabric_material(prefix + '_pantsmat', '#24324a', rough=0.85)
    mats['leather'] = principled(prefix + '_leather', '#3b2416', rough=0.32, coat=0.3, bump=600, bump_scale=0.05)
    mats['sole'] = principled(prefix + '_sole', '#141414', rough=0.8)
    mats['button'] = principled(prefix + '_button', '#f4f4f0', rough=0.25, coat=0.5)
    mats['chrome'] = principled(prefix + '_chrome', '#d8d8d8', rough=0.15, metal=1.0)
    mats['pen_blue'] = principled(prefix + '_penblue', '#1a3d8f', rough=0.3, coat=0.6)
    mats['pen_black'] = principled(prefix + '_penblack', '#111111', rough=0.3, coat=0.6)
    mats['strap'] = principled(prefix + '_strap', '#2a1a10', rough=0.5)
    mats['frame'] = principled(prefix + '_frame', '#1b1b1d', rough=0.25, metal=0.6)
    mats['lens'] = principled(prefix + '_lens', '#dfe6e8', rough=0.02, alpha=0.04, spec=0.6)
    mats['badge'] = badge_material(prefix + '_badgemat')
    mats['vest'] = fabric_material(prefix + '_vestmat', '#ff8a00' if style == 'labcoat' else '#ffb300', rough=0.6, weave_scale=700)
    mats['reflective'] = principled(prefix + '_reflect', '#d9dde0', rough=0.25, metal=0.6)
    return mats


def badge_material(name):
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    p = nb.n('ShaderNodeBsdfPrincipled')
    tc = nb.n('ShaderNodeTexCoord')
    sep = nb.n('ShaderNodeSeparateXYZ')
    nb.link(tc.outputs['UV'], sep.inputs[0])
    gt = nb.n('ShaderNodeMath', _operation='GREATER_THAN')
    nb.link(sep.outputs['Y'], gt.inputs[0])
    gt.inputs[1].default_value = 0.72
    mix = nb.n('ShaderNodeMix', _data_type='RGBA')
    nb.link(gt.outputs[0], mix.inputs['Factor'])
    mix.inputs[6].default_value = srgb('#f5f5f5')
    mix.inputs[7].default_value = srgb('#1e5fa8')
    nb.link(mix.outputs[2], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.2
    p.inputs['Coat Weight'].default_value = 0.8
    nb.output(p.outputs['BSDF'])
    return mat


def build_work_shirt(info, col, mats):
    """Camisa de trabajo de manga larga (operarios)."""
    human, off, rig = info['human'], info['offset'], info['rig']
    L = landmarks(info)

    def pred(c, faces, co_all):
        ta = np.maximum(_arm_param(c, L, 'L'), _arm_param(c, L, 'R'))
        return (c[:, 2] > L['hip'][2] - 0.04) & (c[:, 2] < L['neck'][2] + 0.03) & (ta < 0.95)

    co, faces, used = helper_part(human, 'helper-tights', off, pred)
    bones, M = weights_matrix(human, list(used))
    M = _no_hand_weights(bones, M)
    nrm = vertex_normals(co, faces)
    co = co + nrm * 0.009
    co = laplacian(co, adjacency(len(co), faces), iters=4)
    ob = make_obj(info['name'] + '_shirt', co, faces, col, rig, bones, M, mats=[mats['shirt']])
    add_modifier(ob, 'SOLIDIFY', 'Solidify', thickness=0.002, offset=-1.0)
    add_modifier(ob, 'SUBSURF', 'Subsurf', levels=0, render_levels=1)
    return ob


def build_vest(info, col, mats, over_coat=False):
    """Chaleco de alta visibilidad con bandas reflectivas."""
    human, off, rig = info['human'], info['offset'], info['rig']
    L = landmarks(info)
    z0 = L['hip'][2] - (0.0 if over_coat else 0.02)

    def pred(c, faces, co_all):
        ta = np.maximum(_arm_param(c, L, 'L'), _arm_param(c, L, 'R'))
        front_open = (c[:, 1] < L['chest'][1] - 0.03) & (np.abs(c[:, 0]) < 0.02)
        vneck = (c[:, 1] < L['chest'][1]) & (np.abs(c[:, 0]) < 0.07 * np.clip((c[:, 2] - L['chest'][2] + 0.02) / 0.15, 0, 1)) & (c[:, 2] > L['chest'][2] - 0.02)
        return (c[:, 2] > z0) & (c[:, 2] < L['neck'][2] - 0.01) & (ta < 0.0) & ~front_open & ~vneck

    co, faces, used = helper_part(human, 'helper-tights', off, pred)
    bones, M = weights_matrix(human, list(used))
    nrm = vertex_normals(co, faces)
    co = co + nrm * (0.032 if over_coat else 0.02)
    co = laplacian(co, adjacency(len(co), faces), iters=6)
    cents = np.array([co[f].mean(0) for f in faces])
    zz = cents[:, 2]
    stripe = ((np.abs(zz - (L['chest'][2] - 0.05)) < 0.022) | (np.abs(zz - (L['waist'][2] - 0.04)) < 0.022)).astype(int)
    ob = make_obj(info['name'] + '_vest', co, faces, col, rig, bones, M,
                  mats=[mats['vest'], mats['reflective']], mat_idx=stripe)
    add_modifier(ob, 'SOLIDIFY', 'Solidify', thickness=0.003, offset=-1.0)
    add_modifier(ob, 'SUBSURF', 'Subsurf', levels=0, render_levels=1)
    return ob


def build_helmet(info, col, mats, color='#f2f2ee'):
    rig = info['rig']
    J = info['joints']
    top = np.array(J['head_top'])
    em = (np.array(J['eye.L']) + np.array(J['eye.R'])) / 2
    c = np.array([0.0, em[1] + 0.07, em[2] + 0.035])
    rx, ry, rz = 0.118, 0.138, top[2] - c[2] + 0.04
    verts, faces = [], []
    nu, nv = 32, 10
    for j in range(nv + 1):
        el = (math.pi / 2) * j / nv
        for i in range(nu):
            az = 2 * math.pi * i / nu
            x = math.cos(el) * math.cos(az) * rx
            y = math.cos(el) * math.sin(az) * ry
            z = math.sin(el) * rz
            # cresta central
            z += 0.012 * math.exp(-(x / 0.012) ** 2) * math.sin(el)
            verts.append(c + np.array([x, y, z]))
    for j in range(nv):
        for i in range(nu):
            a = j * nu + i
            b = j * nu + (i + 1) % nu
            faces.append([a, b, b + nu, a + nu])
    # ala (visera adelante más larga)
    base = len(verts)
    for k, s in enumerate((1.0, 1.0)):
        for i in range(nu):
            az = 2 * math.pi * i / nu
            fwd = max(0.0, -math.sin(az))
            ext = 0.018 + 0.04 * fwd ** 2
            x = math.cos(az) * (rx + ext * k)
            y = math.sin(az) * (ry + ext * k)
            verts.append(c + np.array([x, y, -0.004 * k + (0.01 * fwd if k else 0)]))
    for i in range(nu):
        a = base + i
        b = base + (i + 1) % nu
        faces.append([a, b, b + nu, a + nu])
    m = principled(info['name'] + '_helmetmat', color, rough=0.35, coat=0.4)
    ob = mesh_from_data(info['name'] + '_helmet', verts, faces, col)
    ob.data.materials.append(m)
    add_modifier(ob, 'SOLIDIFY', 'Solidify', thickness=0.004, offset=1.0)
    add_modifier(ob, 'SUBSURF', 'Subsurf', levels=1, render_levels=2)
    hb = rig.data.bones['head']
    ob.parent = rig
    ob.parent_type = 'BONE'
    ob.parent_bone = 'head'
    ob.matrix_parent_inverse = (rig.matrix_world @ hb.matrix_local @ Matrix.Translation((0, hb.length, 0))).inverted()
    return ob
