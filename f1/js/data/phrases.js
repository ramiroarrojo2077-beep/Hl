// Frases de los relatores (español rioplatense) y del ingeniero de carrera.
// Marcadores: {a} piloto principal, {b} otro piloto, {pos} puesto en palabras, {n} número de puesto,
// {corner} curva, {gap} diferencia, {lap} vuelta, {laps} total, {left} vueltas restantes,
// {team} equipo, {comp} compuesto, {time} tiempo, {sector}, {reason}, {sec} segundos de sanción.

export const RELATOR = {
  lights: [
    '¡SE APAGAN LOS SEMÁFOROS Y ARRANCA EL {gp}!',
    '¡Luces afuera! ¡Largó el {gp}!',
    '¡Y se apagan las luces! ¡Arrancamos!',
    '¡LARGARON! ¡Ya está en marcha el {gp}!',
  ],
  start_good: [
    '¡Qué largada de {a}! ¡Se metió en la pelea!',
    '¡Tremenda partida de {a}, ganó un montón de lugares!',
    '¡{a} picó como un rayo desde la grilla!',
  ],
  start_bad: [
    '¡Uy, mala largada de {a}! Patinó y se lo comieron todos.',
    '¡{a} se quedó en la largada! ¡Perdió varias posiciones!',
  ],
  formation: [
    'Comienza la vuelta de formación. Los pilotos calientan neumáticos y frenos.',
    'Vuelta de formación en {track}. Zigzag para darle temperatura a las gomas.',
  ],
  grid: [
    'Todos en la grilla. Atención que se encienden las luces…',
    'Los veinte autos en posición. ¡Se viene la largada!',
  ],
  overtake: [
    '¡ATENCIÓN, QUE SE VIENE POR ADENTRO! ¡{a} pasa a {b}!',
    '¡Tremenda maniobra de {a} sobre {b}! ¡Ahora es {pos}!',
    '¡Se le tiró adentro {a}! ¡Le ganó la posición a {b}!',
    '¡Y lo pasó! ¡{a} supera a {b} en {corner}!',
    '¡Qué sobrepaso, señores! {a} se queda con el {pos} puesto.',
    '¡{a} no perdona! ¡Pasó a {b} y va por más!',
    '¡Frenó tardísimo {a}! ¡Adentro de {b}!',
    '¡Por afuera! ¡Por afuera lo pasó {a}! ¡Qué valentía!',
  ],
  overtake_outside: [
    '¡POR AFUERA! ¡{a} le pasa por afuera a {b} en {corner}! ¡Espectacular!',
    '¡Increíble, por el exterior! {a} supera a {b}.',
  ],
  overtake_first: [
    '¡{a} ES EL NUEVO LÍDER DEL {gp}!',
    '¡Cambio de líder! ¡{a} pasa a {b} y toma la punta!',
    '¡Lo pasó! ¡{a} se pone primero! ¡Qué carrera!',
  ],
  overtake_turn1: [
    '¡TREMENDA MANIOBRA EN LA PRIMERA CURVA! ¡{a} se mete adelante de {b}!',
    '¡Primera curva caliente! ¡{a} le gana la posición a {b}!',
  ],
  player_overtake: [
    '¡Bien, {a}! ¡Pasó a {b} y ya es {pos}!',
    '¡Qué buena maniobra de {a}! ¡Adelante de {b}!',
    '¡{a} se lo come a {b}! ¡Sigue escalando posiciones!',
    '¡Vamos {a}! ¡Pasó a {b} en {corner}!',
  ],
  player_lost: [
    '¡Uh! ¡A {a} lo pasó {b}! Cae al {pos} puesto.',
    '{b} le ganó la posición a {a}. Hay que reaccionar.',
    '¡Se lo pasaron a {a}! {b} aprovechó la oportunidad.',
  ],
  lockup: [
    '¡BLOQUEÓ LOS NEUMÁTICOS Y SE PASÓ DE FRENADA {a}!',
    '¡Humo en las ruedas de {a}! ¡Se le bloquearon los frenos en {corner}!',
    '¡Uy, se pasó {a}! ¡Bloqueo en {corner}!',
    '¡Frenó tarde {a} y se le fue de largo!',
  ],
  off_track: [
    '¡Afuera {a}! ¡Se fue a la escapatoria en {corner}!',
    '¡Se le escapó el auto a {a}! ¡Excursión por {corner}!',
    '¡{a} se fue de pista! ¡Tierra y piedras por todos lados!',
  ],
  spin: [
    '¡TROMPO DE {a}! ¡Se dio vuelta en {corner}!',
    '¡Uy, uy, uy! ¡{a} hizo un trompo!',
    '¡Perdió el control {a}! ¡Gira y gira en {corner}!',
  ],
  crash: [
    '¡SE ESTRELLÓ {a}! ¡Fuerte golpe contra las barreras en {corner}!',
    '¡Accidente! ¡{a} se fue contra el muro!',
    '¡Nooo! ¡Golpe tremendo de {a} en {corner}! ¡Esperemos que esté bien!',
    '¡Se terminó la carrera para {a}! ¡Contra las protecciones!',
  ],
  contact: [
    '¡Toque entre {a} y {b}!',
    '¡Contacto! ¡{a} le pegó a {b}!',
    '¡Se tocaron {a} y {b}! ¡Volaron pedazos de fibra de carbono!',
  ],
  retire: [
    '¡Abandono de {a}! Problemas con {reason}.',
    'Se termina la carrera para {a}. Se rompió {reason}.',
    'Mala noticia para {team}: {a} abandona por {reason}.',
  ],
  mechanical: [
    '¡Atención! ¡Sale humo del auto de {a}! Algo pasa con {reason}.',
    '¡Problemas para {a}! ¡Falla en {reason}!',
  ],
  yellow: [
    'Bandera amarilla en el sector {sector}.',
    'Agitan las amarillas en el sector {sector}. Cuidado ahí.',
    'Doble amarilla en el sector {sector}. Hay un auto detenido.',
  ],
  sc: [
    '¡SAFETY CAR! ¡Sale el auto de seguridad!',
    '¡Se despliega el Safety Car! ¡Todo se neutraliza!',
    '¡Auto de seguridad en pista! ¡Se agrupa todo el pelotón!',
  ],
  sc_in: [
    'El Safety Car apaga las luces. ¡Entra en esta vuelta!',
    '¡Atención que se va el Safety Car! ¡Se viene el relanzamiento!',
  ],
  restart: [
    '¡Bandera verde! ¡Se relanza la carrera!',
    '¡Arrancamos de nuevo! ¡Verde, verde, verde!',
    '¡Relanzamiento! ¡A fondo otra vez!',
  ],
  vsc: [
    'Safety Car virtual. Todos tienen que respetar el delta.',
    '¡Virtual Safety Car! Se neutraliza la carrera.',
  ],
  vsc_end: ['Termina el Safety Car virtual. ¡Carrera en marcha!', 'Fin del VSC. ¡Se larga de nuevo!'],
  red: [
    '¡BANDERA ROJA! ¡Se suspende la carrera!',
    '¡Roja! ¡Paran todo! Los autos vuelven a la calle de boxes.',
  ],
  red_restart: ['Se reanuda la carrera con largada detenida.', 'Vuelven a la grilla después de la bandera roja.'],
  pit_in: [
    '{a} entra a boxes.',
    '¡A los pits {a}! Vamos a ver qué hace el equipo.',
    'Entra {a} a la calle de boxes.',
  ],
  pit_stop_fast: [
    '¡Parada relámpago para {a}! {time} segundos.',
    '¡Impresionante el trabajo de los mecánicos de {team}! {time} segundos.',
  ],
  pit_stop_slow: [
    '¡Problemas en la parada de {a}! ¡La rueda {reason} no sale!',
    '¡Uy, qué parada lenta para {a}! Se trabó la {reason}.',
  ],
  fastest_lap: [
    '¡Vuelta rápida para {a}! {time}.',
    '¡{a} marca el récord de la carrera! {time}.',
    '¡Morado en todos lados! Vuelta más rápida de {a}.',
  ],
  lap: [
    'Vuelta {lap} de {laps}. {a} sigue al frente.',
    'Comienza la vuelta {lap}. Lidera {a}.',
  ],
  final_lap: [
    '¡ÚLTIMA VUELTA! ¡ESTO ESTÁ PARA CUALQUIERA!',
    '¡Campana! ¡Última vuelta del {gp}!',
    '¡Se viene la última vuelta! ¡{a} adelante, pero no hay nada definido!',
  ],
  checkered: [
    '¡BANDERA A CUADROS! ¡QUÉ CARRERA ACABAMOS DE VIVIR! ¡GANA {a}!',
    '¡{a} GANA EL {gp}! ¡Bandera a cuadros!',
    '¡Ganó {a}! ¡Victoria para {team}!',
  ],
  player_win: [
    '¡GANÓ {a}! ¡GANÓ {a}! ¡QUÉ CARRERÓN! ¡VICTORIA EN EL {gp}!',
    '¡Victoria de {a}! ¡Tocó el cielo con las manos!',
  ],
  player_podium: ['¡Podio para {a}! ¡Termina {pos}!', '¡{a} sube al podio! Enorme carrera.'],
  player_finish: ['{a} cruza la meta en el {pos} lugar.', 'Termina {a}, {pos}.'],
  rain_start: [
    '¡Atención que empieza a llover en {track}!',
    '¡Gotas en la visera! ¡Llega la lluvia!',
    '¡Se larga a llover! ¡Esto cambia todo!',
  ],
  rain_heavy: ['¡Diluvia! ¡No se ve nada con el spray!', '¡Lluvia torrencial! ¡Cuidado con el aquaplaning!'],
  rain_stop: ['Para de llover. La pista se va a ir secando.', 'Se van las nubes. Se empieza a formar una línea seca.'],
  battle: [
    '¡Qué lindo duelo entre {a} y {b}!',
    '¡Están pegados {a} y {b}! ¡Hay pelea!',
    '¡{a} lo tiene ahí nomás a {b}! ¡Se viene el ataque!',
  ],
  defend: [
    '¡{a} cierra la puerta! ¡Defiende por adentro!',
    '¡Se defiende {a}! No le da espacio a {b}.',
  ],
  penalty: [
    'Sanción para {a}: {sec} segundos por {reason}.',
    '¡Penalización! {sec} segundos para {a} por {reason}.',
  ],
  quali_lap: ['¡Vuelta impresionante de {a}! {time}.', '{a} marca {time}. Se pone {pos}.'],
  quali_pole: ['¡POLE POSITION PROVISORIA PARA {a}!', '¡{a} al tope de la tabla! ¡Qué vuelta!'],
  session_end: ['Bandera a cuadros, termina la sesión.', 'Se terminó el tiempo. Última vuelta para los que están en pista.'],
  puncture: ['¡Pinchazo para {a}! ¡Va con la goma destrozada!', '¡{a} pinchó! ¡Tiene que volver a boxes despacito!'],
};

