// ============================================================
// syncClient.js — Phase 4: löst die Simulation in modules/syncQueue.js
// durch echte Aufrufe von POST /api/sync/push und GET /api/sync/pull ab.
//
// Reihenfolge pro Zyklus: erst push(), dann pull() (siehe Backend-
// Entwicklungsplan, Abschnitt 6.3) — eigene Änderungen zuerst hochladen,
// damit sie nicht durch einen Pull-Konflikt mit dem eigenen, noch nicht
// gesendeten Stand kollidieren.
// ============================================================
import { getSendableSyncEvents, bulkUpdateSyncEvents, applyPulledChanges, put, get, putWithoutSync, removeWithoutSync } from './db.js';
import * as api from './apiClient.js';

const META_CURSOR_KEY = 'syncCursor';

// Server-Obergrenze pro Push-Request (siehe
// packages/shared-types/src/syncEvent.ts: SyncPushRequestSchema —
// `events: z.array(...).max(500)`). Deutlich darunter, damit push() in
// mehreren Blöcken senden kann (siehe unten) statt an dieser Grenze zu
// scheitern.
const PUSH_BATCH_SIZE = 200;

// Ein Event, das serverseitig DAUERHAFT scheitert (z. B. unbekannter
// Store, verletzter Fremdschlüssel, gelöschte Referenz), würde mit
// status: 'error' bei JEDEM weiteren Sync-Zyklus (alle 60s, siehe app.js)
// erneut mitgeschickt — für immer, ohne diese Obergrenze. Ab dieser
// Anzahl Versuche gilt ein Event stattdessen als 'failed' (siehe push()
// unten) und wird aus dem automatischen Push-Filter genommen — die
// Sync-Warteschlangen-Ansicht (modules/syncQueue.js) zeigt es weiterhin an
// und bietet über den vorhandenen "Erneut versuchen"-Button einen
// manuellen Reset auf 'pending'.
const MAX_SYNC_ATTEMPTS = 5;

// pull() verlässt sich darauf, dass der Server niemals hasMore: true
// zusammen mit nextCursor: null liefert (serverseitig ausgeschlossen,
// siehe sync.service.ts) — bräche diese Invariante durch einen
// Server-Fehler, würde die Schleife sonst mit cursor: null endlos
// dieselbe (erste) Seite erneut abfragen. Eine harte Iterationsobergrenze
// dient als zweites, vom Server unabhängiges Sicherheitsnetz.
const MAX_PULL_ITERATIONS = 1000;

async function getCursor() {
  const meta = await get('meta', META_CURSOR_KEY);
  return meta?.cursor ?? null;
}
async function setCursor(cursor) {
  await put('meta', { id: META_CURSOR_KEY, cursor });
}

// Sicherheitsreview 2026-08-27, Befund N5: Der Cursor ist EIN globaler
// Wasserstand für alle Stores zusammen, nicht pro Store — beim Erkennen
// einer Modul-Abbestellung (siehe state.js: applyEnabledModules()) reicht
// es daher nicht, nur die betroffenen Stores lokal zu leeren. Ohne diesen
// Reset würde ein späteres Wieder-Zubuchen desselben Pakets die zuvor
// entfernten Datensätze NICHT automatisch erneut ziehen — pull() liefert ab
// dem gespeicherten Cursor nur noch Änderungen, die bereits gepullten,
// unveränderten Altbestand also nie wieder. Ein Reset auf `null` erzwingt
// beim nächsten pull() einen vollständigen Neuabzug ALLER Stores (auch der
// von der Abbestellung nicht betroffenen) — etwas ineffizienter als ein
// Reset nur für das betroffene Paket, aber ohne zusätzliche
// Cursor-Buchführung je Store umsetzbar, und Modul-Abbestellungen sind
// ein seltenes, administratives Ereignis statt ein häufiger Vorgang.
export async function resetCursor() {
  await setCursor(null);
}

