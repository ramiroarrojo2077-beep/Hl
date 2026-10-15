// Parrilla ficticia (sin licencias oficiales). Los nombres se pueden editar libremente:
// el relato, la radio y los resultados los toman de acá.
// Valores de rendimiento entre 0 y 1. "car" escala potencia y carga; "pit" es la calidad del equipo de boxes.

export const TEAMS = [
  {
    id: 'rosso', name: 'Rosso Veloce', short: 'RSV', base: 'Maranello, Italia',
    colors: { primary: 0xc8102e, secondary: 0xffd400, accent: 0x111111 },
    car: 0.95, power: 0.96, aero: 0.94, reliability: 0.93, pit: 0.92,
  },
  {
    id: 'argento', name: 'Argento Motorsport', short: 'ARG', base: 'Stuttgart, Alemania',
    colors: { primary: 0xb8bec4, secondary: 0x00a19b, accent: 0x111111 },
    car: 0.96, power: 0.97, aero: 0.95, reliability: 0.96, pit: 0.95,
  },
  {
    id: 'torobu', name: 'Toro Blu Racing', short: 'TBR', base: 'Salzburgo, Austria',
    colors: { primary: 0x1b2a5c, secondary: 0xe0182d, accent: 0xffc906 },
    car: 0.98, power: 0.95, aero: 0.99, reliability: 0.94, pit: 0.97,
  },
  {
    id: 'papaya', name: 'Papaya GP', short: 'PAP', base: 'Woking, Reino Unido',
    colors: { primary: 0xff8000, secondary: 0x47c7fc, accent: 0x111111 },
    car: 0.99, power: 0.97, aero: 1.0, reliability: 0.95, pit: 0.94,
  },
  {
    id: 'verde', name: 'Verde Britannia', short: 'VBR', base: 'Silverstone, Reino Unido',
    colors: { primary: 0x0b5a43, secondary: 0xc6ff00, accent: 0xffffff },
    car: 0.9, power: 0.92, aero: 0.89, reliability: 0.92, pit: 0.88,
  },
  {
    id: 'alpina', name: 'Alpina Bleu', short: 'ALB', base: 'Enstone, Francia',
    colors: { primary: 0x0a5ad8, secondary: 0xff7bc5, accent: 0xffffff },
    car: 0.86, power: 0.86, aero: 0.87, reliability: 0.88, pit: 0.86,
  },
  {
    id: 'pampa', name: 'Pampa Racing', short: 'PMP', base: 'Buenos Aires, Argentina',
    colors: { primary: 0x6cace4, secondary: 0xffffff, accent: 0xf6b40e },
    car: 0.88, power: 0.88, aero: 0.89, reliability: 0.9, pit: 0.9,
  },
  {
    id: 'kaze', name: 'Samurai Kaze', short: 'SKZ', base: 'Sakura, Japón',
    colors: { primary: 0xf4f4f4, secondary: 0xd7001c, accent: 0x1a1a1a },
    car: 0.87, power: 0.9, aero: 0.85, reliability: 0.9, pit: 0.89,
  },
  {
    id: 'liberty', name: 'Liberty Stars', short: 'LIB', base: 'Charlotte, Estados Unidos',
    colors: { primary: 0xf0f0f0, secondary: 0x0b1f4b, accent: 0xb3121b },
    car: 0.84, power: 0.87, aero: 0.83, reliability: 0.86, pit: 0.85,
  },
  {
    id: 'nordic', name: 'Nordic Storm', short: 'NRD', base: 'Hinwil, Suiza',
    colors: { primary: 0x151515, secondary: 0xd4af37, accent: 0x52e252 },
    car: 0.83, power: 0.85, aero: 0.84, reliability: 0.87, pit: 0.84,
  },
];

