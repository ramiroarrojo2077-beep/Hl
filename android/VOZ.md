# Voz nativa en la app Android (`window.GravityVoz`)

El WebView de Android no trae la Web Speech API (`SpeechRecognition` ni `speechSynthesis`). En la app,
la página tiene un puente nativo: `window.GravityVoz` (Kotlin: `android/app/src/main/kotlin/ar/gravity/app/VozPuente.kt`).
Fuera de la app (navegador) no existe: usá la Web Speech API.

Solo responde si la página es la del motor (`http://127.0.0.1:38471`). Todos los métodos vuelven enseguida
y el resultado llega por eventos, salvo `disponible()`.

## Eventos (Kotlin → JS)

Definí el receptor **antes** de llamar a cualquier método:

```js
window.gravityVoz = { evento(e) { /* e.tipo dice qué pasó */ } };
```

Cada evento es un objeto con `tipo` y sus campos:

| tipo | campos | cuándo |
|---|---|---|
| `escuchando` | — | el micrófono está abierto (onReadyForSpeech) |
| `nivel` | `db` (≈ -2 a 10), `valor` (0..1) | volumen del micrófono, cada ≥ 50 ms |
| `parcial` | `texto` | transcripción provisoria (solo si cambió) |
| `final` | `texto`, `confianza?` (0..1) | terminó la frase: la escucha se cerró |
| `silencio` | — | dejaste de hablar (onEndOfSpeech); después llega `final` o `error` |
| `hablando` | `id`, `duracionMs`, `pasoMs` (20), `envolvente` [0..1] | la frase `id` empieza a sonar ahora |
| `fin` | `id`, `cortado?` (true) | la frase `id` terminó de sonar (o la cortó `callar()`) |
| `error` | `origen` (`"stt"`/`"tts"`), `codigo`, `mensaje`, `id?`, `nativo?` | ver códigos abajo |
| `voces` | igual que `disponible()` | el motor de voz terminó de arrancar (si tardó) |

Ejemplos:

```json
{"tipo":"escuchando"}
{"tipo":"nivel","db":6.4,"valor":0.7}
{"tipo":"parcial","texto":"che armame el resumen"}
{"tipo":"final","texto":"che armame el resumen de ventas","confianza":0.91}
{"tipo":"silencio"}
{"tipo":"hablando","id":"r12-0","duracionMs":2140,"pasoMs":20,"envolvente":[0,0.31,0.74,1,0.88,0.52]}
{"tipo":"fin","id":"r12-0"}
{"tipo":"fin","id":"r12-1","cortado":true}
{"tipo":"error","origen":"stt","codigo":"no_entendi","mensaje":"No se entendió nada. ¿Lo repetís?","nativo":7}
{"tipo":"error","origen":"tts","codigo":"sintesis","mensaje":"No se pudo armar la voz de esta frase.","id":"r12-2","nativo":-3}
```

Cada frase de `hablar()` termina con **un** `fin` o **un** `error` (con su `id`). Antes del `fin` normal
siempre llega su `hablando`.

## Métodos (JS → Kotlin)

### `GravityVoz.disponible()` → string JSON (sincrónico)

```json
{"stt":true,"tts":true,"ttsListo":true,"idioma":"es-AR","permisoMicrofono":false,"altavoz":false,
 "vozPorDefecto":"es-us-x-esc-local",
 "voces":[{"id":"es-us-x-esc-local","nombre":"Español (Estados Unidos) · voz 1","idioma":"es-US","calidad":"alta","red":false},
          {"id":"es-us-x-esc-network","nombre":"Español (Estados Unidos) · voz 1 · con internet","idioma":"es-US","calidad":"alta","red":true}]}
```

- Prende el motor de voz la primera vez y lo espera hasta 1,5 s. Si todavía no terminó, vuelve con
  `"ttsListo":false` y `voces` vacía, y después llega el evento `voces`.
- `voces`: español primero (rioplatense, latino, España al final), después el resto. `calidad`:
  `muy_baja` | `baja` | `normal` | `alta` | `muy_alta`. `red`: necesita internet.
- `altavoz` es siempre `false` por ahora: escondé o deshabilitá ese botón.
- Si la página no es la del motor, devuelve `"{}"`.

### `GravityVoz.escuchar(idioma)`

