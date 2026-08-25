// apps/web/test/syncClient.test.js
//
// Testet js/syncClient.js gegen eine gemockte apiClient.js (kein echtes
// Netzwerk) und echtes js/db.js (per fake-indexeddb, siehe test/setup.js)
// — bislang völlig ungetestet (Code-Review, Befund 15). Deckt insbesondere
// zwei per Code-Review behobene Regressionen ab:
//   - Befund 1: der Sync-Cursor muss auch auf der letzten Seite eines
//     Zyklus persistiert werden.
//   - Befund 12: "insert-as-new" (siehe apps/api sync.service.ts) vergibt
//     bei einem Konflikt eine neue Server-id — der lokale Datensatz muss
//     entsprechend nachgezogen werden, sonst erscheint er nach dem
//     nächsten pull() doppelt.
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/state.js', () => ({ getCurrentUser: vi.fn(() => null) }));
vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));
vi.mock('../js/apiClient.js', () => ({
  syncPush: vi.fn(),
  syncPull: vi.fn(),
}));

import * as api from '../js/apiClient.js';
import * as db from '../js/db.js';
import { push, pull, runSync } from '../js/syncClient.js';

beforeEach(async () => {
  vi.clearAllMocks();
  await db.wipeAll();
});

describe('push()', () => {
  it('meldet "sent: 0", wenn die Warteschlange leer ist, ohne die API aufzurufen', async () => {
    const result = await push();
    expect(result).toEqual({ sent: 0, applied: 0, conflicts: 0, errors: 0 });
    expect(api.syncPush).not.toHaveBeenCalled();
  });

  it('markiert ein Event bei "applied" als "synced"', async () => {
    const saved = await db.put('groups', { name: 'X' });
    const [event] = await db.getSyncQueue();
    api.syncPush.mockResolvedValue({ results: [{ eventId: event.id, status: 'applied' }] });

    const result = await push();
    expect(result).toEqual({ sent: 1, applied: 1, conflicts: 0, errors: 0 });
    const updated = (await db.getSyncQueue()).find((e) => e.id === event.id);
    expect(updated.status).toBe('synced');
    expect(updated.attempts).toBe(1);
    // Der lokale Datensatz selbst bleibt unter seiner ursprünglichen id.
    expect(await db.get('groups', saved.id)).not.toBeNull();
  });

  it('markiert ein Event bei "conflict" ebenfalls als "synced" (last-write-wins, kein Fehler)', async () => {
    await db.put('groups', { name: 'X' });
    const [event] = await db.getSyncQueue();
    api.syncPush.mockResolvedValue({ results: [{ eventId: event.id, status: 'conflict', serverVersion: { id: event.entityId, name: 'Serverstand' } }] });

    const result = await push();
    expect(result).toEqual({ sent: 1, applied: 0, conflicts: 1, errors: 0 });
    const updated = (await db.getSyncQueue()).find((e) => e.id === event.id);
    expect(updated.status).toBe('synced');
  });

  it('markiert ein Event bei "error" als "error" mit der Server-Meldung', async () => {
    await db.put('groups', { name: 'X' });
    const [event] = await db.getSyncQueue();
    api.syncPush.mockResolvedValue({ results: [{ eventId: event.id, status: 'error', message: 'Payload ungültig.' }] });

    const result = await push();
    expect(result).toEqual({ sent: 1, applied: 0, conflicts: 0, errors: 1 });
    const updated = (await db.getSyncQueue()).find((e) => e.id === event.id);
    expect(updated.status).toBe('error');
    expect(updated.attempts).toBe(1);
    expect(updated.lastError).toBe('Payload ungültig.');
  });

  it('erhöht "attempts" bei jedem erneuten Fehlversuch desselben Events', async () => {
    await db.put('results', { event: '100m Freistil', time: 60 });
    const [event] = await db.getSyncQueue();
    api.syncPush.mockResolvedValue({ results: [{ eventId: event.id, status: 'error', message: 'X' }] });

    await push();
    const secondQueue = await db.getSyncQueue();
    expect(secondQueue.find((e) => e.id === event.id).attempts).toBe(1);

    await push(); // dasselbe (weiterhin "error") Event wird erneut gesendet
    const thirdQueue = await db.getSyncQueue();
    expect(thirdQueue.find((e) => e.id === event.id).attempts).toBe(2);
  });

  // Regressionstest für Befund C2 (Code-Review): ein dauerhaft
  // scheiterndes Event wurde zuvor unbegrenzt oft erneut gesendet, weil
  // "attempts" gezählt, aber nie ausgewertet wurde. Nach MAX_SYNC_ATTEMPTS
  // (5) Fehlversuchen muss push() das Event auf 'failed' setzen — ein
  // Status, der aus dem eigenen toSend-Filter herausfällt, also von einem
  // weiteren push()-Aufruf nicht mehr automatisch erneut gesendet wird.
  it('setzt ein dauerhaft scheiterndes Event nach 5 Fehlversuchen auf "failed" und sendet es danach nicht mehr automatisch', async () => {
    await db.put('groups', { name: 'X' });
    const [event] = await db.getSyncQueue();
    api.syncPush.mockResolvedValue({ results: [{ eventId: event.id, status: 'error', message: 'Store unbekannt.' }] });

    for (let i = 0; i < 5; i++) await push();

    const afterFive = (await db.getSyncQueue()).find((e) => e.id === event.id);
    expect(afterFive.status).toBe('failed');
    expect(afterFive.attempts).toBe(5);

    api.syncPush.mockClear();
    const result = await push();
    expect(result).toEqual({ sent: 0, applied: 0, conflicts: 0, errors: 0 });
    expect(api.syncPush).not.toHaveBeenCalled();
  });

  // Regressionstest für Befund 12: "results" ist der einzige Store mit der
  // Konfliktstrategie "never-overwrite" (siehe packages/sync-protocol) —
  // der Server vergibt bei einem Konflikt eine NEUE id (serverVersion.id)
  // statt zu überschreiben.
  describe('insert-as-new (serverVersion.id abweichend von der lokalen id)', () => {
    it('benennt den lokalen Datensatz auf die neue Server-id um, statt ihn unter der alten id zu belassen', async () => {
      const saved = await db.put('results', { event: '100m Freistil', time: 60 });
      const [event] = await db.getSyncQueue();
      const newServerId = 'server-generated-id';
      api.syncPush.mockResolvedValue({ results: [{ eventId: event.id, status: 'applied', serverVersion: { id: newServerId } }] });

      await push();

      // Alte id existiert lokal nicht mehr, neue id trägt denselben Inhalt.
      expect(await db.get('results', saved.id)).toBeNull();
      const renamed = await db.get('results', newServerId);
      expect(renamed).not.toBeNull();
      expect(renamed.event).toBe('100m Freistil');
      expect(renamed.time).toBe(60);

      // Das Sync-Event selbst bleibt unter der URSPRÜNGLICHEN entityId
      // vermerkt (spiegelt, was tatsächlich gesendet wurde) und ist "synced".
      const updatedEvent = (await db.getSyncQueue()).find((e) => e.id === event.id);
      expect(updatedEvent.status).toBe('synced');
    });

    it('benennt NICHT um, wenn serverVersion.id mit der bereits vorhandenen id übereinstimmt (regulärer Konfliktfall)', async () => {
      const saved = await db.put('groups', { name: 'X' });
      const [event] = await db.getSyncQueue();
      api.syncPush.mockResolvedValue({ results: [{ eventId: event.id, status: 'applied', serverVersion: { id: saved.id } }] });

      await push();
      expect(await db.get('groups', saved.id)).not.toBeNull();
    });

    it('kommt ohne serverVersion klar (normaler Anwendungsfall, keine Umbenennung nötig)', async () => {
      const saved = await db.put('groups', { name: 'X' });
      const [event] = await db.getSyncQueue();
      api.syncPush.mockResolvedValue({ results: [{ eventId: event.id, status: 'applied' }] });

      await push();
      expect(await db.get('groups', saved.id)).not.toBeNull();
    });
  });
});

