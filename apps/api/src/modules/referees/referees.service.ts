// apps/api/src/modules/referees/referees.service.ts
//
// Geschäftslogik für Wettkampfeinsätze von Kampfrichter:innen (docs/
// kampfrichter-modul-plan.md, Abschnitt 5). Zentrale Entscheidung aus dem
// Plan (Abschnitt 5.5, abweichend vom Muster bei Qualifikationen): eine
// Kampfrichter:in verwaltet ihre eigenen Einsätze SELBST (createOwn/
// updateOwn/removeOwn), zusätzlich darf `admin` im eigenen Verein Einsätze
// im Namen einer Kampfrichter:in verwalten (createForMember/
// updateForMember/removeForMember) — jeder admin-seitig angelegte oder
// bearbeitete Eintrag setzt createdByAdminId als reines Herkunfts-Audit.
import type {
  RefereeAssignmentRepository,
  RefereeAssignmentRecord,
  CompetitionRepository,
} from './referees.repository.js';
import type { UserRepository } from '../auth/auth.repository.js';
import { UserNotFoundError } from '../auth/auth.service.js';

export class RefereeAssignmentNotFoundError extends Error {
  constructor() {
    super('Wettkampfeinsatz wurde nicht gefunden.');
  }
}
export class RefereeAssignmentForbiddenError extends Error {
  constructor(message = 'Für diese Aktion fehlt die Berechtigung.') {
    super(message);
  }
}
// Ein mitgeschicktes competitionId muss zu einem Wettkampf des EIGENEN
// Vereins gehören — Kampfrichter:innen amtieren zwar häufig bei fremden
// Wettkämpfen (siehe Plan Abschnitt 5.1), diese existieren dann aber gar
// nicht als Competition-Datensatz (nur als Freitext); ein tatsächlich
// referenziertes competitionId eines FREMDEN Vereins wäre dagegen ein
// Hinweis auf einen manipulierten Client.
export class ForeignCompetitionError extends Error {
  constructor() {
    super('Der referenzierte Wettkampf gehört nicht zum eigenen Verein.');
  }
}

export interface RequesterContext {
  id: string;
  roles: string[]; // Teilmenge von 'admin' | 'referee' (u. a.) — superadmin erreicht diesen Service nie
  clubId: string | null;
}

export interface CreateAssignmentInput {
  competitionName: string;
  competitionPlace: string;
  competitionId: string | null;
  date: Date;
  function: string;
  note: string;
}

export interface UpdateAssignmentInput {
  competitionName?: string;
  competitionPlace?: string;
  competitionId?: string | null;
  date?: Date;
  function?: string;
  note?: string;
}

export interface RefereesServiceDeps {
  assignments: RefereeAssignmentRepository;
  // Nur für den Blick auf clubId/Existenz der Zielperson — keine sonstige
  // Nutzerverwaltung gehört in diesen Service (analog
  // qualifications.service.ts: QualificationsServiceDeps.users).
  users: UserRepository;
  competitions: CompetitionRepository;
}

// Entfernt `deletedAt` aus der Antwort — reine interne Buchhaltung ohne
// legitimen Grund, sie über die API auszuliefern (Datenminimierung, analog
// toPublic() in qualifications.service.ts).
function toPublic(row: RefereeAssignmentRecord): Omit<RefereeAssignmentRecord, 'deletedAt'> {
  const { deletedAt: _deletedAt, ...publicRow } = row;
  return publicRow;
}