// Übernimmt eine vom Server bei "insert-as-new" vergebene neue id in die
// lokale Ablage: liest den Datensatz unter der alten (client-generierten)
// id, speichert ihn unter der neuen id — OHNE ein neues Sync-Event zu
// erzeugen, der Server hat ihn ja bereits unter dieser id angelegt (siehe
// putWithoutSync()) —, entfernt danach die alte Kopie lokal (ebenfalls
// ohne Sync-Event, siehe removeWithoutSync()). Siehe push() unten für den
// Hintergrund.
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
// Sync-Warteschlange, in Blöcken von PUSH_BATCH_SIZE statt als einen
// einzigen Request — eine Offline-Phase mit mehr als 500 Änderungen
// (server-seitiges Limit, siehe oben) würde sonst mit einer 400
// fehlschlagen, dauerhaft, denn die Warteschlange könnte sich nie unter
// 500 abbauen; ein Logout in diesem Zustand verlöre per wipeAll() (siehe
// state.js: logout()) sämtliche ausstehenden Änderungen. Aktualisiert
// jedes Event anhand der Server-Antwort (siehe apps/api SyncEventResult:
// "applied" | "conflict" | "error"). Schlägt ein Block fehl
// (Netzwerk-/Serverfehler), wirft diese Funktion weiter — bereits
// verarbeitete Blöcke bleiben als 'synced'/'error' markiert, der nächste
// Sync-Zyklus setzt bei den verbleibenden Events fort.
export async function push() {
  // Ineffizienz-Korrektur: holt nur die tatsächlich sendbaren Events über
  // den status-Index (siehe db.js: getSendableSyncEvents()), statt die
  // gesamte Warteschlange zu laden und hier zu filtern — dauerhaft
  // gescheiterte ('failed') Events samt payload-Blobs wurden sonst bei
  // jedem Zyklus mitgelesen, obwohl sie nie wieder gesendet werden.
  const toSend = await getSendableSyncEvents();
  if (toSend.length === 0) return { sent: 0, applied: 0, conflicts: 0, errors: 0 };

  let applied = 0, conflicts = 0, errors = 0;

  for (let i = 0; i < toSend.length; i += PUSH_BATCH_SIZE) {
    const batch = toSend.slice(i, i + PUSH_BATCH_SIZE);
    const bySourceId = new Map(batch.map(e => [e.id, e]));
    const events = batch.map(e => ({
      id: e.id, store: e.store, entityId: e.entityId, action: e.action,
      payload: e.payload, clientUpdatedAt: e.createdAt,
    }));

    const { results } = await api.syncPush(events);

    // Ineffizienz-Korrektur: die Statusaktualisierungen dieses Blocks
    // werden gesammelt und am Blockende in EINER Transaktion geschrieben
    // (siehe db.js: bulkUpdateSyncEvents()) statt einzeln je Ergebnis
    // (dort zuvor je ein get() und ein put(), also bis zu 400
    // Transaktionen je 200er-Block). Bewusst je BLOCK geschrieben, nicht
    // erst am Ende aller Blöcke: scheitert ein späterer Block mit einem
    // Netzwerkfehler, müssen die Ergebnisse der bereits erfolgreich
    // gesendeten Blöcke persistiert sein — sonst würden sie beim nächsten
    // Zyklus erneut gesendet.
    const queueUpdates = [];

    for (const result of results) {
      const sourceEvent = bySourceId.get(result.eventId);
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
        queueUpdates.push({ id: result.eventId, patch: { status: 'synced', syncedAt: new Date().toISOString(), attempts: (sourceEvent?.attempts || 0) + 1, lastError: null } });
      } else if (result.status === 'conflict') {
        conflicts++;
        // Server-Stand ist neuer — das lokale Event wird verworfen (nicht
        // als Fehler markiert, siehe Konfliktstrategie last-write-wins);
        // der nächste pull() bringt den aktuellen Serverstand ohnehin lokal
        // an.
        queueUpdates.push({ id: result.eventId, patch: { status: 'synced', syncedAt: new Date().toISOString(), lastError: null } });
      } else {
        errors++;
        const attempts = (sourceEvent?.attempts || 0) + 1;
        // Nach MAX_SYNC_ATTEMPTS Fehlschlägen gilt das Event als 'failed'
        // statt weiterhin 'error' — 'failed' fällt aus dem obigen
        // toSend-Filter heraus und wird dadurch nicht mehr automatisch
        // wiederholt (siehe Konstanten-Kommentar oben).
        const status = attempts >= MAX_SYNC_ATTEMPTS ? 'failed' : 'error';
        // `lastError` bleibt die (deutsche) Server-Diagnosemeldung — für
        // Fehlerberichte/Logs. `lastErrorCode` ist der stabile, über
        // apps/web/js/i18n/{de-DE,en-US}.js: common.syncErrors übersetzte
        // Stellvertreter, den modules/syncQueue.js für die Anzeige nutzt
        // (siehe dortiger Kommentar) — analog zu apiErrorMessage() in
        // apiClient.js für reguläre HTTP-4xx-Antworten.
        queueUpdates.push({ id: result.eventId, patch: { status, attempts, lastError: result.message || 'Unbekannter Fehler.', lastErrorCode: result.code ?? null } });
      }
    }

    await bulkUpdateSyncEvents(queueUpdates);
  }

  return { sent: toSend.length, applied, conflicts, errors };
}

