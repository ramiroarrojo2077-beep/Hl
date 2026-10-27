"""Carga de personajes desde las bibliotecas .blend construidas por build_character_lib.py."""
import os
import bpy

LIB_DIR = os.environ.get('SM_LIB', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'build', 'lib'))


def load(style, collection_name=None, safety=False):
    path = os.path.join(LIB_DIR, style + '.blend')
    with bpy.data.libraries.load(path, link=False) as (src, dst):
        dst.objects = list(src.objects)
    col = bpy.data.collections.new(collection_name or style)
    bpy.context.scene.collection.children.link(col)
    rig = None
    objs = {}
    for ob in dst.objects:
        if ob is None:
            continue
        col.objects.link(ob)
        objs[ob.name] = ob
        if ob.type == 'ARMATURE':
            rig = ob
    for ob in objs.values():
        if ob.name.endswith('_vest') or ob.name.endswith('_helmet'):
            vis = safety or style != 'scientist'
            ob.hide_render = not vis
            ob.hide_viewport = not vis
    return rig, objs


def set_safety(objs, on):
    for name, ob in objs.items():
        if name.endswith('_vest') or name.endswith('_helmet'):
            ob.hide_render = not on
            ob.hide_viewport = not on
