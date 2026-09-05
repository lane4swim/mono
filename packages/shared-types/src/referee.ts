// packages/shared-types/src/referee.ts
//
// Vertrag für das Kampfrichter-Modul (docs/kampfrichter-modul-plan.md,
// Abschnitt 5: Wettkampfeinsätze). Bewusst NICHT Teil von entities.ts/
// ENTITY_SCHEMAS — RefereeAssignment ist kein Sync-Store (User selbst ist
// keiner, siehe qualification.ts-Kommentar für dieselbe Begründung), diese
// Schemas werden stattdessen vom eigenständigen referees-Modul im Backend
// (apps/api/src/modules/referees/) importiert.
import { z } from 'zod';

const isoDate = z.string().datetime();

// Funktion, in der die Kampfrichter:in bei EINEM konkreten Wettkampf
// eingesetzt war (Plan, Abschnitt 5.3) — bewusst eine EIGENE Liste,
// getrennt von QualificationTypeSchema (qualification.ts): eine
// Qualifikation ist ein Befähigungsnachweis ("darf die Funktion X
// ausüben"), ein Einsatz ein tatsächlich ausgeübter Termin ("hat die
// Funktion X am Datum Y ausgeübt") — jemand kann z. B. als schiedsrichter
// qualifiziert, an einem konkreten Wettkampf aber nur als zeitnehmer
// eingesetzt gewesen sein.
export const RefereeFunctionSchema = z.enum([
  'kampfrichter',
  'schiedsrichter',
  'startrichter',
  'zeitnehmer',
  'bahnrichter',
  'wettkampfsekretaer',
  'sonstige',
]);
export type RefereeFunction = z.infer<typeof RefereeFunctionSchema>;
export const REFEREE_FUNCTIONS = RefereeFunctionSchema.options;

export const RefereeAssignmentSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    // Freitext statt Pflicht-Verknüpfung mit einem Competition-Datensatz
    // (Plan, Abschnitt 5.1) — Kampfrichter:innen amtieren häufig bei
    // Wettkämpfen anderer, ggf. vereinsfremder Ausrichter.
    competitionName: z.string().min(1).max(200),
    competitionPlace: z.string().max(300).default(''),
    // Optionaler Verweis auf einen vereinseigenen Wettkampf-Datensatz.
    competitionId: z.string().uuid().nullable(),
    date: isoDate,
    function: RefereeFunctionSchema,
    note: z.string().max(500).default(''),
    // Gesetzt, wenn der Eintrag über den admin-Schreibpfad statt von der
    // Kampfrichter:in selbst angelegt/zuletzt geändert wurde — reines
    // Audit-Feld für die Anzeige ("von {name} erfasst"), siehe Plan
    // Abschnitt 5.5.
    createdByAdminId: z.string().uuid().nullable(),
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict();
export type RefereeAssignment = z.infer<typeof RefereeAssignmentSchema>;

export const CreateRefereeAssignmentRequestSchema = z
  .object({
    competitionName: z.string().min(1).max(200),
    competitionPlace: z.string().max(300).default(''),
    competitionId: z.string().uuid().nullable().optional(),
    date: isoDate,
    function: RefereeFunctionSchema,
    note: z.string().max(500).default(''),
  })
  .strict();
export type CreateRefereeAssignmentRequest = z.infer<typeof CreateRefereeAssignmentRequestSchema>;

// Teilweises Update (PATCH) — jedes Feld optional, analog
// UpdateUserQualificationRequestSchema.
export const UpdateRefereeAssignmentRequestSchema = z
  .object({
    competitionName: z.string().min(1).max(200).optional(),
    competitionPlace: z.string().max(300).optional(),
    competitionId: z.string().uuid().nullable().optional(),
    date: isoDate.optional(),
    function: RefereeFunctionSchema.optional(),
    note: z.string().max(500).optional(),
  })
  .strict();
export type UpdateRefereeAssignmentRequest = z.infer<typeof UpdateRefereeAssignmentRequestSchema>;

export const RefereeAssignmentListResponseSchema = z.object({
  assignments: z.array(RefereeAssignmentSchema),
});
