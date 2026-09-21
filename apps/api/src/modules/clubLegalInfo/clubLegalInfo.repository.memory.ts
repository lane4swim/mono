// In-Memory-Implementierung für Tests (analog auditLog.repository.memory.ts)
// — ermöglicht vollständige Tests der Autorisierungs-/Scoping-Logik in
// clubLegalInfo.service.ts ohne Datenbank.
import type { ClubLegalInfoRepository, ClubLegalInfoRecord, UpdateClubLegalInfoInput } from './clubLegalInfo.repository.js';

const EMPTY_LEGAL_INFO: Omit<ClubLegalInfoRecord, 'clubId' | 'updatedAt' | 'name'> = {
  addressLine1: null,
  postalCode: null,
  city: null,
  representativeName: null,
  contactEmail: null,
  contactPhone: null,
  registerNumber: null,
  registerCourt: null,
  vatId: null,
  privacyContactEmail: null,
  supervisoryAuthority: null,
  dpoRequired: false,
  dpoName: null,
  dpoContact: null,
};

export class InMemoryClubLegalInfoRepository implements ClubLegalInfoRepository {
  private rows = new Map<string, ClubLegalInfoRecord>();

  // Test-Setup: registriert eine clubId als "existierend" (mit leeren
  // rechtlichen Angaben, wie ein frisch angelegter Verein) — ohne diesen
  // Aufruf liefert findByClubId() `null`, wie bei einer unbekannten clubId.
  seedClub(clubId: string, name = 'Testverein'): void {
    if (!this.rows.has(clubId)) {
      this.rows.set(clubId, { clubId, name, updatedAt: new Date(), ...EMPTY_LEGAL_INFO });
    }
  }

  async findByClubId(clubId: string): Promise<ClubLegalInfoRecord | null> {
    return this.rows.get(clubId) ?? null;
  }

  async update(clubId: string, data: UpdateClubLegalInfoInput): Promise<ClubLegalInfoRecord> {
    const existing = this.rows.get(clubId);
    if (!existing) throw new Error(`InMemoryClubLegalInfoRepository.update: unbekannte clubId ${clubId}`);
    const updated: ClubLegalInfoRecord = { clubId, name: existing.name, updatedAt: new Date(), ...data };
    this.rows.set(clubId, updated);
    return updated;
  }
}
