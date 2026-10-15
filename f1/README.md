# F1 Ultra Realistic

Simulador de Fórmula 1 que corre en el navegador (Three.js + WebGL2, sin instalación). Incluye los 15 circuitos pedidos con sus trazados reales, física de auto con neumáticos, aerodinámica y daños, 19 rivales con IA, boxes con mecánicos animados, Safety Car, clima dinámico, dos relatores en español rioplatense, radio del ingeniero, repeticiones y modos campeonato y trayectoria.

## Cómo jugar

```bash
node f1/server.mjs        # o: npm run juego (desde la raíz del repo)
```

Abrí http://localhost:8080. También funciona con cualquier servidor estático apuntando a la carpeta `f1/` (no hace falta compilar nada). Se recomienda Chrome o Edge en una PC con GPU dedicada; la primera carga de cada circuito tarda unos segundos porque el mundo se genera en el momento.

Si la GPU es modesta, bajá la calidad en **Configuración → Gráficos** (Baja o Media) y dejá activada la resolución dinámica.

### Controles

| Acción | Teclado | Mando |
|---|---|---|
| Acelerar / frenar | ↑ / ↓ (o W / S) | Gatillo derecho / izquierdo |
| Dirección | ← → (o A / D) | Stick izquierdo |
| Subir / bajar marcha (si desactivás cambios automáticos) | E / Q | RB / LB |
| DRS | Espacio o F | A |
| Limitador de boxes | L | X |
| Cambiar cámara | C | Y |
| Mirar atrás | V | B |
| Menú de estrategia (neumáticos, ERS, mezcla, reparto de frenada) | M o Tab | Back |
| Modo ERS | X | — |
| Pedir box | B | — |
| Volver a pista | R | — |
| Seguir a otro auto | [ ] | — |
| Pausa | Esc o P | Start |

El volante se configura en **Configuración → Controles → Volante**: tocás "Calibrar dirección" y girás, después acelerador y freno. Las teclas se pueden reasignar desde la misma pantalla. En pantallas táctiles aparecen botones en pantalla.

## Qué incluye

**Modos**: carrera rápida, Gran Premio (prácticas → clasificación → carrera → podio), campeonato (15, 8 o 4 carreras, tablas de pilotos y constructores), modo trayectoria (creás tu piloto, ofertas de equipos según reputación, temporadas sucesivas), contrarreloj con fantasma y récords, entrenamientos, clasificación, garaje con reglaje y repeticiones.

**Circuitos**: Monza, Mónaco, Silverstone, Spa-Francorchamps, Suzuka (con el puente del ocho), Interlagos, Barcelona-Catalunya, Red Bull Ring, COTA, Yas Marina, Marina Bay (nocturno), Hungaroring, Gilles Villeneuve, Albert Park y Hermanos Rodríguez. Los trazados salen de coordenadas GPS reales (dataset [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits), licencia MIT) escaladas a la longitud oficial. Cada uno tiene su ancho, altitud (afecta la densidad del aire, por ejemplo en México), perfil de desniveles aproximado, escapatorias, muros, pianos, boxes con garajes por equipo, tribunas con público animado, comisarios, fotógrafos, carteles, cámaras de TV y entorno propio (lago, mar, río, montañas, ciudad, rascacielos, rueda gigante, torre de COTA, hotel de Yas, estadio de México, etc.).

**Física** (`js/core/CarPhysics.js`): modelo de 4 ruedas a 300 Hz con transferencia de carga longitudinal y lateral, neumáticos tipo Pacejka con elipse de fricción, sensibilidad a la carga, bloqueo y patinamiento, carga aerodinámica y resistencia según alerones, DRS, rebufo y aire sucio, motor V6 con curva de potencia, 8 marchas, ERS con batería, combustible que pesa y se consume, temperatura y desgaste por neumático, compuestos blando/medio/duro/intermedio/lluvia con agarre según humedad, temperatura de frenos, pianos, pasto y grava, pendientes, choques contra muros y daños (alerón, suelo, suspensión) que cambian el comportamiento. ABS, control de tracción, estabilidad y cambios automáticos son opcionales.

