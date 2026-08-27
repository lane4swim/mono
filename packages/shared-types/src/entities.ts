// packages/shared-types/src/entities.ts
//
// Vertrag für das fachliche Datenmodell (Backend-Entwicklungsplan,
// Abschnitt 4 / Phase 2). Jede Schema-Definition spiegelt exakt die Form,
// in der apps/web die Daten bereits in IndexedDB hält (js/db.js, js/seed.js)
// — dadurch entsteht beim künftigen Sync (Phase 3) kein verlustbehaftetes
// Mapping zwischen Client und Server.
//
// Aufräumarbeit (Code-Review): jedes freie Textfeld trägt jetzt ein
// `.max(...)` — vormals unbegrenzt (Fastifys 1-MB-Bodylimit auf
// POST /api/sync/push begrenzte den Schaden zwar auf HTTP-Ebene, aber ein
// einzelnes, absichtlich riesiges Feld hätte trotzdem unbemerkt
// akzeptiert und dauerhaft gespeichert werden können). Die Werte
// orientieren sich grob an der Rolle des Feldes: kurze Label/Namen
// ~200 Zeichen, längere Freitexte (Notizen/Beschreibungen)
// 2000-5000 Zeichen, Athlete.notes als einziges Feld mit erkennbar
// höherem Bedarf (laufende Trainer:innen-Notizen über die gesamte
// Karriere hinweg) 10000 Zeichen.
//
// Aufräumarbeit (Code-Review, Befund S7): dieselbe Begründung galt bislang
// NICHT für Array-Felder (tags, equipment, comments, laps, attendance,
// days, sets) — ein einzelner Datensatz mit z. B. 20.000 Kommentaren wäre
// unter dem 1-MB-Bodylimit geblieben und dauerhaft gespeichert worden,
// obwohl jedes eingebettete Textfeld längst begrenzt ist. Jetzt trägt auch
// jedes Array ein `.max(...)`, großzügig über dem, was eine legitime
// Nutzung je erreichen würde (z. B. Plan.days: eine "Wochenplan" genannte
// Struktur, die die Oberfläche dennoch nicht auf 7 Einträge hart begrenzt
// — 60 deckt bequem auch mehrwöchige Pläne ab, ohne unbegrenzt zu bleiben).
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
//
// `authorName` wird vom Frontend beim Anlegen aus dem eingeloggten Konto
// übernommen (reiner Anzeige-Zweck, kann sich ändern, wenn die Person
// später ihren Namen ändert — deshalb KEIN Abgleichsschlüssel).
//
// `authorId` (Sicherheitsreview 2026-08-27, Befund M2): bis hierhin gab
// es überhaupt keine serverseitige Autor:innen-Verifikation — jedes
// Vereinsmitglied konnte per direktem POST /api/sync/push einen
// Kommentar unter einem beliebigen `authorName` hinterlassen
// (Identitätsvortäuschung), und die Art.-17-Anonymisierung (Befund N5
// des Vorreviews) ließ sich über einen bewusst abweichenden Namen gezielt
// umgehen. `authorId` ist die tatsächliche, stabile User-ID — anders als
// `authorName` NICHT frei wählbar: `sync.commentAuthorship.ts` erzwingt
// beim Push, dass ein NEUER Kommentar `authorId === request.user.sub`
// trägt und ein BESTEHENDER Kommentar seine ursprüngliche Zuordnung
// behält (siehe dort). `jobs/commentAnonymization.ts` gleicht seither
// gegen `authorId` statt gegen `authorName` ab — die dort zuvor
// dokumentierte Unschärfe (Namensgleichheit, nachträgliche
// Namensänderung) entfällt dadurch.
export const CommentSchema = z.object({
  id: z.string().min(1),
  // `.optional()` ist KEINE Aufweichung der Durchsetzung, sondern eine
  // Migrationsnotwendigkeit: Kommentare leben als eingebettetes JSONB in
  // plans/exercises/templates, es gibt für sie also keine Spalten-
  // Migration, die ein neues Pflichtfeld nachträglich befüllen könnte.
  // Wäre `authorId` hier verpflichtend, würde JEDER vor dieser Änderung
  // gespeicherte Kommentar seinen umgebenden Datensatz dauerhaft
  // unspeicherbar machen: der Client pullt den Altbestand unverändert,
  // schickt ihn beim nächsten Bearbeiten zurück, und der `.strict()`-
  // Check lehnte ihn ab ("Payload entspricht nicht dem Schema") — ein
  // Plan mit Alt-Kommentaren ließe sich nie wieder ändern. Die
  // eigentliche Sperre sitzt deshalb eine Ebene höher, wo sie zwischen
  // "Altbestand" und "neu" unterscheiden kann: assertCommentAuthorship()
  // (apps/api/src/modules/sync/sync.commentAuthorship.ts) verlangt für
  // jeden NEUEN Kommentar `authorId === request.user.sub` und lässt einen
  // Kommentar ohne `authorId` ausschließlich dann durch, wenn er
  // unverändert aus dem bereits gespeicherten Datensatz stammt.
  authorId: z.string().uuid().optional(),
  authorName: z.string().min(1).max(200),
  text: z.string().min(1).max(5000),
  createdAt: isoDate,
}).strict();
export type Comment = z.infer<typeof CommentSchema>;