// Regressionstest für Befund C1 (Code-Review): die Warteschlange wurde
// zuvor als EIN Request gesendet — eine Offline-Phase mit mehr als 500
// Events (server-seitiges Limit, siehe
// packages/shared-types/src/syncEvent.ts: SyncPushRequestSchema) ließ
// push() dadurch dauerhaft mit einer 400 scheitern, ohne sich je
// abzubauen. push() muss die Warteschlange stattdessen in Blöcken senden.
describe('push() — Chunking bei großen Warteschlangen', () => {
  it('sendet mehr als PUSH_BATCH_SIZE (200) ausstehende Events in mehreren api.syncPush()-Aufrufen', async () => {
    const EVENT_COUNT = 210;
    for (let i = 0; i < EVENT_COUNT; i++) await db.put('groups', { name: `Gruppe ${i}` });

    api.syncPush.mockImplementation(async (events) => ({
      results: events.map((e) => ({ eventId: e.id, status: 'applied' })),
    }));

    const result = await push();
    expect(result).toEqual({ sent: EVENT_COUNT, applied: EVENT_COUNT, conflicts: 0, errors: 0 });
    expect(api.syncPush).toHaveBeenCalledTimes(2);
    expect(api.syncPush.mock.calls[0][0]).toHaveLength(200);
    expect(api.syncPush.mock.calls[1][0]).toHaveLength(10);

    const queue = await db.getSyncQueue();
    expect(queue.every((e) => e.status === 'synced')).toBe(true);
  });
});

