// apps/api/src/jobs/erasure.repository.memory.ts
import type { ErasureJobGateway, DueErasureRequest } from './erasure.repository.js';
import type { TombstoneRecord } from '../modules/sync/sync.gateway.js';

export interface InMemoryErasureDatabase {
  users: Array<{ id: string; clubId: string | null; athleteId: string | null; [key: string]: unknown }>;
  athletes: Array<{ id: string; [key: string]: unknown }>;
  results: Array<{ id: string; athleteId: string; [key: string]: unknown }>;
  entries: Array<{ id: string; athleteId: string; [key: string]: unknown }>;
  actionItems: Array<{ id: string; athleteId: string; [key: string]: unknown }>;
  sessions: Array<{ id: string; clubId: string; attendance: Array<{ athleteId?: string; [key: string]: unknown }> }>;
  refreshTokens: Array<{ id: string; userId: string }>;
  deletionRequests: Array<{ id: string; userId: string; purgeAfter: Date; status: 'pending' | 'purged'; purgedAt: Date | null }>;
  // Dieselbe Array-Referenz kann in Tests auch an InMemorySyncGateway
  // übergeben werden — so lässt sich end-to-end nachstellen, dass eine
  // vom Purge-Job geschriebene Löschmarkierung anschließend über
  // sync.service.ts's pull() sichtbar wird. Optional, da nicht jeder Test
  // diese Verzahnung braucht.
  tombstones?: TombstoneRecord[];
}

export class InMemoryErasureJobGateway implements ErasureJobGateway {
  constructor(private readonly db: InMemoryErasureDatabase) {}

  async findDuePendingRequests(now: Date): Promise<DueErasureRequest[]> {
    return this.db.deletionRequests
      .filter((r) => r.status === 'pending' && r.purgeAfter.getTime() <= now.getTime())
      .map((r) => ({ id: r.id, userId: r.userId }));
  }

  async purgeUserAndDependents(userId: string): Promise<void> {
    const user = this.db.users.find((u) => u.id === userId);
    if (!user) return;

    this.db.refreshTokens = this.db.refreshTokens.filter((t) => t.userId !== userId);

    if (user.athleteId) {
      const now = new Date();
      const clubId = (user.clubId ?? '') as string;
      const purgedResults = this.db.results.filter((r) => r.athleteId === user.athleteId);
      const purgedEntries = this.db.entries.filter((e) => e.athleteId === user.athleteId);
      const purgedActionItems = this.db.actionItems.filter((a) => a.athleteId === user.athleteId);

      if (this.db.tombstones) {
        this.db.tombstones.push(
          ...purgedResults.map((r): TombstoneRecord => ({ clubId, store: 'results', entityId: r.id, deletedAt: now })),
          ...purgedEntries.map((e): TombstoneRecord => ({ clubId, store: 'entries', entityId: e.id, deletedAt: now })),
          ...purgedActionItems.map((a): TombstoneRecord => ({ clubId, store: 'actionItems', entityId: a.id, deletedAt: now })),
          { clubId, store: 'athletes', entityId: user.athleteId, deletedAt: now },
        );
      }

      this.db.results = this.db.results.filter((r) => r.athleteId !== user.athleteId);
      this.db.entries = this.db.entries.filter((e) => e.athleteId !== user.athleteId);
      this.db.actionItems = this.db.actionItems.filter((a) => a.athleteId !== user.athleteId);
      this.db.sessions
        .filter((s) => s.clubId === user.clubId)
        .forEach((s) => { s.attendance = s.attendance.filter((a) => a.athleteId !== user.athleteId); });
      this.db.athletes = this.db.athletes.filter((a) => a.id !== user.athleteId);
    }

    this.db.users = this.db.users.filter((u) => u.id !== userId);
    // onDelete: Cascade-Äquivalent — der Deletion-Request verschwindet mit.
    this.db.deletionRequests = this.db.deletionRequests.filter((r) => r.userId !== userId);
  }
}