export const GroupSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Group = z.infer<typeof GroupSchema>;

export const AthleteGenderSchema = z.enum(['w', 'm', 'd']);

export const AthleteSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  firstName: z.string().min(1).max(200),
  lastName: z.string().min(1).max(200),
  birthdate: nullableIsoDate,
  gender: AthleteGenderSchema,
  groupId: z.string().uuid().nullable(),
  joinDate: nullableIsoDate,
  active: z.boolean(),
  notes: z.string().max(10000).default(''),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Athlete = z.infer<typeof AthleteSchema>;

export const CourseSchema = z.enum(['LCM', 'SCM']);

export const CompetitionSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  name: z.string().min(1).max(200),
  date: isoDate,
  location: z.string().max(300).default(''),
  course: CourseSchema,
  notes: z.string().max(5000).default(''),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Competition = z.infer<typeof CompetitionSchema>;

export const StartlistEntrySchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  competitionId: z.string().uuid(),
  athleteId: z.string().uuid(),
  event: z.string().min(1).max(200),
  eventNumber: z.string().max(50).default(''),
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
  event: z.string().min(1).max(200),
  time: z.number().positive(),
  date: isoDate,
  course: CourseSchema,
  competitionId: z.string().uuid().nullable(),
  place: z.number().int().positive().nullable(),
  isPB: z.boolean(),
  // Rundenzeiten der Stoppuhr-Funktion — kumulierte Sekunden je Runde.
  laps: z.array(z.number().positive()).max(500).nullable().optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Result = z.infer<typeof ResultSchema>;

export const ExerciseSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  stroke: z.string().max(100).nullable(),
  description: z.string().max(5000).default(''),
  defaultDistance: z.number().int().positive().nullable(),
  tags: z.array(z.string().max(100)).max(50).default([]),
  equipment: z.array(z.string().max(100)).max(50).default([]),
  // Diskussions-/Hinweiskommentare im Übungskatalog (z. B. Technikhinweise
  // mehrerer Trainer:innen zu derselben Übung).
  comments: z.array(CommentSchema).max(500).default([]),
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
  description: z.string().max(2000).default(''),
  distance: z.number().int().nonnegative().nullable(),
  reps: z.number().int().positive(),
  intensity: z.string().max(200),
  restSec: z.number().int().nonnegative(),
  exerciseId: z.string().uuid().nullable().optional(),
  // Kommentare zu genau diesem Satz/dieser Übung innerhalb eines
  // Trainingsplans (bzw. einer Vorlage, da Templates dieselbe Struktur
  // verwenden) — z. B. Rückfragen oder Feedback zu einer konkreten Serie.
  comments: z.array(CommentSchema).max(200).default([]),
}).strict();
export type PlainSet = z.infer<typeof PlainSetSchema>;

