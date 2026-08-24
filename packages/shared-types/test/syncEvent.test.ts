// packages/shared-types/test/syncEvent.test.ts
import { describe, it, expect } from 'vitest';
import { SyncEventSchema, SyncPushRequestSchema, SyncPullQuerySchema, SyncPullResponseSchema } from '../src/syncEvent.js';

describe('SyncEventSchema', () => {
  it('akzeptiert ein gültiges create-Event', () => {
    const event = {
      id: 'evt_a1b2',
      store: 'athletes',
      entityId: 'ath_9f3c',
      action: 'create',
      payload: { firstName: 'Mara', lastName: 'Vogel' },
      clientUpdatedAt: new Date().toISOString(),
    };
    expect(SyncEventSchema.safeParse(event).success).toBe(true);
  });

  it('akzeptiert ein delete-Event mit payload: null', () => {
    const event = {
      id: 'evt_c3d4',
      store: 'results',
      entityId: 'res_1',
      action: 'delete',
      payload: null,
      clientUpdatedAt: new Date().toISOString(),
    };
    expect(SyncEventSchema.safeParse(event).success).toBe(true);
  });

  it('lehnt ein Event mit unbekanntem store ab', () => {
    const event = {
      id: 'evt_x',
      store: 'not_a_real_store',
      entityId: 'x',
      action: 'update',
      payload: {},
      clientUpdatedAt: new Date().toISOString(),
    };
    expect(SyncEventSchema.safeParse(event).success).toBe(false);
  });

  it('lehnt ein Event ohne id ab (Idempotenz-Schlüssel ist Pflicht)', () => {
    const event = {
      store: 'athletes',
      entityId: 'ath_1',
      action: 'update',
      payload: {},
      clientUpdatedAt: new Date().toISOString(),
    };
    expect(SyncEventSchema.safeParse(event).success).toBe(false);
  });

  it('lehnt einen ungültigen ISO-Zeitstempel ab', () => {
    const event = {
      id: 'evt_y',
      store: 'athletes',
      entityId: 'ath_1',
      action: 'update',
      payload: {},
      clientUpdatedAt: 'gestern',
    };
    expect(SyncEventSchema.safeParse(event).success).toBe(false);
  });
});

describe('SyncPushRequestSchema', () => {
  it('verlangt mindestens ein Event', () => {
    expect(SyncPushRequestSchema.safeParse({ events: [] }).success).toBe(false);
  });

  it('akzeptiert bis zu 500 Events', () => {
    const events = Array.from({ length: 500 }, (_, i) => ({
      id: `evt_${i}`,
      store: 'athletes' as const,
      entityId: `ath_${i}`,
      action: 'update' as const,
      payload: {},
      clientUpdatedAt: new Date().toISOString(),
    }));
    expect(SyncPushRequestSchema.safeParse({ events }).success).toBe(true);
  });

  it('lehnt mehr als 500 Events pro Batch ab', () => {
    const events = Array.from({ length: 501 }, (_, i) => ({
      id: `evt_${i}`,
      store: 'athletes' as const,
      entityId: `ath_${i}`,
      action: 'update' as const,
      payload: {},
      clientUpdatedAt: new Date().toISOString(),
    }));
    expect(SyncPushRequestSchema.safeParse({ events }).success).toBe(false);
  });
});

describe('SyncPullQuerySchema', () => {
  it('akzeptiert eine leere Anfrage (weder "since" noch "cursor")', () => {
    expect(SyncPullQuerySchema.safeParse({}).success).toBe(true);
  });

  it('akzeptiert gültige ISO-Zeitstempel für "since" und "cursor"', () => {
    const now = new Date().toISOString();
    expect(SyncPullQuerySchema.safeParse({ since: now }).success).toBe(true);
    expect(SyncPullQuerySchema.safeParse({ cursor: now }).success).toBe(true);
  });

  // Sicherheitskorrektur (Code-Review, Befund 9): "cursor" wurde vormals als
  // beliebiger String akzeptiert — ein Wert wie "abc" erzeugte im Sync-
  // Service ein `Invalid Date`, das erst dort (mit einem ungefangenen
  // Fehler statt einer regulären 400-Antwort) auffiel.
  it('lehnt einen nicht-datumsförmigen "cursor"-Wert ab', () => {
    expect(SyncPullQuerySchema.safeParse({ cursor: 'abc' }).success).toBe(false);
  });

  it('lehnt einen nicht-datumsförmigen "since"-Wert ab', () => {
    expect(SyncPullQuerySchema.safeParse({ since: 'abc' }).success).toBe(false);
  });
});

describe('SyncPullResponseSchema', () => {
  it('akzeptiert eine leere, abgeschlossene Änderungsliste', () => {
    const response = { changes: [], nextCursor: null, hasMore: false };
    expect(SyncPullResponseSchema.safeParse(response).success).toBe(true);
  });

  it('lehnt eine Antwort ohne hasMore ab', () => {
    const response = { changes: [], nextCursor: null };
    expect(SyncPullResponseSchema.safeParse(response).success).toBe(false);
  });
});
