// Geschäftslogik für die rechtlichen Vereinsangaben (Impressum § 5 DDG +
// Datenschutzhinweis Art. 13 DSGVO), siehe docs/Plans/club-legal-info-plan.md.
//
// Zugriffsmatrix:
//   - get(): JEDES authentifizierte Mitglied des EIGENEN Vereins (jede
//     Rolle — admin/trainer/athlete/referee/parent), da die Angaben Teil
//     des für alle sichtbaren Rechtstexts sind (siehe info.js). Ein
//     Superadmin darf jeden Verein abfragen (hat selbst keinen eigenen).
//     Bewusst KEIN unauthentifizierter Zugriff (siehe Abgrenzung zur
//     weiterhin generischen, öffentlichen Vorab-Anzeige in
//     authScreens.js) — bestätigt mit dem Auftraggeber: der Endpunkt ist
//     nur "von innerhalb des Vereins" erreichbar.
//   - update(): nur admin (ausschließlich der EIGENE Verein) oder
//     superadmin (jeder Verein) — exakte Kopie der Zugriffsprüfung aus
//     invitations.service.ts: updateClubIdentity().
import type { ClubLegalInfoRepository, ClubLegalInfoRecord, UpdateClubLegalInfoInput } from './clubLegalInfo.repository.js';
import { ForbiddenError, ClubNotFoundError } from '../invitations/invitations.service.js';
import type { AuditLogWriter } from '../auditLog/auditLog.service.js';

export interface RequesterContext {
  id: string;
  roles: string[];
  clubId: string | null;
}

export interface ClubLegalInfoServiceDeps {
  legalInfo: ClubLegalInfoRepository;
  auditLog: AuditLogWriter;
}

export function createClubLegalInfoService(deps: ClubLegalInfoServiceDeps) {
  return {
    async get(clubId: string, requester: RequesterContext): Promise<ClubLegalInfoRecord> {
      if (!requester.roles.includes('superadmin') && requester.clubId !== clubId) {
        throw new ForbiddenError('Rechtliche Angaben können nur für den eigenen Verein abgerufen werden.');
      }
      const record = await deps.legalInfo.findByClubId(clubId);
      if (!record) throw new ClubNotFoundError();
      return record;
    },

    async update(clubId: string, data: UpdateClubLegalInfoInput, requester: RequesterContext): Promise<ClubLegalInfoRecord> {
      if (requester.roles.includes('admin') && requester.clubId !== clubId) {
        throw new ForbiddenError('Admins dürfen nur die rechtlichen Angaben des eigenen Vereins ändern.');
      }
      const existing = await deps.legalInfo.findByClubId(clubId);
      if (!existing) throw new ClubNotFoundError();
      const updated = await deps.legalInfo.update(clubId, data);
      // Nur die Namen der tatsächlich geänderten Felder, nicht die Inhalte:
      // Impressum/Datenschutzhinweis sind lang und ohnehin im Verein sichtbar.
      // Das Formular schickt stets alle Felder mit, daher der Vergleich.
      const before = existing as unknown as Record<string, unknown>;
      const changedFields = Object.entries(data)
        .filter(([key, value]) => value !== undefined && before[key] !== value)
        .map(([key]) => key);
      if (changedFields.length === 0) return updated;
      await deps.auditLog.record({
        clubId,
        actorId: requester.id,
        action: 'club.legalInfoChanged',
        targetId: clubId,
        targetLabel: '',
        metadata: { fields: changedFields },
      });
      return updated;
    },
  };
}

export type ClubLegalInfoService = ReturnType<typeof createClubLegalInfoService>;