export const COMENTARISTA = {
  after_overtake: [
    'Tenía mucho más ritmo, se notaba que lo iba a pasar.',
    'Usó perfectamente el rebufo en la recta.',
    'Con neumáticos más frescos, la diferencia era enorme.',
    'Lo preparó desde dos curvas antes. Muy inteligente.',
    'Ahí se ve la diferencia de tracción a la salida.',
  ],
  after_lockup: [
    'Ese plano en la goma lo va a sentir en las próximas vueltas.',
    'Ojo con la temperatura de los frenos, está exigiendo mucho.',
    'Perdió por lo menos medio segundo ahí.',
  ],
  after_crash: [
    'Por suerte las protecciones hicieron su trabajo.',
    'Esto puede traer Safety Car, hay muchos restos en la pista.',
    'Una lástima, venía haciendo una gran carrera.',
  ],
  after_pit: [
    'Interesante, la estrategia de {a} va a {comp}.',
    'Sale con {comp}. Veremos si le alcanza hasta el final.',
    'La estrategia de una sola parada puede darle la victoria.',
  ],
  after_sc: [
    'El Safety Car le arruina la diferencia al líder.',
    'Es un buen momento para parar, se pierde mucho menos tiempo.',
    'Ahora todos van a ir a boxes, prestá atención.',
  ],
  after_rain: [
    'Los que tengan intermedios ahora van a volar.',
    'Hay que ver quién se anima a quedarse afuera con lisos.',
    'La adherencia cambia muchísimo de una vuelta a la otra.',
  ],
  gap_leader: [
    '{a} le saca {gap} a {b}. Está controlando la carrera.',
    'La diferencia entre {a} y {b} es de {gap}.',
    '{b} está a {gap} del líder. Todavía puede pasar cualquier cosa.',
  ],
  drs: [
    'El piloto de atrás está entrando en zona de DRS.',
    '{a} ya está a menos de un segundo, tiene el DRS habilitado.',
    'Con el DRS, {a} va a intentar el sobrepaso en la recta.',
  ],
  tyres_old: [
    'Los neumáticos {comp} de {a} ya están mostrando desgaste.',
    'Fíjense las gomas de {a}, ya tienen {age} vueltas. Se le está cayendo el ritmo.',
    '{a} viene haciendo un gran manejo de neumáticos.',
  ],
  sector_slow: [
    '{a} está perdiendo muchísimo tiempo en el sector {sector}.',
    'En el sector {sector}, {a} no encuentra el ritmo.',
  ],
  sector_fast: [
    '{a} viene volando en el sector {sector}, todo en verde.',
    'Mejor parcial personal para {a} en el sector {sector}.',
  ],
  brakes_hot: ['Ojo con la temperatura de los frenos de {a}.', 'Los frenos de {a} están al rojo vivo.'],
  strategy: [
    'Con este desgaste, la estrategia de una sola parada es la ideal.',
    'Va a ser clave la ventana de paradas.',
    'El que pare primero puede sacar ventaja con el undercut.',
    'El aire sucio no deja acercarse en las curvas rápidas.',
  ],
  weather_coming: ['Se ven nubes negras en el horizonte. Atención con la lluvia.', 'El radar marca lluvia para los próximos minutos.'],
  track: [
    'Este circuito, {track}, premia mucho la tracción a la salida de las curvas lentas.',
    'En {track} los frenos sufren muchísimo.',
    'Es un trazado donde la clasificación pesa mucho.',
  ],
  last_laps: [
    'Quedan {left} vueltas. Todo se define ahora.',
    'Faltan {left} vueltas, ya no hay margen para errores.',
  ],
  podium: ['Gran trabajo de todo el equipo {team}.', 'Una victoria merecida, fue el más rápido todo el fin de semana.'],
  penalty: ['Una sanción que puede costarle caro en el resultado final.', 'Tiene que tener cuidado, los comisarios no perdonan.'],
};

