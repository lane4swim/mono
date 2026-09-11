// In-Memory-Implementierung für Tests — ermöglicht vollständige Tests der
// Autorisierungs-/Ablauflogik in auditLog.service.ts ohne Datenbank (analog
// qualifications.repository.memory.ts).
import { randomUUID } from 'node:crypto';
import type { AuditLogRepository, AuditLogEntryRecord, CreateAuditLogEntryInput, ListAuditLogOptions } from './auditLog.repository.js';

export class InMemoryAuditLogRepository implements AuditLogRepository {
  private rows: AuditLogEntryRecord[] = [];

  async create(input: CreateAuditLogEntryInput): Promise<AuditLogEntryRecord> {
    const row: AuditLogEntryRecord = { id: randomUUID(), ...input, createdAt: new Date() };
    this.rows.push(row);
    return row;
  }

  async list(options: ListAuditLogOptions): Promise<AuditLogEntryRecord[]> {
    return this.rows
      .filter((r) => (options.clubId ? r.clubId === options.clubId : true))
      .filter((r) => (options.before ? r.createdAt.getTime() < options.before.getTime() : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, options.limit);
  }
}
