# EARTH NEXT

Plataforma geoespacial 3D para explorar la Tierra completa: desde la órbita hasta la calle, con terreno real, edificios de OpenStreetMap, imágenes satelitales actuales e históricas, clima, iluminación astronómica, recorridos cinematográficos y un asistente geográfico con IA.

Todo usa **fuentes abiertas o autorizadas**; no se extraen datos de Google Earth. Cada panel muestra la fuente, la licencia y la naturaleza del dato (observado, mosaico, modelo, pronóstico o efecto visual simulado).

## Inicio rápido

Requiere Node.js 22.18 o superior y un navegador con WebGL 2.

```bash
cd earth-next
npm install
cp .env.example .env      # opcional: ANTHROPIC_API_KEY, DATABASE_URL
npm run dev               # API en :8787 + interfaz en http://localhost:5173
```

Producción:

```bash
npm run build && npm start   # sirve dist/ y la API en http://localhost:8787
```

Sin ninguna clave la aplicación funciona completa con datos abiertos; el asistente usa su **modo básico** (reglas + servicios de datos) hasta que se configure `ANTHROPIC_API_KEY`.

### Android

Hay un APK firmado para instalar directamente y el proyecto Android (Capacitor) para recompilarlo: ver [docs/ANDROID.md](docs/ANDROID.md).

```bash
npm run android:build   # requiere JDK 21 y Android SDK 36
```

## Qué incluye

| Área | Funciones (verificadas en navegador salvo que se indique) |
|---|---|
| Globo | Elipsoide WGS84, atmósfera, estrellas, Luna, sol según fecha y hora, ciclo día/noche, luces nocturnas, transiciones sin pantallas de carga entre espacio y calle |
| Terreno | Streaming de elevación abierta (AWS Terrain Tiles: SRTM, ETOPO1…) convertida en *web workers* a mallas cuantizadas **con normales**, de modo que el Sol real ilumina laderas y valles; densidad de malla según la calidad (hasta 129×129 por tesela), exageración vertical, batimetría opcional; Cesium World Terrain con token propio |
| Imágenes | Satélite de alta resolución (Esri), Blue Marble, satélite del día (VIIRS), mapas de calles, topográfico, físico, político (límites y nombres), transporte |
| Edificios | Huellas OSM por teselas z15 (Overpass) extruidas con su altura, iluminadas por el Sol y con sombras; colores reales registrados en OSM (`building:colour`, techos con `roof:colour`) o paleta por tipo; las alturas sin dato se ven translúcidas y rotuladas como aproximadas; LRU de memoria. Opcional: Cesium OSM Buildings o Google Photorealistic 3D Tiles con clave propia |
| LOD semántico | 0 espacio · 1 países · 2 ciudades · 3 barrios y edificios (< 6 km) · 4 calles y elementos urbanos OSM (< 900 m), con árboles 3D en su posición real (forma simbólica; altura y copa de OSM si existen) · 5 detalles disponibles |
| Búsqueda | Sugerencias (Photon), búsqueda y geocodificación inversa (Nominatim, 1 pedido/s), coordenadas decimales, GMS y UTM |
| Navegación | Orbital, aéreo, dron, peatón (vista 3D aproximada rotulada), satélite (LEO/MEO/GEO), cinematográfico; teclado, ratón y táctil; velocidad, sensibilidad, altura de ojos y campo de visión configurables |
| Herramientas | Distancia geodésica (Vincenty), superficie y perímetro, altura entre puntos (también sobre edificios), coordenadas en 3 formatos, perfil de elevación con CSV, pendiente (Horn), ruta por calles (OSRM), marcadores, líneas y polígonos, importación GeoJSON/KML/KMZ, exportación GeoJSON/KML/KMZ, capturas PNG con atribuciones, proyectos (navegador o archivo), comparación con divisor |
| Calle | Panorámicas 360° y fotos con licencia abierta (Panoramax; Mapillary con token), visor WebGL propio, navegación por secuencia, comparación por fechas, lugares cercanos; sin cobertura → vista 3D aproximada rotulada |
| Asistente | Lenguaje natural → consultas con fuentes + acciones en el globo (volar, vista desde el espacio, hora, capas, comparación histórica, marcadores, rutas, recorridos, narración por voz). IA: Claude con herramientas; sin clave: modo básico |
| Clima | Pronóstico y análisis de modelo (Open-Meteo), estaciones METAR observadas (NOAA), radar animado (RainViewer), ciclones en curso (GDACS), satélite: nubes del día, precipitación, temperatura de aire y mar; efectos de lluvia/nieve **rotulados como simulados** |
| Historia | Esri Wayback (≈200 versiones desde 2014), Landsat anual 1985–2000, MODIS diario desde 2000, Sentinel-2/Landsat HLS desde 2015 con búsqueda de fechas despejadas (NASA CMR), cobertura del suelo 2001–2024 |
| Iluminación | Posición del Sol y la Luna, salida/puesta, crepúsculos, fases lunares, estaciones, curva anual de duración del día, animación acelerada, sombras dinámicas |
| Recorridos | Vuelo A→B con arco orbital, órbitas, seguimiento de rutas, editor de puntos clave (duración, pausa, rumbo, cabeceo, altura, suavizado, narración), grabación de video (MP4/WebM según navegador) |
| Explorar | Ficha de país y ciudad (Wikidata), lugares de interés OSM y artículos de Wikipedia cercanos, rankings (edificios más altos, montañas, ciudades), comparación de ciudades, lecciones educativas |
| Lugares | Favoritos, colecciones, compartir colección (GeoJSON), enlace a la vista actual (`#@lat,lon,altura…`), búsquedas recientes; sincronización con PostGIS si el servidor la tiene |
| Interfaz | Tema oscuro/claro/automático, alto contraste, texto grande, movimiento reducido, español e inglés, diseño móvil, minimapa, atajos de teclado (`?`) |
| Gráficos | Perfiles baja/media/alta/ultra: densidad de píxeles hasta 2× en pantallas de alta densidad, MSAA 4–8×, HDR con tonemapping PBR neutro, atmósfera calculada por fragmento e iluminada por el Sol, sombras suaves de edificios y árboles sobre el terreno, oclusión ambiental (ultra), precarga de teselas vecinas |
| Rendimiento | Calidad adaptable con objetivo de FPS (sube y baja de perfil según los FPS medidos, con techo por dispositivo), streaming progresivo, caché IndexedDB + LRU en memoria, *service worker* para uso sin conexión parcial, reintentos con retroceso, descarga selectiva por teselas |

