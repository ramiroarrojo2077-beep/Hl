"""Construye los personajes y los guarda como bibliotecas .blend reutilizables por los planos.

Uso: python build_character_lib.py <estilo> <salida.blend>
"""
import sys
import os
import time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy

style = sys.argv[-2]
out = sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
import character
import anim
name = {'scientist': 'Cientifico', 'worker_a': 'OperarioA', 'worker_b': 'OperarioB'}[style]
t = time.time()
info = character.build_character(name, style)
calib = anim.calibrate(info['rig'])
print('calib', calib)
print('built in %.1fs' % (time.time() - t))
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
