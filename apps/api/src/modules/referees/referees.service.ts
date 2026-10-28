// Geschäftslogik für Wettkampfeinsätze von Kampfrichter:innen (docs/
// kampfrichter-modul-plan.md, Abschnitt 5). Zentrale Entscheidung aus dem
// Plan (Abschnitt 5.5, abweichend vom Muster bei Qualifikationen): eine
// Kampfrichter:in verwaltet ihre eigenen Einsätze SELBST (createOwn/
// updateOwn/removeOwn), zusätzlich darf `admin` im eigenen Verein Einsätze
// im Namen einer Kampfrichter:in verwalten (createForMember/
// updateForMember/removeForMember) — jeder admin-seitig angelegte oder
// bearbeitete Eintrag setzt createdByAdminId als reines Herkunfts-Audit.
//
// Rückmeldung: ein admin-seitig angelegter Einsatz ist eine Anfrage
// (status "requested"), die die Kampfrichter:in über respondOwn() zu- oder
// absagt. Ändert ein admin später Datum, Wettkampf, Ort oder Funktion, gilt
// die Anfrage als neu und muss erneut beantwortet werden. Selbst erfasste
// Einsätze sind sofort "confirmed".
import type {
  RefereeAssignmentRepository,
  RefereeAssignmentRecord,
  CompetitionRepository,
} from './referees.repository.js';
import type { UserRepository } from '../auth/auth.repository.js';
import type { AuditLogWriter } from '../auditLog/auditLog.service.js';
import type { Requester } from '../../plugins/requester.js';
import { ForbiddenError } from '../shared/errors.js';
import { requireClub, requireClubAdmin, requireAdminOfSameClub, withoutDeletedAt, findActiveOwnedOrThrow } from '../shared/clubAccess.js';
import type { RefereeNotifier } from './referees.notify.js';

export class RefereeAssignmentNotFoundError extends Error {
  constructor() {
    super('Wettkampfeinsatz wurde nicht gefunden.');
  }
}
export class RefereeAssignmentForbiddenError extends ForbiddenError {}
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

// superadmin erreicht diesen Service nie (siehe requireAnyRole() in
// referees.route.ts).
export type RequesterContext = Requester;

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

export interface RespondInput {
  status: 'confirmed' | 'declined';
  responseNote: string;
}

// Felder, deren Änderung durch einen admin eine erneute Rückmeldung
// verlangt — eine reine Notiz-Änderung nicht.
const KEY_FIELDS = ['competitionName', 'competitionPlace', 'competitionId', 'date', 'function'] as const;

function keyFieldsChanged(existing: RefereeAssignmentRecord, patch: UpdateAssignmentInput): boolean {
  return KEY_FIELDS.some((field) => {
    const next = patch[field];
    if (next === undefined) return false;
    const prev = existing[field];
    if (next instanceof Date && prev instanceof Date) return next.getTime() !== prev.getTime();
    return next !== prev;
  });
}

export interface RefereesServiceDeps {
  assignments: RefereeAssignmentRepository;
  // Nur für den Blick auf clubId/Existenz der Zielperson — keine sonstige
  // Nutzerverwaltung gehört in diesen Service (analog
  // qualifications.service.ts: QualificationsServiceDeps.users).
  users: UserRepository;
  competitions: CompetitionRepository;
  auditLog: AuditLogWriter;
  // Push-Benachrichtigungen zu Anfragen/Antworten — optional (Tests, oder
  // ohne Push-Konfiguration).
  notify?: RefereeNotifier;
  onNotifyError?: (error: unknown) => void;
}

