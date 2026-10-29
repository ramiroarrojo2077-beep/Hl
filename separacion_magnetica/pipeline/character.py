"""Científico protagonista: cuerpo MakeHuman (CC0) + rig completo + ropa, pelo y materiales.

build_character(name, style) crea un personaje con armature 'NAME_rig' y devuelve un dict
con referencias a objetos y metadatos (huesos de agarre, alturas, etc.).
"""
import math
import os
import random
import bpy
import bmesh
import numpy as np
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

import mh_loader as mh
from util import srgb, NodeBuilder, link, collection, mesh_from_data, principled, add_modifier

ASSETS = mh.MH_DIR

BODY_GROUPS = ('body',)
EXTRA_GROUPS = ('helper-upper-teeth', 'helper-lower-teeth', 'helper-tongue')

STYLES = {
    # Científico protagonista
    'scientist': dict(macro=dict(age=0.64, muscle=0.56, weight=0.52, height=0.62, proportions=0.75,
                                 races=(('caucasian', 0.72), ('african', 0.08), ('asian', 0.2))),
                      skin='#c18f72', hair='#2e2119', hair_grey=0.18, eye='brown',
                      outfit='labcoat', glasses=True, beard=True),
    # Operarios de fondo
    'worker_a': dict(macro=dict(age=0.55, muscle=0.7, weight=0.6, height=0.55, proportions=0.6,
                                races=(('caucasian', 0.4), ('african', 0.4), ('asian', 0.2))),
                     skin='#9a6a4f', hair='#1d1612', hair_grey=0.05, eye='brown',
                     outfit='worker', glasses=False, beard=False),
    'worker_b': dict(macro=dict(age=0.6, muscle=0.6, weight=0.65, height=0.48, proportions=0.6,
                                races=(('caucasian', 0.8), ('african', 0.0), ('asian', 0.2))),
                     skin='#d2a48a', hair='#4a3526', hair_grey=0.15, eye='brown',
                     outfit='worker', glasses=False, beard=True),
}


# ---------------------------------------------------------------------------
# Cuerpo
# ---------------------------------------------------------------------------

def _build_mesh(human, groups, name, col):
    keep = [i for i, g in enumerate(human.face_groups) if g in groups]
    used = sorted({v for i in keep for v in human.faces[i]})
    remap = {v: i for i, v in enumerate(used)}
    co = mh.mh_to_blender(human.co[used])
    faces = [[remap[v] for v in human.faces[i]] for i in keep]
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(c) for c in co], [], faces)
    uvl = me.uv_layers.new(name='UVMap')
    loop_uv = []
    for i in keep:
        for t in human.face_uvs[i]:
            loop_uv.append(human.uvs[t] if t >= 0 else (0, 0))
    uvl.data.foreach_set('uv', np.array(loop_uv, dtype=np.float32).ravel())
    me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    link(ob, col)
    # Grupo de material por cara (0 piel, 1 dientes, 2 lengua)
    mi = [0 if human.face_groups[i] == 'body' else (2 if human.face_groups[i] == 'helper-tongue' else 1)
          for i in keep]
    me.polygons.foreach_set('material_index', mi)
    return ob, np.array(used), remap


