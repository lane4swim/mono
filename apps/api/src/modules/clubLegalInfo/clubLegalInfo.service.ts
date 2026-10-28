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
//     superadmin (jeder Verein) — dieselbe zentrale Prüfung
//     (shared/clubAccess.ts: requireClubAdminOrSuperadmin()) wie
//     invitations.service.ts: updateClubIdentity().
import type { ClubLegalInfoRepository, ClubLegalInfoRecord, UpdateClubLegalInfoInput } from './clubLegalInfo.repository.js';
import { ClubNotFoundError } from '../invitations/invitations.service.js';
import { requireOwnClubOrSuperadmin, requireClubAdminOrSuperadmin } from '../shared/clubAccess.js';
import type { Requester } from '../../plugins/requester.js';
import type { AuditLogWriter } from '../auditLog/auditLog.service.js';

export type RequesterContext = Requester;

export interface ClubLegalInfoServiceDeps {
  legalInfo: ClubLegalInfoRepository;
  auditLog: AuditLogWriter;
}

export function createClubLegalInfoService(deps: ClubLegalInfoServiceDeps) {
  return {
    async get(clubId: string, requester: RequesterContext): Promise<ClubLegalInfoRecord> {
      requireOwnClubOrSuperadmin(requester, clubId, 'Rechtliche Angaben können nur für den eigenen Verein abgerufen werden.');
      const record = await deps.legalInfo.findByClubId(clubId);
      if (!record) throw new ClubNotFoundError();
      return record;
    },

    async update(clubId: string, data: UpdateClubLegalInfoInput, requester: RequesterContext): Promise<ClubLegalInfoRecord> {
      requireClubAdminOrSuperadmin(requester, clubId, 'Nur Admins des eigenen Vereins oder Superadmins dürfen die rechtlichen Angaben ändern.');
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
