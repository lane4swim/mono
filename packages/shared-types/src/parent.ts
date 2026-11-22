// Vertrag für den Eltern-/Erziehungsberechtigten-Zugang (Phase 2,
// Abschnitt 4.2 — docs/Plans/phase2-plan.md). Bewusst KEIN Sync-Store
// (siehe Plan, Abschnitt 3.1/5.2) — eine eigene, stark eingeschränkte,
// schreibgeschützte Sicht über eigene REST-Endpunkte.
//
// Freigegebene Felder (Issue #145) — die Schemas unten SIND die Liste: jedes
// Objekt ist .strict(), und parents.service.ts prüft jede Antwort damit,
// bevor sie den Server verlässt. Ein Feld, das hier nicht steht, führt zu
// einem Fehler statt stillschweigend an Eltern zu gehen; neue Felder
// brauchen eine Entscheidung und einen Eintrag hier.
//
// Grundsatz: Daten des eigenen, minderjährigen Kindes, die für die Planung
// relevant sind (Termine, Wettkämpfe samt Lauf/Bahn/Meldezeit, Zeiten,
// Gruppe, zuständige Trainer:innen) sowie die eigene Anwesenheit
// (anwesend/abwesend). Nie: RPE, Feedback-Notizen, Trainer:innen-Notizen,
// Handlungsfelder, Kommentare, Kontaktdaten von Trainer:innen, Daten
// anderer Athlet:innen. Ab dem 18. Geburtstag erscheint ein Kind gar nicht
// mehr (parents.service.ts, parentLinkAgeStatus()).
import { z } from 'zod';

// GET /api/parents/overview — Antwort. Serverseitig vorberechnet, auf
// wenige Einträge begrenzt (Datenminimierung, siehe Plan Abschnitt 3.4).
export const ParentChildOverviewSchema = z.object({
  athlete: z.object({
    id: z.string().guid(),
    firstName: z.string(),
    lastName: z.string(),
    groupId: z.string().guid().nullable(),
    groupName: z.string().nullable(),
    // Namen der für die Gruppe zuständigen Trainer:innen (Group.trainerIds),
    // ohne E-Mail oder andere Kontaktdaten.
    trainerNames: z.array(z.string()),
  }).strict(),
  upcomingSessions: z.array(z.object({
    id: z.string().guid(),
    date: z.string().datetime(),
    groupName: z.string().nullable(),
  }).strict()),
  upcomingCompetitions: z.array(z.object({
    competitionId: z.string().guid(),
    competitionName: z.string(),
    date: z.string().datetime(),
    event: z.string(),
    // Aus der Meldung des Kindes: Wettkampfnummer, Lauf, Bahn, Meldezeit (s).
    eventNumber: z.string(),
    heat: z.number().int().nullable(),
    lane: z.number().int().nullable(),
    seedTime: z.number().nullable(),
  }).strict()),
  recentResults: z.array(z.object({
    id: z.string().guid(),
    event: z.string(),
    time: z.number().nullable(),
    date: z.string().datetime(),
    isPB: z.boolean(),
    status: z.string(),
  }).strict()),
}).strict();
export type ParentChildOverview = z.infer<typeof ParentChildOverviewSchema>;

export const ParentOverviewResponseSchema = z.object({
  children: z.array(ParentChildOverviewSchema),
}).strict();
export type ParentOverviewResponse = z.infer<typeof ParentOverviewResponseSchema>;

// Altersstand eines verknüpften Kindes (Issue #145): "adult" ab dem 18.
// Geburtstag — Eltern sehen das Kind dann nicht mehr, Admins sehen die
// Verknüpfung markiert und können sie entfernen. "birthdateMissing": ohne
// Geburtsdatum nicht prüfbar, die Verknüpfung bleibt wirksam.
export const ParentLinkAgeStatusSchema = z.enum(['minor', 'adult', 'birthdateMissing']);
export type ParentLinkAgeStatus = z.infer<typeof ParentLinkAgeStatusSchema>;