describe('pull()', () => {
  it('übernimmt eine neue/geänderte Zeile vom Server per putWithoutSync (kein neues Sync-Event)', async () => {
    api.syncPull.mockResolvedValue({
      changes: [{ store: 'groups', entityId: 'g1', action: 'update', payload: { id: 'g1', name: 'Vom Server', deletedAt: null }, updatedAt: '2026-01-01T00:00:00.000Z' }],
      nextCursor: '2026-01-01T00:00:00.000Z',
      hasMore: false,
    });

    const result = await pull();
    expect(result).toEqual({ received: 1 });
    const stored = await db.get('groups', 'g1');
    expect(stored.name).toBe('Vom Server');
    // "deletedAt" wird beim Übernehmen entfernt (siehe pull()-Kommentar).
    expect(stored.deletedAt).toBeUndefined();
    // Kein neues Sync-Event für eine vom Server empfangene Änderung.
    expect(await db.getSyncQueue()).toEqual([]);
  });

  it('entfernt eine Zeile lokal bei action: "delete"', async () => {
    await db.putWithoutSync('groups', { id: 'g1', name: 'X' });
    api.syncPull.mockResolvedValue({
      changes: [{ store: 'groups', entityId: 'g1', action: 'delete', payload: null, updatedAt: '2026-01-01T00:00:00.000Z' }],
      nextCursor: '2026-01-01T00:00:00.000Z',
      hasMore: false,
    });

    await pull();
    expect(await db.get('groups', 'g1')).toBeNull();
  });

  // Regressionstest für Befund 1: der Cursor muss auch dann persistiert
  // werden, wenn alle Änderungen in eine einzige Seite passen (hasMore:
  // false) — sonst zieht jeder Hintergrund-Sync dauerhaft den kompletten
  // Bestand erneut.
  it('persistiert den vom Server gelieferten Cursor auch bei einer einzigen, abschließenden Seite', async () => {
    api.syncPull.mockResolvedValue({
      changes: [{ store: 'groups', entityId: 'g1', action: 'update', payload: { id: 'g1', name: 'X' }, updatedAt: '2026-01-01T00:00:00.000Z' }],
      nextCursor: '2026-01-01T00:00:00.000Z',
      hasMore: false,
    });
    await pull();

    // Ein zweiter pull()-Aufruf muss den gespeicherten Cursor an die API
    // weitergeben, statt wieder bei "kein Cursor" (voller Bestand) zu
    // beginnen.
    api.syncPull.mockResolvedValue({ changes: [], nextCursor: null, hasMore: false });
    await pull();
    expect(api.syncPull).toHaveBeenLastCalledWith('2026-01-01T00:00:00.000Z');
  });

  it('holt bei hasMore: true eine weitere Seite mit dem zurückgegebenen Cursor nach', async () => {
    api.syncPull
      .mockResolvedValueOnce({
        changes: [{ store: 'groups', entityId: 'g1', action: 'update', payload: { id: 'g1', name: 'A' }, updatedAt: '2026-01-01T00:00:00.000Z' }],
        nextCursor: '2026-01-01T00:00:00.000Z',
        hasMore: true,
      })
      .mockResolvedValueOnce({
        changes: [{ store: 'groups', entityId: 'g2', action: 'update', payload: { id: 'g2', name: 'B' }, updatedAt: '2026-01-02T00:00:00.000Z' }],
        nextCursor: '2026-01-02T00:00:00.000Z',
        hasMore: false,
      });

    const result = await pull();
    expect(result).toEqual({ received: 2 });
    expect(api.syncPull).toHaveBeenNthCalledWith(1, null);
    expect(api.syncPull).toHaveBeenNthCalledWith(2, '2026-01-01T00:00:00.000Z');
    expect(await db.get('groups', 'g1')).not.toBeNull();
    expect(await db.get('groups', 'g2')).not.toBeNull();
  });

  // Regressionstests für Befund C5 (Code-Review): pull() vertraute bislang
  // uneingeschränkt der Server-Invariante, dass hasMore: true niemals
  // zusammen mit nextCursor: null geliefert wird. Verletzt eine
  // (fehlerhafte) Server-Antwort diese Invariante, zog die Schleife zuvor
  // mit cursor: null endlos dieselbe Seite erneut.
  it('bricht ab, wenn der Server hasMore: true ohne nextCursor liefert, statt endlos dieselbe Seite erneut abzufragen', async () => {
    api.syncPull.mockResolvedValue({
      changes: [{ store: 'groups', entityId: 'g1', action: 'update', payload: { id: 'g1', name: 'A' }, updatedAt: '2026-01-01T00:00:00.000Z' }],
      nextCursor: null,
      hasMore: true,
    });

    const result = await pull();
    expect(result).toEqual({ received: 1 });
    expect(api.syncPull).toHaveBeenCalledTimes(1);
  });

  it('wirft nach MAX_PULL_ITERATIONS Seiten ohne hasMore: false statt endlos weiterzuziehen', async () => {
    let call = 0;
    api.syncPull.mockImplementation(async () => {
      call++;
      return {
        changes: [{ store: 'groups', entityId: `g${call}`, action: 'update', payload: { id: `g${call}`, name: 'X' }, updatedAt: `2026-01-01T00:00:${String(call).padStart(2, '0')}.000Z` }],
        nextCursor: `2026-01-01T00:00:${String(call).padStart(2, '0')}.000Z`,
        hasMore: true,
      };
    });

    await expect(pull()).rejects.toThrow(/Abbruch nach 1000 Seiten/);
    expect(api.syncPull).toHaveBeenCalledTimes(1000);
  });
});

describe('runSync()', () => {
  it('führt push() gefolgt von pull() aus und kombiniert beide Ergebnisse', async () => {
    await db.put('groups', { name: 'X' });
    const [event] = await db.getSyncQueue();
    api.syncPush.mockResolvedValue({ results: [{ eventId: event.id, status: 'applied' }] });
    api.syncPull.mockResolvedValue({ changes: [], nextCursor: null, hasMore: false });

    const result = await runSync();
    expect(result).toMatchObject({ sent: 1, applied: 1, received: 0 });
    // push() vor pull() — siehe Datei-Kommentar in syncClient.js.
    expect(api.syncPush).toHaveBeenCalled();
    expect(api.syncPull).toHaveBeenCalled();
  });
});
