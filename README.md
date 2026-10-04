# Precio de Fábrica

App web que, para cualquier producto, estima:

1. **El precio de fábrica**: lo que cobra el fabricante por unidad comprando por volumen (FOB/EXW), con pedido mínimo y origen.
2. **Lo que debería costar en tu país**: precio de fábrica + flete y seguro + aranceles + tasas + IVA y otros impuestos + un margen razonable de comercio, en moneda local.
3. **A cuánto se vende hoy en tu país**, y si está caro, barato o razonable comparado con lo anterior.

Usa IA (Claude con búsqueda web) para buscar en mayoristas y fabricantes (Alibaba, Made-in-China, 1688, Global Sources, IndiaMART…), en las reglas de importación del país elegido y en tiendas locales. Muestra el progreso en vivo y las fuentes consultadas.

## Uso

Requiere Node.js 22.18 o superior y una API key de Anthropic.

```bash
npm install
cp .env.example .env   # y completá ANTHROPIC_API_KEY
npm start
```

Abrí http://localhost:3000, escribí el producto, elegí el país y tocá **Buscar**.

## Configuración

| Variable | Default | Para qué |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Obligatoria |
| `PORT` | `3000` | Puerto del servidor |
| `PRECIO_MODELO` | `claude-opus-5-5` | Modelo de Claude |
| `PRECIO_ESFUERZO` | `low` | `low` es lo más rápido; `medium` o `high` dan estimaciones más cuidadas pero tardan más |

Las búsquedas repetidas (mismo producto y país) se guardan en memoria 6 horas y responden al instante.

## Estructura

- `src/server.ts`: servidor HTTP. Sirve la página y `GET /api/buscar?producto=…&pais=AR`, que devuelve el progreso y el resultado como eventos SSE.
- `src/buscador.ts`: consulta a Claude con búsqueda web y valida el resultado contra un esquema.
- `src/paises.ts`: países disponibles con su moneda.
- `public/index.html`: interfaz.

`npm run check` corre el chequeo de tipos.

## Aclaración

Los resultados son estimaciones hechas con fuentes públicas, no cotizaciones formales. Antes de comprar o importar, confirmá con el proveedor y con un despachante de aduana.

---

# Arquero AR

Realidad aumentada en tu lugar real: escaneás el piso, ponés un arco con arquero, escaneás tu pelota de verdad y, cuando la pateás, el arquero virtual se tira a atajarla. Puede grabar cada tiro con el arquero incluido.

## Qué hace

1. **Ubicar el arco**: con ARCore (WebXR *hit-test*) encuentra el piso real y fija el arco ahí (con *anchors*, no se corre aunque muevas el celular).
2. **Escanear la pelota**: aprende los colores de tu pelota y del lugar. Después la reconoce en cada cuadro de la cámara con precisión de fracciones de píxel.
3. **Patear**: cuando la pelota queda quieta aparece «Pelota lista». El remate tiene que salir de ese punto, rápido y hacia el arco; la app lo detecta en dos cuadros y ajusta la trayectoria física (por el piso o por el aire, con gravedad y resistencia del aire) a lo que ve la cámara. Cada medición se refina leyendo esa zona de la cámara en su resolución real.

Para medir bien en cualquier celular:

- **Orientación de la cámara**: al mover el celular compara cómo se corre la imagen con el giro que informa ARCore y detecta sola si el navegador entrega la imagen dada vuelta o espejada (si no, todas las posiciones saldrían mal).
- **Borde de la pelota**: el centro y el tamaño se miden sobre el borde real (donde cambia el color), ajustando un círculo con decenas de puntos y descartando los que no encajan. Así no lo engañan la sombra ni el sol de un costado.
- **Tamaño real de la pelota**: mientras está quieta en el piso calcula su radio verdadero (no hace falta acertar el número de pelota).

Para no confundirse: el detector propone varias manchas y el seguimiento elige la que tiene sentido físico (la que sigue quieta, la que sale del punto de reposo o la que va por la trayectoria, con el tamaño que corresponde a esa distancia). Una pierna, otro objeto claro o la detección que salta a otro lado se descartan, y si después de "detectar" un remate la pelota sigue en su lugar, se cancela sin dar resultado. Con eso calcula por dónde va a cruzar la línea y el arquero se tira a ese punto. Según la dificultad, su reacción y lo lejos que llega, ataja o es gol.

