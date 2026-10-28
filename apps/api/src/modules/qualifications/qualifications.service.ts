// Geschäftslogik für das Qualifikationsmanagement (docs/
// nutzer-qualifikationen-plan.md). Zentrale Entscheidungen aus dem Plan:
//   - Ausschließlich `admin` legt Qualifikationen von Vereinsmitgliedern an/
//     bearbeitet/löscht sie (Entscheidung zu Frage 2) — jede Person sieht
//     über listOwn() nur lesend die eigenen.
//   - `superadmin` kommt hier nie an (kein eigener Verein, siehe
//     requireAnyRole('admin', 'trainer', 'athlete', 'referee') in
//     qualifications.route.ts — Entscheidung zu Frage 5).
//   - Erinnerungs-Schwellen sind je Verein/Typ konfigurierbar (Abschnitt 2.4).
import type {
  UserQualificationRepository,
  UserQualificationRecord,
  QualificationReminderSettingRepository,
} from './qualifications.repository.js';
import type { UserRepository } from '../auth/auth.repository.js';
import type { AuditLogWriter } from '../auditLog/auditLog.service.js';
import type { Requester } from '../../plugins/requester.js';
import { ForbiddenError } from '../shared/errors.js';
import { requireClub, requireClubAdmin, requireAdminOfSameClub, withoutDeletedAt, findActiveOwnedOrThrow } from '../shared/clubAccess.js';

export class QualificationNotFoundError extends Error {
  constructor() {
    super('Qualifikation wurde nicht gefunden.');
  }
}
export class QualificationForbiddenError extends ForbiddenError {}
// Cross-Field-Prüfung auf dem MERGE aus bestehendem Datensatz + Patch (siehe
// update() unten) — CreateUserQualificationRequestSchema deckt denselben
// Fall beim Anlegen bereits über sein eigenes .refine() ab (siehe
// packages/shared-types/src/qualification.ts), ein PATCH kennt die
// bestehenden Werte aber erst nach dem Laden des Datensatzes.
export class QualificationInvalidDateRangeError extends Error {
  constructor() {
    super('expiresOn darf nicht vor acquiredOn liegen.');
  }
}

// superadmin erreicht diesen Service nie (siehe requireAnyRole() in
// qualifications.route.ts).
export type RequesterContext = Requester;

export interface CreateQualificationInput {
  type: string;
  note: string;
  acquiredOn: Date;
  expiresOn: Date | null;
  renewalCourseOrganizedOn: Date | null;
}

export interface UpdateQualificationInput {
  type?: string;
  note?: string;
  acquiredOn?: Date;
  expiresOn?: Date | null;
  renewalCourseOrganizedOn?: Date | null;
}

export interface QualificationsServiceDeps {
  qualifications: UserQualificationRepository;
  reminderSettings: QualificationReminderSettingRepository;
  // Nur für den Blick auf clubId/Existenz der Zielperson — keine sonstige
  // Nutzerverwaltung gehört in diesen Service (analog invitations.service.ts:
  // InvitationsServiceDeps.users).
  users: UserRepository;
  auditLog: AuditLogWriter;
}

const NOT_ADMIN_MESSAGE = 'Nur Admins dürfen Qualifikationen von Vereinsmitgliedern verwalten.';

function requireAdminForMember(deps: QualificationsServiceDeps, requester: RequesterContext, targetUserId: string) {
  return requireAdminOfSameClub(deps.users, requester, targetUserId, NOT_ADMIN_MESSAGE, QualificationForbiddenError);
}

function findOwnedOrThrow(deps: QualificationsServiceDeps, targetUserId: string, id: string): Promise<UserQualificationRecord> {
  return findActiveOwnedOrThrow(deps.qualifications, targetUserId, id, QualificationNotFoundError);
}

// Nur die Admin-Pfade (Qualifikationen ANDERER Mitglieder) landen im
// Audit-Log; es gibt keinen Selbstbedienungs-Schreibpfad.
async function recordMemberChange(
  deps: QualificationsServiceDeps,
  requester: RequesterContext,
  targetUserId: string,
  action: 'qualification.created' | 'qualification.updated' | 'qualification.deleted',
  metadata: Record<string, unknown>,
) {
  await deps.auditLog.record({ clubId: requester.clubId, actorId: requester.id, action, targetId: targetUserId, metadata });
}