export function createRefereesService(deps: RefereesServiceDeps) {
  // Benachrichtigungen sind best effort: ein Fehler beim Versand darf die
  // bereits gespeicherte Anfrage/Antwort nicht als gescheitert melden.
  async function notifySafely(send: (notify: RefereeNotifier) => Promise<void>) {
    if (!deps.notify) return;
    try {
      await send(deps.notify);
    } catch (error) {
      deps.onNotifyError?.(error);
    }
  }

  async function assertCompetitionWithinClub(competitionId: string | null | undefined, clubId: string) {
    if (!competitionId) return;
    const competition = await deps.competitions.findById(competitionId);
    if (!competition || competition.clubId !== clubId) throw new ForeignCompetitionError();
  }

  function requireAdminForMember(requester: RequesterContext, targetUserId: string) {
    return requireAdminOfSameClub(
      deps.users,
      requester,
      targetUserId,
      'Nur Admins dürfen Wettkampfeinsätze anderer Vereinsmitglieder verwalten.',
      RefereeAssignmentForbiddenError,
    );
  }

  // Nur die Admin-Pfade ("im Namen von", Plan Abschnitt 5.5) landen im
  // Audit-Log — die Selbsterfassung eigener Einsätze nicht.
  async function recordMemberChange(
    requester: RequesterContext,
    targetUserId: string,
    action: 'refereeAssignment.created' | 'refereeAssignment.updated' | 'refereeAssignment.deleted',
    assignment: RefereeAssignmentRecord,
  ) {
    await deps.auditLog.record({
      clubId: requester.clubId,
      actorId: requester.id,
      action,
      targetId: targetUserId,
      metadata: { assignmentId: assignment.id, competitionName: assignment.competitionName, date: assignment.date.toISOString() },
    });
  }

  function findOwnedOrThrow(targetUserId: string, id: string): Promise<RefereeAssignmentRecord> {
    return findActiveOwnedOrThrow(deps.assignments, targetUserId, id, RefereeAssignmentNotFoundError);
  }

  return {
    // GET /api/me/referee-assignments — die Kampfrichter:in sieht nur die
    // eigenen Einsätze.
    async listOwn(requester: RequesterContext) {
      return (await deps.assignments.listByUser(requester.id)).map(withoutDeletedAt);
    },

    // POST /api/me/referee-assignments — Selbsterfassung.
    async createOwn(input: CreateAssignmentInput, requester: RequesterContext) {
      requireClub(requester, undefined, RefereeAssignmentForbiddenError);
      await assertCompetitionWithinClub(input.competitionId, requester.clubId);
      const created = await deps.assignments.create({
        userId: requester.id,
        clubId: requester.clubId,
        createdByAdminId: null,
        status: 'confirmed',
        ...input,
      });
      return withoutDeletedAt(created);
    },

    // PATCH /api/me/referee-assignments/:id — createdByAdminId bleibt bei
    // einer Selbstbearbeitung bewusst unverändert (siehe Plan
    // Abschnitt 5.5).
    async updateOwn(id: string, patch: UpdateAssignmentInput, requester: RequesterContext) {
      const existing = await findOwnedOrThrow(requester.id, id);
      if (patch.competitionId !== undefined) await assertCompetitionWithinClub(patch.competitionId, existing.clubId);
      const updated = await deps.assignments.update(id, patch);
      return withoutDeletedAt(updated);
    },

    // POST /api/me/referee-assignments/:id/response — Zu- oder Absage;
    // die Antwort darf später geändert werden (z. B. kurzfristig absagen).
    async respondOwn(id: string, input: RespondInput, requester: RequesterContext) {
      const { status: prevStatus, responseNote: prevNote } = await findOwnedOrThrow(requester.id, id);
      const updated = await deps.assignments.update(id, { status: input.status, responseNote: input.responseNote, respondedAt: new Date() });
      if (prevStatus !== updated.status || prevNote !== updated.responseNote) {
        const referee = await deps.users.findById(requester.id);
        await notifySafely((n) => n.assignmentAnswered(updated, referee?.name ?? 'Kampfrichter:in'));
      }
      return withoutDeletedAt(updated);
    },

    // DELETE /api/me/referee-assignments/:id
    async removeOwn(id: string, requester: RequesterContext): Promise<void> {
      await findOwnedOrThrow(requester.id, id);
      await deps.assignments.softDelete(id);
    },

    // GET /api/users/:userId/referee-assignments — nur admin, für
    // Mitglieder des eigenen Vereins.
    async listForMember(targetUserId: string, requester: RequesterContext) {
      await requireAdminForMember(requester, targetUserId);
      return (await deps.assignments.listByUser(targetUserId)).map(withoutDeletedAt);
    },

    // GET /api/referee-assignments/upcoming — nur admin: alle kommenden
    // Einsätze des eigenen Vereins (ab heute, UTC), damit offene Anfragen
    // und Absagen auf einen Blick sichtbar sind.
    async listUpcomingForClub(requester: RequesterContext, now = new Date()) {
      requireClubAdmin(requester, 'Nur Admins dürfen die Einsätze des Vereins einsehen.', RefereeAssignmentForbiddenError);
      const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      return (await deps.assignments.listUpcomingByClub(requester.clubId, today)).map(withoutDeletedAt);
    },

    // GET /api/competitions/:competitionId/referee-assignments — nur admin:
    // das Kampfgericht des Vereins für einen eigenen Wettkampf (Abgleich
    // mit Competition.refereesRequired). Ein fremder oder unbekannter
    // Wettkampf wird wie beim Anlegen abgelehnt.
    async listForCompetition(competitionId: string, requester: RequesterContext) {
      requireClubAdmin(requester, 'Nur Admins dürfen das Kampfgericht eines Wettkampfs einsehen.', RefereeAssignmentForbiddenError);
      await assertCompetitionWithinClub(competitionId, requester.clubId);
      return (await deps.assignments.listByCompetition(competitionId)).map(withoutDeletedAt);
    },

    // POST /api/users/:userId/referee-assignments — Erfassung "im Namen
    // von" (Plan Abschnitt 5.5).
    async createForMember(targetUserId: string, input: CreateAssignmentInput, requester: RequesterContext) {
      const targetUser = await requireAdminForMember(requester, targetUserId);
      await assertCompetitionWithinClub(input.competitionId, targetUser.clubId!);
      // Trägt ein admin mit eigener referee-Rolle sich selbst ein, gibt es
      // niemanden, der noch zusagen müsste.
      const self = targetUserId === requester.id;
      const created = await deps.assignments.create({
        userId: targetUserId,
        clubId: targetUser.clubId!,
        createdByAdminId: requester.id,
        status: self ? 'confirmed' : 'requested',
        ...input,
      });
      await recordMemberChange(requester, targetUserId, 'refereeAssignment.created', created);
      if (!self) await notifySafely((n) => n.assignmentRequested(created));
      return withoutDeletedAt(created);
    },

    // PATCH /api/users/:userId/referee-assignments/:id — createdByAdminId
    // wird auf die handelnde admin-Person aktualisiert (Plan Abschnitt 5.5:
    // "oder zuletzt bearbeitete").
    async updateForMember(targetUserId: string, id: string, patch: UpdateAssignmentInput, requester: RequesterContext) {
      await requireAdminForMember(requester, targetUserId);
      const existing = await findOwnedOrThrow(targetUserId, id);
      if (patch.competitionId !== undefined) await assertCompetitionWithinClub(patch.competitionId, existing.clubId);
      const reRequest = targetUserId !== requester.id && keyFieldsChanged(existing, patch);
      const updated = await deps.assignments.update(id, {
        ...patch,
        createdByAdminId: requester.id,
        ...(reRequest ? { status: 'requested', responseNote: '', respondedAt: null } : {}),
      });
      await recordMemberChange(requester, targetUserId, 'refereeAssignment.updated', updated);
      if (reRequest) await notifySafely((n) => n.assignmentRequested(updated));
      return withoutDeletedAt(updated);
    },

    // DELETE /api/users/:userId/referee-assignments/:id
    async removeForMember(targetUserId: string, id: string, requester: RequesterContext): Promise<void> {
      await requireAdminForMember(requester, targetUserId);
      const existing = await findOwnedOrThrow(targetUserId, id);
      await deps.assignments.softDelete(id);
      await recordMemberChange(requester, targetUserId, 'refereeAssignment.deleted', existing);
    },
  };
}

export type RefereesService = ReturnType<typeof createRefereesService>;