export const INGENIERO = {
  box_now: ['Box, box. Entramos esta vuelta. Vamos a {comp}.', 'Box esta vuelta, box esta vuelta. Ponemos {comp}.', 'Confirmado: box, box. {comp} preparados.'],
  push: ['Push now, tenemos ritmo para alcanzarlo.', 'Vamos, empujá. El de adelante está a {gap}.', 'Modo ataque. Podés agarrarlo.'],
  defend: ['El de atrás está a {gap}. Defendé la posición.', 'Ojo, viene {b} con DRS. Cuidá la defensa.'],
  yellow: ['Cuidado, bandera amarilla en el sector {sector}.', 'Amarilla en el sector {sector}, levantá el pie.'],
  sc: ['Safety Car desplegado. Respetá el delta, no adelantes.', 'Safety Car. Mantené temperatura en las gomas.'],
  sc_box: ['Safety Car: es buen momento, box, box.', 'Aprovechamos el Safety Car. Box esta vuelta.'],
  vsc: ['VSC. Respetá el delta positivo.', 'Virtual Safety Car, mantené el delta.'],
  restart: ['Verde, verde. Vamos, a fondo.', 'Relanzamiento. Cuidado con la temperatura de los frenos.'],
  rain_soon: ['Tenemos lluvia prevista en {min} minutos.', 'El radar dice lluvia en unos {min} minutos. Atento.'],
  rain_now: ['Está lloviendo en el sector {sector}. ¿Cómo está el agarre?', 'Lluvia confirmada. Intermedios preparados si querés entrar.'],
  improving: ['Buen trabajo, estás mejorando tus tiempos.', 'Muy bien, vuelta personal más rápida.', 'Excelente ritmo, seguí así.'],
  fastest: ['¡Vuelta más rápida de la carrera! Buenísimo.', 'Morado. Vuelta más rápida.'],
  slow_sector: ['Estamos perdiendo en el sector {sector}. Revisá los puntos de frenada.', 'Sector {sector} lento comparado con tu mejor.'],
  tyres_cold: ['Neumáticos fríos, cuidado en las primeras curvas.', 'Las gomas todavía no están en temperatura.'],
  tyres_hot: ['Neumáticos sobrecalentados. Cuidá el patinamiento.', 'Temperatura de gomas muy alta, administrá.'],
  tyres_worn: ['Los neumáticos están muy gastados. Pensemos en entrar.', 'Desgaste crítico, el ritmo se va a caer.'],
  brakes_hot: ['Ojo con la temperatura de los frenos.', 'Frenos muy calientes, hacé lift and coast.'],
  damage: ['Tenemos daño en el alerón delantero. Box, box.', 'Vemos daño en el auto. ¿Podés seguir?'],
  fuel_low: ['Combustible justo. Pasá a mezcla pobre.', 'Tenemos que ahorrar combustible, lift and coast.'],
  drs: ['DRS habilitado.', 'Tenés DRS en la próxima recta.'],
  last_lap: ['Última vuelta. Dalo todo.', 'Última vuelta, terminemos el trabajo.'],
  gap_ahead: ['El auto de adelante está a {gap}.', 'Gap al de adelante: {gap}.'],
  gap_behind: ['El de atrás está a {gap}.', 'Tenés {gap} de ventaja sobre el de atrás.'],
  position: ['Estamos en P{n}.', 'Posición actual: P{n}.'],
  win: ['¡GANAMOS! ¡Increíble, increíble trabajo!', '¡P1! ¡Sos un fenómeno! ¡Victoria!'],
  podium: ['¡P{n}! ¡Podio! Gran carrera.', 'Terminamos P{n}, ¡al podio!'],
  points: ['Terminamos P{n}. Buenos puntos para el equipo.', 'P{n}. Sumamos puntos, bien hecho.'],
  noPoints: ['Terminamos P{n}. Vamos a analizar los datos.', 'P{n}. No fue nuestro día, seguimos trabajando.'],
  penalty: ['Recibimos {sec} segundos de sanción por {reason}.', 'Penalización de {sec} segundos: {reason}.'],
  track_limits: ['Cuidado con los límites de pista. Advertencia número {n}.', 'Otra advertencia por límites de pista. Ya van {n}.'],
  pit_limiter: ['Limitador de boxes, cuidado con la velocidad.', 'Bajá a 80 antes de la línea.'],
  pit_done: ['Buena parada, {time} segundos. Salimos con {comp}.', 'Listo, {comp} puestos. Vamos.'],
  lights: ['Modo largada. Concentración.', 'Esperá a que se apaguen las luces.'],
  formation: ['Vuelta de formación. Calentá gomas y frenos. No adelantes.', 'Formación: dale temperatura a los frenos.'],
  quali_out: ['Vuelta de salida. Calentá las gomas y después atacamos.', 'Salimos. Primero calentar neumáticos.'],
  quali_result: ['Clasificamos P{n}.', 'P{n} en la clasificación.'],
  invalid: ['Vuelta anulada por límites de pista.', 'Esa vuelta no cuenta, se excedieron los límites.'],
  blue: ['Bandera azul, dejá pasar al líder.', 'Te están por doblar, liberá la pista.'],
  puncture: ['¡Pinchazo! Volvé a boxes con cuidado.', 'Perdemos presión en un neumático. Box, box.'],
  mechanical: ['Tenemos un problema con {reason}. Seguí si podés.', 'Falla en {reason}. Cuidá el auto.'],
  retire: ['Tenemos que abandonar. Lo siento.', 'Retirá el auto. Se terminó.'],
};

export const ORDINAL = ['', 'primero', 'segundo', 'tercero', 'cuarto', 'quinto', 'sexto', 'séptimo', 'octavo', 'noveno', 'décimo',
  'undécimo', 'duodécimo', 'decimotercero', 'decimocuarto', 'decimoquinto', 'decimosexto', 'decimoséptimo', 'decimoctavo', 'decimonoveno', 'vigésimo', 'vigésimo primero', 'vigésimo segundo'];

export const COMPOUND_SPOKEN = { soft: 'blandos', medium: 'medios', hard: 'duros', inter: 'intermedios', wet: 'de lluvia extrema' };
