// apps/api/src/modules/qualifications/qualifications.service.ts
//
// Geschäftslogik für das Qualifikationsmanagement (docs/
// nutzer-qualifikationen-plan.md). Zentrale Entscheidungen aus dem Plan:
//   - Ausschließlich `admin` legt Qualifikationen von Vereinsmitgliedern an/
//     bearbeitet/löscht sie (Entscheidung zu Frage 2) — jede Person sieht
//     über listOwn() nur lesend die eigenen.
//   - `superadmin` kommt hier nie an (kein eigener Verein, siehe
//     requireRole('admin', 'trainer', 'athlete') in qualifications.route.ts
//     — Entscheidung zu Frage 5).
//   - Erinnerungs-Schwellen sind je Verein/Typ konfigurierbar (Abschnitt 2.4).
import type {
  UserQualificationRepository,
  UserQualificationRecord,
  QualificationReminderSettingRepository,
} from './qualifications.repository.js';
import type { UserRepository } from '../auth/auth.repository.js';
import { UserNotFoundError } from '../auth/auth.service.js';

export class QualificationNotFoundError extends Error {
  constructor() {
    super('Qualifikation wurde nicht gefunden.');
  }
}
export class QualificationForbiddenError extends Error {
  constructor(message = 'Für diese Aktion fehlt die Berechtigung.') {
    super(message);
  }
}
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

export interface RequesterContext {
  id: string;
  role: string; // 'admin' | 'trainer' | 'athlete' (superadmin erreicht diesen Service nie)
  clubId: string | null;
}

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
}

// Entfernt `deletedAt` aus der Antwort — reine interne Buchhaltung ohne
// legitimen Grund, sie über die API auszuliefern (Datenminimierung, analog
// toPublicInvitation() in invitations.service.ts).
function toPublic(row: UserQualificationRecord): Omit<UserQualificationRecord, 'deletedAt'> {
  const { deletedAt: _deletedAt, ...publicRow } = row;
  return publicRow;
}

async function requireAdminOfSameClub(deps: QualificationsServiceDeps, requester: RequesterContext, targetUserId: string) {
  if (requester.role !== 'admin' || !requester.clubId) {
    throw new QualificationForbiddenError('Nur Admins dürfen Qualifikationen von Vereinsmitgliedern verwalten.');
  }
  const targetUser = await deps.users.findById(targetUserId);
  if (!targetUser) throw new UserNotFoundError();
  if (targetUser.clubId !== requester.clubId) {
    throw new QualificationForbiddenError('Diese Person gehört nicht zu Ihrem Verein.');
  }
  return targetUser;
}

async function findOwnedOrThrow(deps: QualificationsServiceDeps, targetUserId: string, id: string): Promise<UserQualificationRecord> {
  const existing = await deps.qualifications.findById(id);
  if (!existing || existing.userId !== targetUserId || existing.deletedAt) throw new QualificationNotFoundError();
  return existing;
}

function assertChronology(acquiredOn: Date, expiresOn: Date | null) {
  if (expiresOn && expiresOn.getTime() < acquiredOn.getTime()) throw new QualificationInvalidDateRangeError();
}

export function createQualificationsService(deps: QualificationsServiceDeps) {
  return {
    // GET /api/me/qualifications — jede angemeldete Person (admin/trainer/
    // athlete) sieht nur lesend die eigenen.
    async listOwn(requester: RequesterContext) {
      return (await deps.qualifications.listByUser(requester.id)).map(toPublic);
    },

    // GET /api/users/:userId/qualifications — nur admin, für Mitglieder des
    // eigenen Vereins.
    async listForMember(targetUserId: string, requester: RequesterContext) {
      await requireAdminOfSameClub(deps, requester, targetUserId);
      return (await deps.qualifications.listByUser(targetUserId)).map(toPublic);
    },

    async create(targetUserId: string, input: CreateQualificationInput, requester: RequesterContext) {
      await requireAdminOfSameClub(deps, requester, targetUserId);
      assertChronology(input.acquiredOn, input.expiresOn);
      const created = await deps.qualifications.create({ userId: targetUserId, ...input });
      return toPublic(created);
    },

    async update(targetUserId: string, id: string, patch: UpdateQualificationInput, requester: RequesterContext) {
      await requireAdminOfSameClub(deps, requester, targetUserId);
      const existing = await findOwnedOrThrow(deps, targetUserId, id);
      const mergedAcquiredOn = patch.acquiredOn ?? existing.acquiredOn;
      const mergedExpiresOn = patch.expiresOn !== undefined ? patch.expiresOn : existing.expiresOn;
      assertChronology(mergedAcquiredOn, mergedExpiresOn);
      const updated = await deps.qualifications.update(id, patch);
      return toPublic(updated);
    },

    async remove(targetUserId: string, id: string, requester: RequesterContext): Promise<void> {
      await requireAdminOfSameClub(deps, requester, targetUserId);
      await findOwnedOrThrow(deps, targetUserId, id);
      await deps.qualifications.softDelete(id);
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
      if (!requester.clubId) {
        throw new QualificationForbiddenError('Für diese Aktion ist ein Verein erforderlich.');
      }
      const rows = await deps.reminderSettings.listByClub(requester.clubId);
      return rows.map((r) => ({ type: r.type, thresholdsDays: r.thresholdsDays }));
    },

    // PUT /api/qualification-settings/:type — nur admin, immer für den
    // eigenen Verein (keine clubId im Request — analog /api/me/*).
    async setReminderSetting(type: string, thresholdsDays: number[], requester: RequesterContext) {
      if (requester.role !== 'admin' || !requester.clubId) {
        throw new QualificationForbiddenError('Nur Admins dürfen die Erinnerungs-Schwellen ändern.');
      }
      const row = await deps.reminderSettings.upsert(requester.clubId, type, thresholdsDays);
      return { type: row.type, thresholdsDays: row.thresholdsDays };
    },
  };
}

export type QualificationsService = ReturnType<typeof createQualificationsService>;