def _skin_material(name, tone, hair_col):
    """Piel PBR: SSS, variación de color por regiones (atributo 'skin_tint') y poros."""
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    p = nb.n('ShaderNodeBsdfPrincipled')
    base = srgb(tone)
    attr = nb.n('ShaderNodeAttribute', _attribute_name='skin_tint')
    sep = nb.n('ShaderNodeSeparateColor')
    nb.link(attr.outputs['Color'], sep.inputs['Color'])
    # R: rubor (mejillas/nariz/orejas), G: labios, B: zona de barba/cuero cabelludo
    tc = nb.n('ShaderNodeTexCoord')
    nz = nb.n('ShaderNodeTexNoise', Scale=60.0, Detail=4.0, Roughness=0.6)
    nb.link(tc.outputs['Object'], nz.inputs['Vector'])
    nzs = nb.n('ShaderNodeMath', _operation='MULTIPLY_ADD')
    nb.link(nz.outputs['Fac'], nzs.inputs[0])
    nzs.inputs[1].default_value = 0.25
    nzs.inputs[2].default_value = 0.875
    c0 = nb.n('ShaderNodeMix', _data_type='RGBA', _blend_type='MULTIPLY')
    c0.inputs['Factor'].default_value = 1.0
    c0.inputs[6].default_value = base
    nb.link(nzs.outputs[0], c0.inputs[7])
    blush = nb.n('ShaderNodeMix', _data_type='RGBA')
    nb.link(sep.outputs['Red'], blush.inputs['Factor'])
    nb.link(c0.outputs[2], blush.inputs[6])
    blush.inputs[7].default_value = (base[0] * 1.05, base[1] * 0.62, base[2] * 0.58, 1)
    lips = nb.n('ShaderNodeMix', _data_type='RGBA')
    nb.link(sep.outputs['Green'], lips.inputs['Factor'])
    nb.link(blush.outputs[2], lips.inputs[6])
    lips.inputs[7].default_value = (base[0] * 0.8, base[1] * 0.56, base[2] * 0.52, 1)
    beard = nb.n('ShaderNodeMix', _data_type='RGBA')
    bf = nb.n('ShaderNodeMath', _operation='MULTIPLY')
    nb.link(sep.outputs['Blue'], bf.inputs[0])
    bf.inputs[1].default_value = 0.55
    nb.link(bf.outputs[0], beard.inputs['Factor'])
    nb.link(lips.outputs[2], beard.inputs[6])
    hc = srgb(hair_col)
    beard.inputs[7].default_value = (hc[0] * 0.9 + base[0] * 0.1, hc[1] * 0.9 + base[1] * 0.1,
                                     hc[2] * 0.9 + base[2] * 0.1, 1)
    nb.link(beard.outputs[2], p.inputs['Base Color'])
    p.inputs['Subsurface Weight'].default_value = 0.1
    p.inputs['Subsurface Radius'].default_value = (1.0, 0.35, 0.2)
    p.inputs['Subsurface Scale'].default_value = 0.012
    # Rugosidad: labios más brillantes, nariz/frente algo más
    rr = nb.n('ShaderNodeMath', _operation='MULTIPLY_ADD')
    nb.link(sep.outputs['Green'], rr.inputs[0])
    rr.inputs[1].default_value = -0.05
    rr.inputs[2].default_value = 0.52
    nb.link(rr.outputs[0], p.inputs['Roughness'])
    p.inputs['Specular IOR Level'].default_value = 0.45
    # Poros + microdetalle
    # (poros más suaves y sin octavas sub-píxel: antes se veían como puntitos negros en la piel)
    pz = nb.n('ShaderNodeTexVoronoi', Scale=280.0)
    nb.link(tc.outputs['Object'], pz.inputs['Vector'])
    pn = nb.n('ShaderNodeTexNoise', Scale=200.0, Detail=2.0)
    nb.link(tc.outputs['Object'], pn.inputs['Vector'])
    hm = nb.n('ShaderNodeMath', _operation='ADD')
    nb.link(pz.outputs['Distance'], hm.inputs[0])
    nb.link(pn.outputs['Fac'], hm.inputs[1])
    bump = nb.n('ShaderNodeBump', Strength=0.012, Distance=0.0004)
    nb.link(hm.outputs[0], bump.inputs['Height'])
    nb.link(bump.outputs['Normal'], p.inputs['Normal'])
    nb.output(p.outputs['BSDF'])
    return mat


