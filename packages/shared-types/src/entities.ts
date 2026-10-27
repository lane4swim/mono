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
  authorId: z.string().guid().optional(),
  authorName: z.string().min(1).max(200),
  text: z.string().min(1).max(5000),
  createdAt: isoDate,
}).strict();
export type Comment = z.infer<typeof CommentSchema>;

export const GroupSchema = z.object({
  id: z.string().guid(),
  clubId: z.string().guid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  // Zuständige Trainer:innen/Admins (User.id), docs/Plans/
  // vereinsverwaltung-phase3-plan.md Abschnitt 1: rein organisatorisch,
  // keine Berechtigungsprüfung hängt daran (siehe Prisma-Schema-Kommentar
  // zu Group.trainerIds).
  trainerIds: z.array(z.string().guid()).max(50).default([]),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Group = z.infer<typeof GroupSchema>;

export const AthleteGenderSchema = z.enum(['w', 'm', 'd']);

// Ob für ein Athletenprofil ein eigenes Nutzerkonto vorgesehen ist:
// "managed" = nur von Admin/Trainer:innen gepflegt, keine Athlet:innen-
// Einladung; "invitable" = darf per Einladung mit einem Konto verknüpft
// werden. Eltern-Einladungen sind davon unabhängig.
export const AthleteAccountModeSchema = z.enum(['managed', 'invitable']);
export type AthleteAccountMode = z.infer<typeof AthleteAccountModeSchema>;

export const AthleteSchema = z.object({
  id: z.string().guid(),
  clubId: z.string().guid(),
  firstName: z.string().min(1).max(200),
  lastName: z.string().min(1).max(200),
  birthdate: nullableIsoDate,
  gender: AthleteGenderSchema,
  groupId: z.string().guid().nullable(),
  joinDate: nullableIsoDate,
  active: z.boolean(),
  notes: z.string().max(10000).default(''),
  // Externe Athletenkennung für den Ergebnisimport (DSV7/Lenex) — generisch
  // statt DSV-spezifisch, siehe docs/Plans/dsv7-lenex-import-plan.md Abschnitt 3.1.
  nationalID: z.string().max(50).nullable().optional(),
  nationalIDType: z.string().max(50).nullable().optional(),
  // Bewusst optional OHNE .default(): der Sync-Push schreibt den GEPARSTEN
  // Payload (sync.service.ts) — ein Default würde beim Update eines alten,
  // feldlosen Client-Datensatzes ein "invitable" still auf "managed"
  // zurücksetzen. Fehlt das Feld, bleibt der gespeicherte Wert unverändert;
  // neue Zeilen erhalten "managed" über den Spalten-Default (schema.prisma).
  // Lesende Stellen behandeln undefined wie "managed".
  accountMode: AthleteAccountModeSchema.optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Athlete = z.infer<typeof AthleteSchema>;

export const CourseSchema = z.enum(['LCM', 'SCM']);

// Eine Disziplin aus einer geladenen DSV7-Wettkampfdefinitionsliste
// (Element WETTKAMPF, siehe apps/web/js/resultsImport/dsv7DefinitionParser.js)
// — Grundlage für die Auswahlliste beim Anlegen von Startlisten-Einträgen.
// Die Codes werden unverändert aus der Datei übernommen: round = Wettkampfart
// (V/Z/F/E/A/N), stroke = Technik (F/R/B/S/L/X), style = Ausübung (GL/BE/AR/
// ST/WE/GB/X), gender = Geschlecht (M/W/X/D). `event` ist das daraus
// abgeleitete Disziplin-Label (z. B. "100 Freistil", "4x50 Lagen"), null,
// wenn sich keines bilden ließ (z. B. Sonderform).
//
// Eine Pflichtzeit (Element PFLICHTZEIT) der Disziplin: classType =
// Wertungsklasse-Typ ("JG" = Jahrgang, "AK" = Altersklasse, leer = alle),
// min/max = MinJG/AK bzw. MaxJG/AK unverändert aus der Datei (leer =
// offen), gender wie bei der Disziplin, time in Sekunden.
export const CompetitionRequiredTimeSchema = z.object({
  classType: z.string().max(5).default(''),
  min: z.string().max(10).default(''),
  max: z.string().max(10).default(''),
  gender: z.string().max(5).default(''),
  time: z.number().positive(),
}).strict();
export type CompetitionRequiredTime = z.infer<typeof CompetitionRequiredTimeSchema>;

// Nachweiszeitraum der Pflichtzeiten (Element NACHWEIS): von/bis als
// "JJJJ-MM-TT" (null = offen), course = geforderte Bahnlänge, null = jede.
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const CompetitionQualifyingWindowSchema = z.object({
  from: isoDay.nullable(),
  to: isoDay.nullable(),
  course: CourseSchema.nullable(),
}).strict();

export const CompetitionDisciplineSchema = z.object({
  number: z.string().min(1).max(50),
  round: z.string().max(5).default(''),
  session: z.number().int().positive().nullable().optional(),
  distanceM: z.number().int().positive(),
  stroke: z.string().max(5),
  style: z.string().max(5).default(''),
  relaySize: z.number().int().positive().default(1),
  gender: z.string().max(5).default(''),
  event: z.string().min(1).max(200).nullable(),
  // Pflichtzeiten aus der Wettkampfdefinition; der Nachweiszeitraum gilt
  // für die ganze Veranstaltung, wird aber je Disziplin mitgeführt, damit
  // alles in der bestehenden JSON-Spalte `disciplines` liegt.
  requiredTimes: z.array(CompetitionRequiredTimeSchema).max(100).optional(),
  qualifyingWindow: CompetitionQualifyingWindowSchema.optional(),
}).strict();
export type CompetitionDiscipline = z.infer<typeof CompetitionDisciplineSchema>;

export const CompetitionSchema = z.object({
  id: z.string().guid(),
  clubId: z.string().guid(),
  name: z.string().min(1).max(200),
  date: isoDate,
  location: z.string().max(300).default(''),
  course: CourseSchema,
  notes: z.string().max(5000).default(''),
  // Beide Fristen sind optional und bewusst OHNE .default() (vgl.
  // AthleteSchema.accountMode): ein älterer Client ohne diese Felder soll
  // beim Sync-Push gesetzte Fristen nicht still auf null zurücksetzen.
  // entryDeadline = externer Meldeschluss (Abgabe der Startliste beim
  // Veranstalter), selectionDeadline = interne Frist für die Auswahl der
  // Starts. Der Vorschlagswert für selectionDeadline (3 Wochen vor dem
  // Wettkampf bzw. 1 Woche vor dem Meldeschluss) wird im Formular gesetzt,
  // nicht hier — gespeichert wird nur, was tatsächlich eingetragen ist.
  entryDeadline: nullableIsoDate.optional(),
  selectionDeadline: nullableIsoDate.optional(),
  // Disziplinen aus einer geladenen DSV7-Wettkampfdefinitionsliste — wie die
  // Fristen bewusst OHNE .default(), damit ein älterer Client ohne das Feld
  // die geladene Liste beim Sync-Push nicht still leert. Nicht nullable:
  // "keine Definition" ist ein leeres Array (Prisma-Json-Spalten nehmen
  // kein schlichtes null an).
  disciplines: z.array(CompetitionDisciplineSchema).max(500).optional(),
  // Anzahl der Kampfrichter:innen, die der Verein laut Ausschreibung zu
  // stellen hat. Immer von Hand erfasst — weder DSV7 noch DSV8 haben dafür
  // ein Element. Wie die Fristen OHNE .default(); null = keine Vorgabe.
  refereesRequired: z.number().int().min(0).max(99).nullable().optional(),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Competition = z.infer<typeof CompetitionSchema>;

export const StartlistEntrySchema = z.object({
  id: z.string().guid(),
  clubId: z.string().guid(),
  competitionId: z.string().guid(),
  athleteId: z.string().guid(),
  event: z.string().min(1).max(200),
  eventNumber: z.string().max(50).default(''),
  heat: z.number().int().positive().nullable(),
  lane: z.number().int().positive().nullable(),
  seedTime: z.number().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type StartlistEntry = z.infer<typeof StartlistEntrySchema>;

// "OK" = gewertetes Ergebnis mit echter Zeit. Die übrigen Werte sind die
// DSV7-Codes für "Grund der Nichtwertung" (siehe
// docs/Plans/dsv7-lenex-import-plan.md Abschnitt 3.4): DS = Disqualifikation,
// NA = nicht angetreten, AB = abgemeldet, AU = aufgegeben,
// ZU = Zeitüberschreitung.
export const ResultStatusSchema = z.enum(['OK', 'DS', 'NA', 'AB', 'AU', 'ZU']);

// Eine importierte Zwischenzeit (DSV7 PNZWISCHENZEIT/STZWISCHENZEIT) —
// getrennt von `laps` (Stoppuhr-Funktion, andere Semantik). `legIndex`
// referenziert bei Staffeln die Startnummer der/des Ablösenden innerhalb
// der Staffel, bei Einzelstrecken ist es nicht gesetzt.
export const ResultSplitSchema = z.object({
  distanceM: z.number().positive(),
  time: z.number().positive(),
  legIndex: z.number().int().positive().optional(),
}).strict();
export type ResultSplit = z.infer<typeof ResultSplitSchema>;

export const ResultSchema = z.object({
  id: z.string().guid(),
  clubId: z.string().guid(),
  athleteId: z.string().guid(),
  event: z.string().min(1).max(200),
  // Bei status !== "OK" gibt es keine gewertete Zeit (siehe
  // docs/Plans/dsv7-lenex-import-plan.md Abschnitt 3.4/5).
  time: z.number().positive().nullable(),
  date: isoDate,
  course: CourseSchema,
  competitionId: z.string().guid().nullable(),
  place: z.number().int().positive().nullable(),
  isPB: z.boolean(),
  // Rundenzeiten der Stoppuhr-Funktion — kumulierte Sekunden je Runde.
  laps: z.array(z.number().positive()).max(500).nullable().optional(),
  // Aus einem Ergebnisimport übernommene Zwischenzeiten.
  splits: z.array(ResultSplitSchema).max(200).nullable().optional(),
  status: ResultStatusSchema.default('OK'),
  statusNote: z.string().max(2000).nullable().optional(),
  // Diskussions-/Hinweiskommentare zum Ergebnis — bleiben bei einem
  // Ergebnisimport unangetastet erhalten (siehe COMMENT_BEARING_STORES in
  // sync.commentAuthorship.ts).
  comments: z.array(CommentSchema).max(500).default([]),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Result = z.infer<typeof ResultSchema>;

export const ExerciseSchema = z.object({
  id: z.string().guid(),
  clubId: z.string().guid(),
  name: z.string().min(1).max(200),
  category: z.string().min(1).max(100),
  stroke: z.string().max(100).nullable(),
  description: z.string().max(5000).default(''),
  defaultDistance: z.number().int().positive().nullable(),
  // Analog zu defaultDistance, aber für zeitbasierte Übungen (Kraft/Land,
  // Dauerschwimmen ohne feste Distanz). .default(null) statt .nullable()
  // pur, da Altbestand (vor dieser Änderung) das Feld gar nicht kennt —
  // ein fehlender Schlüssel muss also genauso wie ein expliziter
  // null-Wert behandelt werden.
  defaultDurationSec: z.number().int().positive().nullable().default(null),
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
  // Dauer dieses Satzes in Sekunden — unabhängig von distance und frei
  // damit kombinierbar (z. B. "20 Min Dauerschwimmen" ohne feste Distanz,
  // oder "3x100m" MIT Zielzeit). .default(null) statt .nullable() pur,
  // da Altbestand (vor dieser Änderung) das Feld gar nicht kennt.
  durationSec: z.number().int().positive().nullable().default(null),
  reps: z.number().int().positive(),
  intensity: z.string().max(200),
  restSec: z.number().int().nonnegative(),
  exerciseId: z.string().guid().nullable().optional(),
  // Material für GENAU diesen Satz — unabhängig von Exercise.equipment
  // (dem Katalog-Standard einer verknüpften Übung). `.optional()` statt
  // `.default([])`: ein fehlendes Feld (Altbestand vor dieser Änderung)
  // bedeutet "kein eigener Wert, Anzeige fällt auf die verknüpfte Übung
  // zurück" (siehe equipmentForEntry() in js/modules/setEditor.js) — das
  // ist etwas anderes als ein bewusst geleertes Array (Material entfernt).
  equipment: z.array(z.string().max(100)).max(50).optional(),
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

// Ein Abschnitt gliedert eine Sätze-/Blöcke-Liste (Plan-Tag oder Vorlage)
// mit einer Überschrift — z. B. "Einschwimmen" / "Hauptteil" /
// "Ausschwimmen". Bewusst NUR eine Ebene tief (`entries` referenziert
// dieselbe PlainSet/RepeatBlock-Union wie ein Block, NICHT SetEntrySchema
// selbst): Abschnitte verschachteln sich nicht ineinander, genau wie sich
// Wiederholungsblöcke nicht ineinander verschachteln (siehe oben). Ein
// Umsortieren/Einfügen bleibt dadurch strukturell auf die eigene
// `entries`-Liste beschränkt — ein Verschieben von Sätzen/Blöcken über
// Abschnittsgrenzen hinweg ist fachlich nicht vorgesehen und mit dieser
// Form gar nicht erst darstellbar.
export const ExerciseEntrySchema = z.discriminatedUnion('kind', [PlainSetSchema, RepeatBlockSchema]);
export type ExerciseEntry = z.infer<typeof ExerciseEntrySchema>;

export const SectionSchema = z.object({
  kind: z.literal('section'),
  id: z.string(),
  heading: z.string().max(200).default(''),
  entries: z.array(ExerciseEntrySchema).max(200),
}).strict();
export type Section = z.infer<typeof SectionSchema>;

export const SetEntrySchema = z.discriminatedUnion('kind', [PlainSetSchema, RepeatBlockSchema, SectionSchema]);
export type SetEntry = z.infer<typeof SetEntrySchema>;

export const TemplateSchema = z.object({
  id: z.string().guid(),
  clubId: z.string().guid(),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).default(''),
  tags: z.array(z.string().max(100)).max(50).default([]),
  // Standard-Beckenlänge dieser Vorlage (siehe
  // docs/Plans/beckenlaenge-regeneration-plan.md, Abschnitt 2) — wird beim
  // Anwenden der Vorlage als Snapshot in PlanDay.poolLength übernommen,
  // bleibt dort aber pro Tag unabhängig überschreibbar. null = nicht
  // festgelegt, kein irreführender Default für Vorlagen ohne Angabe.
  poolLength: CourseSchema.nullable().default(null),
  sets: z.array(SetEntrySchema).max(200),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Template = z.infer<typeof TemplateSchema>;

// Eigenständige, wiederverwendbare Abschnitts-Vorlage — dieselbe Form wie
// SectionSchema.entries (nur Sätze/Blöcke, keine verschachtelten
// Abschnitte), aber mit eigener id/clubId, damit sie unabhängig von einem
// Trainingsplan katalogisiert und in mehrere Pläne/Vorlagen eingefügt
// werden kann.
export const SectionTemplateSchema = z.object({
  id: z.string().guid(),
  clubId: z.string().guid(),
  name: z.string().min(1).max(200),
  description: z.string().max(5000).default(''),
  tags: z.array(z.string().max(100)).max(50).default([]),
  entries: z.array(ExerciseEntrySchema).max(200),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type SectionTemplate = z.infer<typeof SectionTemplateSchema>;

export const PlanDaySchema = z.object({
  date: isoDate,
  // Beckenlänge dieses Trainingstages (Issue #72) — optional, da bestehende
  // Pläne keinen Wert haben; null = nicht festgelegt, kann von Tag zu Tag
  // im selben Plan variieren.
  poolLength: CourseSchema.nullable().default(null),
  sets: z.array(SetEntrySchema).max(200),
}).strict();
export type PlanDay = z.infer<typeof PlanDaySchema>;

export const PlanStatusSchema = z.enum(['aktiv', 'archiv']);

export const PlanSchema = z.object({
  id: z.string().guid(),
  clubId: z.string().guid(),
  name: z.string().min(1).max(200),
  weekStart: isoDate,
  groupId: z.string().guid().nullable(),
  status: PlanStatusSchema,
  days: z.array(PlanDaySchema).max(60),
  // Kommentare zum gesamten Trainingsplan (nicht zu einem einzelnen Satz
  // — siehe dafür PlainSetSchema.comments oben).
  comments: z.array(CommentSchema).max(500).default([]),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Plan = z.infer<typeof PlanSchema>;

// Wiederkehrende Trainingspläne (Phase 1, Abschnitt 3.1 —
// docs/Plans/trainingsplanung-phase1-plan.md). Ein Zyklus ist eine Vorlage für
// eine Abfolge von Wochen; "Zyklus anwenden" erzeugt daraus konkrete
// Plan-Datensätze (Snapshot, keine dauerhafte Beziehung).
export const CycleDaySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6), // 0 = Montag … 6 = Sonntag
  templateId: z.string().guid(),
}).strict();
export type CycleDay = z.infer<typeof CycleDaySchema>;

export const CycleWeekSchema = z.object({
  weekOffset: z.number().int().min(0).max(51),
  label: z.string().max(200).default(''),
  days: z.array(CycleDaySchema).max(7),
}).strict();
export type CycleWeek = z.infer<typeof CycleWeekSchema>;

export const PlanCycleSchema = z.object({
  id: z.string().guid(),
  clubId: z.string().guid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).default(''),
  weeks: z.array(CycleWeekSchema).max(52), // Obergrenze analog Plan.days (max 60)
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type PlanCycle = z.infer<typeof PlanCycleSchema>;

export const AttendanceRecordSchema = z.object({
  athleteId: z.string().guid(),
  present: z.boolean(),
  rpe: z.number().int().min(1).max(10).nullable(),
  note: z.string().max(2000).default(''),
}).strict();
export type AttendanceRecord = z.infer<typeof AttendanceRecordSchema>;

export const TrainingSessionSchema = z.object({
  id: z.string().guid(),
  clubId: z.string().guid(),
  date: isoDate,
  groupId: z.string().guid().nullable(),
  planId: z.string().guid().nullable(),
  trainerNote: z.string().max(5000).default(''),
  attendance: z.array(AttendanceRecordSchema).max(500),
  // Anwesende Trainer:innen (User.id), pro Einheit abgehakt. Default []
  // hält Einheiten aus der Zeit vor diesem Feld gültig.
  coachIds: z.array(z.string().guid()).max(50).default([]),
  // Manuelle Distanzangabe (Meter). null = aus dem verknüpften Plan-Tag
  // berechnen (Standardfall) — siehe docs/Plans/trainingsplanung-phase1-plan.md.
  actualDistance: z.number().int().nonnegative().nullable().default(null),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type TrainingSession = z.infer<typeof TrainingSessionSchema>;

export const ActionItemStatusSchema = z.enum(['offen', 'progress', 'done']);

export const ActionItemSchema = z.object({
  id: z.string().guid(),
  clubId: z.string().guid(),
  athleteId: z.string().guid(),
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
  assignedTrainerId: z.string().guid().nullable(),
  createdDate: isoDate,
  dueDate: nullableIsoDate,
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type ActionItem = z.infer<typeof ActionItemSchema>;

// Vereinsinterne Nachrichten/Ankündigungen (Phase 2, Abschnitt 4.1 —
// docs/Plans/phase2-plan.md). authorId nullable: ein gelöschtes
// Autor:innen-Konto reißt die Ankündigung nicht mit (siehe schema.prisma:
// Announcement.authorId, onDelete: SetNull).
export const AnnouncementSchema = z.object({
  id: z.string().guid(),
  clubId: z.string().guid(),
  // null = an den gesamten Verein gerichtet; gesetzt = nur an diese Gruppe.
  groupId: z.string().guid().nullable(),
  authorId: z.string().guid().nullable(),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict();
export type Announcement = z.infer<typeof AnnouncementSchema>;

// Saisonplanung im Kalender: vereinsweite Ferien/Feiertage und
// Hallenbadschließungen sowie je Gruppe regelmäßige Trainingszeiten und
// Trainingslager. Ein gemeinsamer Store statt fünf — alle Arten sind
// datierte Zeiträume mit Titel, nur `trainingSlot` trägt zusätzlich eine
// wöchentliche Wiederholung (weekdays + Uhrzeit). Die einzelnen Termine
// einer Trainingszeit werden erst im Kalender aus der Regel berechnet
// (apps/web/js/modules/calendarEvents.js), nicht gespeichert.
export const CalendarEntryKindSchema = z.enum(['publicHoliday', 'schoolHoliday', 'poolClosure', 'trainingCamp', 'trainingSlot']);
export type CalendarEntryKind = z.infer<typeof CalendarEntryKindSchema>;

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const CalendarEntrySchema = z.object({
  id: z.string().guid(),
  clubId: z.string().guid(),
  kind: CalendarEntryKindSchema,
  title: z.string().min(1).max(200),
  // Beide inklusive; bei trainingSlot der Gültigkeitszeitraum der Regel.
  startDate: isoDate,
  endDate: isoDate,
  // null = ganzer Verein. Ferien/Feiertage/Schließungen gelten immer
  // vereinsweit (siehe superRefine unten).
  groupId: z.string().guid().nullable().default(null),
  // Nur trainingSlot: Wochentage (0 = Montag … 6 = Sonntag, wie
  // CycleDaySchema) und Uhrzeit.
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  startTime: timeOfDay.nullable().default(null),
  endTime: timeOfDay.nullable().default(null),
  // Nur trainingSlot: an Tagen dieser Arten fällt das Training aus.
  pauseDuring: z.array(CalendarEntryKindSchema.exclude(['trainingSlot'])).max(4).default([]),
  // Nur trainingSlot: Vorbelegung für neu angelegte Trainingspläne.
  poolLength: CourseSchema.nullable().default(null),
  location: z.string().max(200).default(''),
  note: z.string().max(2000).default(''),
  createdAt: isoDate,
  updatedAt: isoDate,
}).strict().superRefine((entry, ctx) => {
  if (entry.endDate.slice(0, 10) < entry.startDate.slice(0, 10)) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'endDate liegt vor startDate' });
  }
  if (['publicHoliday', 'schoolHoliday', 'poolClosure'].includes(entry.kind) && entry.groupId !== null) {
    ctx.addIssue({ code: 'custom', path: ['groupId'], message: 'gilt immer vereinsweit' });
  }
  if (entry.kind === 'trainingSlot' && entry.weekdays.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'mindestens ein Wochentag' });
  }
});
export type CalendarEntry = z.infer<typeof CalendarEntrySchema>;

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
  sectionTemplates: SectionTemplateSchema,
  plans: PlanSchema,
  planCycles: PlanCycleSchema,
  sessions: TrainingSessionSchema,
  actionItems: ActionItemSchema,
  announcements: AnnouncementSchema,
  calendarEntries: CalendarEntrySchema,
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
