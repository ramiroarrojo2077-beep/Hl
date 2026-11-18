# Estado por fase y verificación

Verificado el 18/11/2026 con Chromium sin interfaz (WebGL por software), servidor de desarrollo y build de producción.

| Fase | Estado | Cómo se verificó |
|---|---|---|
| 1. Globo, cámara, navegación, búsqueda | Completa | E2E: motor en < 2 s, sugerencias Photon, vuelo a Buenos Aires, coordenadas; unitarias de coordenadas/UTM/geodesia |
| 2. Terreno, mapas, edificios | Completa con salvedad | E2E: terreno real del Aconcagua (altura bajo cámara 3721 m), capas Esri/GIBS. Edificios: pipeline completo probado con un recorte **sintético** porque Overpass no responde desde el contenedor de desarrollo; parser y alturas cubiertos con unitarias |
| 3. Interfaz y herramientas | Completa | E2E: distancia, perfil de elevación, todos los paneles, importación GeoJSON, captura PNG; PostGIS probado con PostgreSQL 16 + PostGIS 3 (inserción, `ST_DWithin`, bbox, GeoJSON) |
| 4. Calle y panorámicas | Completa | E2E: panorámica 360° real de Panoramax en París, navegación por secuencia; vista 3D aproximada rotulada |
| 5. Asistente IA | Completa con salvedad | Modo básico verificado E2E (distancia Ushuaia–La Quiaca con marcadores y fuentes). Bucle con IA verificado contra una API **simulada** (herramientas en paralelo, acciones, texto en streaming, fuentes); no hubo clave real disponible para una prueba contra la API de Anthropic |
| 6. Clima, iluminación, histórico | Completa | E2E: pronóstico Open-Meteo, radar RainViewer, 19 estaciones METAR vía proxy, ciclones GDACS en curso, Wayback 2014 vs actual con divisor, Landsat 1990, animación del tiempo; unitarias de astronomía (salidas/puestas ±3 min, equinoccios ±20 min, fases lunares) |
| 7. Recorridos y video | Completa | E2E: vuelo a Machu Picchu grabado a MP4 (190 kB); unitarias de interpolación y continuidad de trayectorias |
| 8. Optimización y pruebas | Completa | Calidad adaptable, caché IndexedDB, *service worker*, 70 pruebas unitarias/integración, 30 verificaciones E2E, diseño móvil sin desbordes |

## Limitaciones conocidas

- Las alturas de edificios dependen de OpenStreetMap: donde no hay `height` ni `building:levels`, el volumen es genérico y se muestra semitransparente con aviso.
- Sin token de Cesium ion o clave de Google no hay fachadas fotorrealistas (LOD 5 muestra sólo lo disponible).
- La cobertura de panorámicas abiertas es desigual (muy buena en Francia y Europa, menor en otras regiones).
- El servidor de demostración de OSRM sólo rutea en auto.
- Los FPS medidos en el entorno de prueba (render por software) no son representativos; en GPU real el objetivo es 60 FPS con degradación automática.
- El `Dockerfile` y `docker-compose.yml` son de referencia y no se ejecutaron en el entorno de desarrollo.