def _skin_tint_attribute(ob, J):
    """Pinta un atributo de color por vértice con máscaras faciales calculadas por distancia."""
    me = ob.data
    co = np.array([v.co for v in me.vertices])
    n = len(co)
    red = np.zeros(n)
    lips = np.zeros(n)
    beard = np.zeros(n)

    def blob(center, radius, power=2.0):
        d = np.linalg.norm(co - center, axis=1) / radius
        return np.clip(1 - d, 0, 1) ** power

    head = J['head']
    nose = J['nose']
    mouth = J['mouth']
    lcheek = J['cheek.L']
    rcheek = J['cheek.R']
    red += 0.45 * blob(lcheek, 0.035) + 0.45 * blob(rcheek, 0.035) + 0.5 * blob(nose, 0.022)
    red += 0.35 * blob(J['ear.L'], 0.035) + 0.35 * blob(J['ear.R'], 0.035)
    # labios: elipse aplanada
    d = co - mouth
    e = (d[:, 0] / 0.026) ** 2 + (d[:, 2] / 0.0105) ** 2 + (d[:, 1] / 0.03) ** 2
    lips = np.clip(1.25 - e, 0, 1) ** 0.7
    # barba (sombra de barba corta) y cuero cabelludo
    rel = co - head
    jaw_zone = (co[:, 2] < mouth[2] + 0.012) & (co[:, 2] > J['chin'][2] - 0.045) & (co[:, 1] < head[1] + 0.035)
    beard[jaw_zone] = 1.0
    upper_lip = (np.abs(co[:, 0] - mouth[0]) < 0.03) & (co[:, 2] > mouth[2] + 0.004) & (co[:, 2] < nose[2] - 0.006) & (co[:, 1] < mouth[1] + 0.02)
    beard[upper_lip] = 1.0
    sideburn = (co[:, 2] > mouth[2]) & (co[:, 2] < J['eye.L'][2] - 0.01) & (np.abs(co[:, 0]) > 0.055) & (co[:, 1] > head[1] - 0.02) & (co[:, 1] < head[1] + 0.03)
    beard[sideburn] = 0.8
    beard *= np.clip(1 - lips * 3, 0, 1)
    scalp = (rel[:, 2] > 0.045) & (co[:, 1] > nose[1] + 0.035) | ((rel[:, 2] > 0.075))
    beard[scalp & (co[:, 2] > J['eye.L'][2] + 0.035)] = 1.0
    ob['beard_mask_ready'] = True
    colors = np.stack([np.clip(red, 0, 1), np.clip(lips, 0, 1), np.clip(beard, 0, 1), np.ones(n)], 1)
    attr = me.color_attributes.new('skin_tint', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', colors.astype(np.float32).ravel())
    return dict(beard=beard, scalp=scalp)


def _eye_material(name):
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    p = nb.n('ShaderNodeBsdfPrincipled')
    img = bpy.data.images.load(os.path.join(ASSETS, 'eyes', 'brown_eye.png'), check_existing=True)
    tex = nb.n('ShaderNodeTexImage', _image=img)
    nb.link(tex.outputs['Color'], p.inputs['Base Color'])
    p.inputs['Roughness'].default_value = 0.25
    p.inputs['Coat Weight'].default_value = 0.35
    p.inputs['Coat Roughness'].default_value = 0.05
    p.inputs['Subsurface Weight'].default_value = 0.1
    nb.output(p.outputs['BSDF'])
    return mat


def _cornea_material(name):
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    gl = nb.n('ShaderNodeBsdfGlossy', Roughness=0.0)
    tr = nb.n('ShaderNodeBsdfTransparent')
    fr = nb.n('ShaderNodeFresnel', IOR=1.376)
    mix = nb.n('ShaderNodeMixShader')
    nb.link(fr.outputs['Fac'], mix.inputs['Fac'])
    nb.link(tr.outputs[0], mix.inputs[1])
    nb.link(gl.outputs[0], mix.inputs[2])
    nb.output(mix.outputs[0])
    mat.surface_render_method = 'BLENDED'
    return mat


# ---------------------------------------------------------------------------
# Armature
# ---------------------------------------------------------------------------

def _build_armature(human, name, col, offset):
    arm = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, arm)
    link(rig, col)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bones = human.bones()
    eb = {}
    for b in bones:
        e = arm.edit_bones.new(b['name'])
        e.head = Vector(b['head'] - offset)
        e.tail = Vector(b['tail'] - offset)
        if (e.tail - e.head).length < 1e-4:
            e.tail = e.head + Vector((0, 0, 0.01))
        d = (e.tail - e.head).normalized()
        nrm = Vector(b['normal']).normalized()
        z = nrm.cross(d)
        if z.length > 1e-6:
            e.align_roll(z.normalized())
        eb[b['name']] = e
    for b in bones:
        if b['parent']:
            eb[b['name']].parent = eb[b['parent']]
            if (eb[b['name']].head - eb[b['parent']].tail).length < 1e-4:
                eb[b['name']].use_connect = True
    # Controles extra: IK de manos y pies, polos, mirada, puntos de agarre
    root = eb['root']
    for side in ('L', 'R'):
        s = 1 if side == 'L' else -1
        wrist = eb['wrist.' + side]
        mid = (eb['finger3-1.' + side].head + wrist.head) * 0.5
        hand_dir = (eb['finger3-1.' + side].head - wrist.head).normalized()
        # Bone de agarre: centro de la palma, ligeramente hacia la cara palmar
        grip = arm.edit_bones.new('grip.' + side)
        palm_n = (eb['finger5-1.' + side].head - eb['finger2-1.' + side].head).cross(hand_dir).normalized()
        if side == 'R':
            palm_n = -palm_n
        grip.head = mid + hand_dir * 0.02
        grip.tail = grip.head + hand_dir * 0.05
        grip.align_roll(palm_n)
        grip.parent = wrist
        grip['palm_normal'] = list(palm_n)
        ik = arm.edit_bones.new('IK_hand.' + side)
        ik.head = wrist.head.copy()
        ik.tail = wrist.tail.copy()
        ik.roll = wrist.roll
        ik.parent = None
        pole = arm.edit_bones.new('pole_arm.' + side)
        el = eb['lowerarm01.' + side].head
        pole.head = el + Vector((s * 0.3, 0.5, -0.05))
        pole.tail = pole.head + Vector((0, 0.05, 0))
        pole.parent = None
        fk = arm.edit_bones.new('IK_foot.' + side)
        foot = eb['foot.' + side]
        fk.head = foot.head.copy()
        fk.tail = foot.tail.copy()
        fk.roll = foot.roll
        fk.parent = None
        kp = arm.edit_bones.new('pole_leg.' + side)
        kn = eb['lowerleg01.' + side].head
        kp.head = kn + Vector((0, -0.6, 0))
        kp.tail = kp.head + Vector((0, -0.05, 0))
        kp.parent = None
    look = arm.edit_bones.new('look')
    hpos = eb['head'].head
    look.head = hpos + Vector((0, -1.5, 0.1))
    look.tail = look.head + Vector((0, 0, 0.05))
    look.parent = None
    eyel = arm.edit_bones.new('look_eyes')
    eyel.head = look.head.copy()
    eyel.tail = look.tail.copy()
    eyel.parent = None
    bpy.ops.object.mode_set(mode='POSE')
    pb = rig.pose.bones
    for pbn in pb:
        pbn.rotation_mode = 'QUATERNION'
    for side in ('L', 'R'):
        # Brazos: IK de 4 huesos con huesos de torsión bloqueados (solo giran sobre su eje)
        c = pb['lowerarm02.' + side].constraints.new('IK')
        c.name = 'IK_arm'
        c.target = rig
        c.subtarget = 'IK_hand.' + side
        c.pole_target = rig
        c.pole_subtarget = 'pole_arm.' + side
        c.pole_angle = math.radians(-90 if side == 'L' else -90)
        c.chain_count = 4
        c.influence = 1.0
        for bn in ('upperarm02.' + side, 'lowerarm02.' + side):
            pb[bn].lock_ik_x = True
            pb[bn].lock_ik_z = True
        pb['lowerarm01.' + side].lock_ik_y = True
        cr = pb['wrist.' + side].constraints.new('COPY_ROTATION')
        cr.name = 'IK_wrist'
        cr.target = rig
        cr.subtarget = 'IK_hand.' + side
        cr.influence = 1.0
        # Piernas
        c = pb['lowerleg02.' + side].constraints.new('IK')
        c.name = 'IK_leg'
        c.target = rig
        c.subtarget = 'IK_foot.' + side
        c.pole_target = rig
        c.pole_subtarget = 'pole_leg.' + side
        c.pole_angle = math.radians(-90)
        c.chain_count = 4
        c.influence = 1.0
        for bn in ('upperleg02.' + side, 'lowerleg02.' + side):
            pb[bn].lock_ik_x = True
            pb[bn].lock_ik_z = True
        pb['lowerleg01.' + side].lock_ik_y = True
        cr = pb['foot.' + side].constraints.new('COPY_ROTATION')
        cr.name = 'IK_footrot'
        cr.target = rig
        cr.subtarget = 'IK_foot.' + side
        cr.influence = 1.0
        # Ojos siguen el objetivo de mirada
        dt = pb['eye.' + side].constraints.new('DAMPED_TRACK')
        dt.target = rig
        dt.subtarget = 'look_eyes'
        dt.influence = 1.0
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def _apply_weights(ob, human, used, remap):
    W = human.weights()
    for bone, arr in W.items():
        vg = ob.vertex_groups.new(name=bone)
        idx = arr[:, 0].astype(int)
        w = arr[:, 1]
        for i, ww in zip(idx, w):
            j = remap.get(int(i))
            if j is not None:
                vg.add([j], float(ww), 'REPLACE')


