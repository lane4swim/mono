// apps/api/src/modules/sync/sync.gateway.ts
//
// Abstraktionsschicht zwischen sync.service.ts und der Datenhaltung.
// Anders als bei auth/invitations (ein Repository-Interface je Entität)
// braucht die generische Sync-API GENAU EINE Schnittstelle, die über alle
// zehn fachlichen Stores hinweg funktioniert — sie nutzt dafür
// db/entityRegistry.ts (SyncStore -> Prisma-Delegate), das in Phase 2
// bereits für genau diesen Zweck vorbereitet wurde.
import type { PrismaClient } from '@prisma/client';
import type { EntityStoreName } from '@lane1/shared-types';
import { getEntityDelegate } from '../../db/entityRegistry.js';

export interface SyncRecord {
  id: string;
  clubId: string;
  updatedAt: Date;
  deletedAt: Date | null;
  [key: string]: unknown;
}

export interface ChangedRecord {
  store: EntityStoreName;
  entityId: string;
  action: 'create' | 'update' | 'delete';
  payload: Record<string, unknown> | null;
  updatedAt: Date;
}

// Schlanke Löschmarkierung (siehe schema.prisma: SyncTombstone) — nur id +
// Zeitpunkt, keine Personendaten. Wird vom Purge-Job (siehe
// jobs/erasure.repository.ts) angelegt, bevor eine Zeile unwiderruflich
// gelöscht wird, damit listChangedSince() die Löschung auch dann noch
// melden kann, wenn ein Client die gesamte Aufbewahrungsfrist verpasst hat
// (die eigentliche Zeile existiert dann ja physisch nicht mehr).
export interface TombstoneRecord {
  clubId: string;
  store: EntityStoreName;
  entityId: string;
  deletedAt: Date;
}

export interface SyncGateway {
  findById(store: EntityStoreName, id: string): Promise<SyncRecord | null>;
  create(store: EntityStoreName, payload: Record<string, unknown>): Promise<void>;
  update(store: EntityStoreName, id: string, payload: Record<string, unknown>): Promise<void>;
  softDelete(store: EntityStoreName, id: string, clubId: string): Promise<void>;
  // Änderungen eines Vereins seit einem Zeitpunkt, über alle Stores hinweg,
  // absteigend nach updatedAt limitiert (Pagination via `limit`).
  listChangedSince(clubId: string, since: Date | null, limit: number): Promise<ChangedRecord[]>;
  isEventProcessed(eventId: string): Promise<boolean>;
  markEventProcessed(eventId: string, clubId: string, store: EntityStoreName, action: string): Promise<void>;
}

const ALL_STORES: EntityStoreName[] = [
  'athletes', 'groups', 'competitions', 'entries', 'results',
  'exercises', 'templates', 'plans', 'sessions', 'actionItems',
];

export class PrismaSyncGateway implements SyncGateway {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(store: EntityStoreName, id: string): Promise<SyncRecord | null> {
    const delegate = getEntityDelegate(this.prisma, store);
    const record = await delegate.findUnique({ where: { id } });
    return record as SyncRecord | null;
  }

  async create(store: EntityStoreName, payload: Record<string, unknown>): Promise<void> {
    const delegate = getEntityDelegate(this.prisma, store);
    await delegate.create({ data: payload });
  }

  async update(store: EntityStoreName, id: string, payload: Record<string, unknown>): Promise<void> {
    const delegate = getEntityDelegate(this.prisma, store);
    await delegate.update({ where: { id }, data: payload });
  }

  async softDelete(store: EntityStoreName, id: string, clubId: string): Promise<void> {
    const delegate = getEntityDelegate(this.prisma, store);
    // clubId in der where-Klausel: verhindert, dass ein manipuliertes Event
    // versehentlich/absichtlich eine id eines FREMDEN Vereins löscht.
    await delegate.update({ where: { id, clubId }, data: { deletedAt: new Date() } });
  }

  async listChangedSince(clubId: string, since: Date | null, limit: number): Promise<ChangedRecord[]> {
    const [storeResults, tombstones] = await Promise.all([
      Promise.all(
        ALL_STORES.map(async (store) => {
          const delegate = getEntityDelegate(this.prisma, store);
          const rows = (await delegate.findMany({
            where: { clubId, ...(since ? { updatedAt: { gt: since } } : {}) },
            orderBy: { updatedAt: 'asc' },
            take: limit,
          })) as SyncRecord[];
          return rows.map((row): ChangedRecord => ({
            store,
            entityId: row.id,
            action: row.deletedAt ? 'delete' : (since ? 'update' : 'create'),
            payload: row.deletedAt ? null : row,
            updatedAt: row.updatedAt,
          }));
        }),
      ),
      this.prisma.syncTombstone.findMany({
        where: { clubId, ...(since ? { deletedAt: { gt: since } } : {}) },
        orderBy: { deletedAt: 'asc' },
        take: limit,
      }),
    ]);

    const tombstoneChanges: ChangedRecord[] = tombstones.map((t: { store: string; entityId: string; deletedAt: Date }) => ({
      store: t.store as EntityStoreName,
      entityId: t.entityId,
      action: 'delete',
      payload: null,
      updatedAt: t.deletedAt,
    }));

    return [...storeResults.flat(), ...tombstoneChanges]
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .slice(0, limit);
  }

  async isEventProcessed(eventId: string): Promise<boolean> {
    const existing = await this.prisma.syncedEvent.findUnique({ where: { id: eventId } });
    return existing !== null;
  }

  async markEventProcessed(eventId: string, clubId: string, store: EntityStoreName, action: string): Promise<void> {
    await this.prisma.syncedEvent.create({ data: { id: eventId, clubId, store, action } });
  }
}