// Admin-Verwaltung der Eltern-Kind-Verknüpfungen (Plan Abschnitt 3.5).
export const ParentLinkSchema = z.object({
  athleteId: z.string().guid(),
  firstName: z.string(),
  lastName: z.string(),
  ageStatus: ParentLinkAgeStatusSchema,
}).strict();
export type ParentLink = z.infer<typeof ParentLinkSchema>;

export const ParentLinksResponseSchema = z.object({
  links: z.array(ParentLinkSchema),
}).strict();
export type ParentLinksResponse = z.infer<typeof ParentLinksResponseSchema>;

export const CreateParentLinkRequestSchema = z.object({
  athleteId: z.string().guid(),
});
export type CreateParentLinkRequest = z.infer<typeof CreateParentLinkRequestSchema>;

// GET /api/parents/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD — Kalender der
// verknüpften Kinder. Dieselbe Form wie die lokalen Stores (damit das
// Kalendermodul sie unverändert auswertet), aber auf das Nötigste
// reduziert (Datenminimierung, Plan Abschnitt 3.4): Pläne ohne Sätze,
// Einheiten nur mit der eigenen Anwesenheit (anwesend/abwesend, ohne RPE/Notizen),
// Wettkämpfe nur mit eigener Meldung, Saisonplanung ohne Notizen; keine
// Handlungsfelder.
const isoDate = z.string().datetime();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Höchstens gut zwei Jahre je Anfrage — die Jahresansicht samt Rändern
// braucht etwas über ein Jahr.
export const PARENT_CALENDAR_MAX_DAYS = 800;

export const ParentCalendarQuerySchema = z
  .object({ from: dateOnly, to: dateOnly })
  .strict()
  .refine((q) => q.from <= q.to, { message: 'from liegt nach to', path: ['to'] })
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 <= PARENT_CALENDAR_MAX_DAYS, {
    message: `Zeitraum höchstens ${PARENT_CALENDAR_MAX_DAYS} Tage`, path: ['to'],
  });
export type ParentCalendarQuery = z.infer<typeof ParentCalendarQuerySchema>;

export const ParentCalendarChildSchema = z.object({
  athlete: z.object({
    id: z.string().guid(),
    firstName: z.string(),
    lastName: z.string(),
    groupId: z.string().guid().nullable(),
  }).strict(),
  groups: z.array(z.object({ id: z.string().guid(), name: z.string() }).strict()),
  calendarEntries: z.array(z.object({
    id: z.string().guid(),
    kind: z.string(),
    title: z.string(),
    startDate: isoDate,
    endDate: isoDate,
    groupId: z.string().guid().nullable(),
    weekdays: z.array(z.number().int()),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    pauseDuring: z.array(z.string()),
    location: z.string(),
  }).strict()),
  plans: z.array(z.object({
    id: z.string().guid(),
    name: z.string(),
    groupId: z.string().guid().nullable(),
    days: z.array(z.object({ date: isoDate }).strict()),
  }).strict()),
  sessions: z.array(z.object({
    id: z.string().guid(),
    date: isoDate,
    groupId: z.string().guid().nullable(),
    attendance: z.array(z.object({ athleteId: z.string().guid(), present: z.boolean() }).strict()),
  }).strict()),
  competitions: z.array(z.object({
    id: z.string().guid(),
    name: z.string(),
    date: isoDate,
    location: z.string(),
    course: z.string(),
    entryDeadline: isoDate.nullable(),
    selectionDeadline: isoDate.nullable(),
  }).strict()),
  entries: z.array(z.object({ id: z.string().guid(), competitionId: z.string().guid(), athleteId: z.string().guid() }).strict()),
}).strict();
export type ParentCalendarChild = z.infer<typeof ParentCalendarChildSchema>;

export const ParentCalendarResponseSchema = z.object({
  children: z.array(ParentCalendarChildSchema),
}).strict();
export type ParentCalendarResponse = z.infer<typeof ParentCalendarResponseSchema>;
