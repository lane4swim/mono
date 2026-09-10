// Business-Logik für den Eltern-/Erziehungsberechtigten-Zugang (Phase 2,
// Abschnitt 4.2 — docs/Plans/phase2-plan.md).
import type { ParentOverviewResponse, ParentLink } from '@lane1/shared-types';
import type { ParentLinkRepository } from './parents.repository.js';
import type { ParentOverviewGateway } from './parents.overview.repository.js';

// Minimale, für dieses Modul ausreichende Nachschlagemöglichkeiten —
// analog AthleteLookup in invitations.repository.ts: keine Abhängigkeit
// auf die vollen auth/invitations-Module, nur die gebrauchten Felder.
export interface ParentsUserLookup {
  findById(id: string): Promise<{ id: string; clubId: string | null; roles: readonly string[] } | null>;
}
export interface ParentsAthleteLookup {
  findById(id: string): Promise<{ id: string; clubId: string; firstName: string; lastName: string } | null>;
}

export interface ParentsServiceDeps {
  parentLinks: ParentLinkRepository;
  overview: ParentOverviewGateway;
  users: ParentsUserLookup;
  athletes: ParentsAthleteLookup;
}

export class ParentNotInClubError extends Error {}
export class AthleteNotInClubError extends Error {}
export class UserNotParentError extends Error {}

export interface RequesterContext {
  userId: string;
  clubId: string | null;
}

export function createParentsService(deps: ParentsServiceDeps) {
  return {
    // Eigene, stark eingeschränkte Sicht (Plan Abschnitt 3.4) — nur die
    // eigenen verknüpften Kinder, nie fremde. `requester.userId` kommt
    // aus dem Access Token, nicht aus der Anfrage — eine `parent`-Person
    // kann dadurch strukturell nur ihre eigenen Verknüpfungen abrufen.
    async getOverview(requester: RequesterContext): Promise<ParentOverviewResponse> {
      const links = await deps.parentLinks.listByUser(requester.userId);
      const children = await Promise.all(links.map((link) => deps.overview.buildChildOverview(link.athleteId)));
      // Verwaiste Verknüpfungen (Athletenprofil zwischenzeitlich gelöscht)
      // werden stillschweigend herausgefiltert statt einen Fehler zu
      // werfen — die übrigen Kinder sollen weiterhin sichtbar bleiben.
      return { children: children.filter((c): c is NonNullable<typeof c> => c !== null) };
    },

    // Admin-Verwaltung (Plan Abschnitt 3.5) — `admin`/`superadmin`-geschützt
    // auf Route-Ebene (siehe parents.route.ts), hier zusätzlich das
    // Vereins-Scoping: das Ziel-Konto muss zum eigenen Verein gehören UND
    // die Rolle "parent" tragen.
    async listLinks(targetUserId: string, requester: RequesterContext): Promise<ParentLink[]> {
      const target = await deps.users.findById(targetUserId);
      if (!target || target.clubId !== requester.clubId) throw new ParentNotInClubError();
      if (!target.roles.includes('parent')) throw new UserNotParentError();

      const links = await deps.parentLinks.listByUser(targetUserId);
      const athletes = await Promise.all(links.map((link) => deps.athletes.findById(link.athleteId)));
      return athletes
        .filter((a): a is NonNullable<typeof a> => a !== null)
        .map((a) => ({ athleteId: a.id, firstName: a.firstName, lastName: a.lastName }));
    },

    async addLink(targetUserId: string, athleteId: string, requester: RequesterContext): Promise<void> {
      const target = await deps.users.findById(targetUserId);
      if (!target || target.clubId !== requester.clubId) throw new ParentNotInClubError();
      if (!target.roles.includes('parent')) throw new UserNotParentError();

      const athlete = await deps.athletes.findById(athleteId);
      if (!athlete || athlete.clubId !== requester.clubId) throw new AthleteNotInClubError();

      await deps.parentLinks.create(targetUserId, athleteId);
    },

    async removeLink(targetUserId: string, athleteId: string, requester: RequesterContext): Promise<void> {
      const target = await deps.users.findById(targetUserId);
      if (!target || target.clubId !== requester.clubId) throw new ParentNotInClubError();
      await deps.parentLinks.remove(targetUserId, athleteId);
    },
  };
}
export type ParentsService = ReturnType<typeof createParentsService>;
