# Separación Magnética — Ciencia en Acción (producción 3D)

Video educativo animado en 3D sobre **separación magnética**, con un científico protagonista
modelado, riggeado y animado que realiza los experimentos dentro de escenarios 3D.

- **Entregable:** `Separacion_Magnetica_3D_Final.mp4` (H.264 1920×1080, 30 fps, AAC 48 kHz, ~3:40,
  9 secuencias, subtítulos en español quemados en la imagen) + `Separacion_Magnetica_3D_Final.srt`.
- **Guion técnico / storyboard:** [`guion/guion_tecnico.md`](guion/guion_tecnico.md)
- **Narración:** [`guion/narracion.json`](guion/narracion.json) (español rioplatense, voz es_AR).

## Pipeline (todo generado por código, Blender 5.2 vía `bpy`)

| Etapa | Archivo |
|---|---|
| Malla humana, targets, esqueleto de 163 huesos (MakeHuman CC0), ojos, piel PBR | `pipeline/mh_loader.py`, `pipeline/character.py` |
| Vestuario (bata con cuello, bolsillos, botones, lapiceras, credencial; camisa, corbata, pantalón, zapatos, anteojos, casco y chaleco) | `pipeline/clothes.py` |
| Pelo, barba y cejas | `pipeline/hair.py` |
| IK de brazos/piernas, calibración automática de polos y dedos, poses de mano, expresiones faciales (unidades BVH), parpadeo | `pipeline/anim.py` |
| Actuación por frame: caminata procedural con planificación de pisadas, giros, paso lateral, alcance/agarre exacto de objetos (`grasp_frame`), mirada, objetos sujetos a la mano | `pipeline/perform.py` |
| Escenarios: laboratorio + pasillo, campus exterior, planta de reciclaje, chatarrería | `pipeline/sets_lab.py`, `pipeline/sets_plant.py`, `pipeline/shot_e1a.py`, `pipeline/shot_e5.py` |
| Motion graphics: líneas de campo de dipolo calculadas, partículas, etiquetas con línea guía, flechas, títulos 3D | `pipeline/mograph.py` |
| Planos (cámaras con cortes, cámara lenta, simulación de limaduras y chatarra) | `pipeline/shot_e1a.py` … `pipeline/shot_e6.py`, `pipeline/shotlib.py` |
| Render (EEVEE) | `pipeline/render_scene.py` |
| Narración TTS + verificación | `audio/narracion.py` |
| Efectos, música original y mezcla; subtítulos | `audio/sfx_events.py`, `audio/mix.py` |
| Montaje final FFmpeg | `edit/montaje.py`, `guion/edl.json` |

### Reproducir

```bash
python -m venv venv && ./venv/bin/pip install bpy==5.2.3 numpy scipy pillow piper-tts sherpa-onnx soundfile
export SM_LIB=build/lib SM_BUILD=build
for s in scientist worker_a worker_b; do ./venv/bin/python pipeline/build_character_lib.py $s build/lib/$s.blend; done
for e in e1a e1b e2 e2b e3 e4 e4b e5 e6; do ./venv/bin/python pipeline/shot_$e.py; done          # genera build/scenes/*.blend
SM_MAX_FRAMES=45 SM_MAX_RSS_MB=4700 ./venv/bin/python pipeline/render_scene.py build/scenes/E2.blend build/frames/E2 1 1350  # (idem cada escena;
#   sale con código 3 al llegar al tope de cuadros o de memoria: relanzar hasta que devuelva 0)
./venv/bin/python audio/narracion.py <modelos_tts> build/narr
./venv/bin/python audio/sfx_events.py build/scenes build/steps.json
./venv/bin/python audio/mix.py build/narr build/scenes build/steps.json build/out
python edit/montaje.py build/frames build/out/timeline.json build/out/mezcla.wav build/out/subtitulos.ass Separacion_Magnetica_3D_Final.mp4
```

Los archivos `.blend` de cada escena se regeneran de forma determinística con los scripts.

## Notas técnicas y limitaciones (honestas)

- El entorno de producción no tenía GPU: se renderizó con **EEVEE sobre CPU (llvmpipe)**. Para cumplir el
  plazo de entrega, los cuadros se renderizaron a **1280×720 con 1 muestra de anti-aliasing** y el video se
  escaló a **1920×1080** (lanczos + nitidez suave) en el montaje. El archivo final es 1080p30 real en formato,
  pero la resolución de render interna es 720p. Con más tiempo de cómputo, basta cambiar `res`/`samples` en
  `pipeline/shotlib.py` y volver a renderizar.
- El pelo y la barba usan una malla con textura (en lugar de hebras) porque las hebras multiplicaban por 4 el
  tiempo de render.
- La narración es una voz sintética (TTS) rioplatense; el científico no habla en cámara (narradora en off),
  por lo que no hay sincronización labial; sí tiene expresiones faciales y parpadeo.
- Assets de terceros: malla base, esqueleto, pesos, ojos y unidades faciales de **MakeHuman (CC0)** en
  `assets/makehuman/`. Voz: modelo Piper `es_AR-daniela-high`. Todo lo demás (modelos, materiales, música,
  efectos) es procedural y original.