function stripDeletedAt(payload) {
  const { deletedAt: _deletedAt, ...rest } = payload;
  return rest;
}

// Holt Änderungen anderer Geräte/Nutzer:innen des eigenen Vereins seit dem
// zuletzt gespeicherten Cursor und schreibt sie in die passenden lokalen
// IndexedDB-Stores. Löscht (statt zu importieren) bei action: "delete".
export async function pull() {
  let cursor = await getCursor();
  let totalChanges = 0;
  let hasMore = true;
  let iterations = 0;

  while (hasMore) {
    if (iterations >= MAX_PULL_ITERATIONS) {
      throw new Error(`pull(): Abbruch nach ${MAX_PULL_ITERATIONS} Seiten ohne hasMore: false — vermutlich ein Server-Fehler.`);
    }
    iterations++;

    const response = await api.syncPull(cursor);
    // Ineffizienz-Korrektur: die gesamte Seite wird in EINER
    // store-übergreifenden IndexedDB-Transaktion angewendet (siehe db.js:
    // applyPulledChanges()) statt in einer je Datensatz. Beim erstmaligen
    // Vollabzug eines Vereins waren das zuvor hunderte bis tausende
    // Einzeltransaktionen nacheinander — der spürbar langsamste Teil des
    // ersten Logins auf einem Mobilgerät.
    //
    // `deletedAt` ist kein Feld der Entity-Schemas (siehe
    // packages/shared-types/src/entities.ts) — die generische Sync-API
    // liefert für nicht gelöschte Zeilen dennoch den vollständigen
    // Prisma-Datensatz inkl. dieser (stets null-wertigen) Spalte. Würde
    // sie unverändert lokal gespeichert, würde jede spätere Bearbeitung
    // dieses Datensatzes (siehe modules/*.js: `{ ...data }`) sie beim
    // nächsten Push wieder mitschicken — der `.strict()`-Zod-Schema-Check
    // auf dem Server lehnt unbekannte Felder ab, das Update würde dann mit
    // "Payload entspricht nicht dem Schema" fehlschlagen. Kein
    // Frontend-Code liest `.deletedAt` lokal (Löschungen laufen
    // ausschließlich über eigene "delete"-Sync-Events) — das Feld wird
    // daher beim Übernehmen in die lokale Ablage konsequent entfernt statt
    // nur ignoriert.
    const changes = response.changes.map((change) =>
      change.action === 'delete'
        ? change
        : { ...change, payload: stripDeletedAt(change.payload) },
    );
    totalChanges += await applyPulledChanges(changes);
    cursor = response.nextCursor;
    hasMore = response.hasMore;
    // Sicherheitsnetz: hasMore: true ohne nextCursor dürfte laut
    // Server-Invariante nie vorkommen — Abbruch statt Endlosschleife mit
    // cursor: null.
    if (!cursor) break;
    await setCursor(cursor);
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
