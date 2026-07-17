// apps/api/src/modules/sync/sync.gateway.memory.ts
//
// Test-Double für SyncGateway — hält alle Stores als einfache Maps im
// Speicher. Ermöglicht vollständige Tests von sync.service.ts (Idempotenz,
// Konfliktlogik, Vereins-Scoping, Pagination) ohne Datenbank.
import type { EntityStoreName } from '@lane1/shared-types';
import type { SyncGateway, SyncRecord, ChangedRecord } from './sync.gateway.js';

export class InMemorySyncGateway implements SyncGateway {
  // store -> (id -> record)
  private data = new Map<EntityStoreName, Map<string, SyncRecord>>();
  private processedEvents = new Set<string>();

  private table(store: EntityStoreName): Map<string, SyncRecord> {
    if (!this.data.has(store)) this.data.set(store, new Map());
    return this.data.get(store)!;
  }

  // Test-Hilfsfunktion: einen Datensatz direkt "im Server-Stand" ansiedeln,
  // ohne über push() zu gehen — simuliert z. B. "ein anderes Gerät hat
  // diesen Datensatz bereits synchronisiert".
  seed(store: EntityStoreName, record: SyncRecord): void {
    this.table(store).set(record.id, record);
  }

  async findById(store: EntityStoreName, id: string): Promise<SyncRecord | null> {
    return this.table(store).get(id) ?? null;
  }

  async create(store: EntityStoreName, payload: Record<string, unknown>): Promise<void> {
    this.table(store).set(payload.id as string, this.normalizeDates(payload));
  }

  async update(store: EntityStoreName, id: string, payload: Record<string, unknown>): Promise<void> {
    const merged = { ...(this.table(store).get(id) ?? {}), ...payload };
    this.table(store).set(id, this.normalizeDates(merged));
  }

  // Ankommende Payloads (aus dem Client-JSON bzw. zod-validierten Events)
  // tragen Zeitstempel als ISO-Strings, nicht als Date-Objekte — anders als
  // was seed()/listChangedSince() erwarten (spiegelt, wie Prisma Date-Spalten
  // stets als echte Date-Objekte zurückgibt). Ohne diese Normalisierung
  // würde listChangedSince() beim späteren `.toISOString()`-Aufruf auf
  // einem String statt einem Date-Objekt fehlschlagen.
  private normalizeDates(record: Record<string, unknown>): SyncRecord {
    const normalized = { ...record };
    for (const key of ['updatedAt', 'createdAt', 'deletedAt']) {
      const value = normalized[key];
      if (typeof value === 'string') normalized[key] = new Date(value);
    }
    return normalized as SyncRecord;
  }

  async softDelete(store: EntityStoreName, id: string, clubId: string): Promise<void> {
    const existing = this.table(store).get(id);
    if (existing && existing.clubId === clubId) {
      this.table(store).set(id, { ...existing, deletedAt: new Date() });
    }
  }

  async listChangedSince(clubId: string, since: Date | null, limit: number): Promise<ChangedRecord[]> {
    const changes: ChangedRecord[] = [];
    for (const [store, records] of this.data.entries()) {
      for (const record of records.values()) {
        if (record.clubId !== clubId) continue;
        if (since && record.updatedAt.getTime() <= since.getTime()) continue;
        changes.push({
          store,
          entityId: record.id,
          action: record.deletedAt ? 'delete' : 'update',
          payload: record.deletedAt ? null : record,
          updatedAt: record.updatedAt,
        });
      }
    }
    changes.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
    return changes.slice(0, limit);
  }

  async isEventProcessed(eventId: string): Promise<boolean> {
    return this.processedEvents.has(eventId);
  }

  async markEventProcessed(eventId: string): Promise<void> {
    this.processedEvents.add(eventId);
  }
}
