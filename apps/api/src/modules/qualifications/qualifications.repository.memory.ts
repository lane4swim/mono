// apps/api/src/modules/qualifications/qualifications.repository.memory.ts
//
// In-Memory-Implementierungen für Tests — ermöglicht vollständige Tests der
// Autorisierungs-/Ablauflogik in qualifications.service.ts ohne Datenbank
// (analog invitations.repository.memory.ts).
import { randomUUID } from 'node:crypto';
import type {
  UserQualificationRepository,
  UserQualificationRecord,
  CreateUserQualificationInput,
  UpdateUserQualificationInput,
  QualificationReminderSettingRepository,
  ClubQualificationReminderSettingRecord,
} from './qualifications.repository.js';

export class InMemoryUserQualificationRepository implements UserQualificationRepository {
  private rows: UserQualificationRecord[] = [];

  async create(input: CreateUserQualificationInput): Promise<UserQualificationRecord> {
    const now = new Date();
    const row: UserQualificationRecord = { id: randomUUID(), ...input, createdAt: now, updatedAt: now, deletedAt: null };
    this.rows.push(row);
    return row;
  }
  async findById(id: string): Promise<UserQualificationRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async listByUser(userId: string): Promise<UserQualificationRecord[]> {
    return this.rows
      .filter((r) => r.userId === userId && !r.deletedAt)
      .sort((a, b) => b.acquiredOn.getTime() - a.acquiredOn.getTime());
  }
  async update(id: string, input: UpdateUserQualificationInput): Promise<UserQualificationRecord> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`UserQualification ${id} nicht gefunden.`);
    Object.assign(row, input, { updatedAt: new Date() });
    return row;
  }
  async softDelete(id: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.deletedAt = new Date();
  }
}

export class InMemoryQualificationReminderSettingRepository implements QualificationReminderSettingRepository {
  private rows: ClubQualificationReminderSettingRecord[] = [];

  async listByClub(clubId: string): Promise<ClubQualificationReminderSettingRecord[]> {
    return this.rows.filter((r) => r.clubId === clubId);
  }
  async listAll(): Promise<ClubQualificationReminderSettingRecord[]> {
    return this.rows.slice();
  }
  async upsert(clubId: string, type: string, thresholdsDays: number[]): Promise<ClubQualificationReminderSettingRecord> {
    const now = new Date();
    const existing = this.rows.find((r) => r.clubId === clubId && r.type === type);
    if (existing) {
      existing.thresholdsDays = thresholdsDays;
      existing.updatedAt = now;
      return existing;
    }
    const row: ClubQualificationReminderSettingRecord = { id: randomUUID(), clubId, type, thresholdsDays, createdAt: now, updatedAt: now };
    this.rows.push(row);
    return row;
  }
}
