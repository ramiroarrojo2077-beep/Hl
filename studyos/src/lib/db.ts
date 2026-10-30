import Dexie, { type EntityTable } from 'dexie';
import type { Item } from './items';

// Todos los datos viven en IndexedDB del dispositivo. Cada tabla guarda
// registros con `id` string generado por newId(). Las fechas se guardan como
// timestamps (ms) para poder indexarlas y ordenarlas.

export interface Subject {
  id: string;
  name: string;
  color: string;
  icon: string;
  category: string;
  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  subjectId: string;
  name: string;
  createdAt: number;
}

export interface Note {
  id: string;
  subjectId?: string;
  folderId?: string;
  title: string;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export type DocKind = 'pdf' | 'docx' | 'pptx' | 'txt' | 'image' | 'paste';
export type DocStatus = 'processing' | 'ready' | 'partial' | 'error';

export interface DocStructure {
  headings: { text: string; level: number; page: number }[];
  formulas: { text: string; page: number }[];
  tables: { page: number; rows: number }[];
  images: { page: number; count: number }[];
  keywords: string[];
  /** Conceptos identificados por el Document Agent (si se pidió el análisis con IA) */
  aiConcepts?: { name: string; page?: number; definition?: string }[];
}

export interface DocumentRec {
  id: string;
  subjectId?: string;
  folderId?: string;
  title: string;
  fileName: string;
  mime: string;
  size: number;
  kind: DocKind;
  status: DocStatus;
  error?: string;
  warnings: string[];
  pageCount: number;
  /** Etiqueta de las unidades: Página, Diapositiva, Sección */
  unitLabel: string;
  ocrUsed: boolean;
  charCount: number;
  structure: DocStructure;
  createdAt: number;
  updatedAt: number;
}

export interface DocFile {
  id: string; // = documentId
  blob: Blob;
}

export interface DocPage {
  id: string;
  docId: string;
  index: number; // 1-based
  text: string;
  /** Texto obtenido por OCR en lugar de la capa de texto */
  ocr?: boolean;
  ocrConfidence?: number;
}

export interface Chunk {
  id: string;
  docId: string;
  page: number;
  order: number;
  heading?: string;
  text: string;
  embedding?: number[];
  embeddingModel?: string;
}

export type SummaryMode = 'quick' | 'full' | 'exam' | 'visual' | 'simple';

export interface Summary {
  id: string;
  docId?: string;
  subjectId?: string;
  title: string;
  mode: SummaryMode;
  depth: number; // 1-5
  length: 'short' | 'medium' | 'long';
  content: string;
  invalidCitations: number[];
  review?: { ok: boolean; issues: string[]; at: number };
  provider: string;
  model: string;
  createdAt: number;
}

export interface Deck {
  id: string;
  subjectId?: string;
  docId?: string;
  name: string;
  createdAt: number;
}

export interface Card {
  id: string;
  deckId: string;
  front: string;
  back: string;
  image?: string; // data URL
  concept?: string;
  sourcePage?: number;
  // Estado SM-2
  ease: number;
  interval: number; // días
  reps: number;
  lapses: number;
  due: number; // timestamp
  lastReview?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CardReview {
  id: string;
  cardId: string;
  deckId: string;
  grade: number; // calidad SM-2 0..5
  reviewedAt: number;
  intervalBefore: number;
  intervalAfter: number;
  elapsedDays: number;
  /** tiempo real que tardó en responder la tarjeta (ms, máx. 2 min) */
  durationMs?: number;
}

export interface ItemResult {
  score: number;
  max: number;
  correct: boolean | null; // null = abierta, evaluada por criterios
  feedback: string;
  gradedBy: 'auto' | 'ai' | 'manual' | 'pending';
  criteria?: { id: string; description: string; points: number; awarded: number; comment: string }[];
  confidence?: 'alta' | 'media' | 'baja';
  disputed?: boolean;
}

export interface Exam {
  id: string;
  subjectId?: string;
  docId?: string;
  title: string;
  topic: string;
  difficulty: number;
  mode: 'practice' | 'mock';
  timeLimitMin?: number;
  items: Item[];
  provider: string;
  model: string;
  createdAt: number;
}

export interface ExamAttempt {
  id: string;
  examId: string;
  startedAt: number;
  finishedAt?: number;
  answers: Record<string, unknown>;
  results: Record<string, ItemResult>;
  score: number;
  maxScore: number;
  status: 'in_progress' | 'submitted' | 'graded';
}

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'graded' | 'needs_review';

export interface Task {
  id: string;
  subjectId?: string;
  title: string;
  description: string;
  objectives: string[];
  topic: string;
  level: string;
  difficulty: number; // 1..6 (6 = adaptativo, ya resuelto a 1..5 en cada ítem)
  modality: 'individual' | 'grupal';
  estimatedMinutes: number;
  dueDate?: number;
  status: TaskStatus;
  origin: 'prompt' | 'document' | 'errors' | 'summary' | 'tutor' | 'reinforcement';
  instruction: string;
  sourceDocId?: string;
  parentTaskId?: string;
  focusConcepts: string[];
  items: Item[];
  lastScore?: number; // 0..1
  aiComment?: string;
  provider: string;
  model: string;
  createdAt: number;
  updatedAt: number;
}

export interface TaskAttempt {
  id: string;
  taskId: string;
  startedAt: number;
  updatedAt: number;
  submittedAt?: number;
  answers: Record<string, unknown>;
  hintsUsed: Record<string, number>;
  revealed: Record<string, boolean>;
  results?: Record<string, ItemResult>;
  score?: number;
  maxScore?: number;
  feedback?: string;
  status: 'draft' | 'submitted' | 'graded';
}

export interface MasteryEvent {
  at: number;
  correct: number; // 0..1
  source: 'exam' | 'task' | 'flashcard' | 'tutor';
  refId: string;
}

export interface ConceptMastery {
  id: string; // `${subjectId ?? '_'}::${conceptKey}`
  subjectId?: string;
  concept: string;
  attempts: number;
  correctSum: number;
  score: number; // EMA 0..1
  lastSeen: number;
  history: MasteryEvent[];
}

export interface ConceptMap {
  id: string;
  subjectId?: string;
  docId?: string;
  title: string;
  nodes: { id: string; label: string; description?: string; color?: string; x: number; y: number; level: number; page?: number }[];
  edges: { id: string; source: string; target: string; label?: string }[];
  createdAt: number;
  updatedAt: number;
}

export type EventType = 'exam' | 'study' | 'review' | 'task' | 'focus' | 'other';

export interface CalendarEvent {
  id: string;
  subjectId?: string;
  title: string;
  type: EventType;
  start: number;
  end?: number;
  allDay: boolean;
  notes?: string;
  done: boolean;
  planId?: string;
  taskId?: string;
  reminderMinutes?: number;
  notificationId?: number;
}

export interface StudyPlan {
  id: string;
  subjectId?: string;
  title: string;
  examDate: number;
  topics: string[];
  minutesPerDay: number;
  createdAt: number;
}

export interface FocusSession {
  id: string;
  subjectId?: string;
  goal: string;
  startedAt: number;
  endedAt: number;
  plannedMinutes: number;
  focusedMinutes: number;
  pomodoros: number;
  interruptions: number;
  completed: boolean;
}

export type TutorMode = 'patient' | 'direct' | 'socratic' | 'exam' | 'visual' | 'language';

export interface TutorSession {
  id: string;
  subjectId?: string;
  docId?: string;
  title: string;
  mode: TutorMode;
  level: number; // 1..5
  targetLanguage?: string;
  createdAt: number;
  updatedAt: number;
}

export interface TutorMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  interrupted?: boolean;
  error?: string;
}

export interface Whiteboard {
  id: string;
  subjectId?: string;
  title: string;
  objects: unknown[];
  createdAt: number;
  updatedAt: number;
}

export interface VideoProject {
  id: string;
  subjectId?: string;
  docId?: string;
  prompt: string;
  title: string;
  script: unknown;
  createdAt: number;
  updatedAt: number;
}

export interface Activity {
  id: string;
  type: string;
  title: string;
  refId?: string;
  route?: string;
  subjectId?: string;
  at: number;
}

export interface SettingRow {
  key: string;
  value: unknown;
}

export class StudyDB extends Dexie {
  subjects!: EntityTable<Subject, 'id'>;
  folders!: EntityTable<Folder, 'id'>;
  notes!: EntityTable<Note, 'id'>;
  documents!: EntityTable<DocumentRec, 'id'>;
  docFiles!: EntityTable<DocFile, 'id'>;
  pages!: EntityTable<DocPage, 'id'>;
  chunks!: EntityTable<Chunk, 'id'>;
  summaries!: EntityTable<Summary, 'id'>;
  decks!: EntityTable<Deck, 'id'>;
  cards!: EntityTable<Card, 'id'>;
  reviews!: EntityTable<CardReview, 'id'>;
  exams!: EntityTable<Exam, 'id'>;
  examAttempts!: EntityTable<ExamAttempt, 'id'>;
  tasks!: EntityTable<Task, 'id'>;
  taskAttempts!: EntityTable<TaskAttempt, 'id'>;
  mastery!: EntityTable<ConceptMastery, 'id'>;
  maps!: EntityTable<ConceptMap, 'id'>;
  events!: EntityTable<CalendarEvent, 'id'>;
  plans!: EntityTable<StudyPlan, 'id'>;
  focus!: EntityTable<FocusSession, 'id'>;
  tutorSessions!: EntityTable<TutorSession, 'id'>;
  tutorMessages!: EntityTable<TutorMessage, 'id'>;
  boards!: EntityTable<Whiteboard, 'id'>;
  videos!: EntityTable<VideoProject, 'id'>;
  activity!: EntityTable<Activity, 'id'>;
  settings!: EntityTable<SettingRow, 'key'>;

