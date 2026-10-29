"""Utilidades comunes de bpy: materiales PBR procedurales, mallas, colecciones."""
import math
import bpy
import bmesh
import numpy as np
from mathutils import Vector, Matrix


def srgb(h):
    """'#RRGGBB' o tupla sRGB 0-1 -> RGBA lineal."""
    if isinstance(h, str):
        h = h.lstrip('#')
        c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    else:
        c = list(h)
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c[:3]]
    return (*lin, 1.0)


def collection(name, parent=None):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(col)
    return col


def link(obj, col=None):
    (col or bpy.context.scene.collection).objects.link(obj)
    return obj


def mesh_from_data(name, verts, faces, col=None, uvs=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], [tuple(f) for f in faces])
    if uvs is not None:
        uv = me.uv_layers.new(name='UVMap')
        uv.data.foreach_set('uv', np.asarray(uvs, dtype=np.float32).ravel())
    me.validate(clean_customdata=False)
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    link(ob, col)
    return ob


class NodeBuilder:
    """Pequeño ayudante para armar árboles de nodos de shader en código."""

    def __init__(self, mat):
        mat.use_nodes = True
        self.mat = mat
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.x = 0

    def n(self, kind, **inputs):
        node = self.nt.nodes.new(kind)
        node.location = (self.x, 0)
        self.x -= 200
        for k, v in inputs.items():
            if k.startswith('_'):
                setattr(node, k[1:], v)
            else:
                self.set(node, k, v)
        return node

    def set(self, node, key, val):
        sock = node.inputs[key]
        if isinstance(val, bpy.types.NodeSocket):
            self.nt.links.new(val, sock)
        else:
            sock.default_value = val

    def link(self, a, b):
        self.nt.links.new(a, b)

    def output(self, shader, displacement=None):
        out = self.nt.nodes.new('ShaderNodeOutputMaterial')
        out.location = (400, 0)
        self.link(shader, out.inputs['Surface'])
        if displacement is not None:
            self.link(displacement, out.inputs['Displacement'])
        return out


def principled(name, color, rough=0.5, metal=0.0, spec=0.5, emission=None, emit_strength=0.0,
               alpha=1.0, transmission=0.0, ior=1.45, coat=0.0, bump=None, bump_scale=0.0,
               noise_color=0.0, noise_scale=40.0, sss=0.0, sss_radius=(1, 0.3, 0.2)):
    """Material Principled con variación procedural opcional (ruido de color y bump)."""
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    p = nb.n('ShaderNodeBsdfPrincipled')
    col = srgb(color) if not (isinstance(color, tuple) and len(color) == 4) else color
    if noise_color > 0:
        tc = nb.n('ShaderNodeTexCoord')
        # pocas octavas: con 6 el detalle quedaba por debajo del píxel y se veía como granulado que titila
        nz = nb.n('ShaderNodeTexNoise', Scale=noise_scale, Detail=2.0)
        nb.link(tc.outputs['Object'], nz.inputs['Vector'])
        ramp = nb.n('ShaderNodeMix', _data_type='RGBA')
        ramp.inputs['Factor'].default_value = 0.5
        dark = tuple(c * (1 - noise_color) for c in col[:3]) + (1,)
        light = tuple(min(1, c * (1 + noise_color * 0.6)) for c in col[:3]) + (1,)
        ramp.inputs[6].default_value = dark
        ramp.inputs[7].default_value = light
        nb.link(nz.outputs['Fac'], ramp.inputs['Factor'])
        nb.link(ramp.outputs[2], p.inputs['Base Color'])
    else:
        p.inputs['Base Color'].default_value = col
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    p.inputs['Specular IOR Level'].default_value = spec
    p.inputs['IOR'].default_value = ior
    p.inputs['Alpha'].default_value = alpha
    p.inputs['Transmission Weight'].default_value = transmission
    p.inputs['Coat Weight'].default_value = coat
    if sss > 0:
        p.inputs['Subsurface Weight'].default_value = sss
        p.inputs['Subsurface Radius'].default_value = sss_radius
        p.inputs['Subsurface Scale'].default_value = 0.01
    if emission is not None:
        p.inputs['Emission Color'].default_value = srgb(emission) if isinstance(emission, str) else emission
        p.inputs['Emission Strength'].default_value = emit_strength
    if bump_scale > 0:
        tc = nb.n('ShaderNodeTexCoord')
        nz = nb.n('ShaderNodeTexNoise', Scale=bump or 200.0, Detail=3.0)
        nb.link(tc.outputs['Object'], nz.inputs['Vector'])
        bn = nb.n('ShaderNodeBump', Strength=bump_scale, Distance=0.002)
        nb.link(nz.outputs['Fac'], bn.inputs['Height'])
        nb.link(bn.outputs['Normal'], p.inputs['Normal'])
    nb.output(p.outputs['BSDF'])
    if alpha < 1.0 or transmission > 0:
        mat.surface_render_method = 'BLENDED' if alpha < 1.0 else 'DITHERED'
    return mat


def emission_mat(name, color, strength=5.0, alpha=1.0):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    nb = NodeBuilder(mat)
    e = nb.n('ShaderNodeEmission', Color=srgb(color) if isinstance(color, str) else color, Strength=strength)
    if alpha < 1.0:
        tr = nb.n('ShaderNodeBsdfTransparent')
        mix = nb.n('ShaderNodeMixShader', Fac=alpha)
        nb.link(tr.outputs[0], mix.inputs[1])
        nb.link(e.outputs[0], mix.inputs[2])
        nb.output(mix.outputs[0])
        mat.surface_render_method = 'BLENDED'
    else:
        nb.output(e.outputs[0])
    return mat


def set_material(ob, mat, slot_only=False):
    if not slot_only:
        ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


def add_modifier(ob, kind, name=None, **kw):
    m = ob.modifiers.new(name or kind, kind)
    if kind == 'SOLIDIFY':
        # límite de desplazamiento: sin él, en ciertas poses un vértice salía disparado y formaba una "púa"
        m.thickness_clamp = 1.0
    for k, v in kw.items():
        setattr(m, k, v)
    return m


def look_at_rot(src, dst, up=(0, 0, 1)):
    d = Vector(dst) - Vector(src)
    return d.to_track_quat('-Z', 'Y').to_euler()


def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a))) if b != a else float(x >= b)
    return t * t * (3 - 2 * t)


def ease(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def ease_io(t, p=2.0):
    t = min(1.0, max(0.0, t))
    return t ** p / (t ** p + (1 - t) ** p) if 0 < t < 1 else t
