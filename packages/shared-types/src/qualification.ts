// packages/shared-types/src/qualification.ts
//
// Vertrag für das Qualifikationsmanagement (docs/nutzer-qualifikationen-plan.md).
// Bewusst NICHT Teil von entities.ts/ENTITY_SCHEMAS — UserQualification ist
// kein Sync-Store (User selbst ist keiner, siehe Plan Abschnitt 1.1), diese
// Schemas werden stattdessen vom eigenständigen qualifications-Modul im
// Backend (apps/api/src/modules/qualifications/) importiert.
import { z } from 'zod';

const isoDate = z.string().datetime();
const nullableIsoDate = z.string().datetime().nullable();

// Feste Werteliste (Plan, Abschnitt 2.2 / Entscheidung zu Frage 1) — ein
// geschlossenes Enum statt Freitext, damit Anzeige-Labels über
// `t('qualification.type.*')` lokalisiert werden können und Filterung/
// Reporting möglich bleibt. Eine je Verein frei konfigurierbare Werteliste
// ist bewusst nicht Teil dieses ersten Umsetzungsschritts.
export const QualificationTypeSchema = z.enum([
  'trainer_c',
  'trainer_b',
  'trainer_a',
  'rettungsschwimmer_silber',
  'rettungsschwimmer_gold',
  'erste_hilfe',
  'kinderschutz',
  'sonstige',
]);
export type QualificationType = z.infer<typeof QualificationTypeSchema>;
export const QUALIFICATION_TYPES = QualificationTypeSchema.options;

// Fallback-Vorlaufzeiten (Tage vor expiresOn), wenn ein Verein für einen
// Qualifikationstyp keine eigene ClubQualificationReminderSetting-Zeile
// konfiguriert hat (siehe Plan, Abschnitt 2.4/5) — zwei Schwellen, damit
// eine Person sowohl frühzeitig als auch kurzfristig vor Ablauf erinnert
// wird.
export const DEFAULT_QUALIFICATION_REMINDER_THRESHOLDS_DAYS = [60, 14];

function hasChronologicalOrder(v: { acquiredOn: string; expiresOn: string | null }) {
  return !v.expiresOn || v.expiresOn >= v.acquiredOn;
}
// Als Funktion statt eines geteilten Objekt-Literals: zod erwartet für den
// `path` ein MUTABLES Array (`(string | number)[]`) — ein einmal mit
// `as const` erzeugtes, wiederverwendetes Literal wäre `readonly` und
// dadurch nicht zuweisungskompatibel; eine frische Kopie je Aufruf umgeht
// das, ohne den `path` versehentlich veränderlich geteilt zwischen beiden
// .refine()-Aufrufen unten zu halten.
function chronologyIssue() {
  return { message: 'expiresOn darf nicht vor acquiredOn liegen.', path: ['expiresOn'] };
}

export const UserQualificationSchema = z
  .object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    type: QualificationTypeSchema,
    note: z.string().max(500).default(''),
    acquiredOn: isoDate,
    expiresOn: nullableIsoDate,
    renewalCourseOrganizedOn: nullableIsoDate,
    createdAt: isoDate,
    updatedAt: isoDate,
  })
  .strict()
  // Ablauf darf fachlich nicht vor dem Erwerb liegen — hier für die
  // Ausgabeform (Server -> Client) geprüft; die Eingabeformen unten prüfen
  // dieselbe Regel eigenständig, da CreateUserQualificationRequestSchema
  // ein Teilmengen-Objekt ohne id/userId/createdAt/updatedAt ist.
  .refine(hasChronologicalOrder, chronologyIssue());
export type UserQualification = z.infer<typeof UserQualificationSchema>;

export const CreateUserQualificationRequestSchema = z
  .object({
    type: QualificationTypeSchema,
    note: z.string().max(500).default(''),
    acquiredOn: isoDate,
    expiresOn: nullableIsoDate.optional(),
    renewalCourseOrganizedOn: nullableIsoDate.optional(),
  })
  .strict()
  .refine((v) => hasChronologicalOrder({ acquiredOn: v.acquiredOn, expiresOn: v.expiresOn ?? null }), chronologyIssue());
export type CreateUserQualificationRequest = z.infer<typeof CreateUserQualificationRequestSchema>;

// Teilweises Update (PATCH) — bewusst OHNE Cross-Field-Refine hier: ein
// Patch kann nur `expiresOn` ändern, ohne `acquiredOn` mitzuschicken. Die
// eigentliche Prüfung "neues expiresOn nicht vor (ggf. unverändertem)
// acquiredOn" erfolgt serverseitig im qualifications.service.ts gegen den
// bereits gespeicherten Datensatz (siehe dortiger Kommentar).
export const UpdateUserQualificationRequestSchema = z
  .object({
    type: QualificationTypeSchema.optional(),
    note: z.string().max(500).optional(),
    acquiredOn: isoDate.optional(),
    expiresOn: nullableIsoDate.optional(),
    renewalCourseOrganizedOn: nullableIsoDate.optional(),
  })
  .strict();
export type UpdateUserQualificationRequest = z.infer<typeof UpdateUserQualificationRequestSchema>;

export const UserQualificationListResponseSchema = z.object({
  qualifications: z.array(UserQualificationSchema),
});

// Konfigurierte Erinnerungs-Schwelle für EINEN Qualifikationstyp eines
// Vereins (Plan, Abschnitt 2.4).
export const QualificationReminderSettingSchema = z
  .object({
    type: QualificationTypeSchema,
    thresholdsDays: z.array(z.number().int().positive()).min(1).max(10),
  })
  .strict();
export type QualificationReminderSetting = z.infer<typeof QualificationReminderSettingSchema>;

export const QualificationReminderSettingsResponseSchema = z.object({
  settings: z.array(QualificationReminderSettingSchema),
  // Fallback, den ein Typ OHNE eigene Zeile in `settings` tatsächlich
  // verwendet (siehe DEFAULT_QUALIFICATION_REMINDER_THRESHOLDS_DAYS oben) —
  // mitgeliefert, damit die Einstellungen-Oberfläche (Plan, Abschnitt 4.4)
  // "nichts konfiguriert" sichtbar von "keine Erinnerung" unterscheiden kann.
  defaultThresholdsDays: z.array(z.number().int().positive()),
});

export const UpdateQualificationReminderSettingRequestSchema = z
  .object({
    thresholdsDays: z.array(z.number().int().positive()).min(1).max(10),
  })
  .strict();
export type UpdateQualificationReminderSettingRequest = z.infer<typeof UpdateQualificationReminderSettingRequestSchema>;