Dos modos:

- **En mano**: sostenés el celular y mirás la jugada. Descuenta el giro de la cámara (con la orientación de ARCore) para seguir detectando la pelota en movimiento.
- **Fijo + video**: apoyás el celular mirando al arco. Es el modo más preciso y graba cada tiro (desde unos segundos antes hasta el resultado) en un video que podés descargar o compartir.

## Requisitos

- Un celular **Android con Chrome** compatible con ARCore ("Servicios de Google Play para RA" instalado). Usa WebXR con `camera-access`, que Chrome soporta en Android.
- En **iPhone**, Safari todavía no tiene WebXR para realidad aumentada. Ahí sólo anda la demo.
- La página tiene que abrirse con **https** (o `localhost`).

## Cómo abrirla en el celular

- **GitHub Pages**: en el repo, *Settings → Pages → Source: GitHub Actions*. Cada cambio en `arquero/` que llegue a la rama principal se publica solo (workflow `arquero-pages.yml`) en `https://ramiroarrojo2077-beep.github.io/Hl/`.
- **Desde tu compu**: `npm start` y abrí `http://localhost:3000/arquero/`. Para usarla en el celular conectalo por USB, abrí `chrome://inspect` en la compu y activá *Port forwarding* del puerto 3000; en el celular entrá a `localhost:3000/arquero/`.

## App para Android (APK)

El workflow `android-apk.yml` compila el APK en GitHub Actions con cada cambio y lo publica en *Releases* con la etiqueta `apk`:

`https://github.com/ramiroarrojo2077-beep/Hl/releases/download/apk/arquero-ar.apk`

Para instalarlo, abrí ese link en el celular, descargalo y aceptá instalar apps de origen desconocido. La app trae el juego adentro y funciona sin internet: lo sirve en `http://localhost` dentro del celular y lo abre con Chrome, porque Android no permite realidad aumentada web dentro de una WebView y Chrome sí. Si en la ventana integrada no arranca la realidad aumentada, el botón **Abrir en Chrome** lo abre en Chrome normal.

Está firmado con una clave de prueba pública (`android/app/arquero-debug.keystore`) para que cada versión nueva se instale encima de la anterior. Para publicar en Play Store hace falta una clave propia y privada.

Para compilarlo en tu compu (con el SDK de Android instalado): `npm ci`, `npm run android:web` y después `./gradlew assembleRelease` dentro de `android/`.

## Consejos para que detecte mejor

- Escaneá la pelota con buena luz, llenando el círculo.
- Antes de patear esperá a que diga **«Pelota lista»** (la pelota quieta medio segundo).
- Mejor si la pelota contrasta con el piso y la pared (si no, la app igual aprende el fondo, pero tarda un poco más).
- En modo fijo dejá el celular quieto, con el arco y el punto de remate a la vista, a 1-2 m detrás o al costado de donde pateás.
- El botón ⚙ muestra lo que ve el detector (en violeta) para revisar que reconozca la pelota.
- Si un tiro sale mal, tocá ⚙ → **Guardar registro para Claude** y mandá ese archivo: tiene lo que midió la cámara cuadro a cuadro y fotos del remate, para ver qué falló.

## Estructura

- `arquero/index.html`: interfaz (inicio, pasos y HUD sobre la cámara).
- `arquero/js/app.js`: flujo del juego (ubicar → escanear → patear), resultados y videos.
- `arquero/js/xr-stage.js`: sesión WebXR (hit-test, anchors, imagen de la cámara).
- `arquero/js/detector.js`: reconocimiento de la pelota en la imagen (colores aprendidos, movimiento compensando el giro de la cámara, centro y radio subpíxel).
- `arquero/js/tracker.js`: posición 3D, detección del remate y ajuste de la trayectoria a los rayos de la cámara.
- `arquero/js/keeper-ai.js`: hasta dónde llega el arquero según la dificultad y el resultado del tiro.
- `arquero/js/keeper.js`, `goal.js`: el arquero y el arco en 3D (sin archivos externos).
- `arquero/js/recorder.js`: grabación de cada tiro (cámara + arquero) con MediaRecorder.
- `arquero/js/demo-stage.js`: demo sin realidad aumentada que simula la cámara, para probar en cualquier navegador.
- `android/`: app Android que empaqueta el juego (servidor local + Chrome).

`npm test` corre las pruebas del detector, el seguimiento y el arquero.

