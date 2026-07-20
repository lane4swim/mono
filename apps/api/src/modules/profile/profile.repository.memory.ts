// apps/api/src/modules/profile/profile.repository.memory.ts
import { randomUUID } from 'node:crypto';
import type {
  ProfileDataGateway,
  PersonalDataExport,
  ErasureRequestRecord,
} from './profile.repository.js';
import { UserNotFoundForExportError, ErasureAlreadyRequestedError } from './profile.repository.js';

export interface InMemoryUserRow {
  id: string;
  clubId: string | null;
  athleteId: string | null;
  deletedAt: Date | null;
  [key: string]: unknown;
}
export interface InMemoryAthleteRow {
  id: string;
  deletedAt: Date | null;
  [key: string]: unknown;
}
export interface InMemoryLinkedRow {
  id: string;
  athleteId: string;
  deletedAt: Date | null;
  [key: string]: unknown;
}
export interface InMemorySessionRow {
  id: string;
  clubId: string;
  date: Date;
  attendance: Array<Record<string, unknown>>;
}

export interface InMemoryProfileDatabase {
  users: InMemoryUserRow[];
  athletes: InMemoryAthleteRow[];
  results: InMemoryLinkedRow[];
  entries: InMemoryLinkedRow[];
  actionItems: InMemoryLinkedRow[];
  sessions: InMemorySessionRow[];
}

// Test-Double für ProfileDataGateway — hält eine kleine, injizierbare
// "Datenbank" als Plain-Arrays im Speicher. Ermöglicht vollständige Tests
// von exportUserData()/requestErasure() ohne Postgres/Prisma.
export class InMemoryProfileDataGateway implements ProfileDataGateway {
  private erasureRequests = new Map<string, ErasureRequestRecord>();

  constructor(private readonly db: InMemoryProfileDatabase) {}

  async exportUserData(userId: string): Promise<PersonalDataExport> {
    const user = this.db.users.find((u) => u.id === userId);
    if (!user) throw new UserNotFoundForExportError();

    let athlete: Record<string, unknown> | null = null;
    let results: Array<Record<string, unknown>> = [];
    let entries: Array<Record<string, unknown>> = [];
    let actionItems: Array<Record<string, unknown>> = [];
    let attendance: Array<Record<string, unknown>> = [];

    if (user.athleteId) {
      athlete = this.db.athletes.find((a) => a.id === user.athleteId) ?? null;
      results = this.db.results.filter((r) => r.athleteId === user.athleteId);
      entries = this.db.entries.filter((e) => e.athleteId === user.athleteId);
      actionItems = this.db.actionItems.filter((a) => a.athleteId === user.athleteId);
      attendance = this.db.sessions
        .filter((s) => s.clubId === user.clubId)
        .map((session): Record<string, unknown> | null => {
          const record = session.attendance.find((a) => a.athleteId === user.athleteId);
          return record ? { sessionId: session.id, date: session.date, ...record } : null;
        })
        .filter((x): x is Record<string, unknown> => x !== null);
    }

    const { passwordHash: _passwordHash, ...publicUser } = user;
    return {
      exportedAt: new Date().toISOString(),
      format: 'lane1-user-data-export-v1',
      user: publicUser,
      athlete,
      results,
      entries,
      actionItems,
      attendance,
    };
  }

  async requestErasure(userId: string, retentionDays: number): Promise<ErasureRequestRecord> {
    const user = this.db.users.find((u) => u.id === userId);
    if (!user) throw new UserNotFoundForExportError();
    if (this.erasureRequests.has(userId)) throw new ErasureAlreadyRequestedError();

    const now = new Date();
    const purgeAfter = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000);

    user.deletedAt = now;
    if (user.athleteId) {
      const athlete = this.db.athletes.find((a) => a.id === user.athleteId);
      if (athlete) athlete.deletedAt = now;
      this.db.results.filter((r) => r.athleteId === user.athleteId).forEach((r) => (r.deletedAt = now));
      this.db.entries.filter((e) => e.athleteId === user.athleteId).forEach((e) => (e.deletedAt = now));
      this.db.actionItems.filter((a) => a.athleteId === user.athleteId).forEach((a) => (a.deletedAt = now));
    }

    const request: ErasureRequestRecord = { id: randomUUID(), userId, requestedAt: now, purgeAfter, purgedAt: null, status: 'pending' };
    this.erasureRequests.set(userId, request);
    return request;
  }
}
