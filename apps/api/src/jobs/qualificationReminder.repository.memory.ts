// apps/api/src/jobs/qualificationReminder.repository.memory.ts
//
// In-Memory-Implementierung für Tests von jobs/notifyExpiringQualifications.ts
// ohne Datenbank (analog erasure.repository.memory.ts-Muster für den
// Löschungs-Job).
import type {
  NotifyExpiringQualificationsGateway,
  QualificationReminderCandidate,
  AdminContact,
} from './qualificationReminder.repository.js';

export class InMemoryNotifyExpiringQualificationsGateway implements NotifyExpiringQualificationsGateway {
  private sentLog = new Set<string>(); // `${qualificationId}:${thresholdDays}`

  constructor(
    private readonly candidates: QualificationReminderCandidate[] = [],
    private readonly thresholdsByClubAndType: Map<string, number[]> = new Map(),
    private readonly adminsByClub: Map<string, AdminContact[]> = new Map(),
  ) {}

  async findActiveQualificationsForModuleClubs(): Promise<QualificationReminderCandidate[]> {
    return this.candidates.slice();
  }
  async findThresholdsByClubAndType(): Promise<Map<string, number[]>> {
    return new Map(this.thresholdsByClubAndType);
  }
  async findAdminsForClub(clubId: string): Promise<AdminContact[]> {
    return this.adminsByClub.get(clubId) ?? [];
  }
  async hasReminderBeenSent(qualificationId: string, thresholdDays: number): Promise<boolean> {
    return this.sentLog.has(`${qualificationId}:${thresholdDays}`);
  }
  async recordReminderSent(qualificationId: string, thresholdDays: number): Promise<void> {
    this.sentLog.add(`${qualificationId}:${thresholdDays}`);
  }
}
