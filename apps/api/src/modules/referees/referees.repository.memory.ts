// apps/api/src/modules/referees/referees.repository.memory.ts
//
// In-Memory-Implementierungen für Tests — ermöglicht vollständige Tests der
// Autorisierungs-/Ablauflogik in referees.service.ts ohne Datenbank
// (analog qualifications.repository.memory.ts).
import { randomUUID } from 'node:crypto';
import type {
  RefereeAssignmentRepository,
  RefereeAssignmentRecord,
  CreateRefereeAssignmentInput,
  UpdateRefereeAssignmentInput,
  CompetitionRepository,
  CompetitionLookup,
} from './referees.repository.js';

export class InMemoryRefereeAssignmentRepository implements RefereeAssignmentRepository {
  private rows: RefereeAssignmentRecord[] = [];

  async create(input: CreateRefereeAssignmentInput): Promise<RefereeAssignmentRecord> {
    const now = new Date();
    const row: RefereeAssignmentRecord = { id: randomUUID(), ...input, createdAt: now, updatedAt: now, deletedAt: null };
    this.rows.push(row);
    return row;
  }
  async findById(id: string): Promise<RefereeAssignmentRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async listByUser(userId: string): Promise<RefereeAssignmentRecord[]> {
    return this.rows
      .filter((r) => r.userId === userId && !r.deletedAt)
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }
  async update(id: string, input: UpdateRefereeAssignmentInput): Promise<RefereeAssignmentRecord> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) throw new Error(`RefereeAssignment ${id} nicht gefunden.`);
    Object.assign(row, input, { updatedAt: new Date() });
    return row;
  }
  async softDelete(id: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) row.deletedAt = new Date();
  }
}

export class InMemoryCompetitionRepository implements CompetitionRepository {
  constructor(private readonly competitions: CompetitionLookup[] = []) {}

  async findById(id: string): Promise<CompetitionLookup | null> {
    return this.competitions.find((c) => c.id === id) ?? null;
  }
}
