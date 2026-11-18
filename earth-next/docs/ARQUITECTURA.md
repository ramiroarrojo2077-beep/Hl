# Arquitectura de EARTH NEXT

```
earth-next/
├── src/
│   ├── geo/        Núcleo geoespacial puro (sin dependencias, probado): coordenadas/UTM, geodesia WGS84,
│   │               astronomía, teselas, terreno Terrarium, pendientes, LOD, edificios OSM, recorridos
│   ├── services/   Acceso a datos: HTTP con reintentos y caché IndexedDB, geocodificación, elevación,
│   │               Overpass, Wikipedia/Wikidata, clima, calle, histórico, ruteo, asistente
│   ├── engine/     Motor 3D sobre CesiumJS: terreno, imágenes, edificios, navegación, herramientas,
│   │               iluminación/tiempo, clima en el globo, recorridos y video, panorámicas, calidad adaptable
│   ├── ui/         Interfaz Preact + señales: barra superior, riel, paneles, información, asistente
│   ├── state/      Estado global reactivo y ajustes persistidos
│   └── i18n/       Traducciones (texto fuente en español, diccionario inglés)
├── server/         Node (sin framework): API de estado, asistente con Claude (SSE), proxy METAR,
│                   PostGIS opcional, archivos estáticos
├── tests/          Vitest (unitarias + integración del asistente)
└── e2e/            Playwright (humo y funciones avanzadas)
```

## Decisiones principales

**CesiumJS (Apache 2.0)** es el motor: globo WGS84 de precisión, streaming jerárquico de terreno e imágenes con *frustum culling* y *horizon culling*, 3D Tiles, sombras, atmósfera y planificador de pedidos. Sobre él se agregan capas propias:

- **Proveedor de terreno Terrarium** (`engine/terrain-provider.ts`): implementa la interfaz `TerrainProvider` sobre las teselas abiertas de AWS. Usa el planificador de Cesium (prioridad y cancelación) y decodifica PNG → alturas en un pool de *web workers* (`decoder-pool.ts`), re-muestreando a grillas de 65×65 con bordes coincidentes. La batimetría se recorta a 0 m salvo que se active.
- **Edificios OSM por teselas** (`engine/buildings.ts`): pide huellas por tesela z15 alrededor del centro de la vista (sólo bajo 6 km), las convierte con el esquema *Simple 3D Buildings* (`geo/osm-buildings.ts`) y las extruye en *Primitives* por lotes en *workers* de Cesium. La base de cada edificio es el mínimo de la elevación del terreno bajo sus vértices. Las teselas se descargan por LRU (40 máx.): nunca se carga una ciudad entera en memoria.
- **LOD semántico** (`geo/lod.ts`): además del LOD interno de Cesium, define 6 niveles que activan capas de datos (edificios bajo 6 km, elementos urbanos bajo 900 m).
- **Calidad adaptable** (`engine/quality.ts`): perfiles bajo/medio/alto/ultra (escala de resolución, error de pantalla, caché de teselas, MSAA, sombras, HDR). En automático mide FPS cada 2 s y baja de perfil si no se alcanza el objetivo; sube sólo tras 20 s estables.
- **Iluminación**: modo "auto" (día/noche y luces nocturnas desde el espacio; luz plena bajo 2000 km para poder leer la imagen a cualquier hora) y modo "realista" (noche también a nivel del suelo).

**Preact + señales** para la interfaz: liviano (≈3 kB) y reactivo sin re-renderizar el globo.

**Servidor Node sin framework** (`server/index.ts`): pocas rutas, validación con Zod, límite de tasa por IP, cuerpos de hasta 64 kB. Ejecuta TypeScript directamente (Node ≥ 22.18) y reutiliza los módulos de `src/geo`.

## Asistente geográfico

- **Con IA** (`server/assistant.ts`): Messages API de Anthropic con herramientas, bucle en el servidor y streaming SSE al navegador. Herramientas de **datos** (geocodificación, elevación, medición geodésica, Sol/Luna, clima, Wikipedia, rankings de Wikidata, lugares OSM, búsqueda web con citas) y de **acción** (volar, vista desde el espacio, hora, capas, comparación histórica, marcadores, rutas, recorridos, calle, clima, narración) que el servidor reenvía al navegador como eventos. Las entradas se validan con Zod antes de ejecutar nada. Las conversaciones se guardan en memoria del servidor y sólo se extienden agregando mensajes al final. Se usa el bucle propio (y no Managed Agents) porque las acciones se ejecutan en el globo del navegador del usuario con baja latencia.
- **Modo básico** (`services/assistant-local.ts`): reglas en español e inglés que resuelven los pedidos frecuentes con los mismos servicios de datos y fuentes. Si no entiende, lo dice.

## Datos y caché

`services/http.ts` centraliza tiempo de espera, reintentos con retroceso exponencial (errores de red, 429, 5xx, respetando `Retry-After`), deduplicación de pedidos en vuelo y caché en IndexedDB con expiración (+ respaldo "vencido" para modo sin conexión). El *service worker* cachea la aplicación y hasta 3000 teselas de imágenes/terreno.

## Persistencia

- Navegador: ajustes, favoritos, colecciones, proyectos, recorridos y dibujos (localStorage / IndexedDB); exportación a archivo.
- Servidor (opcional): PostgreSQL + PostGIS (`server/db.ts`) con lugares (`GEOGRAPHY(POINT)`, índice GiST, consultas `ST_DWithin` y por bbox) y capas GeoJSON por proyecto.

## Extensiones previstas

- **Cliente fotorrealista en Unreal Engine 5**: Cesium for Unreal consume las mismas fuentes (terreno, imágenes, 3D Tiles); el servidor y el asistente se reutilizan.
- **Procesamiento en Python**: pipelines de OSM/raster hacia PostGIS (osm2pgsql, GDAL) para servir capas propias como teselas.
- **Componentes Rust/C++ (WASM)**: candidatos si se procesan rásters grandes en el cliente (sombreado de relieve, cuencas visuales); hoy la decodificación ya corre en *workers*.