export const RepeatBlockSchema = z.object({
  kind: z.literal('block'),
  id: z.string(),
  label: z.string().max(200).default(''),
  repeatCount: z.number().int().positive(),
  sets: z.array(PlainSetSchema).max(50),
}).strict();
export type RepeatBlock = z.infer<typeof RepeatBlockSchema>;

export const SetEntrySchema = z.discriminatedUnion('kind', [PlainSetSchema, RepeatBlockSchema]);
export type SetEntry = z.infer<typeof SetEntrySchema>;

export const TemplateSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).default(''),
  tags: z.array(z.string().max(100)).max(50).default([]),
  sets: z.array(SetEntrySchema).max(200),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Template = z.infer<typeof TemplateSchema>;

export const PlanDaySchema = z.object({
  date: isoDate,
  sets: z.array(SetEntrySchema).max(200),
}).strict();
export type PlanDay = z.infer<typeof PlanDaySchema>;

export const PlanStatusSchema = z.enum(['aktiv', 'archiv']);

export const PlanSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  name: z.string().min(1).max(200),
  weekStart: isoDate,
  groupId: z.string().uuid().nullable(),
  status: PlanStatusSchema,
  days: z.array(PlanDaySchema).max(60),
  // Kommentare zum gesamten Trainingsplan (nicht zu einem einzelnen Satz
  // — siehe dafür PlainSetSchema.comments oben).
  comments: z.array(CommentSchema).max(500).default([]),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Plan = z.infer<typeof PlanSchema>;

export const AttendanceRecordSchema = z.object({
  athleteId: z.string().uuid(),
  present: z.boolean(),
  rpe: z.number().int().min(1).max(10).nullable(),
  note: z.string().max(2000).default(''),
}).strict();
export type AttendanceRecord = z.infer<typeof AttendanceRecordSchema>;

export const TrainingSessionSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  date: isoDate,
  groupId: z.string().uuid().nullable(),
  planId: z.string().uuid().nullable(),
  trainerNote: z.string().max(5000).default(''),
  attendance: z.array(AttendanceRecordSchema).max(500),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type TrainingSession = z.infer<typeof TrainingSessionSchema>;

export const ActionItemStatusSchema = z.enum(['offen', 'progress', 'done']);

export const ActionItemSchema = z.object({
  id: z.string().uuid(),
  clubId: z.string().uuid(),
  athleteId: z.string().uuid(),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).default(''),
  category: z.string().min(1).max(100),
  status: ActionItemStatusSchema,
  // Zuständige Person (Trainer:in oder Admin) für dieses Handlungsfeld.
  // Wird beim Anlegen clientseitig standardmäßig auf den/die Erfasser:in
  // gesetzt (siehe apps/web/js/modules/actionItems.js: openItemModal),
  // bleibt aber frei umzuweisen. Nullable + SetNull (siehe schema.prisma),
  // damit ein gelöschtes Trainer:innen-Konto das Handlungsfeld nicht
  // blockiert.
  assignedTrainerId: z.string().uuid().nullable(),
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

// Aus ENTITY_SCHEMAS abgeleitet (statt an jeder Verwendungsstelle erneut
// als eigenes Array getippt) — die zehn fachlichen Store-Namen existieren
// dadurch nur an EINER Stelle im Code. Konsumenten (u. a.
// apps/api/src/db/entityRegistry.ts: ENTITY_STORE_NAMES,
// apps/api/src/modules/sync/sync.gateway.ts: ALL_STORES) importieren
// dieses Array, statt es erneut aufzuzählen — ein Store, der hier fehlt
// oder hinzukommt, wirkt sich automatisch überall aus, ohne dass eine der
// bislang unabhängig gepflegten Kopien in Vergessenheit geraten kann.
export const ENTITY_STORE_NAMES = Object.keys(ENTITY_SCHEMAS) as EntityStoreName[];
