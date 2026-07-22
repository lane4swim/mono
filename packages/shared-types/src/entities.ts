// packages/shared-types/src/entities.ts
//
// Vertrag für das fachliche Datenmodell (Backend-Entwicklungsplan,
// Abschnitt 4 / Phase 2). Jede Schema-Definition spiegelt exakt die Form,
// in der apps/web die Daten bereits in IndexedDB hält (js/db.js, js/seed.js)
// — dadurch entsteht beim künftigen Sync (Phase 3) kein verlustbehaftetes
// Mapping zwischen Client und Server.
import { z } from 'zod';
import { SyncStoreSchema } from './syncEvent.js';

const isoDate = z.string().datetime();
const nullableIsoDate = z.string().datetime().nullable();

// Ein einzelner Kommentar — wird an drei Stellen eingebettet (siehe unten):
// am Trainingsplan selbst (PlanSchema.comments), an einer einzelnen
// Übung/einem Satz innerhalb eines Plans (PlainSetSchema.comments) sowie
// im Übungskatalog (ExerciseSchema.comments). `id` ist bewusst kein UUID
// (wie z. B. bei PlainSetSchema.id) — Kommentare sind Einträge in einer
// eingebetteten Liste, keine eigenständig referenzierten Entitäten.
// `authorName` wird vom Frontend beim Anlegen aus dem eingeloggten Konto
// übernommen (Anzeige-Zweck) — es gibt bewusst keine serverseitige
// Autor:innen-Verifikation, genau wie bei den übrigen freien Textfeldern
// dieses Datenmodells (z. B. Athlete.notes, TrainingSession.trainerNote).
export const CommentSchema = z.object({
  id: z.string().min(1),
  authorName: z.string().min(1),
  text: z.string().min(1),
  createdAt: isoDate,
}).strict();
export type Comment = z.infer<typeof CommentSchema>;

export const GroupSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().default(''),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Group = z.infer<typeof GroupSchema>;

export const AthleteGenderSchema = z.enum(['w', 'm', 'd']);

export const AthleteSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  birthdate: nullableIsoDate,
  gender: AthleteGenderSchema,
  groupId: z.string().uuid().nullable(),
  joinDate: nullableIsoDate,
  active: z.boolean(),
  notes: z.string().default(''),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Athlete = z.infer<typeof AthleteSchema>;

export const CourseSchema = z.enum(['LCM', 'SCM']);

export const CompetitionSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  name: z.string().min(1),
  date: isoDate,
  location: z.string().default(''),
  course: CourseSchema,
  notes: z.string().default(''),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Competition = z.infer<typeof CompetitionSchema>;

export const StartlistEntrySchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  competitionId: z.string().uuid(),
  athleteId: z.string().uuid(),
  event: z.string().min(1),
  eventNumber: z.string().default(''),
  heat: z.number().int().positive().nullable(),
  lane: z.number().int().positive().nullable(),
  seedTime: z.number().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type StartlistEntry = z.infer<typeof StartlistEntrySchema>;

export const ResultSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  athleteId: z.string().uuid(),
  event: z.string().min(1),
  time: z.number().positive(),
  date: isoDate,
  course: CourseSchema,
  competitionId: z.string().uuid().nullable(),
  place: z.number().int().positive().nullable(),
  isPB: z.boolean(),
  // Rundenzeiten der Stoppuhr-Funktion — kumulierte Sekunden je Runde.
  laps: z.array(z.number().positive()).nullable().optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Result = z.infer<typeof ResultSchema>;

export const ExerciseSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  name: z.string().min(1),
  category: z.string().min(1),
  stroke: z.string().nullable(),
  description: z.string().default(''),
  defaultDistance: z.number().int().positive().nullable(),
  tags: z.array(z.string()).default([]),
  equipment: z.array(z.string()).default([]),
  // Diskussions-/Hinweiskommentare im Übungskatalog (z. B. Technikhinweise
  // mehrerer Trainer:innen zu derselben Übung).
  comments: z.array(CommentSchema).default([]),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Exercise = z.infer<typeof ExerciseSchema>;