function assertChronology(acquiredOn: Date, expiresOn: Date | null) {
  if (expiresOn && expiresOn.getTime() < acquiredOn.getTime()) throw new QualificationInvalidDateRangeError();
}

export function createQualificationsService(deps: QualificationsServiceDeps) {
  return {
    // GET /api/me/qualifications — jede angemeldete Person (admin/trainer/
    // athlete) sieht nur lesend die eigenen.
    async listOwn(requester: RequesterContext) {
      return (await deps.qualifications.listByUser(requester.id)).map(withoutDeletedAt);
    },

    // GET /api/users/:userId/qualifications — nur admin, für Mitglieder des
    // eigenen Vereins.
    async listForMember(targetUserId: string, requester: RequesterContext) {
      await requireAdminForMember(deps, requester, targetUserId);
      return (await deps.qualifications.listByUser(targetUserId)).map(withoutDeletedAt);
    },

    async create(targetUserId: string, input: CreateQualificationInput, requester: RequesterContext) {
      await requireAdminForMember(deps, requester, targetUserId);
      assertChronology(input.acquiredOn, input.expiresOn);
      const created = await deps.qualifications.create({ userId: targetUserId, ...input });
      await recordMemberChange(deps, requester, targetUserId, 'qualification.created', { qualificationId: created.id, type: created.type });
      return withoutDeletedAt(created);
    },

    async update(targetUserId: string, id: string, patch: UpdateQualificationInput, requester: RequesterContext) {
      await requireAdminForMember(deps, requester, targetUserId);
      const existing = await findOwnedOrThrow(deps, targetUserId, id);
      const mergedAcquiredOn = patch.acquiredOn ?? existing.acquiredOn;
      const mergedExpiresOn = patch.expiresOn !== undefined ? patch.expiresOn : existing.expiresOn;
      assertChronology(mergedAcquiredOn, mergedExpiresOn);
      const updated = await deps.qualifications.update(id, patch);
      await recordMemberChange(deps, requester, targetUserId, 'qualification.updated', { qualificationId: id, type: updated.type });
      return withoutDeletedAt(updated);
    },

    async remove(targetUserId: string, id: string, requester: RequesterContext): Promise<void> {
      await requireAdminForMember(deps, requester, targetUserId);
      const existing = await findOwnedOrThrow(deps, targetUserId, id);
      await deps.qualifications.softDelete(id);
      await recordMemberChange(deps, requester, targetUserId, 'qualification.deleted', { qualificationId: id, type: existing.type });
    },

    // GET /api/qualification-settings — Erinnerungs-Schwellen des EIGENEN
    // Vereins (Abschnitt 2.4). Bewusst LESEND für jede Rolle (nicht nur
    // admin, anders als beim Schreiben unten): trainer/athlete brauchen die
    // konfigurierten Schwellen, um den Status-Badge der EIGENEN
    // Qualifikationen (Abschnitt 4.2) korrekt zu berechnen — ohne
    // Lesezugriff bekäme das Frontend hier stets ein leeres Ergebnis und
    // würde jede Qualifikation fälschlich als "gültig" statt z. B. "läuft
    // bald ab" anzeigen, sobald die Schwellen vom Standardwert abweichen.
    async listReminderSettings(requester: RequesterContext) {
      requireClub(requester, undefined, QualificationForbiddenError);
      const rows = await deps.reminderSettings.listByClub(requester.clubId);
      return rows.map((r) => ({ type: r.type, thresholdsDays: r.thresholdsDays }));
    },

    // PUT /api/qualification-settings/:type — nur admin, immer für den
    // eigenen Verein (keine clubId im Request — analog /api/me/*).
    async setReminderSetting(type: string, thresholdsDays: number[], requester: RequesterContext) {
      requireClubAdmin(requester, 'Nur Admins dürfen die Erinnerungs-Schwellen ändern.', QualificationForbiddenError);
      const row = await deps.reminderSettings.upsert(requester.clubId, type, thresholdsDays);
      return { type: row.type, thresholdsDays: row.thresholdsDays };
    },
  };
}

export type QualificationsService = ReturnType<typeof createQualificationsService>;
