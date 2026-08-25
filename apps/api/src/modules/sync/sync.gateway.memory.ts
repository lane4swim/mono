// apps/api/src/modules/sync/sync.gateway.memory.ts
//
// Test-Double für SyncGateway — hält alle Stores als einfache Maps im
// Speicher. Ermöglicht vollständige Tests von sync.service.ts (Idempotenz,
// Konfliktlogik, Vereins-Scoping, Pagination) ohne Datenbank.
import type { EntityStoreName } from '@lane1/shared-types';
import type { SyncGateway, SyncRecord, ChangedRecord, TombstoneRecord, SyncWriteOperation, ApplyOutcome } from './sync.gateway.js';

export class InMemorySyncGateway implements SyncGateway {
  // store -> (id -> record)
  private data = new Map<EntityStoreName, Map<string, SyncRecord>>();
  // eventId -> clubId, die das Event verarbeitet hat (siehe
  // isEventProcessed()/markEventProcessed() unten — clubId-gescoped,
  // spiegelt PrismaSyncGateway).
  private processedEvents = new Map<string, string>();
  // userId -> clubId, für findClubIdForUser() (Eigentümerprüfung von
  // ActionItem.assignedTrainerId, siehe sync.service.ts).
  private users = new Map<string, string | null>();

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

  // Test-Hilfsfunktion analog zu seed(), aber für den User -> clubId-
  // Zusammenhang, den findClubIdForUser() abfragt.
  seedUser(userId: string, clubId: string | null): void {
    this.users.set(userId, clubId);
  }

  async findClubIdForUser(userId: string): Promise<string | null> {
    return this.users.get(userId) ?? null;
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
    // Spiegelt Prismas `@default(now())`/`@updatedAt` (siehe schema.prisma):
    // sync.service.ts entfernt "createdAt"/"updatedAt" mittlerweile bewusst
    // aus dem Payload, BEVOR er hier ankommt (Sicherheitskorrektur — die
    // Client-Uhr durfte nicht mehr den serverseitigen Zeitstempel
    // bestimmen, der zugleich als Pull-Sync-Cursor dient). Ein echter
    // Prisma-Client setzt beide Felder in diesem Fall selbst; dieses
    // Test-Double muss dasselbe tun, sonst fehlt `updatedAt` beim
    // gespeicherten Datensatz komplett (listChangedSince() bräche dann auf
    // `record.updatedAt.getTime()` ab).
    const now = new Date();
    this.table(store).set(id, this.normalizeDates({ ...payload, createdAt: payload.createdAt ?? now, updatedAt: now }));
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
    // "updatedAt" wird — wie bei create() oben — IMMER serverseitig neu
    // gesetzt, unabhängig davon, ob der (mittlerweile bereinigte) Payload
    // noch einen Wert dafür enthält, analog zu Prismas `@updatedAt`.
    const merged = { ...(current ?? {}), ...payload, updatedAt: new Date() };
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

  async isEventProcessed(eventId: string, clubId: string): Promise<boolean> {
    return this.processedEvents.get(eventId) === clubId;
  }

  async markEventProcessed(eventId: string, clubId: string): Promise<void> {
    this.processedEvents.set(eventId, clubId);
  }

  // Spiegelt PrismaSyncGateway.applyAndMarkProcessed() (siehe dort für den
  // Hintergrund — Code-Review, Befund C3): Node ist hier ohnehin
  // single-threaded, ein echtes Nebenläufigkeits-/Transaktionsmodell lässt
  // sich im Speicher nicht sinnvoll nachbilden (die eigentliche Race-
  // Condition-Sicherheit wird stattdessen von den Prisma-
  // Integrationstests gegen echtes Postgres abgedeckt) — der VERTRAG
  // (alles-oder-nichts, idempotent bei Wiederholung desselben Events)
  // wird trotzdem exakt nachgebildet: bereits verarbeitet? ->
  // 'already-processed' OHNE die Datenänderung zu versuchen; sonst
  // schreiben und erst DANACH als verarbeitet vermerken — wirft die
  // Datenänderung, bleibt der Ledger-Eintrag (wie bei einer echten,
  // fehlgeschlagenen Transaktion) unverändert unvermerkt.
  async applyAndMarkProcessed(
    operation: SyncWriteOperation,
    event: { id: string; clubId: string; store: EntityStoreName; action: string },
  ): Promise<ApplyOutcome> {
    if (await this.isEventProcessed(event.id, event.clubId)) return 'already-processed';

    if (operation.kind === 'create') {
      await this.create(operation.store, operation.payload);
    } else if (operation.kind === 'update') {
      await this.update(operation.store, operation.id, operation.clubId, operation.payload);
    } else {
      await this.softDelete(operation.store, operation.id, operation.clubId);
    }
    await this.markEventProcessed(event.id, event.clubId);
    return 'applied';
  }
}