  constructor(name = 'studyos') {
    super(name);
    this.version(1).stores({
      subjects: 'id, name, updatedAt',
      folders: 'id, subjectId',
      notes: 'id, subjectId, folderId, updatedAt',
      documents: 'id, subjectId, folderId, status, createdAt',
      docFiles: 'id',
      pages: 'id, docId, [docId+index]',
      chunks: 'id, docId, [docId+order]',
      summaries: 'id, docId, subjectId, createdAt',
      decks: 'id, subjectId, docId',
      cards: 'id, deckId, due',
      reviews: 'id, cardId, deckId, reviewedAt',
      exams: 'id, subjectId, docId, createdAt',
      examAttempts: 'id, examId, startedAt, status',
      tasks: 'id, subjectId, status, dueDate, createdAt, parentTaskId',
      taskAttempts: 'id, taskId, updatedAt, status',
      mastery: 'id, subjectId, score, lastSeen',
      maps: 'id, subjectId, docId, updatedAt',
      events: 'id, subjectId, start, type, planId, taskId',
      plans: 'id, subjectId, examDate',
      focus: 'id, subjectId, startedAt',
      tutorSessions: 'id, subjectId, updatedAt',
      tutorMessages: 'id, sessionId, createdAt',
      boards: 'id, subjectId, updatedAt',
      videos: 'id, subjectId, updatedAt',
      activity: 'id, at, type',
      settings: 'key',
    });
  }
}

export const db = new StudyDB();

/** Pide al navegador que no borre IndexedDB por falta de espacio. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch {
    /* sin soporte */
  }
  return false;
}

export async function logActivity(a: Omit<Activity, 'id' | 'at'>) {
  const { newId } = await import('./ids');
  await db.activity.add({ ...a, id: newId(), at: Date.now() });
}

/** Tablas que se exportan/importan en la copia de seguridad. */
export const BACKUP_TABLES = [
  'subjects', 'folders', 'notes', 'documents', 'pages', 'chunks', 'summaries', 'decks', 'cards', 'reviews',
  'exams', 'examAttempts', 'tasks', 'taskAttempts', 'mastery', 'maps', 'events', 'plans', 'focus',
  'tutorSessions', 'tutorMessages', 'boards', 'videos', 'activity',
] as const;