Escucha **una** frase (por ejemplo `"es-AR"`; si es inválido se usa `es-AR`). La primera vez pide el
permiso del micrófono. Eventos: `escuchando` → `nivel`/`parcial`… → `silencio` → `final` (o `error`).
Después de `final` o `error` la escucha se cerró: para el próximo turno, llamá de nuevo a `escuchar()`.
Llamarlo mientras ya escucha reinicia la escucha.

### `GravityVoz.dejarDeEscuchar()`

Cancela la escucha **sin** evento (ni `final` ni `error`).

### `GravityVoz.hablar(id, texto, opcionesJson)`

- `id`: 1 a 64 caracteres, lo elegís vos y vuelve en `hablando`/`fin`/`error`.
- `texto`: 1 a 4000 caracteres.
- `opcionesJson`: string JSON, opcional (`""` o `"{}"`): `{"voz":"<id de voces>","velocidad":1.0,"tono":1.0}`.
  `velocidad` y `tono` van de 0.5 a 2 (1 = normal). Sin `voz`, o con un id que no existe, se usa `vozPorDefecto`.

Va a una cola FIFO: mandá oración por oración a medida que llegan; mientras suena una ya se prepara la
siguiente. Hasta 100 frases en cola (si no, `error` `cola_llena`).

### `GravityVoz.callar()`

Corta lo que suena y vacía la cola: un `fin` con `cortado:true` por cada frase que no había terminado
(la que sonaba primero, después las de la cola, en orden). Sin nada en cola no manda nada.

### `GravityVoz.altavoz(activo)`

No hace nada por ahora (`disponible().altavoz` es `false`). La voz sale por el canal de multimedia:
parlante, o auriculares si hay.

## Códigos de error

`origen:"stt"`: `permiso` (negaste el micrófono), `sin_reconocedor` (el celular no tiene reconocedor),
`segundo_plano` (la app se fue al fondo: se cortó el micrófono; también si llamás a `escuchar()` con la app
en segundo plano), `sin_conexion`, `audio`, `servidor`, `cliente`, `no_hablaste` (no dijiste nada a tiempo),
`no_entendi`, `ocupado` (micrófono o reconocedor en uso), `demasiados`, `idioma`, `desconocido`.

`origen:"tts"` (con `id` cuando es de una frase): `invalido` (id o texto fuera de límites), `cola_llena`,
`sin_voz` (no hay motor de texto a voz), `sin_conexion` (voz por internet sin conexión), `sintesis`,
`reproduccion`.

`mensaje` ya está en castellano rioplatense para mostrarlo tal cual. `nativo` es el código de Android
(útil para depurar).

## Ciclo de vida

- Si la página se recarga o navega, se corta todo sin eventos.
- Si la app pasa a segundo plano (onStop), se corta la escucha (`error` `segundo_plano`); la voz que
  estaba sonando sigue y la cola termina.

## Ejemplo: turnos de una llamada

```js
const voz = window.GravityVoz;
let t0 = 0, env = [], paso = 20;
window.gravityVoz = {
  evento(e) {
    switch (e.tipo) {
      case 'parcial': mostrarSubtitulo(e.texto); break;
      case 'final': mandarAlAgente(e.texto); break;   // la escucha ya se cerró; el agente contesta por oraciones
      case 'error': if (e.origen === 'stt' && (e.codigo === 'no_hablaste' || e.codigo === 'no_entendi')) voz.escuchar('es-AR');
                    else avisar(e.mensaje); break;
      case 'hablando': t0 = performance.now(); env = e.envolvente; paso = e.pasoMs; break;
      case 'fin': if (!e.cortado && colaVacia(e.id)) voz.escuchar('es-AR'); break;  // terminó de hablar: tu turno
    }
  },
};
// Animación al ritmo de la voz:
function cuadro() { const i = Math.floor((performance.now() - t0) / paso); escalarOrbe(env[i] ?? 0); requestAnimationFrame(cuadro); }
const info = JSON.parse(voz.disponible());
if (info.stt) voz.escuchar(info.idioma);
// Cada oración del agente: voz.hablar('r12-' + n, oracion, JSON.stringify({ velocidad: 1.05 }));
```

Conviene no escuchar mientras habla el agente: por el parlante, el reconocedor puede tomar su voz como tuya.
