// Vertrag für den Eltern-/Erziehungsberechtigten-Zugang (Phase 2,
// Abschnitt 4.2 — docs/Plans/phase2-plan.md). Bewusst KEIN Sync-Store
// (siehe Plan, Abschnitt 3.1/5.2) — eine eigene, stark eingeschränkte,
// schreibgeschützte Sicht über eigene REST-Endpunkte.
import { z } from 'zod';

// GET /api/parents/overview — Antwort. Serverseitig vorberechnet, auf
// wenige Einträge begrenzt (Datenminimierung, siehe Plan Abschnitt 3.4).
export const ParentChildOverviewSchema = z.object({
  athlete: z.object({
    id: z.string().uuid(),
    firstName: z.string(),
    lastName: z.string(),
    groupId: z.string().uuid().nullable(),
    groupName: z.string().nullable(),
  }),
  upcomingSessions: z.array(z.object({
    id: z.string().uuid(),
    date: z.string().datetime(),
    groupName: z.string().nullable(),
  })),
  upcomingCompetitions: z.array(z.object({
    competitionId: z.string().uuid(),
    competitionName: z.string(),
    date: z.string().datetime(),
    event: z.string(),
  })),
  recentResults: z.array(z.object({
    id: z.string().uuid(),
    event: z.string(),
    time: z.number().nullable(),
    date: z.string().datetime(),
    isPB: z.boolean(),
    status: z.string(),
  })),
});
export type ParentChildOverview = z.infer<typeof ParentChildOverviewSchema>;

export const ParentOverviewResponseSchema = z.object({
  children: z.array(ParentChildOverviewSchema),
});
export type ParentOverviewResponse = z.infer<typeof ParentOverviewResponseSchema>;

// Admin-Verwaltung der Eltern-Kind-Verknüpfungen (Plan Abschnitt 3.5).
export const ParentLinkSchema = z.object({
  athleteId: z.string().uuid(),
  firstName: z.string(),
  lastName: z.string(),
});
export type ParentLink = z.infer<typeof ParentLinkSchema>;

export const ParentLinksResponseSchema = z.object({
  links: z.array(ParentLinkSchema),
});
export type ParentLinksResponse = z.infer<typeof ParentLinksResponseSchema>;

export const CreateParentLinkRequestSchema = z.object({
  athleteId: z.string().uuid(),
});
export type CreateParentLinkRequest = z.infer<typeof CreateParentLinkRequestSchema>;

// GET /api/parents/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD — Kalender der
// verknüpften Kinder. Dieselbe Form wie die lokalen Stores (damit das
// Kalendermodul sie unverändert auswertet), aber auf das Nötigste
// reduziert (Datenminimierung, Plan Abschnitt 3.4): Pläne ohne Sätze,
// Einheiten nur mit der eigenen Anwesenheit (ohne RPE/Notizen),
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
    id: z.string().uuid(),
    firstName: z.string(),
    lastName: z.string(),
    groupId: z.string().uuid().nullable(),
  }),
  groups: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  calendarEntries: z.array(z.object({
    id: z.string().uuid(),
    kind: z.string(),
    title: z.string(),
    startDate: isoDate,
    endDate: isoDate,
    groupId: z.string().uuid().nullable(),
    weekdays: z.array(z.number().int()),
    startTime: z.string().nullable(),
    endTime: z.string().nullable(),
    pauseDuring: z.array(z.string()),
    location: z.string(),
  })),
  plans: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    groupId: z.string().uuid().nullable(),
    days: z.array(z.object({ date: isoDate })),
  })),
  sessions: z.array(z.object({
    id: z.string().uuid(),
    date: isoDate,
    groupId: z.string().uuid().nullable(),
    attendance: z.array(z.object({ athleteId: z.string().uuid(), present: z.boolean() })),
  })),
  competitions: z.array(z.object({
    id: z.string().uuid(),
    name: z.string(),
    date: isoDate,
    location: z.string(),
    course: z.string(),
    entryDeadline: isoDate.nullable(),
    selectionDeadline: isoDate.nullable(),
  })),
  entries: z.array(z.object({ id: z.string().uuid(), competitionId: z.string().uuid(), athleteId: z.string().uuid() })),
});
export type ParentCalendarChild = z.infer<typeof ParentCalendarChildSchema>;

export const ParentCalendarResponseSchema = z.object({
  children: z.array(ParentCalendarChildSchema),
});
export type ParentCalendarResponse = z.infer<typeof ParentCalendarResponseSchema>;
