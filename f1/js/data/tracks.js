// Metadatos de cada circuito. Los trazados salen de circuitGeo.js (datos reales);
// longitud, vueltas, altitud y sentido son datos públicos del calendario de F1.
// Los perfiles de elevación son aproximados (metros respecto de la línea de meta,
// indexados por fracción de vuelta) a partir de los desniveles conocidos de cada trazado.

export const TRACKS = [
  {
    id: 'monza', name: 'Monza', fullName: 'Autodromo Nazionale Monza', gp: 'Gran Premio de Italia',
    country: 'Italia', flag: '🇮🇹', city: 'Monza', length: 5793, laps: 53, altitude: 162, width: 13,
    elevation: [[0, 0], [0.2, 2], [0.45, 5], [0.6, 3], [0.8, 1], [1, 0]],
    env: {
      theme: 'park', sky: 'day', sunElev: 38, sunAz: 210, ground: 0x4f7a32, trees: 'deciduous', treeDensity: 1.0,
      buildings: 'suburb', mountains: 0.15, haze: 0.00045, temp: 27, rainChance: 0.12,
      landmarks: ['banking', 'podium-over-track'],
    },
    street: false, runoff: 'gravel', sponsors: ['ROSSO', 'TEMPO', 'MILANO', 'VELOCE'],
    blurb: 'El Templo de la Velocidad: rectas eternas, chicanas y poca carga aerodinámica.',
  },
  {
    id: 'monaco', name: 'Mónaco', fullName: 'Circuit de Monaco', gp: 'Gran Premio de Mónaco',
    country: 'Mónaco', flag: '🇲🇨', city: 'Montecarlo', length: 3337, laps: 78, altitude: 7, width: 9.5,
    elevation: [[0, 0], [0.08, 3], [0.17, 25], [0.25, 42], [0.33, 35], [0.4, 22], [0.47, 6], [0.55, 4],
      [0.62, 1], [0.7, 1], [0.8, 0.5], [0.92, 1], [1, 0]],
    env: {
      theme: 'harbor', sky: 'day', sunElev: 45, sunAz: 190, ground: 0x6e7a55, trees: 'palm', treeDensity: 0.5,
      buildings: 'dense', buildingHeight: 28, mountains: 0.9, water: 'sea', haze: 0.0004, temp: 24, rainChance: 0.1,
      landmarks: ['yachts', 'casino', 'cliffs'],
    },
    street: true, wallGap: 1.6, runoff: 'wall', sponsors: ['RIVIERA', 'CASINO', 'YACHT', 'ROLEX'],
    blurb: 'Muros a centímetros, el túnel y la Rascasse. Clasificar es media carrera.',
  },
  {
    id: 'silverstone', name: 'Silverstone', fullName: 'Silverstone Circuit', gp: 'Gran Premio de Gran Bretaña',
    country: 'Reino Unido', flag: '🇬🇧', city: 'Silverstone', length: 5891, laps: 52, altitude: 153, width: 15,
    elevation: [[0, 0], [0.15, -3], [0.3, 2], [0.5, 6], [0.7, 3], [0.85, -2], [1, 0]],
    env: {
      theme: 'countryside', sky: 'overcast', sunElev: 32, sunAz: 160, ground: 0x4c7d34, trees: 'deciduous', treeDensity: 0.45,
      buildings: 'sparse', mountains: 0.05, haze: 0.0006, temp: 19, rainChance: 0.35,
      landmarks: ['wing-building'],
    },
    street: false, runoff: 'asphalt', sponsors: ['BRITANNIA', 'TEA', 'ROYAL', 'WING'],
    blurb: 'Maggotts, Becketts y Chapel: curvas rápidas para autos con mucha carga.',
  },
  {
    id: 'spa', name: 'Spa-Francorchamps', fullName: 'Circuit de Spa-Francorchamps', gp: 'Gran Premio de Bélgica',
    country: 'Bélgica', flag: '🇧🇪', city: 'Stavelot', length: 7004, laps: 44, altitude: 410, width: 14,
    elevation: [[0, 0], [0.03, 2], [0.07, -16], [0.1, 12], [0.16, 28], [0.26, 40], [0.36, 22], [0.46, 2],
      [0.56, -30], [0.64, -58], [0.72, -45], [0.82, -25], [0.93, -6], [1, 0]],
    env: {
      theme: 'ardennes', sky: 'overcast', sunElev: 30, sunAz: 200, ground: 0x3f6e2e, trees: 'pine', treeDensity: 1.25,
      buildings: 'sparse', mountains: 0.6, haze: 0.0009, temp: 17, rainChance: 0.45,
      landmarks: ['forest-hills'],
    },
    street: false, runoff: 'asphalt', sponsors: ['ARDENNES', 'BIÈRE', 'EAU ROUGE', 'PROXI'],
    blurb: 'Eau Rouge, Raidillon y Pouhon en el bosque de las Ardenas. Clima cambiante.',
  },
  {
    id: 'suzuka', name: 'Suzuka', fullName: 'Suzuka International Racing Course', gp: 'Gran Premio de Japón',
    country: 'Japón', flag: '🇯🇵', city: 'Suzuka', length: 5807, laps: 53, altitude: 45, width: 13,
    // el cruce en puente: la recta de 130R (0.81) pasa por encima del tramo de 0.40
    elevation: [[0, 0], [0.06, -6], [0.15, 0], [0.25, 8], [0.32, 12], [0.36, 6], [0.4, -2], [0.47, -4], [0.58, 0],
      [0.66, 6], [0.75, 9], [0.81, 7], [0.88, -2], [0.94, -4], [1, 0]],
    env: {
      theme: 'japan', sky: 'day', sunElev: 34, sunAz: 200, ground: 0x507d38, trees: 'pine', treeDensity: 0.8,
      buildings: 'suburb', mountains: 0.45, haze: 0.0005, temp: 22, rainChance: 0.3,
      landmarks: ['ferris-wheel'],
    },
    street: false, runoff: 'gravel', sponsors: ['KAZE', 'SAKURA', 'NIPPON', 'HONDA-JI'],
    blurb: 'El ocho más famoso del mundo: las Eses, Degner, Spoon y la 130R.',
  },
  {
    id: 'interlagos', name: 'Interlagos', fullName: 'Autódromo José Carlos Pace', gp: 'Gran Premio de São Paulo',
    country: 'Brasil', flag: '🇧🇷', city: 'São Paulo', length: 4309, laps: 71, altitude: 785, width: 13,
    elevation: [[0, 0], [0.06, -8], [0.12, -16], [0.22, -26], [0.3, -31], [0.38, -18], [0.48, -12], [0.58, -20],
      [0.66, -25], [0.73, -30], [0.8, -36], [0.88, -22], [0.95, -8], [1, 0]],
    env: {
      theme: 'city-hills', sky: 'day', sunElev: 50, sunAz: 30, ground: 0x4d7b30, trees: 'tropical', treeDensity: 0.5,
      buildings: 'dense', buildingHeight: 30, mountains: 0.2, water: 'lake', haze: 0.0007, temp: 25, rainChance: 0.4,
      landmarks: ['favela-hills'],
    },
    street: false, runoff: 'asphalt', sponsors: ['SAMBA', 'PAULISTA', 'BRASIL', 'CAFÉ'],
    blurb: 'Antihorario, con la Bajada del Lago y la subida de los boxes. Lluvia traicionera.',
  },
  {
    id: 'barcelona', name: 'Barcelona-Catalunya', fullName: 'Circuit de Barcelona-Catalunya', gp: 'Gran Premio de España',
    country: 'España', flag: '🇪🇸', city: 'Montmeló', length: 4657, laps: 66, altitude: 109, width: 13,
    elevation: [[0, 0], [0.1, -5], [0.2, 5], [0.3, 0], [0.4, -10], [0.5, 8], [0.6, 14], [0.7, 2],
      [0.77, -10], [0.85, -5], [1, 0]],
    env: {
      theme: 'mediterranean', sky: 'day', sunElev: 55, sunAz: 180, ground: 0x7c8a4a, trees: 'pine', treeDensity: 0.45,
      buildings: 'suburb', mountains: 0.4, haze: 0.0005, temp: 26, rainChance: 0.08,
      landmarks: [],
    },
    street: false, runoff: 'gravel', sponsors: ['CATALUNYA', 'TAPAS', 'IBÉRICA', 'SOL'],
    blurb: 'El banco de pruebas de la F1: si el auto anda acá, anda en todos lados.',
  },
  {
    id: 'redbullring', name: 'Red Bull Ring', fullName: 'Red Bull Ring', gp: 'Gran Premio de Austria',
    country: 'Austria', flag: '🇦🇹', city: 'Spielberg', length: 4318, laps: 71, altitude: 677, width: 14,
    elevation: [[0, 0], [0.1, 24], [0.2, 38], [0.27, 42], [0.42, 25], [0.55, 10], [0.62, 4], [0.75, -10],
      [0.88, -16], [1, 0]],
    env: {
      theme: 'alpine', sky: 'day', sunElev: 45, sunAz: 170, ground: 0x4f8536, trees: 'pine', treeDensity: 0.7,
      buildings: 'sparse', mountains: 1.0, haze: 0.00035, temp: 23, rainChance: 0.3,
      landmarks: ['bull'],
    },
    street: false, runoff: 'asphalt', sponsors: ['ALPEN', 'STEIRMARK', 'BULL', 'SCHNELL'],
    blurb: 'Vuelta corta, subidas fuertes y los Alpes de fondo. Pura frenada y tracción.',
  },
  {
    id: 'cota', name: 'Circuit of the Americas', fullName: 'Circuit of the Americas', gp: 'Gran Premio de Estados Unidos',
    country: 'Estados Unidos', flag: '🇺🇸', city: 'Austin', length: 5513, laps: 56, altitude: 160, width: 15,
    elevation: [[0, 0], [0.05, 30], [0.1, 22], [0.22, 12], [0.35, 4], [0.42, -8], [0.6, -6], [0.75, -4],
      [0.88, 0], [1, 0]],
    env: {
      theme: 'texas', sky: 'day', sunElev: 40, sunAz: 220, ground: 0x7d8d45, trees: 'oak', treeDensity: 0.35,
      buildings: 'sparse', mountains: 0.08, haze: 0.0005, temp: 28, rainChance: 0.1,
      landmarks: ['tower'],
    },
    street: false, runoff: 'asphalt', sponsors: ['TEXAS', 'LONE STAR', 'AUSTIN', 'RODEO'],
    blurb: 'La subida a la curva 1 y las eses inspiradas en Silverstone. Antihorario.',
  },
  {
    id: 'yasmarina', name: 'Yas Marina', fullName: 'Yas Marina Circuit', gp: 'Gran Premio de Abu Dabi',
    country: 'Emiratos Árabes Unidos', flag: '🇦🇪', city: 'Abu Dabi', length: 5281, laps: 58, altitude: 3, width: 14,
    elevation: [[0, 0], [0.3, 2], [0.6, 1], [1, 0]],
    env: {
      theme: 'desert-marina', sky: 'dusk', sunElev: 4, sunAz: 260, ground: 0xc9b07a, trees: 'palm', treeDensity: 0.3,
      buildings: 'sparse', mountains: 0, water: 'marina', haze: 0.0004, temp: 29, rainChance: 0.0,
      landmarks: ['hotel', 'yachts'], floodlights: true,
    },
    street: false, runoff: 'asphalt', sponsors: ['YAS', 'MARINA', 'FALCON', 'DESERT'],
    blurb: 'Carrera del atardecer a la noche, con el hotel que cambia de color sobre la pista.',
  },
  {
    id: 'marinabay', name: 'Marina Bay', fullName: 'Marina Bay Street Circuit', gp: 'Gran Premio de Singapur',
    country: 'Singapur', flag: '🇸🇬', city: 'Singapur', length: 4940, laps: 62, altitude: 18, width: 11,
    elevation: [[0, 0], [0.5, 1], [1, 0]],
    env: {
      theme: 'night-city', sky: 'night', sunElev: -20, sunAz: 270, ground: 0x2f4a2a, trees: 'tropical', treeDensity: 0.4,
      buildings: 'skyscrapers', buildingHeight: 120, mountains: 0, water: 'bay', haze: 0.0006, temp: 30, rainChance: 0.35,
      landmarks: ['ferris-wheel', 'skyline'], floodlights: true,
    },
    street: true, wallGap: 2.5, runoff: 'wall', sponsors: ['MERLION', 'LION CITY', 'ORCHID', 'MARINA'],
    blurb: 'Carrera nocturna entre rascacielos, calor y humedad extremos. Safety Car casi seguro.',
  },
  {
    id: 'hungaroring', name: 'Hungaroring', fullName: 'Hungaroring', gp: 'Gran Premio de Hungría',
    country: 'Hungría', flag: '🇭🇺', city: 'Mogyoród', length: 4381, laps: 70, altitude: 264, width: 13,
    elevation: [[0, 0], [0.08, -10], [0.16, -15], [0.24, -6], [0.32, 8], [0.42, 4], [0.5, 10], [0.6, 16],
      [0.7, 8], [0.8, -4], [0.9, -8], [1, 0]],
    env: {
      theme: 'hills', sky: 'day', sunElev: 55, sunAz: 190, ground: 0x6e8a3c, trees: 'deciduous', treeDensity: 0.5,
      buildings: 'sparse', mountains: 0.25, haze: 0.0005, temp: 31, rainChance: 0.15,
      landmarks: [],
    },
    street: false, runoff: 'gravel', sponsors: ['BUDAPEST', 'DANUBIO', 'PAPRIKA', 'MAGYAR'],
    blurb: 'Un Mónaco sin muros: lento, sinuoso y casi imposible para adelantar.',
  },
  {
    id: 'montreal', name: 'Gilles Villeneuve', fullName: 'Circuit Gilles-Villeneuve', gp: 'Gran Premio de Canadá',
    country: 'Canadá', flag: '🇨🇦', city: 'Montreal', length: 4361, laps: 70, altitude: 13, width: 12,
    elevation: [[0, 0], [0.5, 1], [1, 0]],
    env: {
      theme: 'island', sky: 'day', sunElev: 42, sunAz: 200, ground: 0x4f8034, trees: 'deciduous', treeDensity: 0.6,
      buildings: 'none', mountains: 0.05, water: 'river', haze: 0.0005, temp: 21, rainChance: 0.3,
      landmarks: ['skyline', 'biosphere'],
    },
    street: true, wallGap: 4, runoff: 'wall', sponsors: ['ÉRABLE', 'QUÉBEC', 'CHAMPIONS', 'NORD'],
    blurb: 'Isla Notre-Dame: frenadas brutales, pianos altos y el Muro de los Campeones.',
  },
  {
    id: 'albertpark', name: 'Albert Park', fullName: 'Albert Park Circuit', gp: 'Gran Premio de Australia',
    country: 'Australia', flag: '🇦🇺', city: 'Melbourne', length: 5278, laps: 58, altitude: 10, width: 13,
    elevation: [[0, 0], [0.5, 2], [1, 0]],
    env: {
      theme: 'lake-park', sky: 'day', sunElev: 35, sunAz: 330, ground: 0x5e8a3a, trees: 'eucalyptus', treeDensity: 0.6,
      buildings: 'none', mountains: 0.0, water: 'lake', haze: 0.0004, temp: 23, rainChance: 0.2,
      landmarks: ['skyline'],
    },
    street: true, wallGap: 6, runoff: 'gravel', sponsors: ['MELBOURNE', 'KOALA', 'AUSSIE', 'LAKESIDE'],
    blurb: 'Semiurbano alrededor del lago, rápido y fluido, con el skyline de Melbourne al fondo.',
  },
  {
    id: 'mexico', name: 'Hermanos Rodríguez', fullName: 'Autódromo Hermanos Rodríguez', gp: 'Gran Premio de la Ciudad de México',
    country: 'México', flag: '🇲🇽', city: 'Ciudad de México', length: 4304, laps: 71, altitude: 2240, width: 14,
    elevation: [[0, 0], [0.5, 2], [1, 0]],
    env: {
      theme: 'stadium-city', sky: 'day', sunElev: 48, sunAz: 200, ground: 0x6b8a3c, trees: 'deciduous', treeDensity: 0.35,
      buildings: 'dense', buildingHeight: 22, mountains: 0.55, haze: 0.0007, temp: 21, rainChance: 0.1,
      landmarks: ['stadium'],
    },
    street: false, runoff: 'asphalt', sponsors: ['AZTECA', 'MÉXICO', 'TACOS', 'MARIACHI'],
    blurb: 'A 2240 metros de altura: aire fino, poca carga y la recta más larga del año.',
  },
];

export const TRACK_BY_ID = Object.fromEntries(TRACKS.map(t => [t.id, t]));
