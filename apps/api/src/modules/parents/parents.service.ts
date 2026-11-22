// Business-Logik für den Eltern-/Erziehungsberechtigten-Zugang (Phase 2,
// Abschnitt 4.2 — docs/Plans/phase2-plan.md).
import { ParentOverviewResponseSchema, ParentCalendarResponseSchema, ParentLinkSchema, type ParentOverviewResponse, type ParentLink, type ParentCalendarResponse } from '@lane1/shared-types';
import { parentLinkAgeStatus } from './parents.age.js';
import type { ParentLinkRepository } from './parents.repository.js';
import type { ParentOverviewGateway } from './parents.overview.repository.js';
import type { ParentCalendarGateway, DateRange } from './parents.calendar.repository.js';
import type { AuditLogWriter } from '../auditLog/auditLog.service.js';
import type { Requester } from '../../plugins/requester.js';

// Minimale, für dieses Modul ausreichende Nachschlagemöglichkeiten —
// analog AthleteLookup in invitations.repository.ts: keine Abhängigkeit
// auf die vollen auth/invitations-Module, nur die gebrauchten Felder.
export interface ParentsUserLookup {
  findById(id: string): Promise<{ id: string; clubId: string | null; roles: readonly string[] } | null>;
}
export interface ParentsAthleteLookup {
  findById(id: string): Promise<{ id: string; clubId: string; firstName: string; lastName: string; birthdate?: Date | null } | null>;
}

export interface ParentsServiceDeps {
  parentLinks: ParentLinkRepository;
  overview: ParentOverviewGateway;
  // Optional, damit bestehende Tests ohne Kalender-Gateway weiterlaufen.
  calendar?: ParentCalendarGateway;
  users: ParentsUserLookup;
  athletes: ParentsAthleteLookup;
  auditLog: AuditLogWriter;
  now?: () => Date;
}

export class ParentNotInClubError extends Error {}
export class AthleteNotInClubError extends Error {}
export class UserNotParentError extends Error {}

export type RequesterContext = Pick<Requester, 'id' | 'clubId'>;

export function createParentsService(deps: ParentsServiceDeps) {
  const now = deps.now ?? (() => new Date());

  // Verknüpfte Kinder, die Eltern sehen dürfen: ab dem 18. Geburtstag nicht
  // mehr (Issue #145, parents.age.ts). Ein nicht mehr vorhandenes Profil
  // filtert anschließend das jeweilige Gateway heraus.
  async function visibleChildIds(userId: string): Promise<string[]> {
    const links = await deps.parentLinks.listByUser(userId);
    const today = now();
    const athletes = await Promise.all(links.map((link) => deps.athletes.findById(link.athleteId)));
    return links
      .filter((_link, i) => parentLinkAgeStatus(athletes[i]?.birthdate, today) !== 'adult')
      .map((link) => link.athleteId);
  }

  return {
    // Eigene, stark eingeschränkte Sicht (Plan Abschnitt 3.4) — nur die
    // eigenen verknüpften Kinder, nie fremde. `requester.id` kommt
    // aus dem Access Token, nicht aus der Anfrage — eine `parent`-Person
    // kann dadurch strukturell nur ihre eigenen Verknüpfungen abrufen.
    //
    // Die Antwort wird gegen das strikte Schema geprüft (Issue #145): ein
    // nicht freigegebenes Feld bricht die Anfrage ab, statt an Eltern zu
    // gehen (siehe packages/shared-types/src/parent.ts).
    async getOverview(requester: RequesterContext): Promise<ParentOverviewResponse> {
      const childIds = await visibleChildIds(requester.id);
      const children = await Promise.all(childIds.map((id) => deps.overview.buildChildOverview(id)));
      // Verwaiste Verknüpfungen (Athletenprofil zwischenzeitlich gelöscht)
      // werden stillschweigend herausgefiltert statt einen Fehler zu
      // werfen — die übrigen Kinder sollen weiterhin sichtbar bleiben.
      return ParentOverviewResponseSchema.parse({ children: children.filter((c): c is NonNullable<typeof c> => c !== null) });
    },

    // Kalender der eigenen verknüpften Kinder — wie getOverview() kommt
    // die Person aus dem Access Token, nie aus der Anfrage.
    async getCalendar(requester: RequesterContext, range: DateRange): Promise<ParentCalendarResponse> {
      if (!deps.calendar) return { children: [] };
      const childIds = await visibleChildIds(requester.id);
      const children = await Promise.all(childIds.map((id) => deps.calendar!.buildChildCalendar(id, range)));
      return ParentCalendarResponseSchema.parse({ children: children.filter((c): c is NonNullable<typeof c> => c !== null) });
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
      const today = now();
      return athletes
        .filter((a): a is NonNullable<typeof a> => a !== null)
        .map((a) => ParentLinkSchema.parse({
          athleteId: a.id, firstName: a.firstName, lastName: a.lastName, ageStatus: parentLinkAgeStatus(a.birthdate, today),
        }));
    },

    async addLink(targetUserId: string, athleteId: string, requester: RequesterContext): Promise<void> {
      const target = await deps.users.findById(targetUserId);
      if (!target || target.clubId !== requester.clubId) throw new ParentNotInClubError();
      if (!target.roles.includes('parent')) throw new UserNotParentError();

      const athlete = await deps.athletes.findById(athleteId);
      if (!athlete || athlete.clubId !== requester.clubId) throw new AthleteNotInClubError();

      await deps.parentLinks.create(targetUserId, athleteId);
      // Eine Verknüpfung gibt dem Elternkonto Zugriff auf die Daten des Kindes.
      await deps.auditLog.record({
        clubId: requester.clubId,
        actorId: requester.id,
        action: 'parentLink.added',
        targetId: targetUserId,
        metadata: { athleteId },
      });
    },

    async removeLink(targetUserId: string, athleteId: string, requester: RequesterContext): Promise<void> {
      const target = await deps.users.findById(targetUserId);
      if (!target || target.clubId !== requester.clubId) throw new ParentNotInClubError();
      await deps.parentLinks.remove(targetUserId, athleteId);
      await deps.auditLog.record({
        clubId: requester.clubId,
        actorId: requester.id,
        action: 'parentLink.removed',
        targetId: targetUserId,
        metadata: { athleteId },
      });
    },
  };
}
export type ParentsService = ReturnType<typeof createParentsService>;
