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