# ---------------------------------------------------------------------------
# Construcción principal
# ---------------------------------------------------------------------------

def build_character(name='Cientifico', style='scientist', col=None, seed=1):
    st = STYLES[style]
    rnd = random.Random(seed)
    col = col or collection(name)
    human = mh.Human(targets=mh.macro_targets(**st['macro']))
    # offset de suelo: plantas de los pies en z=0, centrado en la pelvis
    all_co = mh.mh_to_blender(human.co)
    body_idx = sorted({v for i, g in enumerate(human.face_groups) if g == 'body' for v in human.faces[i]})
    bc = all_co[body_idx]
    offset = np.array([0.0, (bc[:, 1].max() + bc[:, 1].min()) * 0.5, bc[:, 2].min()])
    offset[0] = 0.0

    body, used, remap = _build_mesh(human, BODY_GROUPS + EXTRA_GROUPS, name + '_body', col)
    me = body.data
    co = np.array([v.co for v in me.vertices]) - offset
    me.vertices.foreach_set('co', co.astype(np.float32).ravel())

    def J(jn):
        return mh.mh_to_blender(human.joint(jn)) - offset

    joints = {
        'head': J('head____head'), 'neck': J('neck01____head'),
        'eye.L': J('eye.L____head'), 'eye.R': J('eye.R____head'),
        'jaw': J('jaw____head'),
    }
    # Landmarks faciales aproximados a partir de huesos de la cara
    eyeL, eyeR = joints['eye.L'], joints['eye.R']
    eye_mid = (eyeL + eyeR) * 0.5
    head_top = co[co[:, 2].argmax()]
    face_front = co[(np.abs(co[:, 0]) < 0.004) & (co[:, 2] > eye_mid[2] - 0.12) & (co[:, 2] < eye_mid[2] + 0.02)]
    nose_tip = face_front[face_front[:, 1].argmin()]
    lip_band = co[(np.abs(co[:, 0]) < 0.004) & (co[:, 2] < nose_tip[2] - 0.02) & (co[:, 2] > nose_tip[2] - 0.06)]
    mouth = lip_band[lip_band[:, 1].argmin()].copy()
    mouth[1] += 0.004
    mouth[2] -= 0.003
    chin_band = co[(np.abs(co[:, 0]) < 0.004) & (co[:, 2] < mouth[2] - 0.01) & (co[:, 2] > mouth[2] - 0.08) & (co[:, 1] < eye_mid[1])]
    chin = chin_band[chin_band[:, 2].argmin()] if len(chin_band) else mouth - np.array([0, 0, 0.05])
    joints.update({'nose': nose_tip, 'mouth': mouth, 'chin': chin, 'head_top': head_top,
                   'cheek.L': eyeL + np.array([0.012, -0.012, -0.035]),
                   'cheek.R': eyeR + np.array([-0.012, -0.012, -0.035]),
                   'ear.L': eyeL + np.array([0.045, 0.085, -0.02]),
                   'ear.R': eyeR + np.array([-0.045, 0.085, -0.02])})
    masks = _skin_tint_attribute(body, joints)

    skin = _skin_material(name + '_skin', st['skin'], st['hair'])
    teeth = principled(name + '_teeth', '#e8e2d0', rough=0.25, sss=0.2)
    tongue = principled(name + '_tongue', '#a8504c', rough=0.35, sss=0.4)
    me.materials.append(skin)
    me.materials.append(teeth)
    me.materials.append(tongue)

    # Ojos (proxy high-poly ajustado a la malla)
    eco, euv, ef, efuv, _ = human.fit_proxy(os.path.join(ASSETS, 'eyes', 'high-poly.mhclo'))
    eco_b = mh.mh_to_blender(eco) - offset
    loop_uv = [euv[t] for f in efuv for t in f]
    eyes = mesh_from_data(name + '_eyes', eco_b, ef, col)
    uvl = eyes.data.uv_layers.new(name='UVMap')
    uvl.data.foreach_set('uv', np.array(loop_uv, dtype=np.float32).ravel())
    eyes.data.materials.append(_eye_material(name + '_eyemat'))
    eyes.data.materials.append(_cornea_material(name + '_cornea'))
    # Capa externa (córnea) -> material transparente brillante. Se separan islas conectadas
    # y la isla de mayor radio medio en cada ojo es la córnea.
    bm = bmesh.new()
    bm.from_mesh(eyes.data)
    bm.faces.ensure_lookup_table()
    island_of = {}
    isl = 0
    for f0 in bm.faces:
        if f0.index in island_of:
            continue
        stack = [f0]
        while stack:
            f = stack.pop()
            if f.index in island_of:
                continue
            island_of[f.index] = isl
            for e in f.edges:
                for g in e.link_faces:
                    if g.index not in island_of:
                        stack.append(g)
        isl += 1
    bm.free()
    centers = {}
    for side, jn in (('L', 'eye.L____head'), ('R', 'eye.R____head')):
        centers[side] = Vector(mh.mh_to_blender(human.joint(jn)) - offset)
    stats = {}
    for p in eyes.data.polygons:
        side = 'L' if p.center.x > 0 else 'R'
        r = (p.center - centers[side]).length
        k = island_of[p.index]
        s_, n_ = stats.get(k, (0.0, 0))
        stats[k] = (s_ + r, n_ + 1)
    by_side = {}
    for p in eyes.data.polygons:
        side = 'L' if p.center.x > 0 else 'R'
        k = island_of[p.index]
        by_side.setdefault(side, set()).add(k)
    outer = set()
    for side, ks in by_side.items():
        if len(ks) > 1:
            outer.add(max(ks, key=lambda k: stats[k][0] / stats[k][1]))
    for p in eyes.data.polygons:
        if island_of[p.index] in outer:
            p.material_index = 1
    rig = _build_armature(human, name + '_rig', col, offset)
    _apply_weights(body, human, used, remap)
    for ob in (body,):
        ob.parent = rig
        add_modifier(ob, 'ARMATURE', 'Armature', object=rig, use_deform_preserve_volume=True)
    # ojos: pesos rígidos a cada hueso de ojo
    vgL = eyes.vertex_groups.new(name='eye.L')
    vgR = eyes.vertex_groups.new(name='eye.R')
    for v in eyes.data.vertices:
        (vgL if v.co.x > 0 else vgR).add([v.index], 1.0, 'REPLACE')
    eyes.parent = rig
    add_modifier(eyes, 'ARMATURE', 'Armature', object=rig)
    info = dict(name=name, rig=rig, body=body, eyes=eyes, joints=joints, human=human, offset=offset,
                masks=masks, style=st, col=col)
    dress(info)
    add_modifier(body, 'SUBSURF', 'Subsurf', levels=0, render_levels=1)
    # lashes: helpers de pestañas como tiras oscuras semitransparentes
    lash, _, _ = _build_mesh(human, ('helper-r-eyelashes-2', 'helper-l-eyelashes-2'), name + '_lashes', col)
    lco = np.array([v.co for v in lash.data.vertices]) - offset
    lash.data.vertices.foreach_set('co', lco.astype(np.float32).ravel())
    # solo pestañas superiores (las inferiores se veían como un delineado oscuro)
    eco = np.array([v.co for v in eyes.data.vertices])
    ez = eco[:, 2].mean()
    import bmesh as _bm
    bm_ = _bm.new()
    bm_.from_mesh(lash.data)
    low = [f for f in bm_.faces if sum(v.co.z for v in f.verts) / len(f.verts) < ez - 0.001]
    _bm.ops.delete(bm_, geom=low, context='FACES')
    bm_.to_mesh(lash.data)
    bm_.free()
    lash.data.materials.clear()
    lash.data.materials.append(principled(name + '_lashmat', '#1a120c', rough=0.6, alpha=0.5))
    _, lused, lremap = None, None, None
    lw = human.weights()
    lidx = sorted({v for i, g in enumerate(human.face_groups) if g in ('helper-r-eyelashes-2', 'helper-l-eyelashes-2') for v in human.faces[i]})
    lmap = {v: i for i, v in enumerate(lidx)}
    for bone, arr in lw.items():
        sel = [(lmap[int(v)], w) for v, w in arr if int(v) in lmap]
        if sel:
            vg = lash.vertex_groups.new(name=bone)
            for i, w in sel:
                vg.add([i], float(w), 'REPLACE')
    lash.parent = rig
    add_modifier(lash, 'ARMATURE', 'Armature', object=rig)
    info['lashes'] = lash
    return info