**IA** (`js/core/AIDriver.js`): cada rival tiene un perfil de velocidad calculado con la física de su auto y habilidades propias (ritmo, frenada, ataque, defensa, gomas, consistencia, lluvia, largada). Adelantan por dentro o por fuera, defienden la posición, siguen con distancia de frenada segura, esquivan autos detenidos, cometen errores (bloqueos, despistes, trompos, choques), hacen su estrategia de paradas y cambian a neumáticos de lluvia.

**Carrera** (`js/core/Session.js`): semáforo de largada con salida en falso, vuelta de formación opcional, cronometraje por sectores, intervalos, vuelta rápida, DRS con punto de detección, banderas amarillas, azules, Safety Car, Virtual Safety Car y bandera roja con relanzamiento, penalizaciones (límites de pista, exceso de velocidad en boxes, adelantar con amarilla o Safety Car, provocar choques), fallas mecánicas, abandonos, resultados con puntos.

**Boxes**: hay que bajar a 80 km/h antes de la línea del limitador; después el auto va solo hasta su garaje, los mecánicos (pistolas, gatos, portarruedas, lollipop) cambian las cuatro ruedas y la parada dura según la calidad del equipo, con errores ocasionales y cambio de trompa si hay daño.

**Relato y radio** (`js/audio/Commentary.js`, `js/data/phrases.js`): un relator con emoción y un comentarista técnico reaccionan a los eventos reales de la carrera (largada, adelantamientos, choques, banderas, Safety Car, boxes, vuelta rápida, lluvia, última vuelta, podio) con nombres, posiciones y diferencias, prioridades y sin repetir frases. Usan la síntesis de voz del navegador (prefiere voces es-AR) y siempre muestran subtítulos. El ingeniero avisa lluvia, banderas, desgaste, frenos, combustible, distancias y llama a boxes.

**Audio** (`js/audio/AudioEngine.js`): motor sintetizado según rpm y carga, turbo, MGU-K, cambios, petardeos, neumáticos, pianos, viento, grava, golpes, público, lluvia, pistolas neumáticas, radio y motores rivales con sonido espacial y efecto Doppler. Suena distinto en cada cámara.

**Gráficos**: materiales PBR, pintura con barniz, fibra de carbono, sombras dinámicas, bloom, oclusión ambiental (Ultra), SMAA, niebla, lluvia, spray, humo, chispas, carrera nocturna con torres de luz, LOD de autos, carga progresiva del circuito y resolución dinámica. Cámaras: exterior, T-cam, cockpit, frontal, lateral, TV, helicóptero y libre.

## Limitaciones conocidas

- No se usó Unreal Engine 5: el entorno de desarrollo no tiene GPU ni editor, así que el juego está hecho para el navegador. El trazado de rayos no existe en WebGL; los reflejos usan mapas de entorno.
- Equipos y pilotos son ficticios (no hay licencias oficiales). Se editan en `js/data/teams.js` y el relato los toma de ahí.
- Los perfiles de elevación son aproximados a partir de los desniveles conocidos de cada circuito; la numeración de curvas sale de la geometría y puede no coincidir con la oficial.
- Las voces dependen de las que tenga instaladas el sistema operativo.

## Pruebas

```bash
node f1/test/tracks.test.mjs        # construye los 15 circuitos y calcula el tiempo teórico de vuelta
node f1/test/drive.test.mjs         # un piloto automático maneja el modelo físico completo
node f1/test/race.test.mjs monza 10 # carrera completa solo con IA (boxes, banderas, resultados)
node f1/test/player.test.mjs monza  # jugador: parada asistida, clasificación, práctica, contrarreloj y repetición
```

## Estructura

- `index.html`, `css/style.css`: interfaz y HUD.
- `js/main.js`: flujo del juego y bucle principal.
- `js/core/`: circuito, física, IA, sesión, repeticiones, guardado.
- `js/render/`: escena del circuito, modelo del auto, personas, cámaras, partículas, garaje y podio.
- `js/audio/`: audio, relatores y radio.
- `js/ui/`: HUD y pantallas de menú.
- `js/modes/Season.js`: campeonato y trayectoria.
- `js/data/`: circuitos, equipos, frases.
- `vendor/three/`: Three.js r186 (MIT).
- `tools/gen-circuits.py`: genera `circuitGeo.js` desde el GeoJSON.