// Sets/Wiederholungsblöcke — identische Struktur wie im Frontend
// (js/modules/setEditor.js): ein Eintrag ist entweder ein einzelner Satz
// oder ein Block, der wiederum mehrere einzelne Sätze enthält (keine
// verschachtelten Blöcke).
export const PlainSetSchema = z.object({
  kind: z.literal('set'),
  id: z.string(),
  description: z.string().default(''),
  distance: z.number().int().nonnegative().nullable(),
  reps: z.number().int().positive(),
  intensity: z.string(),
  restSec: z.number().int().nonnegative(),
  exerciseId: z.string().uuid().nullable().optional(),
  // Kommentare zu genau diesem Satz/dieser Übung innerhalb eines
  // Trainingsplans (bzw. einer Vorlage, da Templates dieselbe Struktur
  // verwenden) — z. B. Rückfragen oder Feedback zu einer konkreten Serie.
  comments: z.array(CommentSchema).default([]),
}).strict();
export type PlainSet = z.infer<typeof PlainSetSchema>;

export const RepeatBlockSchema = z.object({
  kind: z.literal('block'),
  id: z.string(),
  label: z.string().default(''),
  repeatCount: z.number().int().positive(),
  sets: z.array(PlainSetSchema),
}).strict();
export type RepeatBlock = z.infer<typeof RepeatBlockSchema>;

export const SetEntrySchema = z.discriminatedUnion('kind', [PlainSetSchema, RepeatBlockSchema]);
export type SetEntry = z.infer<typeof SetEntrySchema>;

export const TemplateSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
  sets: z.array(SetEntrySchema),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Template = z.infer<typeof TemplateSchema>;

export const PlanDaySchema = z.object({
  date: isoDate,
  sets: z.array(SetEntrySchema),
}).strict();
export type PlanDay = z.infer<typeof PlanDaySchema>;

export const PlanStatusSchema = z.enum(['aktiv', 'archiv']);

export const PlanSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  name: z.string().min(1),
  weekStart: isoDate,
  groupId: z.string().uuid().nullable(),
  status: PlanStatusSchema,
  days: z.array(PlanDaySchema),
  // Kommentare zum gesamten Trainingsplan (nicht zu einem einzelnen Satz
  // — siehe dafür PlainSetSchema.comments oben).
  comments: z.array(CommentSchema).default([]),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Plan = z.infer<typeof PlanSchema>;

export const AttendanceRecordSchema = z.object({
  athleteId: z.string().uuid(),
  present: z.boolean(),
  rpe: z.number().int().min(1).max(10).nullable(),
  note: z.string().default(''),
}).strict();
export type AttendanceRecord = z.infer<typeof AttendanceRecordSchema>;

export const TrainingSessionSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  date: isoDate,
  groupId: z.string().uuid().nullable(),
  planId: z.string().uuid().nullable(),
  trainerNote: z.string().default(''),
  attendance: z.array(AttendanceRecordSchema),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type TrainingSession = z.infer<typeof TrainingSessionSchema>;

export const ActionItemStatusSchema = z.enum(['offen', 'progress', 'done']);

export const ActionItemSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  athleteId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().default(''),
  category: z.string().min(1),
  status: ActionItemStatusSchema,
  createdDate: isoDate,
  dueDate: nullableIsoDate,
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type ActionItem = z.infer<typeof ActionItemSchema>;

// ---- Registry: SyncStore -> Zod-Schema -------------------------------
// Zentrale Zuordnung, welches Schema zu welchem Store-Namen gehört. Wird
// in Phase 3 direkt von der generischen Sync-API (`POST /api/sync/push`)
// genutzt, um ein eingehendes Event-Payload gegen das richtige Schema zu
// validieren, OHNE für jeden Store einen eigenen Endpunkt zu brauchen.
// Ein Test stellt sicher, dass hier kein SyncStore-Wert vergessen wurde
// (siehe test/entities.test.ts).
export const ENTITY_SCHEMAS = {
  athletes: AthleteSchema,
  groups: GroupSchema,
  competitions: CompetitionSchema,
  entries: StartlistEntrySchema,
  results: ResultSchema,
  exercises: ExerciseSchema,
  templates: TemplateSchema,
  plans: PlanSchema,
  sessions: TrainingSessionSchema,
  actionItems: ActionItemSchema,
} satisfies Partial<Record<z.infer<typeof SyncStoreSchema>, z.ZodTypeAny>>;

export type EntityStoreName = keyof typeof ENTITY_SCHEMAS;
