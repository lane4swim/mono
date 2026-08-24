// apps/web/test/db.test.js
//
// Testet js/db.js — den generischen IndexedDB-Wrapper inkl. der
// Sync-Warteschlange (Outbox-Pattern), bislang völlig ungetestet (Code-
// Review, Befund 15). state.js wird gemockt, um getCurrentUser() ohne den
// echten Login-Fluss (Netzwerk, apiClient.js) steuern zu können — db.js
// braucht davon nur die aktuell eingeloggte clubId (siehe put(): fügt
// clubId für neu angelegte, vereins-gescopte Datensätze automatisch hinzu).
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../js/state.js', () => ({ getCurrentUser: vi.fn(() => null) }));
vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));

import { getCurrentUser } from '../js/state.js';
import * as db from '../js/db.js';

beforeEach(async () => {
  vi.mocked(getCurrentUser).mockReturnValue(null);
  await db.wipeAll();
});

describe('put()', () => {
  it('vergibt eine id und Zeitstempel für einen neuen Datensatz', async () => {
    const saved = await db.put('groups', { name: 'Leistungsgruppe' });
    expect(saved.id).toBeTruthy();
    expect(saved.createdAt).toBeTruthy();
    expect(saved.updatedAt).toBe(saved.createdAt);

    const fetched = await db.get('groups', saved.id);
    expect(fetched).toEqual(saved);
  });

  it('aktualisiert updatedAt, behält createdAt bei einer Bearbeitung', async () => {
    const created = await db.put('groups', { name: 'Original' });
    await new Promise((r) => setTimeout(r, 2));
    const updated = await db.put('groups', { ...created, name: 'Geändert' });

    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.updatedAt).not.toBe(created.updatedAt);
  });

  // Siehe Kommentar bei CLUB_SCOPED_STORES in db.js: ohne diese
  // Auto-Ergänzung scheiterte der allererste Sync-Push eines neu
  // angelegten Datensatzes IMMER, da das Formular selbst die eingeloggte
  // clubId nicht kennt.
  it('ergänzt clubId automatisch für einen vereins-gescopten Store, wenn eine Person eingeloggt ist', async () => {
    vi.mocked(getCurrentUser).mockReturnValue({ clubId: 'club-123' });
    const saved = await db.put('athletes', { firstName: 'Mara', lastName: 'Vogel' });
    expect(saved.clubId).toBe('club-123');
  });

  it('überschreibt eine bereits vorhandene clubId NICHT', async () => {
    vi.mocked(getCurrentUser).mockReturnValue({ clubId: 'club-neu' });
    const saved = await db.put('athletes', { firstName: 'Mara', lastName: 'Vogel', clubId: 'club-alt' });
    expect(saved.clubId).toBe('club-alt');
  });

  it('ergänzt keine clubId für einen NICHT vereins-gescopten Store (z. B. "meta")', async () => {
    vi.mocked(getCurrentUser).mockReturnValue({ clubId: 'club-123' });
    const saved = await db.put('meta', { id: 'x', value: 1 });
    expect(saved.clubId).toBeUndefined();
  });

  it('reiht ein "create"-Sync-Event ein für einen neuen Datensatz', async () => {
    const saved = await db.put('groups', { name: 'Leistungsgruppe' });
    const queue = await db.getSyncQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ store: 'groups', entityId: saved.id, action: 'create', status: 'pending' });
  });

  it('reiht ein "update"-Sync-Event ein für einen bestehenden Datensatz', async () => {
    const created = await db.put('groups', { name: 'Original' });
    await db.put('groups', { ...created, name: 'Geändert' });
    const queue = await db.getSyncQueue();
    // Ein "create"- und ein "update"-Event — IndexedDBs getAll() liefert
    // keine garantierte Einfüge-Reihenfolge (sortiert nach Schlüssel, hier
    // eine zufällige uid()), daher ungeordnet vergleichen.
    expect(queue.map((e) => e.action).sort()).toEqual(['create', 'update']);
  });

  it('reiht KEIN Sync-Event für "meta"/"syncQueue" selbst ein (SYNC_EXCLUDED)', async () => {
    await db.put('meta', { id: 'x', value: 1 });
    expect(await db.getSyncQueue()).toEqual([]);
  });

  it('entfernt ein evtl. vorhandenes "deletedAt"-Feld aus dem Sync-Event-Payload', async () => {
    const saved = await db.put('groups', { name: 'X', deletedAt: null });
    const queue = await db.getSyncQueue();
    expect(queue[0].payload.deletedAt).toBeUndefined();
    // Das Feld bleibt aber im LOKAL gespeicherten Datensatz selbst erhalten
    // (nur der ausgehende Sync-Event-Payload wird bereinigt).
    expect(saved.deletedAt).toBeNull();
  });
});

