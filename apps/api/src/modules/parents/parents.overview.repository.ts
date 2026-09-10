// Datenzugriff für die eingeschränkte Eltern-Übersicht (GET
// /api/parents/overview, Phase 2, Abschnitt 3.4 — docs/Plans/phase2-plan.md).
// Serverseitig vorberechnet aus den bestehenden Tabellen — bewusst KEIN
// Sync-Store, kein Zugriff über die generische Sync-API (siehe Plan,
// Abschnitt 3.4).
import type { PrismaClient } from '@prisma/client';
import type { ParentChildOverview } from '@lane1/shared-types';

// Bewusst klein (Datenminimierung, siehe Plan Abschnitt 3.4) — kein
// unbegrenzter Export, nur ein Überblick über die nächsten/letzten
// Ereignisse.
const OVERVIEW_ITEM_LIMIT = 10;

export interface ParentOverviewGateway {
  // null, wenn das Athletenprofil nicht mehr existiert/gelöscht wurde
  // (z. B. eine verwaiste ParentLink-Zeile nach einer Löschung) — der
  // Service filtert solche Einträge einfach aus der Antwort heraus.
  buildChildOverview(athleteId: string): Promise<ParentChildOverview | null>;
}

export class PrismaParentOverviewGateway implements ParentOverviewGateway {
  constructor(private readonly prisma: PrismaClient) {}

  async buildChildOverview(athleteId: string): Promise<ParentChildOverview | null> {
    const athlete = await this.prisma.athlete.findFirst({
      where: { id: athleteId, deletedAt: null },
      include: { group: true },
    });
    if (!athlete) return null;

    const now = new Date();

    const [sessions, entries, results] = await Promise.all([
      athlete.groupId
        ? this.prisma.trainingSession.findMany({
            where: { groupId: athlete.groupId, deletedAt: null, date: { gte: now } },
            include: { group: true },
            orderBy: { date: 'asc' },
            take: OVERVIEW_ITEM_LIMIT,
          })
        : Promise.resolve([]),
      this.prisma.startlistEntry.findMany({
        where: { athleteId, deletedAt: null, competition: { date: { gte: now }, deletedAt: null } },
        include: { competition: true },
        orderBy: { competition: { date: 'asc' } },
        take: OVERVIEW_ITEM_LIMIT,
      }),
      this.prisma.result.findMany({
        where: { athleteId, deletedAt: null },
        orderBy: { date: 'desc' },
        take: OVERVIEW_ITEM_LIMIT,
      }),
    ]);

    return {
      athlete: {
        id: athlete.id,
        firstName: athlete.firstName,
        lastName: athlete.lastName,
        groupId: athlete.groupId,
        groupName: athlete.group?.name ?? null,
      },
      upcomingSessions: sessions.map((s) => ({ id: s.id, date: s.date.toISOString(), groupName: s.group?.name ?? null })),
      upcomingCompetitions: entries
        .filter((e) => e.competition)
        .map((e) => ({
          competitionId: e.competition!.id,
          competitionName: e.competition!.name,
          date: e.competition!.date.toISOString(),
          event: e.event,
        })),
      recentResults: results.map((r) => ({
        id: r.id,
        event: r.event,
        time: r.time,
        date: r.date.toISOString(),
        isPB: r.isPB,
        status: r.status,
      })),
    };
  }
}