## Pruebas

```bash
npm run check   # tipos (cliente y servidor)
npm test        # unitarias + integración del asistente con una API simulada
npm run test:e2e   # requiere `npm run dev` y Playwright con Chromium
```

- **Unitarias (70)**: coordenadas y UTM (verificadas contra PROJ), geodesia (contra GeographicLib), áreas, astronomía (salidas/puestas, equinoccios, fases lunares), teselas, decodificación de terreno, pendientes, LOD, alturas OSM y multipolígonos, recorridos, y el bucle del asistente (herramientas de datos, acciones, historial sólo agregado al final).
- **E2E (`e2e/smoke.cjs`, `e2e/features.cjs`)**: arranque, búsqueda y vuelo, edificios por teselas, terreno de montaña, medición, perfil, todos los paneles, asistente, Panoramax 360°, Wayback y Landsat con divisor, pronóstico, radar, METAR, ciclones, grabación de video, importación GeoJSON, captura, animación del tiempo, diseño móvil. Con `E2E_FAKE_OVERPASS=1` se sirve un recorte **sintético** de edificios para entornos sin acceso a Overpass.

## Documentación

- [Arquitectura](docs/ARQUITECTURA.md)
- [Fuentes de datos, licencias y dependencias externas](docs/FUENTES-Y-LICENCIAS.md)
- [Estado por fase y verificación](docs/ESTADO.md)
- [App Android](docs/ANDROID.md)
