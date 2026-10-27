# Separación magnética — Guion técnico y storyboard

Video educativo animado 3D · español rioplatense · 1920×1080 · 30 fps · ~3:03

Narración en off: voz es_AR "daniela" (Piper TTS). Protagonista: **Dr. Andrés Ferro**, físico de materiales (personaje 3D original, rig completo).

Cada escena es un archivo de Blender independiente generado por `pipeline/shot_*.py`. Los tiempos son relativos al inicio de cada escena; la tabla `guion/edl.json` define el orden y las transiciones del montaje.

---

## E1a — Exterior del complejo científico (9 s) · `shot_e1a.py`

| t (s) | Cámara | Acción / imagen | Gráficos | Narración |
|---|---|---|---|---|
| 0–5 | Aérea alta, dolly-in descendente | Campus: edificio principal con muro cortina, torre, ala de laboratorios, plaza, árboles, estacionamiento | — | E1_01 (1.6): "En este complejo científico se estudia un fenómeno…" |
| 5–9 | Dolly hasta la entrada vidriada | Las puertas deslizantes se abren; la cámara "atraviesa" la fachada | — | |

**Transición:** fundido a blanco (1 s) → pasillo interior (transición arquitectónica).

## E1b — Pasillo → laboratorio → presentación del tema (25 s) · `shot_e1b.py`

| t | Cámara | Acción | Gráficos | Narración |
|---|---|---|---|---|
| 0–8 | C1 travelling hacia atrás en el pasillo vidriado | El científico camina por el pasillo hacia el laboratorio | — | E1_02 (0.8) |
| 8–17 | C2 plano general del laboratorio, paneo | Entra por la puerta, recorre el laboratorio, llega a la mesada, gira, observa la mezcla, la señala | — | E1_03 (9.2) |
| 17–25 | C3 plano medio frontal, dolly-out | Mira a cámara, gesto de manos abiertas presentando el tema | Título 3D **SEPARACIÓN MAGNÉTICA** con líneas de campo animadas, partículas que fluyen por las líneas y destellos | E1_04 (17.6) |

## E2 — Experimento de laboratorio (45 s) · `shot_e2.py`

Utilería: cristalizador con arena y 320 limaduras individuales (objetos), imán de barra (N rojo / S azul) con mango, funda plástica removible, soporte, bandeja blanca, frascos rotulados, microscopio, etc.

| t real | Cámara | Acción | Gráficos | Narración |
|---|---|---|---|---|
| 0–6 | C1 plano medio desde la izquierda | Presenta la mezcla con la palma abierta | Etiqueta **ARENA** — granos de cuarzo · no magnética | E2_01 (0.5) |
| 6–11 | C2 macro con desenfoque (acercamiento microscópico) | Señala las limaduras con el índice | Etiqueta **LIMADURAS DE HIERRO** — Fe · ferromagnéticas | E2_02 (6.2) |
| 11–17.5 | C3 plano medio lateral | Aproxima la mano (pre-agarre), abre, cierra sobre el mango, levanta el imán enfundado y lo muestra | Etiqueta **IMÁN** — dentro de una funda plástica | E2_03 (11.2) |
| 17.5–24.2 | C4 primer plano bajo, f/4 | Baja el imán sobre la mezcla, hace un barrido circular. **Cámara lenta 0.45× (20.8–23.8 s)**: las limaduras saltan y se adhieren formando "cerdas"; la arena queda | Líneas de campo 3D (dipolo calculado) que viajan con el imán, partículas de flujo, flechas de fuerza, etiqueta **CAMPO MAGNÉTICO** | E2_04 (17.6) |
| 24.2–27 | C5 macro del cristalizador | Levanta el imán: la arena queda en el recipiente | — | E2_05 (24.4) |
| 27–37.5 | C6 plano detalle de manos | Paso lateral hasta la bandeja; la mano izquierda toma la funda, la derecha retira el imán; las limaduras caen (simulación con gravedad) y se apilan en la bandeja | — | E2_06 (27.4) |
| 37.5–45 | C7 plano general frontal | Resultado; sonríe a cámara | Etiquetas **FRACCIÓN NO MAGNÉTICA** (arena) y **FRACCIÓN MAGNÉTICA** (hierro) | E2_07 (38.4) |

## E3 — Explicación científica en la mesa holográfica (27 s) · `shot_e3.py`

| t | Cámara | Acción | Gráficos | Narración |
|---|---|---|---|---|
| 0–6 | C1 seguimiento | Camina hasta la mesa holográfica; gesto de barrido activa el holograma | Campo de proyección, imán holográfico S/N, líneas de campo 3D con partículas | E3_01 (0.6) |
| 6–13 | C2 frontal | Señala el polo | Fe, Ni, Co y acero aparecen y son atraídos hacia los polos (aceleración creciente) con flechas; etiqueta **ATRAÍDOS POR EL IMÁN** | E3_02 (7.0) |
| 13–20 | C3 3/4 | Gesto de "no" con mano abierta | Plástico, aluminio y cobre **no** se mueven ("no atraído"); etiqueta **NO ATRAÍDOS (imán común)** | E3_03 (13.2) |
| 20–27 | C4 frontal | Separa con ambas manos | Una mezcla holográfica se divide en **FRACCIÓN MAGNÉTICA** / **FRACCIÓN NO MAGNÉTICA** | E3_04 (20.4) |

