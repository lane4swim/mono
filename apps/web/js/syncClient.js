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

// Übernimmt eine vom Server bei "insert-as-new" vergebene neue id in die
// lokale Ablage: liest den Datensatz unter der alten (client-generierten)
// id, speichert ihn unter der neuen id — OHNE ein neues Sync-Event zu
// erzeugen, der Server hat ihn ja bereits unter dieser id angelegt (siehe
// putWithoutSync()) —, entfernt danach die alte Kopie lokal (ebenfalls
// ohne Sync-Event, siehe removeWithoutSync()). Siehe push() unten für den
// Hintergrund (Code-Review, Befund 12).
//
// Bekannte Grenze: ein weiteres, zum Zeitpunkt DIESES Push-Zyklus bereits
// in der Warteschlange stehendes Event für dieselbe alte entityId (z. B.
// ein unmittelbar danach offline erfasstes zweites Update desselben
// Datensatzes) liefe anschließend ins Leere, da der lokale Datensatz nicht
// mehr unter der alten id existiert. In der Praxis wird "results" — der
// einzige Store mit dieser Konfliktstrategie — nach dem Anlegen so gut wie
// nie noch einmal offline bearbeitet.
async function renameLocalRecord(store, oldId, newId) {
  const existing = await get(store, oldId);
  if (!existing) return;
  await putWithoutSync(store, { ...existing, id: newId });
  await removeWithoutSync(store, oldId);
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
    const sourceEvent = toSend.find(e => e.id === result.eventId);
    if (result.status === 'applied') {
      applied++;
      // "insert-as-new" (siehe apps/api sync.service.ts: resolveConflict()
      // -> "results" nutzt die Konfliktstrategie "never-overwrite") vergibt
      // bei einem Konflikt serverseitig eine NEUE id statt zu
      // überschreiben und meldet sie über serverVersion.id zurück. Ohne
      // dieses Nachziehen bliebe der lokale Datensatz unter der ALTEN
      // (client-generierten) id gespeichert; der nächste pull() würde
      // denselben Datensatz zusätzlich unter der NEUEN id importieren —
      // er erschiene lokal doppelt (siehe renameLocalRecord() oben).
      const newId = result.serverVersion?.id;
      if (sourceEvent && typeof newId === 'string' && newId !== sourceEvent.entityId) {
        await renameLocalRecord(sourceEvent.store, sourceEvent.entityId, newId);
      }
      await updateSyncEvent(result.eventId, { status: 'synced', syncedAt: new Date().toISOString(), attempts: (sourceEvent?.attempts || 0) + 1, lastError: null });
    } else if (result.status === 'conflict') {
      conflicts++;
      // Server-Stand ist neuer — das lokale Event wird verworfen (nicht
      // als Fehler markiert, siehe Konfliktstrategie last-write-wins);
      // der nächste pull() bringt den aktuellen Serverstand ohnehin lokal
      // an.
      await updateSyncEvent(result.eventId, { status: 'synced', syncedAt: new Date().toISOString(), lastError: null });
    } else {
      errors++;
      await updateSyncEvent(result.eventId, { status: 'error', attempts: (sourceEvent?.attempts || 0) + 1, lastError: result.message || 'Unbekannter Fehler.' });
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
        // `deletedAt` ist kein Feld der Entity-Schemas (siehe
        // packages/shared-types/src/entities.ts) — die generische Sync-API
        // liefert für nicht gelöschte Zeilen dennoch den vollständigen
        // Prisma-Datensatz inkl. dieser (stets null-wertigen) Spalte. Würde
        // sie hier unverändert lokal gespeichert, würde jede spätere
        // Bearbeitung dieses Datensatzes (siehe modules/*.js: `{ ...data }`)
        // sie beim nächsten Push wieder mitschicken — der `.strict()`-Zod-
        // Schema-Check auf dem Server lehnt unbekannte Felder ab, das
        // Update würde dann mit "Payload entspricht nicht dem Schema"
        // fehlschlagen. Kein Frontend-Code liest `.deletedAt` lokal
        // (Löschungen laufen ausschließlich über eigene "delete"-Sync-
        // Events, siehe oben) — das Feld wird daher beim Übernehmen in die
        // lokale Ablage konsequent entfernt statt nur ignoriert.
        const { deletedAt, ...payload } = change.payload;
        await putWithoutSync(change.store, payload);
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
