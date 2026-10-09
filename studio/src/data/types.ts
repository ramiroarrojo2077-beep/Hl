export type ProjectType = 'game' | 'prototype' | 'app' | 'ai' | 'experiment'
export type ProjectStatus = 'concept' | 'prototype' | 'in-development' | 'paused' | 'finished'
export type Mood = 'horror' | 'futurist' | 'calm' | 'neutral'
export type Scene = 'horror' | 'city' | 'island' | 'orbit' | 'interface' | 'neural' | 'waves' | 'terrain'

/** Arte generativo de reemplazo. Si un proyecto tiene `cover`, se usa la imagen real. */
export interface ArtSpec {
  scene: Scene
  /** [fondo, medio, luz] */
  palette: [string, string, string]
}

export interface MediaImage {
  src: string
  alt: string
  /** srcset opcional para imágenes responsivas */
  srcSet?: string
}

export interface ProjectLink {
  label: string
  href: string
}

export interface DevlogEntry {
  date: string
  title: string
  text: string
}

export interface Project {
  id: string
  slug: string
  name: string
  tagline: string
  description: string
  type: ProjectType
  status: ProjectStatus
  /** Año de inicio. */
  year: number
  /** Fecha ISO usada para ordenar. */
  date: string
  genre?: string
  engine?: string
  platforms?: string[]
  tech: string[]
  accent: string
  mood: Mood
  art: ArtSpec
  cover?: MediaImage
  gallery?: MediaImage[]
  /** ID de YouTube o URL a un .mp4 */
  trailer?: string
  links: ProjectLink[]
  featured?: boolean
  lab?: boolean
  /** Marca de contenido de demostración: reemplázalo por tus proyectos reales. */
  demo?: boolean
  detail: {
    story?: string
    mechanics?: { title: string; text: string }[]
    world?: { title: string; text: string }[]
    devlog?: DevlogEntry[]
    credits?: string[]
    goals?: string[]
  }
}
