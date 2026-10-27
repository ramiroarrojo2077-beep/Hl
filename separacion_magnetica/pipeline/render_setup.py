"""Configuración de render común (EEVEE headless, 1080p30) y compositor."""
import bpy


def setup(scene=None, samples=6, res=(1920, 1080), fps=30, glare=True):
    sc = scene or bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE'
    ee = sc.eevee
    ee.taa_render_samples = samples
    ee.use_raytracing = False
    ee.use_shadows = True
    ee.shadow_ray_count = 1
    ee.shadow_step_count = 1
    ee.shadow_resolution_scale = 0.75
    ee.use_fast_gi = False
    ee.volumetric_tile_size = '16'
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.fps = fps
    sc.render.film_transparent = False
    sc.render.filter_size = 1.6
    sc.render.hair_type = 'STRIP'
    sc.render.hair_subdiv = 0
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    sc.view_settings.exposure = 0.0
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGB'
    sc.render.image_settings.compression = 15
    if glare:
        ng = bpy.data.node_groups.get('comp_main') or bpy.data.node_groups.new('comp_main', 'CompositorNodeTree')
        ng.nodes.clear()
        if not ng.interface.items_tree:
            ng.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
        rl = ng.nodes.new('CompositorNodeRLayers')
        gl = ng.nodes.new('CompositorNodeGlare')
        try:
            gl.inputs['Type'].default_value = 'Bloom'
        except Exception:
            try:
                gl.glare_type = 'BLOOM'
            except Exception:
                pass
        for k, v in (('Threshold', 1.2), ('Strength', 0.35), ('Size', 0.6)):
            if k in gl.inputs:
                try:
                    gl.inputs[k].default_value = v
                except Exception:
                    pass
        out = ng.nodes.new('NodeGroupOutput')
        ng.links.new(rl.outputs['Image'], gl.inputs['Image'])
        ng.links.new(gl.outputs['Image'], out.inputs[0])
        sc.compositing_node_group = ng
        sc.render.use_compositing = True
    return sc


def lights_soft(scene=None, filter_radius=1.5):
    for ob in (scene or bpy.context.scene).objects:
        if ob.type == 'LIGHT':
            ob.data.shadow_filter_radius = filter_radius