def dress(info):
    import clothes
    import hair
    st = info['style']
    col = info['col']
    mats = clothes.default_materials(info['name'], st['outfit'])
    info['mats'] = mats
    L = clothes.landmarks(info)
    if st['outfit'] == 'labcoat':
        info['coat'] = clothes.build_coat(info, col, mats)
        info['shirt'] = clothes.build_shirt(info, col, mats)
    else:
        info['shirt'] = clothes.build_work_shirt(info, col, mats)
    info['pants'] = clothes.build_pants(info, col, mats)
    info['shoes'] = clothes.build_shoes(info, col, mats)
    if st.get('glasses'):
        clothes.build_glasses(info, col, mats)
    # equipo de seguridad (casco + chaleco); en el científico se muestra solo en escenas industriales
    info['vest'] = clothes.build_vest(info, col, mats, over_coat=(st['outfit'] == 'labcoat'))
    info['helmet'] = clothes.build_helmet(info, col, mats, color='#f2f2ee' if st['outfit'] == 'labcoat' else '#f5b800')
    hair.build_hair(info, col, color=st['hair'], grey=st['hair_grey'], beard=st.get('beard', False), density=0.4)
    # Ocultar la piel cubierta por la ropa (evita que atraviese las prendas)
    body = info['body']
    co = np.array([v.co for v in body.data.vertices])
    tL = clothes._arm_param(co, L, 'L')
    tR = clothes._arm_param(co, L, 'R')
    hand = (tL > 0.9) | (tR > 0.9) | (np.abs(co[:, 0]) > np.abs(L['wristL'][0]) - 0.03) & (co[:, 2] < L['wristL'][2] + 0.08)
    head = co[:, 2] > L['neck'][2] - 0.035
    vg = body.vertex_groups.new(name='skin_visible')
    keep = np.where(hand | head)[0]
    vg.add([int(i) for i in keep], 1.0, 'REPLACE')
    m = add_modifier(body, 'MASK', 'HideCovered', vertex_group='skin_visible')
    m.threshold = 0.5
    body.modifiers.move(len(body.modifiers) - 1, 0)