Rigor: se aclara explícitamente que no todos los metales son atraídos (aluminio y cobre no responden a un imán común).

**Transición:** fundido encadenado (1 s) → planta.

## E4 — Planta de reciclaje (31 s) · `shot_e4.py`

Nave industrial con columnas, cerchas, claraboyas, luminarias; cinta transportadora animada (textura y objetos), separador magnético de banda transversal (overband) con contenedor de acero, fardos, carteles, barandas de seguridad. Operario A clasificando en la cinta, operario B caminando al fondo. El científico usa casco y chaleco.

| t | Cámara | Acción | Gráficos | Narración |
|---|---|---|---|---|
| 0–6.5 | C1 aérea | Plano general de la planta; el científico camina por el pasillo peatonal señalizado | — | E4_01 (0.8) |
| 6.5–13 | C2 a ras de la cinta | Residuos mezclados avanzan: latas de acero y aluminio, botellas, cartón | Etiqueta **RESIDUOS MEZCLADOS** | E4_02 (6.6) |
| 13–21 | C3 bajo el separador | Las latas de acero son levantadas por el imán y llevadas por la banda transversal; **corte interno**: la carcasa se vuelve transparente y muestra el imán | Líneas de campo, etiquetas **SEPARADOR MAGNÉTICO DE BANDA** y **ACERO → separado** | E4_03 (13.4) |
| 21–31 | C4 sobre el científico en la consola | Las latas caen al contenedor; aluminio y plástico siguen; el científico opera la pantalla táctil | Flechas de trayecto y etiqueta | E4_04 (21.2) |

**Transición:** fundido a negro (0.8 s).

## E5 — Chatarrería con electroimán (28 s) · `shot_e5.py`

Patio de chatarra con pilas procedurales (~900 piezas), volquete, camión, galpón, cerco, barreras de hormigón y cartel **ZONA SEGURA**; cartel **PELIGRO: CARGAS SUSPENDIDAS**. Grúa manipuladora con orugas, pluma, cable y electroimán; operador en la cabina.

| t | Cámara | Acción | Gráficos | Narración |
|---|---|---|---|---|
| 0–7 | C1 aérea | El científico llega a la zona segura (detrás de las barreras, fuera del radio de trabajo) | — | E5_01 (0.8) |
| 7–14 | C2 cabina/pluma | La grúa gira y se posiciona sobre la pila; baja el imán; **activa el electroimán** (12.2 s) | Brillo, líneas de campo, etiqueta **ELECTROIMÁN ACTIVADO** | E5_02 (7.4) |
| 14–23 | C3 general lateral | Levanta piezas de hierro/acero, gira 90°, baja sobre el volquete y **corta la corriente** (20.6 s): la carga cae | Etiquetas **hierro y acero**, **CORRIENTE OFF** | E5_03 (14.2) |
| 23–28 | C4 plano medio del científico | Explica a cámara desde la zona segura | — | E5_04 (23.6) |

El personaje nunca se ubica bajo cargas suspendidas ni dentro del radio de giro.

## E6 — Aplicaciones y resumen (22 s) · `shot_e6.py`

| t | Cámara | Acción | Gráficos | Narración |
|---|---|---|---|---|
| 0–8.2 | C1 picado sobre la mesada | Presiona tres botones; cada maqueta se anima: brazo con imán sobre arena/hierro, cinta con separador en miniatura, grúa con electroimán | — | E6_01 (0.8) |
| 8.2–15 | C2 frontal | Gesto de manos abiertas | **RECUPERACIÓN DE MATERIALES**, **CLASIFICACIÓN DE RESIDUOS**, **APROVECHAMIENTO INDUSTRIAL** | E6_02 (8.6) |
| 15–22 | C3 dolly-out general | Mira a cámara y sonríe | Título final **SEPARACIÓN MAGNÉTICA — CIENCIA EN ACCIÓN** con líneas de campo y partículas | E6_03 (16.6) |

---

## Audio
- Narración: `audio/narracion.py` (Piper es_AR), verificada con Whisper.
- Música instrumental original procedural (pads, bajo, arpegio, pulso suave en escenas industriales) con ducking bajo la voz.
- Efectos sintetizados y sincronizados con la animación: pisadas (extraídas de las curvas IK de los pies), metal, limaduras, funda, puertas, holograma, beeps, maquinaria, viento y pájaros, motor y giro hidráulico de la grúa, zumbido del electroimán, caída de chatarra.
- Subtítulos SRT sincronizados (también incrustados como pista de texto en el MP4).
