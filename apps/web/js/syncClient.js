// ============================================================
// syncClient.js — Phase 4: löst die Simulation in modules/syncQueue.js
// durch echte Aufrufe von POST /api/sync/push und GET /api/sync/pull ab.
//
// Reihenfolge pro Zyklus: erst push(), dann pull() (siehe Backend-
// Entwicklungsplan, Abschnitt 6.3) — eigene Änderungen zuerst hochladen,
// damit sie nicht durch einen Pull-Konflikt mit dem eigenen, noch nicht
// gesendeten Stand kollidieren.
// ============================================================
import { getSyncQueue, updateSyncEvent, put, get, putWithoutSync, removeWithoutSync } from './db.js';
import * as api from './apiClient.js';

const META_CURSOR_KEY = 'syncCursor';

async function getCursor() {
  const meta = await get('meta', META_CURSOR_KEY);
  return meta?.cursor ?? null;
}
async function setCursor(cursor) {
  await put('meta', { id: META_CURSOR_KEY, cursor });
}

// Sendet alle ausstehenden/fehlerhaften Events aus der lokalen
// Sync-Warteschlange. Aktualisiert jedes Event anhand der Server-Antwort
// (siehe apps/api SyncEventResult: "applied" | "conflict" | "error").
export async function push() {
  const queue = await getSyncQueue();
  const toSend = queue.filter(e => e.status === 'pending' || e.status === 'error');
  if (toSend.length === 0) return { sent: 0, applied: 0, conflicts: 0, errors: 0 };

  const events = toSend.map(e => ({
    id: e.id, store: e.store, entityId: e.entityId, action: e.action,
    payload: e.payload, clientUpdatedAt: e.createdAt,
  }));

  const { results } = await api.syncPush(events);
  let applied = 0, conflicts = 0, errors = 0;

  for (const result of results) {
    if (result.status === 'applied') {
      applied++;
      await updateSyncEvent(result.eventId, { status: 'synced', syncedAt: new Date().toISOString(), attempts: (queue.find(e => e.id === result.eventId)?.attempts || 0) + 1, lastError: null });
    } else if (result.status === 'conflict') {
      conflicts++;
      // Server-Stand ist neuer — das lokale Event wird verworfen (nicht
      // als Fehler markiert, siehe Konfliktstrategie last-write-wins);
      // der nächste pull() bringt den aktuellen Serverstand ohnehin lokal
      // an.
      await updateSyncEvent(result.eventId, { status: 'synced', syncedAt: new Date().toISOString(), lastError: null });
    } else {
      errors++;
      await updateSyncEvent(result.eventId, { status: 'error', attempts: (queue.find(e => e.id === result.eventId)?.attempts || 0) + 1, lastError: result.message || 'Unbekannter Fehler.' });
    }
  }

  return { sent: toSend.length, applied, conflicts, errors };
}

// Holt Änderungen anderer Geräte/Nutzer:innen des eigenen Vereins seit dem
// zuletzt gespeicherten Cursor und schreibt sie in die passenden lokalen
// IndexedDB-Stores. Löscht (statt zu importieren) bei action: "delete".
export async function pull() {
  let cursor = await getCursor();
  let totalChanges = 0;
  let hasMore = true;

  while (hasMore) {
    const response = await api.syncPull(cursor);
    for (const change of response.changes) {
      if (change.action === 'delete') {
        await removeWithoutSync(change.store, change.entityId).catch(() => { /* bereits lokal entfernt */ });
      } else {
        await putWithoutSync(change.store, change.payload);
      }
      totalChanges++;
    }
    cursor = response.nextCursor;
    hasMore = response.hasMore;
    if (cursor) await setCursor(cursor);
  }

  return { received: totalChanges };
}

// Führt einen vollständigen Sync-Zyklus aus (push, dann pull) und wirft
// bei einem Netzwerk-/Serverfehler weiter, damit der Aufrufer (siehe
// modules/syncQueue.js) eine passende Fehlermeldung anzeigen kann.
export async function runSync() {
  const pushResult = await push();
  const pullResult = await pull();
  return { ...pushResult, ...pullResult };
}
