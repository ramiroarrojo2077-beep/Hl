import type { Project, ProjectStatus, ProjectType } from './types'

/**
 * Catálogo de proyectos.
 * Para añadir un proyecto nuevo, agrega un objeto a este array: la home, el
 * catálogo, los filtros, la línea de tiempo y su página de detalle se generan solos.
 * Todos los proyectos con `demo: true` son contenido de ejemplo.
 */
export const projects: Project[] = [
  {
    id: 'p01',
    slug: 'umbral',
    name: 'Umbral',
    tagline: 'Hay puertas que nunca deberían abrirse dos veces.',
    description: 'Terror psicológico en primera persona dentro de una casa que cambia cada vez que la recorres.',
    type: 'game',
    status: 'in-development',
    year: 2026,
    date: '2026-03-01',
    genre: 'Terror psicológico',
    engine: 'Unreal Engine 5',
    platforms: ['PC'],
    tech: ['Unreal Engine 5', 'Blueprints', 'C++', 'MetaSounds'],
    accent: '#E5484D',
    mood: 'horror',
    art: { scene: 'horror', palette: ['#07070a', '#1a0d10', '#E5484D'] },
    links: [],
    featured: true,
    demo: true,
    detail: {
      story:
        'Vuelves a la casa de tu infancia para venderla. Cada noche, una habitación nueva aparece donde antes había una pared. Umbral explora la memoria, la culpa y el miedo a lo familiar.',
      mechanics: [
        { title: 'Arquitectura viva', text: 'La distribución de la casa se reorganiza entre noches según tus decisiones.' },
        { title: 'Luz limitada', text: 'Una linterna de batería frágil: iluminar revela, pero también llama la atención.' },
        { title: 'Sonido como mapa', text: 'El audio espacial guía y engaña. Escuchar es tan importante como mirar.' },
      ],
      world: [
        { title: 'La casa', text: 'Un personaje en sí misma: pasillos que respiran y puertas que recuerdan.' },
        { title: 'La presencia', text: 'Nunca se muestra del todo. Se intuye en reflejos, sombras y silencios.' },
      ],
      devlog: [
        { date: '2026-03', title: 'Prototipo de habitaciones dinámicas', text: 'Primer sistema que reordena módulos de la casa entre sesiones.' },
        { date: '2026-05', title: 'Iluminación y atmósfera', text: 'Pruebas con Lumen y niebla volumétrica para el primer piso.' },
      ],
      credits: ['Diseño, programación y arte: Ramiro', 'Gracias a quienes probaron las primeras versiones.'],
    },
  },
  {
    id: 'p02',
    slug: 'neon-austral',
    name: 'Neón Austral',
    tagline: 'Una ciudad al fin del mundo que nunca duerme.',
    description: 'Exploración narrativa en una metrópolis austral iluminada por neón, hackeo y decisiones con consecuencias.',
    type: 'game',
    status: 'prototype',
    year: 2025,
    date: '2025-09-15',
    genre: 'Aventura de exploración',
    engine: 'Godot 4',
    platforms: ['PC', 'Steam Deck'],
    tech: ['Godot 4', 'GDScript', 'Shaders', 'Blender'],
    accent: '#3DD6F5',
    mood: 'futurist',
    art: { scene: 'city', palette: ['#03060c', '#0b1830', '#3DD6F5'] },
    links: [],
    featured: true,
    demo: true,
    detail: {
      story:
        'En 2089, Ushuaia es el último puerto antes de la Antártida y la ciudad más conectada del hemisferio sur. Eres una mensajera que transporta datos que nadie debería leer.',
      mechanics: [
        { title: 'Rutas verticales', text: 'Recorre la ciudad por tejados, cables y túneles de servicio.' },
        { title: 'Hackeo contextual', text: 'Altera semáforos, luces y pantallas para abrir caminos o crear distracciones.' },
        { title: 'Reputación', text: 'Cada entrega cambia cómo te ven los distritos de la ciudad.' },
      ],
      world: [
        { title: 'Distrito Puerto', text: 'Contenedores, grúas y mercados nocturnos bajo la nieve.' },
        { title: 'La Torre Sur', text: 'El centro de datos que mantiene viva la ciudad.' },
      ],
      devlog: [
        { date: '2025-09', title: 'Movimiento vertical', text: 'Primer prototipo de parkour y cámara en tercera persona.' },
        { date: '2026-01', title: 'Shader de neón', text: 'Iluminación emisiva y reflejos en superficies mojadas.' },
      ],
      credits: ['Diseño, programación y arte: Ramiro'],
    },
  },
  {
    id: 'p03',
    slug: 'kaia',
    name: 'Kaia',
    tagline: 'Cuida una isla. Deja que la isla te cuide a ti.',
    description: 'Un juego relajante sobre restaurar una pequeña isla, cultivar y escuchar el ritmo de las mareas.',
    type: 'game',
    status: 'concept',
    year: 2026,
    date: '2026-06-10',
    genre: 'Cozy / Simulación',
    engine: 'Unity',
    platforms: ['PC', 'Móvil'],
    tech: ['Unity', 'C#', 'Shader Graph'],
    accent: '#7BD88F',
    mood: 'calm',
    art: { scene: 'island', palette: ['#0b1a1f', '#1f4a4f', '#F2C98B'] },
    links: [],
    demo: true,
    detail: {
      story:
        'Llegas a una isla olvidada después de una tormenta. Sin objetivos urgentes ni cronómetros: solo estaciones, plantas y criaturas que vuelven poco a poco.',
      mechanics: [
        { title: 'Ecosistema', text: 'Cada planta atrae fauna distinta y modifica la isla con el tiempo.' },
        { title: 'Mareas', text: 'El ciclo del agua abre y cierra zonas de la costa.' },
      ],
      world: [{ title: 'Criaturas', text: 'Pequeños habitantes que se mudan a la isla cuando encuentran su hogar.' }],
      credits: ['Concepto: Ramiro'],
    },
  },
  {
    id: 'p04',
    slug: 'orbita',
    name: 'Órbita',
    tagline: 'Puzles de gravedad en miniatura.',
    description: 'Prototipo de puzles donde lanzas satélites y usas la gravedad de planetas para llegar a la meta.',
    type: 'prototype',
    status: 'prototype',
    year: 2025,
    date: '2025-04-20',
    genre: 'Puzle de física',
    engine: 'Web (Canvas)',
    tech: ['TypeScript', 'Canvas 2D', 'Física propia'],
    accent: '#A78BFA',
    mood: 'futurist',
    art: { scene: 'orbit', palette: ['#06050d', '#1a1433', '#A78BFA'] },
    links: [],
    lab: true,
    demo: true,
    detail: {
      story: 'Un experimento para comprobar si una sola mecánica —la gravedad— puede sostener 30 niveles de puzle.',
      mechanics: [
        { title: 'Lanzamiento', text: 'Define dirección y fuerza; la física hace el resto.' },
        { title: 'Asistencia gravitatoria', text: 'Encadena órbitas para alcanzar zonas imposibles.' },
      ],
      goals: ['Validar la mecánica principal', 'Diseñar 10 niveles de prueba', 'Medir la curva de dificultad'],
    },
  },
  {
    id: 'p05',
    slug: 'atlas',
    name: 'Atlas',
    tagline: 'El cuaderno de desarrollo que siempre quise tener.',
    description: 'Aplicación para organizar ideas, tareas y diarios de desarrollo de videojuegos en un solo lugar.',
    type: 'app',
    status: 'in-development',
    year: 2026,
    date: '2026-02-01',
    tech: ['React', 'TypeScript', 'SQLite', 'Tauri'],
    accent: '#F5A524',
    mood: 'neutral',
    art: { scene: 'interface', palette: ['#0a0907', '#1f1a12', '#F5A524'] },
    links: [],
    demo: true,
    detail: {
      story: 'Atlas nace de tener ideas repartidas en diez aplicaciones distintas. Un espacio local, rápido y privado para pensar proyectos.',
      mechanics: [
        { title: 'Tableros de ideas', text: 'Conecta notas, referencias y tareas como un mapa.' },
        { title: 'Devlog automático', text: 'Genera entradas de diario a partir de las tareas completadas.' },
      ],
      goals: ['Versión de escritorio estable', 'Sincronización opcional', 'Exportación a Markdown'],
    },
  },
  {
    id: 'p06',
    slug: 'eco',
    name: 'Eco',
    tagline: 'Personajes que recuerdan lo que les dijiste.',
    description: 'Experimento de diálogo con IA para NPCs con memoria, personalidad y límites narrativos definidos.',
    type: 'ai',
    status: 'prototype',
    year: 2026,
    date: '2026-07-05',
    tech: ['TypeScript', 'LLM API', 'Node.js'],
    accent: '#34D399',
    mood: 'futurist',
    art: { scene: 'neural', palette: ['#030806', '#0c2018', '#34D399'] },
    links: [],
    lab: true,
    demo: true,
    detail: {
      story: '¿Puede un personaje generado por IA mantener coherencia durante horas de juego? Eco prueba memoria a largo plazo y guiones con límites.',
      mechanics: [
        { title: 'Memoria episódica', text: 'El NPC resume y recuerda conversaciones anteriores.' },
        { title: 'Guardarraíles narrativos', text: 'Reglas que impiden romper el tono o el canon del mundo.' },
      ],
      goals: ['Medir coherencia en sesiones largas', 'Reducir latencia de respuesta'],
    },
  },
  {
    id: 'p07',
    slug: 'pulso',
    name: 'Pulso',
    tagline: 'Música que se puede ver.',
    description: 'Visualizador audio-reactivo en tiempo real hecho con shaders para navegador.',
    type: 'experiment',
    status: 'finished',
    year: 2024,
    date: '2024-11-12',
    tech: ['WebGL', 'GLSL', 'Web Audio API'],
    accent: '#FF6BCB',
    mood: 'neutral',
    art: { scene: 'waves', palette: ['#0a0509', '#26102a', '#FF6BCB'] },
    links: [],
    lab: true,
    demo: true,
    detail: {
      story: 'Un experimento de fin de semana para aprender shaders: el audio del micrófono deforma ondas de luz en tiempo real.',
      mechanics: [{ title: 'Análisis FFT', text: 'Frecuencias graves, medias y agudas controlan forma, color y brillo.' }],
    },
  },
  {
    id: 'p08',
    slug: 'terrenal',
    name: 'Terrenal',
    tagline: 'Montañas infinitas a partir de una semilla.',
    description: 'Generador de terrenos procedurales con erosión simulada para usar en futuros juegos.',
    type: 'experiment',
    status: 'in-development',
    year: 2025,
    date: '2025-12-01',
    tech: ['Rust', 'WebGPU', 'Ruido Perlin'],
    accent: '#60A5FA',
    mood: 'calm',
    art: { scene: 'terrain', palette: ['#04070d', '#132036', '#60A5FA'] },
    links: [],
    lab: true,
    demo: true,
    detail: {
      story: 'Una herramienta interna: generar paisajes creíbles en segundos para prototipar mundos.',
      mechanics: [
        { title: 'Erosión hidráulica', text: 'Simula lluvia y ríos para esculpir valles naturales.' },
        { title: 'Exportación', text: 'Mapas de altura listos para Unreal, Unity y Godot.' },
      ],
      goals: ['Erosión en GPU', 'Biomas por altura y humedad'],
    },
  },
]

export const TYPE_LABEL: Record<ProjectType, string> = {
  game: 'Videojuego',
  prototype: 'Prototipo',
  app: 'Aplicación',
  ai: 'Inteligencia artificial',
  experiment: 'Experimento',
}

export const TYPE_PLURAL: Record<ProjectType, string> = {
  game: 'Videojuegos',
  prototype: 'Prototipos',
  app: 'Aplicaciones',
  ai: 'IA',
  experiment: 'Experimentos',
}

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  concept: 'Concepto',
  prototype: 'Prototipo jugable',
  'in-development': 'En desarrollo',
  paused: 'En pausa',
  finished: 'Finalizado',
}

export const getProject = (slug: string) => projects.find((p) => p.slug === slug)

export const relatedProjects = (p: Project, n = 3) =>
  projects
    .filter((o) => o.id !== p.id)
    .map((o) => ({ o, score: (o.type === p.type ? 2 : 0) + o.tech.filter((t) => p.tech.includes(t)).length }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((x) => x.o)