describe('putWithoutSync()', () => {
  it('speichert den Datensatz, ohne ein Sync-Event zu erzeugen', async () => {
    await db.putWithoutSync('groups', { id: 'g1', name: 'Von einem anderen Gerät' });
    expect(await db.get('groups', 'g1')).toMatchObject({ name: 'Von einem anderen Gerät' });
    expect(await db.getSyncQueue()).toEqual([]);
  });

  it('überschreibt updatedAt NICHT — der übergebene Wert bleibt maßgeblich', async () => {
    await db.putWithoutSync('groups', { id: 'g1', name: 'X', updatedAt: '2026-01-01T00:00:00.000Z' });
    const fetched = await db.get('groups', 'g1');
    expect(fetched.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('remove()/removeWithoutSync()', () => {
  it('reiht bei remove() ein "delete"-Sync-Event ein', async () => {
    const saved = await db.put('groups', { name: 'X' });
    await db.remove('groups', saved.id);
    expect(await db.get('groups', saved.id)).toBeNull();
    const queue = await db.getSyncQueue();
    const deleteEvent = queue.find((e) => e.action === 'delete');
    expect(deleteEvent).toMatchObject({ store: 'groups', entityId: saved.id, action: 'delete', payload: null });
  });

  it('erzeugt bei removeWithoutSync() KEIN Sync-Event', async () => {
    await db.putWithoutSync('groups', { id: 'g1', name: 'X' });
    await db.removeWithoutSync('groups', 'g1');
    expect(await db.get('groups', 'g1')).toBeNull();
    expect(await db.getSyncQueue()).toEqual([]);
  });
});

describe('Sync-Warteschlange — Bookkeeping', () => {
  it('pendingSyncCount() zählt "pending" und "error", nicht "synced"', async () => {
    const a = await db.put('groups', { name: 'A' });
    const b = await db.put('groups', { name: 'B' });
    await db.put('groups', { name: 'C' });
    const queue = await db.getSyncQueue();
    await db.updateSyncEvent(queue.find((e) => e.entityId === a.id).id, { status: 'synced' });
    await db.updateSyncEvent(queue.find((e) => e.entityId === b.id).id, { status: 'error' });

    expect(await db.pendingSyncCount()).toBe(2); // "C" (pending) + "B" (error)
  });

  it('clearSyncedEvents() entfernt nur "synced"-Einträge und liefert deren Anzahl', async () => {
    const a = await db.put('groups', { name: 'A' });
    await db.put('groups', { name: 'B' });
    const queueBefore = await db.getSyncQueue();
    await db.updateSyncEvent(queueBefore.find((e) => e.entityId === a.id).id, { status: 'synced' });

    const removed = await db.clearSyncedEvents();
    expect(removed).toBe(1);
    const queueAfter = await db.getSyncQueue();
    expect(queueAfter).toHaveLength(1);
    expect(queueAfter[0].entityId).not.toBe(a.id);
  });

  it('clearSyncedEvents() liefert 0, ohne etwas zu löschen, wenn keine "synced"-Einträge vorliegen', async () => {
    await db.put('groups', { name: 'A' });
    expect(await db.clearSyncedEvents()).toBe(0);
    expect(await db.getSyncQueue()).toHaveLength(1);
  });

  // Regressionstests für Befund P5 (Code-Review): pendingSyncCount() und
  // clearSyncedEvents() lasen zuvor bei JEDEM Aufruf die GESAMTE
  // Warteschlange (getAll()) — dieser Pfad läuft nach jedem Render, jedem
  // Sync-Zyklus und beim Logout. Der neue status-Index (siehe db.js:
  // openDb()) erlaubt stattdessen gezielte count()/getAllKeys()-Abfragen.
  // Per Spy auf die IndexedDB-Primitive selbst geprüft (nicht nur das
  // Ergebnis) — beweist, dass tatsächlich der Index genutzt wird, nicht
  // nur, dass das Endergebnis zufällig übereinstimmt.
  describe('nutzt den status-Index statt getAll() (Befund P5)', () => {
    it('pendingSyncCount() ruft NIE objectStore.getAll() auf, sondern index("status").count() zweimal', async () => {
      const a = await db.put('groups', { name: 'A' });
      await db.put('groups', { name: 'B' });
      await db.put('groups', { name: 'C' });
      const queue = await db.getSyncQueue();
      await db.updateSyncEvent(queue.find((e) => e.entityId === a.id).id, { status: 'synced' });

      const getAllSpy = vi.spyOn(IDBObjectStore.prototype, 'getAll');
      const countSpy = vi.spyOn(IDBIndex.prototype, 'count');
      try {
        expect(await db.pendingSyncCount()).toBe(2);
        expect(getAllSpy).not.toHaveBeenCalled();
        expect(countSpy).toHaveBeenCalledTimes(2);
        expect(countSpy.mock.calls.map((c) => c[0]).sort()).toEqual(['error', 'pending']);
      } finally {
        getAllSpy.mockRestore();
        countSpy.mockRestore();
      }
    });

    it('clearSyncedEvents() ruft NIE objectStore.getAll() auf, sondern index("status").getAllKeys("synced")', async () => {
      const a = await db.put('groups', { name: 'A' });
      await db.put('groups', { name: 'B' });
      const queue = await db.getSyncQueue();
      await db.updateSyncEvent(queue.find((e) => e.entityId === a.id).id, { status: 'synced' });

      const getAllSpy = vi.spyOn(IDBObjectStore.prototype, 'getAll');
      const getAllKeysSpy = vi.spyOn(IDBIndex.prototype, 'getAllKeys');
      try {
        expect(await db.clearSyncedEvents()).toBe(1);
        expect(getAllSpy).not.toHaveBeenCalled();
        expect(getAllKeysSpy).toHaveBeenCalledTimes(1);
        expect(getAllKeysSpy).toHaveBeenCalledWith('synced');
      } finally {
        getAllSpy.mockRestore();
        getAllKeysSpy.mockRestore();
      }
    });
  });
});

describe('countAll()', () => {
  it('liefert die Anzahl der Datensätze eines Stores', async () => {
    await db.put('groups', { name: 'A' });
    await db.put('groups', { name: 'B' });
    expect(await db.countAll('groups')).toBe(2);
  });

  it('liefert 0 für einen leeren Store', async () => {
    expect(await db.countAll('groups')).toBe(0);
  });

  // Regressionstest für Befund P5: countAll() lud vormals ALLE
  // Datensätze (getAll()), nur um deren .length zurückzugeben.
  it('ruft objectStore.count() auf, NICHT getAll()', async () => {
    await db.put('groups', { name: 'A' });

    const getAllSpy = vi.spyOn(IDBObjectStore.prototype, 'getAll');
    const countSpy = vi.spyOn(IDBObjectStore.prototype, 'count');
    try {
      expect(await db.countAll('groups')).toBe(1);
      expect(getAllSpy).not.toHaveBeenCalled();
      expect(countSpy).toHaveBeenCalledTimes(1);
    } finally {
      getAllSpy.mockRestore();
      countSpy.mockRestore();
    }
  });
});

describe('bulkPut()/exportAll()/importAll()/wipeAll()', () => {
  it('bulkPut() erzeugt KEIN Sync-Event (Seed-/Import-Daten sind keine Nutzeraktion)', async () => {
    await db.bulkPut('groups', [{ id: 'g1', name: 'A' }, { id: 'g2', name: 'B' }]);
    expect(await db.getAll('groups')).toHaveLength(2);
    expect(await db.getSyncQueue()).toEqual([]);
  });

  it('exportAll()/importAll() geben denselben Datenbestand über alle Stores hinweg wieder', async () => {
    await db.putWithoutSync('groups', { id: 'g1', name: 'A' });
    const dump = await db.exportAll();
    await db.wipeAll();
    expect(await db.getAll('groups')).toEqual([]);

    await db.importAll(dump);
    expect(await db.getAll('groups')).toEqual([{ id: 'g1', name: 'A' }]);
  });

  it('wipeAll() leert wirklich ALLE Stores, inklusive der Sync-Warteschlange', async () => {
    await db.put('groups', { name: 'A' });
    expect(await db.getSyncQueue()).not.toEqual([]);

    await db.wipeAll();
    for (const store of db.STORES) {
      expect(await db.getAll(store)).toEqual([]);
    }
  });
});
