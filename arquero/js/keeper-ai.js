// Reglas del arquero: hasta dónde llega y cuánto tarda.
//
// La velocidad del arquero se mide en "medio arco": en Normal tarda 0,45 s en
// llegar del centro al palo una vez que arrancó. Así el juego queda parejo con
// cualquier tamaño de arco. La reacción se cuenta desde que la app detecta el
// remate (unos 0,07 s después de la patada), pensada para patear a 4-8 m.

// lectura: con qué probabilidad "lee" el remate (va hacia donde va la pelota);
// si no, adivina un lado como un arquero de verdad y se puede tirar al revés.
// Sin esto el arquero sabría siempre dónde va el tiro y casi no habría goles.
export const DIFICULTADES = {
  facil: { label: "Fácil", reaccion: 0.22, medioArco: 0.6, lectura: 0.4 },
  normal: { label: "Normal", reaccion: 0.14, medioArco: 0.45, lectura: 0.6 },
  dificil: { label: "Difícil", reaccion: 0.09, medioArco: 0.35, lectura: 0.8 },
  imposible: { label: "Imposible", reaccion: 0.04, medioArco: 0.25, lectura: 0.95 },
};

export const ARCOS = {
  mini: { label: "Mini (2 × 1,3 m)", ancho: 2, alto: 1.3 },
  f5: { label: "Fútbol 5 (3 × 2 m)", ancho: 3, alto: 2 },
  f11: { label: "Cancha grande (7,32 × 2,44 m)", ancho: 7.32, alto: 2.44 },
};

// Radio en metros según el número de pelota.
export const PELOTAS = {
  5: { label: "N.º 5 (adulto)", radio: 0.11 },
  4: { label: "N.º 4", radio: 0.103 },
  3: { label: "N.º 3 (chica)", radio: 0.095 },
};

// Proporciones del cuerpo (en alturas del arquero).
export const CUERPO = {
  centro: 0.55, // altura del centro del cuerpo parado
  alcance: 0.62, // del centro a las manos con los brazos estirados
  bloqueo: 0.35, // lo que tapa con el cuerpo sin moverse
  vueloMaximo: 1.25, // cuánto puede desplazar el centro en una estirada
};

export const alturaArquero = (altoArco) => altoArco * 0.78;
export const radioPalo = (altoArco) => 0.06 * Math.min(1, altoArco / 2.44);

// Decide qué pasa con un remate que cruza la línea en (x, y).
// tiempo: segundos entre que se detectó el remate y que la pelota llega.
// suerte: número entre 0 y 1 que varía un poco la velocidad del arquero.
// lectura, adivina: números entre 0 y 1 (al azar, uno por remate) para saber si
//   el arquero lee el remate y, si no, para qué lado se tira. Sin ellos lo lee.
export function judgeShot({ x, y, tiempo, arco, radio, dificultad, suerte = 0.5, lectura = 0, adivina = 0.5 }) {
  const { ancho, alto } = arco;
  const hk = alturaArquero(alto);
  const palo = radioPalo(alto);
  const c0 = { x: 0, y: CUERPO.centro * hk };

  const dist = Math.hypot(x - c0.x, y - c0.y) || 1e-6;
  const u = { x: (x - c0.x) / dist, y: (y - c0.y) / dist };
  const tipo = Math.abs(x) < 0.3 * hk ? (y > 0.95 * hk ? "salto" : y < 0.35 * hk ? "abajo" : "cuerpo") : "estirada";

  const cfg = DIFICULTADES[dificultad] ?? DIFICULTADES.normal;
  const velocidad = (ancho / 2 / cfg.medioArco) * (0.85 + 0.3 * suerte);
  // Lo que tienen que recorrer las manos más allá de lo que tapa el cuerpo.
  const maximo = (CUERPO.alcance + CUERPO.vueloMaximo - CUERPO.bloqueo) * hk;
  const recorrido = Math.min(Math.max(0, tiempo - cfg.reaccion) * velocidad, maximo);
  const necesita = Math.max(0, dist - CUERPO.bloqueo * hk);

  // ¿Leyó el remate? Si no, se tira a donde adivinó: un lado (a media altura,
  // a dos tercios del palo) o se queda en el medio.
  const leyo = lectura < cfg.lectura;
  let destino = { x, y };
  let lado = 0;
  if (!leyo) {
    const ladoPelota = Math.sign(x) || (adivina < 0.5 ? -1 : 1);
    lado = adivina < 0.45 ? -ladoPelota : adivina < 0.6 ? 0 : ladoPelota;
    destino = { x: lado * (ancho / 3), y: lado ? 0.45 * hk : c0.y };
  }
  const distDestino = Math.hypot(destino.x - c0.x, destino.y - c0.y) || 1e-6;
  const v = leyo ? u : { x: (destino.x - c0.x) / distDestino, y: (destino.y - c0.y) / distDestino };

  // Hasta dónde llegan las manos en la dirección en que se tiró.
  const d = Math.min(recorrido + CUERPO.bloqueo * hk, leyo ? dist : distDestino);
  const alcanzable = { x: c0.x + v.x * d, y: Math.max(0.05 * hk, c0.y + v.y * d) };
  // Sin leerlo, ataja sólo si la pelota va justo adonde fue (o al cuerpo).
  const cerca = Math.hypot(alcanzable.x - x, alcanzable.y - y) < radio + 0.12 * hk || dist < CUERPO.bloqueo * hk * 0.8;
  const base = { tipo: leyo ? tipo : lado ? "estirada" : "cuerpo", objetivo: { x, y }, manos: alcanzable, margen: leyo ? recorrido - necesita : cerca ? 0 : -1, leyo };

  const cercaPalo = Math.abs(Math.abs(x) - ancho / 2) < radio + palo && y < alto + radio;
  const cercaTravesano = Math.abs(y - alto) < radio + palo && Math.abs(x) < ancho / 2;
  if (cercaPalo || cercaTravesano) {
    return { ...base, resultado: "palo", detalle: cercaTravesano ? "travesaño" : "palo" };
  }
  if (Math.abs(x) > ancho / 2 || y > alto) {
    return { ...base, resultado: "afuera", detalle: y > alto ? "arriba" : x > 0 ? "derecha" : "izquierda" };
  }
  if (leyo ? recorrido >= necesita : cerca) return { ...base, resultado: "atajada", manos: { x, y } };
  return { ...base, resultado: "gol" };
}
