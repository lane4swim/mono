import { randomUUID } from 'node:crypto';
import type { ParentLinkRecord, ParentLinkRepository } from './parents.repository.js';

export class InMemoryParentLinkRepository implements ParentLinkRepository {
  private rows: ParentLinkRecord[] = [];

  async create(userId: string, athleteId: string): Promise<ParentLinkRecord> {
    const existing = this.rows.find((r) => r.userId === userId && r.athleteId === athleteId);
    if (existing) return existing;
    const row: ParentLinkRecord = { id: randomUUID(), userId, athleteId, createdAt: new Date() };
    this.rows.push(row);
    return row;
  }

  async listByUser(userId: string): Promise<ParentLinkRecord[]> {
    return this.rows.filter((r) => r.userId === userId);
  }

  async remove(userId: string, athleteId: string): Promise<void> {
    this.rows = this.rows.filter((r) => !(r.userId === userId && r.athleteId === athleteId));
  }
}
