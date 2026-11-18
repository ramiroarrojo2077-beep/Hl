# Fuentes de datos, licencias y dependencias externas

La aplicación no extrae ni redistribuye datos de Google Earth. Las capas que requieren licencia propia del usuario (Cesium ion, Google Map Tiles API, Mapillary) se activan sólo con su clave.

## Fuentes abiertas usadas por defecto

| Dato | Proveedor | Licencia / condiciones | Naturaleza |
|---|---|---|---|
| Terreno | AWS Terrain Tiles (Mapzen Terrarium: SRTM, GMTED2010, ETOPO1, NED…) | Fuentes abiertas, atribución requerida | Modelo de elevación |
| Satélite alta resolución, mapas topográfico/físico/atlas, límites, transporte | Esri ArcGIS Online | Términos de Esri; atribución obligatoria; uso comercial con cuenta ArcGIS | Mosaico de varias fechas |
| Blue Marble, VIIRS/MODIS diarios, Black Marble, IMERG, AIRS, GHRSST, GPW, cobertura del suelo, Landsat WELD, HLS, ASTER | NASA EOSDIS GIBS | Dominio público (se pide atribución); GPW: CC BY 4.0 | Observado / mosaico / modelo |
| Imágenes históricas | Esri World Imagery Wayback | Términos de Esri | Mosaico por versión |
| Fechas de adquisición HLS | NASA CMR | Dominio público | Metadatos |
| Calles, edificios, lugares, elementos urbanos | OpenStreetMap (Overpass, Nominatim, Photon, teselas) | ODbL; políticas de uso de cada servicio | Cartografía colaborativa |
| Panorámicas y fotos de calle | Panoramax (federación) | CC-BY-SA / Etalab según autor | Fotografía |
| Ruteo | OSRM (servidor de demostración) | ODbL (datos), uso moderado | Cálculo |
| Pronóstico y análisis | Open-Meteo | CC BY 4.0 | Modelo / pronóstico |
| Estaciones meteorológicas | NOAA Aviation Weather Center (METAR) | Dominio público (EE. UU.) | Observado |
| Radar | RainViewer | Gratuito con atribución | Observado / pronóstico inmediato |
| Ciclones | GDACS (CE / ONU) | Uso libre con atribución | Observado |
| Enciclopedia | Wikipedia | CC BY-SA 4.0 | Texto |
| Datos estructurados | Wikidata | CC0 | Colaborativo |

Las capturas de pantalla incrustan las atribuciones de las capas visibles. Al publicar videos, incluir las mismas atribuciones.

## Dependencias externas y alternativas legales

| Función | Dependencia | Limitación | Alternativa |
|---|---|---|---|
| Fachadas fotorrealistas (LOD 5) | Google Photorealistic 3D Tiles (clave y facturación de Google) | Comercial; términos de Google (logo, atribución) | Edificios OSM extruidos (abiertos) o Cesium OSM Buildings (token ion) |
| Terreno global de alta calidad con normales | Cesium World Terrain (token ion) | Cuota gratuita limitada | AWS Terrain Tiles (por defecto) |
| Imagen satelital submétrica | Esri World Imagery | Uso comercial requiere cuenta ArcGIS | Bing vía Cesium ion; NASA GIBS/HLS a 30 m (dominio público) |
| Edificios OSM | Overpass API pública | Límites de uso; puede rechazar desde algunos centros de datos | Instancia propia de Overpass o pipeline osm2pgsql → PostGIS → 3D Tiles |
| Geocodificación | Nominatim público (1 pedido/s) | No apto para alto volumen | Instancia propia de Nominatim/Photon o proveedor comercial |
| Teselas OSM estándar | tile.openstreetmap.org | Uso moderado, sin uso masivo | Servidor de teselas propio o proveedor comercial |
| Ruteo | Servidor de demostración OSRM | Sólo perfil auto, sin garantías | Instancia OSRM/Valhalla propia (`VITE_OSRM_URL`) |
| Cobertura de calle | Panoramax (sin clave); Mapillary (token gratuito) | Cobertura desigual por país | Vista 3D aproximada rotulada |
| Asistente con IA | API de Anthropic (`ANTHROPIC_API_KEY`) | Costo por uso | Modo básico local sin IA |
| Clima en tiempo real | Los modelos tienen latencia; los satélites diarios 3 h–2 días | No es "tiempo real" | Se rotula la hora de cada dato |
| Imágenes históricas anteriores a 1984 | No hay cobertura satelital global abierta | — | Las reconstrucciones del pasado remoto deben presentarse como hipotéticas |