export function createRefereesService(deps: RefereesServiceDeps) {
  async function assertCompetitionWithinClub(competitionId: string | null | undefined, clubId: string) {
    if (!competitionId) return;
    const competition = await deps.competitions.findById(competitionId);
    if (!competition || competition.clubId !== clubId) throw new ForeignCompetitionError();
  }

  async function requireAdminOfSameClub(requester: RequesterContext, targetUserId: string) {
    if (!requester.roles.includes('admin') || !requester.clubId) {
      throw new RefereeAssignmentForbiddenError('Nur Admins dürfen Wettkampfeinsätze anderer Vereinsmitglieder verwalten.');
    }
    const targetUser = await deps.users.findById(targetUserId);
    if (!targetUser) throw new UserNotFoundError();
    if (targetUser.clubId !== requester.clubId) {
      throw new RefereeAssignmentForbiddenError('Diese Person gehört nicht zu Ihrem Verein.');
    }
    return targetUser;
  }

  async function findOwnedOrThrow(targetUserId: string, id: string): Promise<RefereeAssignmentRecord> {
    const existing = await deps.assignments.findById(id);
    if (!existing || existing.userId !== targetUserId || existing.deletedAt) throw new RefereeAssignmentNotFoundError();
    return existing;
  }

  return {
    // GET /api/me/referee-assignments — die Kampfrichter:in sieht nur die
    // eigenen Einsätze.
    async listOwn(requester: RequesterContext) {
      return (await deps.assignments.listByUser(requester.id)).map(toPublic);
    },

    // POST /api/me/referee-assignments — Selbsterfassung.
    async createOwn(input: CreateAssignmentInput, requester: RequesterContext) {
      if (!requester.clubId) throw new RefereeAssignmentForbiddenError('Für diese Aktion ist ein Verein erforderlich.');
      await assertCompetitionWithinClub(input.competitionId, requester.clubId);
      const created = await deps.assignments.create({
        userId: requester.id,
        clubId: requester.clubId,
        createdByAdminId: null,
        ...input,
      });
      return toPublic(created);
    },

    // PATCH /api/me/referee-assignments/:id — createdByAdminId bleibt bei
    // einer Selbstbearbeitung bewusst unverändert (siehe Plan
    // Abschnitt 5.5).
    async updateOwn(id: string, patch: UpdateAssignmentInput, requester: RequesterContext) {
      const existing = await findOwnedOrThrow(requester.id, id);
      if (patch.competitionId !== undefined) await assertCompetitionWithinClub(patch.competitionId, existing.clubId);
      const updated = await deps.assignments.update(id, patch);
      return toPublic(updated);
    },

    // DELETE /api/me/referee-assignments/:id
    async removeOwn(id: string, requester: RequesterContext): Promise<void> {
      await findOwnedOrThrow(requester.id, id);
      await deps.assignments.softDelete(id);
    },

    // GET /api/users/:userId/referee-assignments — nur admin, für
    // Mitglieder des eigenen Vereins.
    async listForMember(targetUserId: string, requester: RequesterContext) {
      await requireAdminOfSameClub(requester, targetUserId);
      return (await deps.assignments.listByUser(targetUserId)).map(toPublic);
    },

    // POST /api/users/:userId/referee-assignments — Erfassung "im Namen
    // von" (Plan Abschnitt 5.5).
    async createForMember(targetUserId: string, input: CreateAssignmentInput, requester: RequesterContext) {
      const targetUser = await requireAdminOfSameClub(requester, targetUserId);
      await assertCompetitionWithinClub(input.competitionId, targetUser.clubId!);
      const created = await deps.assignments.create({
        userId: targetUserId,
        clubId: targetUser.clubId!,
        createdByAdminId: requester.id,
        ...input,
      });
      return toPublic(created);
    },

    // PATCH /api/users/:userId/referee-assignments/:id — createdByAdminId
    // wird auf die handelnde admin-Person aktualisiert (Plan Abschnitt 5.5:
    // "oder zuletzt bearbeitete").
    async updateForMember(targetUserId: string, id: string, patch: UpdateAssignmentInput, requester: RequesterContext) {
      await requireAdminOfSameClub(requester, targetUserId);
      const existing = await findOwnedOrThrow(targetUserId, id);
      if (patch.competitionId !== undefined) await assertCompetitionWithinClub(patch.competitionId, existing.clubId);
      const updated = await deps.assignments.update(id, { ...patch, createdByAdminId: requester.id });
      return toPublic(updated);
    },

    // DELETE /api/users/:userId/referee-assignments/:id
    async removeForMember(targetUserId: string, id: string, requester: RequesterContext): Promise<void> {
      await requireAdminOfSameClub(requester, targetUserId);
      await findOwnedOrThrow(targetUserId, id);
      await deps.assignments.softDelete(id);
    },
  };
}

export type RefereesService = ReturnType<typeof createRefereesService>;
