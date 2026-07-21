// apps/api/src/modules/sync/sync.gateway.memory.ts
//
// Test-Double für SyncGateway — hält alle Stores als einfache Maps im
// Speicher. Ermöglicht vollständige Tests von sync.service.ts (Idempotenz,
// Konfliktlogik, Vereins-Scoping, Pagination) ohne Datenbank.
import type { EntityStoreName } from '@lane1/shared-types';
import type { SyncGateway, SyncRecord, ChangedRecord, TombstoneRecord } from './sync.gateway.js';

export class InMemorySyncGateway implements SyncGateway {
  // store -> (id -> record)
  private data = new Map<EntityStoreName, Map<string, SyncRecord>>();
  private processedEvents = new Set<string>();

  // Von außen injizierbar (z. B. dieselbe Array-Referenz, die auch
  // InMemoryErasureJobGateway befüllt) — ermöglicht Tests, die den
  // Zusammenspiel "Purge-Job schreibt Tombstone -> Sync-Gateway meldet
  // ihn beim nächsten Pull" end-to-end nachstellen, ohne echte Datenbank.
  constructor(private readonly tombstones: TombstoneRecord[] = []) {}

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

  async findById(store: EntityStoreName, id: string, clubId?: string): Promise<SyncRecord | null> {
    const record = this.table(store).get(id) ?? null;
    // Spiegelt das Scoping von PrismaSyncGateway.findById(): ein Treffer,
    // der einem anderen Verein gehört, gilt für einen scoped Aufruf als
    // "nicht gefunden".
    if (record && clubId !== undefined && record.clubId !== clubId) return null;
    return record;
  }

  async create(store: EntityStoreName, payload: Record<string, unknown>): Promise<void> {
    this.assertReferencedEntityExists(payload);
    // Spiegelt Prismas Unique-Constraint auf der Primärspalte "id": ein
    // real generierter Prisma-Client würde bei create() mit bereits
    // existierender id mit Fehlercode "P2002" fehlschlagen, statt die
    // bestehende Zeile stillschweigend zu überschreiben. Ohne diese Prüfung
    // könnte ein Datensatz eines fremden Vereins, der über das
    // Club-Scoping von findById() als "nicht existent" erscheint (siehe
    // Sicherheitsreview, Punkt 2), über diesen create()-Fallback-Pfad
    // trotzdem überschrieben werden.
    const id = payload.id as string;
    if (this.table(store).has(id)) {
      const err = new Error(`Unique constraint failed on the fields: (\`id\`)`) as Error & { code: string };
      err.code = 'P2002';
      throw err;
    }
    this.table(store).set(id, this.normalizeDates(payload));
  }

  async update(store: EntityStoreName, id: string, clubId: string, payload: Record<string, unknown>): Promise<void> {
    const current = this.table(store).get(id);
    // Vereins-Scoping analog zu PrismaSyncGateway.update()/softDelete():
    // existiert der Datensatz, gehört aber einem anderen Verein, wird das
    // Update stillschweigend nicht angewandt — statt den fremden
    // Datensatz zu überschreiben. (Prisma würde stattdessen "P2025"
    // werfen; für den In-Memory-Zweck genügt No-Op, das Sicherheits-
    // verhalten — kein Schreibzugriff auf fremde Daten — ist identisch.)
    if (current && current.clubId !== clubId) return;
    this.assertReferencedEntityExists(payload);
    const merged = { ...(current ?? {}), ...payload };
    this.table(store).set(id, this.normalizeDates(merged));
  }

  // Simuliert den Postgres-Fremdschlüssel-Verstoß (Prisma-Fehlercode
  // "P2003"), der real auftritt, wenn ein Datensatz auf eine bereits
  // endgültig gelöschte (per Purge-Job entfernte) Person verweist — siehe
  // sync.service.ts: describeSyncError() übersetzt genau diesen Fall in
  // eine verständliche Meldung statt einer rohen DB-Fehlermeldung.
  private assertReferencedEntityExists(payload: Record<string, unknown>): void {
    const athleteId = payload.athleteId as string | undefined;
    if (!athleteId) return;
    const isPurged = this.tombstones.some((t) => t.store === 'athletes' && t.entityId === athleteId);
    if (isPurged) {
      const err = new Error('Foreign key constraint failed on the field: `athleteId`') as Error & { code: string };
      err.code = 'P2003';
      throw err;
    }
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
    for (const t of this.tombstones) {
      if (t.clubId !== clubId) continue;
      if (since && t.deletedAt.getTime() <= since.getTime()) continue;
      changes.push({ store: t.store, entityId: t.entityId, action: 'delete', payload: null, updatedAt: t.deletedAt });
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