// Habilidades: braking (frenada), defense (defensa), attack (adelantamiento),
// tyres (gestión de neumáticos), consistency (consistencia), wet (lluvia), pace (ritmo puro), start (largada)
export const DRIVERS = [
  { id: 'lorenzi', first: 'Marco', last: 'Lorenzi', num: 16, nat: 'ITA', team: 'rosso', helmet: 0xffd400,
    skill: { pace: 0.95, braking: 0.93, defense: 0.88, attack: 0.92, tyres: 0.86, consistency: 0.88, wet: 0.88, start: 0.9 } },
  { id: 'duval', first: 'Antoine', last: 'Duval', num: 55, nat: 'FRA', team: 'rosso', helmet: 0xffffff,
    skill: { pace: 0.92, braking: 0.9, defense: 0.9, attack: 0.88, tyres: 0.93, consistency: 0.92, wet: 0.87, start: 0.91 } },
  { id: 'hartmann', first: 'Lukas', last: 'Hartmann', num: 44, nat: 'GER', team: 'argento', helmet: 0x9b59b6,
    skill: { pace: 0.96, braking: 0.95, defense: 0.92, attack: 0.94, tyres: 0.95, consistency: 0.95, wet: 0.97, start: 0.88 } },
  { id: 'kimura', first: 'Ren', last: 'Kimura', num: 12, nat: 'JPN', team: 'argento', helmet: 0x00a19b,
    skill: { pace: 0.9, braking: 0.89, defense: 0.85, attack: 0.9, tyres: 0.86, consistency: 0.86, wet: 0.84, start: 0.92 } },
  { id: 'vandijk', first: 'Daan', last: 'Van Dijk', num: 1, nat: 'NED', team: 'torobu', helmet: 0xff6a00,
    skill: { pace: 0.99, braking: 0.98, defense: 0.97, attack: 0.97, tyres: 0.93, consistency: 0.97, wet: 0.98, start: 0.93 } },
  { id: 'ortega', first: 'Sergio', last: 'Ortega', num: 11, nat: 'MEX', team: 'torobu', helmet: 0x1b5e20,
    skill: { pace: 0.88, braking: 0.9, defense: 0.93, attack: 0.86, tyres: 0.94, consistency: 0.84, wet: 0.82, start: 0.85 } },
  { id: 'blake', first: 'Oliver', last: 'Blake', num: 4, nat: 'GBR', team: 'papaya', helmet: 0x111111,
    skill: { pace: 0.97, braking: 0.94, defense: 0.9, attack: 0.95, tyres: 0.91, consistency: 0.92, wet: 0.92, start: 0.87 } },
  { id: 'mcrae', first: 'Jack', last: 'McRae', num: 81, nat: 'AUS', team: 'papaya', helmet: 0x0b1f4b,
    skill: { pace: 0.95, braking: 0.92, defense: 0.88, attack: 0.9, tyres: 0.95, consistency: 0.94, wet: 0.88, start: 0.89 } },
  { id: 'fernandez', first: 'Álvaro', last: 'Fernández', num: 14, nat: 'ESP', team: 'verde', helmet: 0x003399,
    skill: { pace: 0.9, braking: 0.95, defense: 0.98, attack: 0.93, tyres: 0.92, consistency: 0.93, wet: 0.93, start: 0.97 } },
  { id: 'strand', first: 'Erik', last: 'Strand', num: 18, nat: 'SWE', team: 'verde', helmet: 0xffffff,
    skill: { pace: 0.83, braking: 0.84, defense: 0.82, attack: 0.82, tyres: 0.85, consistency: 0.83, wet: 0.8, start: 0.84 } },
  { id: 'moreau', first: 'Pierre', last: 'Moreau', num: 10, nat: 'FRA', team: 'alpina', helmet: 0x0a2a6b,
    skill: { pace: 0.88, braking: 0.87, defense: 0.86, attack: 0.88, tyres: 0.86, consistency: 0.85, wet: 0.9, start: 0.86 } },
  { id: 'nowak', first: 'Jakub', last: 'Nowak', num: 31, nat: 'POL', team: 'alpina', helmet: 0xdc143c,
    skill: { pace: 0.85, braking: 0.86, defense: 0.84, attack: 0.85, tyres: 0.84, consistency: 0.83, wet: 0.84, start: 0.83 } },
  { id: 'ibarra', first: 'Facundo', last: 'Ibarra', num: 43, nat: 'ARG', team: 'pampa', helmet: 0x6cace4,
    skill: { pace: 0.92, braking: 0.91, defense: 0.87, attack: 0.94, tyres: 0.85, consistency: 0.84, wet: 0.88, start: 0.9 } },
  { id: 'silva', first: 'Gabriel', last: 'Silva', num: 5, nat: 'BRA', team: 'pampa', helmet: 0x009c3b,
    skill: { pace: 0.87, braking: 0.86, defense: 0.85, attack: 0.88, tyres: 0.87, consistency: 0.86, wet: 0.9, start: 0.87 } },
  { id: 'tanaka', first: 'Yuki', last: 'Tanaka', num: 22, nat: 'JPN', team: 'kaze', helmet: 0x1a1a1a,
    skill: { pace: 0.88, braking: 0.9, defense: 0.84, attack: 0.89, tyres: 0.82, consistency: 0.8, wet: 0.85, start: 0.88 } },
  { id: 'lindqvist', first: 'Nils', last: 'Lindqvist', num: 27, nat: 'DEN', team: 'kaze', helmet: 0xc8102e,
    skill: { pace: 0.85, braking: 0.87, defense: 0.9, attack: 0.84, tyres: 0.88, consistency: 0.88, wet: 0.86, start: 0.85 } },
  { id: 'carter', first: 'Logan', last: 'Carter', num: 2, nat: 'USA', team: 'liberty', helmet: 0xb3121b,
    skill: { pace: 0.84, braking: 0.85, defense: 0.83, attack: 0.86, tyres: 0.83, consistency: 0.82, wet: 0.8, start: 0.86 } },
  { id: 'rossi', first: 'Luca', last: 'Rossi', num: 7, nat: 'ITA', team: 'liberty', helmet: 0x00843d,
    skill: { pace: 0.85, braking: 0.84, defense: 0.85, attack: 0.84, tyres: 0.86, consistency: 0.85, wet: 0.83, start: 0.84 } },
  { id: 'zhou', first: 'Wei', last: 'Zhou', num: 24, nat: 'CHN', team: 'nordic', helmet: 0xde2910,
    skill: { pace: 0.84, braking: 0.83, defense: 0.84, attack: 0.82, tyres: 0.88, consistency: 0.87, wet: 0.82, start: 0.84 } },
  { id: 'berg', first: 'Henrik', last: 'Berg', num: 77, nat: 'FIN', team: 'nordic', helmet: 0x0f52ba,
    skill: { pace: 0.86, braking: 0.85, defense: 0.86, attack: 0.83, tyres: 0.9, consistency: 0.9, wet: 0.85, start: 0.86 } },
];

export const TEAM_BY_ID = Object.fromEntries(TEAMS.map(t => [t.id, t]));
export const DRIVER_BY_ID = Object.fromEntries(DRIVERS.map(d => [d.id, d]));

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

export const COMPOUNDS = {
  soft: { id: 'soft', name: 'Blando', letter: 'S', color: '#e8352c', grip: 1.035, wear: 1.7, optTemp: 90, warmRate: 1.25 },
  medium: { id: 'medium', name: 'Medio', letter: 'M', color: '#f5d10a', grip: 1.0, wear: 1.0, optTemp: 100, warmRate: 1.0 },
  hard: { id: 'hard', name: 'Duro', letter: 'H', color: '#f2f2f2', grip: 0.97, wear: 0.62, optTemp: 110, warmRate: 0.8 },
  inter: { id: 'inter', name: 'Intermedio', letter: 'I', color: '#33b249', grip: 1.0, wear: 1.1, optTemp: 75, warmRate: 1.1, wetTyre: true },
  wet: { id: 'wet', name: 'Lluvia extrema', letter: 'W', color: '#1f6fe0', grip: 1.0, wear: 1.0, optTemp: 65, warmRate: 1.0, wetTyre: true },
};
