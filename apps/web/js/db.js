// db.js — schlanker, Promise-basierter Wrapper um IndexedDB.
// Eine Datenbank, ein Object Store je Entität. Generisches CRUD, damit
// neue Module nur einen Store-Namen ergänzen müssen und get/getAll/
// put/remove kostenlos dazubekommen.
//
// Bewusst OHNE Import aus state.js: state.js importiert seinerseits
// wipeAll() von hier (Sitzungsende räumt die lokale Ablage auf) — ein
// Import in Gegenrichtung erzeugte einen Zyklus zwischen den beiden
// Modulen. put() unten braucht dennoch die clubId der aktuell
// eingeloggten Person (siehe CLUB_SCOPED_STORES-Kommentar dort); dafür
// registriert state.js beim Laden per setClubIdProvider() eine Callback-
// Funktion, statt dass db.js sich die Persistenzschicht selbst holt. Der
// Cycle verschwindet dadurch vollständig: db.js kennt state.js gar nicht
// mehr, nur noch dessen Ergebnis über diesen einen, injizierten Callback.
import { IS_DEMO } from './demoMode.js';

// demo.html läuft mit einer eigenen, vollständig getrennten IndexedDB-
// Datenbank statt 'lane1-db' — dadurch kann die Demo weder bereits
// synchronisierte Daten eines echten Kontos sehen, noch hinterlässt sie
// nach einem echten Login irgendwelche Spuren: beide laufen im selben
// Origin, aber IndexedDB ist pro Datenbankname isoliert, also gibt es
// schlicht nichts zum Vermischen oder Aufräumen.
const DB_NAME = IS_DEMO ? 'lane1-demo-db' : 'lane1-db';
// v3: Index auf syncQueue.status ergänzt (Code-Review, Befund P5) —
// pendingSyncCount()/clearSyncedEvents() lasen zuvor bei JEDEM Aufruf die
// GESAMTE Warteschlange (inkl. aller payload-Blobs) nur, um sie in
// JavaScript nach status zu filtern. pendingSyncCount() läuft nach jedem
// Render, jedem Sync-Zyklus (alle 60 s) und beim Logout — ein Index macht
// diesen häufigsten Pfad der App billig.
const DB_VERSION = 3;

export const STORES = [
  'users', 'athletes', 'groups', 'competitions', 'entries', 'results',
  'exercises', 'templates', 'plans', 'sessions', 'actionItems', 'meta', 'syncQueue',
  'clubs', 'invitations'
];

let dbPromise = null;

function openDb(){
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      STORES.forEach(name => {
        if (!db.objectStoreNames.contains(name)) {
          db.createObjectStore(name, { keyPath: 'id' });
        }
      });
      // `req.transaction` (die laufende versionchange-Transaktion) gibt
      // auch für bereits BESTEHENDE Stores (z. B. bei einem Upgrade von
      // v1/v2 einer bereits installierten PWA) Zugriff — IndexedDB baut
      // den Index dabei automatisch aus den vorhandenen Zeilen auf, keine
      // manuelle Migration nötig.
      const syncQueueStore = req.transaction.objectStore('syncQueue');
      if (!syncQueueStore.indexNames.contains('status')) {
        syncQueueStore.createIndex('status', 'status');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode = 'readonly'){
  return openDb().then(db => db.transaction(store, mode).objectStore(store));
}

// Wie tx(), aber für eine Transaktion über MEHRERE Stores hinweg: liefert
// die Transaktion selbst statt eines einzelnen Object Stores. IndexedDB
// erlaubt das ausdrücklich (`db.transaction([...])`) — genau das macht es
// möglich, eine ganze Pull-Seite (Änderungen quer über alle Stores) in
// EINER Transaktion anzuwenden statt in einer je Datensatz (siehe
// applyPulledChanges() unten).
function multiTx(stores, mode = 'readonly'){
  return openDb().then(db => db.transaction(stores, mode));
}

// Wartet auf den Abschluss einer (bereits vollständig befüllten)
// Transaktion. Gegenstück zu reqPromise() oben, nur eine Ebene höher —
// bei einem Bulk-Vorgang interessiert nicht das Ergebnis jeder einzelnen
// Anfrage, sondern nur, ob die Transaktion als Ganzes durchlief.
function txDone(transaction, result){
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

// Code-Review, Befund R6: dieselbe request→Promise-Übersetzung (onsuccess/
// onerror auf resolve/reject abbilden) stand vormals als Duplikat in fast
// jeder Funktion unten. `map` wandelt das rohe req.result bei Bedarf um
// (z. B. ein fehlendes Ergebnis auf `[]`/`null` statt `undefined`).
function reqPromise(req, map = (r) => r){
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(map(req.result));
    req.onerror = () => reject(req.error);
  });
}

export function uid(){
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

export async function getAll(store){
  const os = await tx(store);
  return reqPromise(os.getAll(), (r) => r || []);
}

export async function get(store, id){
  const os = await tx(store);
  return reqPromise(os.get(id), (r) => r || null);
}

// Stores, die interne Buchführung statt Nutzerinhalte darstellen —
// Änderungen daran werden nie für die Synchronisierung eingereiht (das
// wäre für syncQueue selbst zirkulär, und 'meta' ist rein lokaler
// App-Zustand).
const SYNC_EXCLUDED = new Set(['syncQueue', 'meta']);

// Mandantenfähige fachliche Stores — deckungsgleich mit ENTITY_STORE_NAMES
// in apps/api/src/db/entityRegistry.ts. Jedes zugehörige Entity-Schema
// (packages/shared-types/src/entities.ts) verlangt ein Pflichtfeld
// `clubId`. 'users'/'clubs'/'invitations' (ebenfalls in STORES, siehe
// oben) sind bewusst NICHT hier aufgeführt: sie werden aktuell nirgends
// über put() geschrieben (Nutzerverwaltung läuft über eigene REST-
// Endpunkte, siehe apiClient.js) und ein Verein hat ohnehin keine eigene
// clubId (seine id IST die clubId).
export const CLUB_SCOPED_STORES = new Set([
  'athletes', 'groups', 'competitions', 'entries', 'results',
  'exercises', 'templates', 'plans', 'sessions', 'actionItems',
]);

// Liefert die clubId der aktuell eingeloggten Person, für put() unten —
// standardmäßig ein No-op (liefert `undefined`), bis state.js beim Laden
// per setClubIdProvider() die echte Quelle einträgt. Bleibt der Provider
// unregistriert (z. B. in einem Test, der db.js isoliert lädt), verhält
// sich put() dann einfach so, als gäbe es keine eingeloggte Person —
// dasselbe Verhalten wie zuvor bei einem `getCurrentUser()`, das `null`
// liefert.
let clubIdProvider = () => undefined;
export function setClubIdProvider(fn) {
  clubIdProvider = fn;
}

export async function put(store, obj){
  const isNew = !obj.id;
  if (!obj.id) obj.id = uid();
  // clubId fehlte bislang bei jedem neu über eines der Formulare
  // (modules/*.js) angelegten Datensatz — die Formulare kennen nur die
  // fachlichen Felder, nicht den eingeloggten Verein. Das zugehörige
  // Entity-Schema verlangt clubId aber als Pflichtfeld, also scheiterte
  // der allererste Sync-Push eines neu angelegten Datensatzes IMMER mit
  // "Payload entspricht nicht dem Schema" — zentral hier statt in jedem
  // einzelnen Formular ergänzt, damit kein Store dabei vergessen werden
  // kann. Überschreibt eine bereits vorhandene clubId nie (z. B. bei
  // einer Bearbeitung, wo sie schon aus dem ursprünglichen Datensatz
  // stammt).
  if (obj.clubId === undefined && CLUB_SCOPED_STORES.has(store)) {
    const clubId = clubIdProvider();
    if (clubId) obj.clubId = clubId;
  }
  obj.updatedAt = new Date().toISOString();
  if (!obj.createdAt) obj.createdAt = obj.updatedAt;
  const os = await tx(store, 'readwrite');
  const saved = await reqPromise(os.put(obj), () => obj);
  if (!SYNC_EXCLUDED.has(store)) {
    // `deletedAt` ist kein Feld der Entity-Schemas (siehe
    // packages/shared-types/src/entities.ts) und würde von der Sync-API
    // per .strict()-Zod-Check abgelehnt ("Payload entspricht nicht dem
    // Schema"). Ein lokal gespeicherter Datensatz kann dieses Feld tragen,
    // wenn er ursprünglich vom Server gepullt wurde (siehe syncClient.js:
    // pull() — dort wird es seit der Behebung dieses Fehlers zwar nicht
    // mehr NEU eingeschleust, ein VOR dieser Änderung bereits lokal
    // abgelegter Datensatz kann es aber noch tragen) — wird hier daher
    // sicherheitshalber aus dem Sync-Event-Payload entfernt, unabhängig
    // davon, ob es im übergebenen `obj` steckt.
    const { deletedAt: _deletedAt, ...payload } = saved;
    await enqueueSyncEvent(store, saved.id, isNew ? 'create' : 'update', payload);
  }
  return saved;
}

// Wie put(), aber OHNE ein Sync-Event zu erzeugen. Wird von syncClient.js
// (pull) genutzt, um vom Server empfangene Änderungen lokal zu übernehmen —
// würde man dafür das normale put() nutzen, würde jede vom Server
// abgeholte Änderung sofort wieder als neues lokales Outbox-Event
// eingereiht und beim nächsten Push unnötig zurückgesendet (Endlosschleife
// aus Sicht der Sync-Warteschlange). Überschreibt updatedAt NICHT — der
// vom Server gelieferte Zeitstempel bleibt maßgeblich.
export async function putWithoutSync(store, obj){
  if (!obj.id) obj.id = uid();
  const os = await tx(store, 'readwrite');
  return reqPromise(os.put(obj), () => obj);
}

export async function bulkPut(store, items){
  // Für Seeding/Import genutzt — reiht bewusst KEINE Sync-Events ein, da
  // geseedete/importierte Daten keine "Offline-Änderung" einer Person sind.
  const os = await tx(store, 'readwrite');
  return new Promise((resolve, reject) => {
    items.forEach(it => {
      if (!it.id) it.id = uid();
      os.put(it);
    });
    os.transaction.oncomplete = () => resolve(items);
    os.transaction.onerror = () => reject(os.transaction.error);
  });
}

export async function remove(store, id){
  const os = await tx(store, 'readwrite');
  await reqPromise(os.delete(id));
  if (!SYNC_EXCLUDED.has(store)) {
    await enqueueSyncEvent(store, id, 'delete', null);
  }
  return true;
}

// Wie remove(), aber ohne ein Sync-Event zu erzeugen — Gegenstück zu
// putWithoutSync(), aus demselben Grund von syncClient.js (pull) genutzt,
// wenn der Server eine Löschung meldet (action: "delete").
export async function removeWithoutSync(store, id){
  const os = await tx(store, 'readwrite');
  await reqPromise(os.delete(id));
  return true;
}

export async function clearStore(store){
  const os = await tx(store, 'readwrite');
  return reqPromise(os.clear(), () => true);
}

// Ineffizienz-Korrektur (Code-Review, Befund P5): lud vormals ALLE
// Datensätze eines Stores (getAll()), nur um deren Länge zurückzugeben —
// IndexedDB hat dafür objectStore.count(), das ohne die Datensätze selbst
// zu übertragen auskommt.
export async function countAll(store){
  const os = await tx(store);
  return reqPromise(os.count());
}

export async function exportAll(){
  const dump = {};
  for (const s of STORES) dump[s] = await getAll(s);
  return dump;
}

export async function importAll(dump){
  for (const s of STORES) {
    if (dump[s]) { await clearStore(s); await bulkPut(s, dump[s]); }
  }
}

export async function wipeAll(){
  for (const s of STORES) await clearStore(s);
}

// ============================================================
// Sync-Warteschlange (Event Queue) — jedes Anlegen/Bearbeiten/Löschen
// gegen einen "synchronisierbaren" Store wird hier angehängt. Eine
// separate Sync-Engine (syncClient.js) leert diese Warteschlange
// anschließend zu einem Server hin.
// ============================================================

export async function enqueueSyncEvent(store, entityId, action, payload){
  const evt = {
    id: uid(), store, entityId, action, payload,
    createdAt: new Date().toISOString(), status: 'pending',
    attempts: 0, lastError: null, syncedAt: null,
  };
  return put('syncQueue', evt);
}

// Wie enqueueSyncEvent(), aber für mehrere Events IN EINER EINZIGEN
// IndexedDB-Transaktion (Code-Review, Befund P7): ein Import/Bulk-Vorgang
// (siehe modules/libraryTransfer.js: importLibrary()), der enqueueSyncEvent()
// stattdessen EINZELN pro Datensatz aufgerufen hätte, öffnet dafür je
// Aufruf eine eigene Transaktion — bei 200 importierten Übungen 200
// zusätzliche Transaktionen allein für die Warteschlange. `items` ist ein
// Array aus { store, entityId, action, payload }, identisch zu den
// Einzelargumenten von enqueueSyncEvent().
export async function bulkEnqueueSyncEvents(items){
  const now = new Date().toISOString();
  const events = items.map(({ store, entityId, action, payload }) => ({
    id: uid(), store, entityId, action, payload,
    createdAt: now, status: 'pending',
    attempts: 0, lastError: null, syncedAt: null,
  }));
  return bulkPut('syncQueue', events);
}

export function getSyncQueue(){
  return getAll('syncQueue');
}

// Ineffizienz-Korrektur: liefert genau die Events, die ein Push-Zyklus
// tatsächlich senden würde ('pending' + 'error', siehe syncClient.js:
// push()), über den status-Index — statt wie bisher die GESAMTE
// Warteschlange per getSyncQueue() zu laden und danach in JavaScript zu
// filtern. Der Unterschied wächst mit der Zeit: bereits erfolgreich
// gesendete Events werden zwar aufgeräumt (clearSyncedEvents()), dauerhaft
// gescheiterte ('failed', siehe MAX_SYNC_ATTEMPTS dort) aber bewusst NICHT
// — sie blieben liegen und wurden bislang samt ihrer vollständigen
// payload-Blobs bei JEDEM automatischen Sync-Zyklus (alle 60 s) erneut
// aus IndexedDB gelesen, nur um sofort wieder weggefiltert zu werden.
//
// Zwei getrennte Index-Abfragen statt einer Bereichsabfrage, aus demselben
// Grund wie bei pendingSyncCount() unten: 'pending' und 'error' bilden
// keine zusammenhängende Schlüsselspanne, und IndexedDB kennt kein "IN".
export async function getSendableSyncEvents(){
  const os = await tx('syncQueue');
  const idx = os.index('status');
  const [pending, errored] = await Promise.all([
    reqPromise(idx.getAll('pending'), (r) => r || []),
    reqPromise(idx.getAll('error'), (r) => r || []),
  ]);
  // Nach Entstehungszeit sortiert — und zwar bewusst, nicht nur der
  // Ordnung halber: die Reihenfolge INNERHALB eines Push-Blocks ist
  // fachlich relevant. Der Server verarbeitet die Events eines Blocks der
  // Reihe nach und entscheidet je Event über resolveConflict() anhand des
  // Zeitstempels, den er beim Schreiben selbst setzt (siehe
  // packages/sync-protocol: serverIsNewer). Träfe ein Update VOR dem
  // zugehörigen Create ein, verglichen sich die beiden gegen einen
  // Serverstand, den das jeweils andere Event gerade erst erzeugt hat —
  // das ältere von beiden würde dann als "conflict-server-wins"
  // verworfen, obwohl beide vom selben Gerät und in klarer Reihenfolge
  // stammen.
  //
  // Diese Sortierung fehlte bislang: getSyncQueue() (getAll()) liefert
  // nach Primärschlüssel sortiert, und der ist eine ZUFÄLLIGE UUID (siehe
  // uid()) — die Reihenfolge war also nie die Entstehungsreihenfolge,
  // sondern schlicht beliebig. `createdAt` ist ein ISO-Zeitstempel und
  // damit lexikografisch in Zeitreihenfolge sortierbar; Array.sort ist
  // stabil, gleiche Millisekunde behält also die Reihenfolge aus den
  // beiden Index-Abfragen.
  return [...pending, ...errored].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// Ineffizienz-Korrektur: wendet mehrere Warteschlangen-Aktualisierungen in
// EINER Transaktion an, statt je Event zwei eigene zu öffnen (updateSyncEvent()
// unten macht ein get() und ein put(), jedes mit eigener Transaktion). Ein
// Push-Block umfasst bis zu 200 Events (siehe syncClient.js:
// PUSH_BATCH_SIZE) — das waren bis zu 400 Transaktionen allein für das
// Nachführen der Statusfelder.
//
// `updates` ist ein Array aus { id, patch }. Nicht (mehr) vorhandene
// Events werden übersprungen, genau wie updateSyncEvent() sie mit `null`
// quittiert. Umgeht bewusst put(): dessen Zusatzlogik (clubId ergänzen,
// updatedAt setzen, Sync-Event einreihen) ist für 'syncQueue' ohnehin
// wirkungslos bzw. ausgeschlossen (siehe SYNC_EXCLUDED oben).
export async function bulkUpdateSyncEvents(updates){
  if (updates.length === 0) return 0;
  const transaction = await multiTx(['syncQueue'], 'readwrite');
  const os = transaction.objectStore('syncQueue');
  let applied = 0;
  for (const { id, patch } of updates) {
    const req = os.get(id);
    req.onsuccess = () => {
      const evt = req.result;
      if (!evt) return;
      applied++;
      os.put({ ...evt, ...patch, updatedAt: new Date().toISOString() });
    };
  }
  return txDone(transaction, undefined).then(() => applied);
}

// Ineffizienz-Korrektur: übernimmt eine komplette Pull-Seite (siehe
// syncClient.js: pull()) in EINER store-übergreifenden Transaktion. Zuvor
// lief je Änderung ein eigenes putWithoutSync()/removeWithoutSync() — also
// eine eigene IndexedDB-Transaktion pro Datensatz. Beim erstmaligen
// Vollabzug eines Vereins (Seitengröße 200, oft mehrere Seiten) waren das
// hunderte bis tausende Transaktionen nacheinander; auf einem Mobilgerät
// ist genau das der spürbar langsame Teil des ersten Logins.
//
// `changes` ist ein Array aus { store, entityId, action, payload } — exakt
// das Format der Sync-API-Antwort. Verhalten je Änderung unverändert:
//   - action 'delete' -> lokal entfernen; ein unbekannter Store wird
//     ignoriert (die Zeile kann lokal ohnehin nicht liegen), wie zuvor der
//     `.catch()` um removeWithoutSync(),
//   - sonst -> Upsert des Payloads OHNE ein Sync-Event zu erzeugen (sonst
//     ginge jede gepullte Änderung sofort wieder als eigener Push hinaus).
// Ein unbekannter Store bei einem Upsert bleibt dagegen ein harter Fehler
// (wie zuvor), damit ein Server, der einen hier nicht vorgesehenen Store
// ausliefert, nicht stillschweigend Daten verliert.
export async function applyPulledChanges(changes){
  if (changes.length === 0) return 0;
  const known = new Set(STORES);
  const unknownUpsert = changes.find((c) => c.action !== 'delete' && !known.has(c.store));
  if (unknownUpsert) throw new Error(`Unbekannter Store "${unknownUpsert.store}" in der Sync-Antwort.`);

  const involved = [...new Set(changes.filter((c) => known.has(c.store)).map((c) => c.store))];
  if (involved.length === 0) return 0;

  const transaction = await multiTx(involved, 'readwrite');
  let applied = 0;
  for (const change of changes) {
    if (!known.has(change.store)) continue; // nur 'delete', siehe oben
    const os = transaction.objectStore(change.store);
    if (change.action === 'delete') os.delete(change.entityId);
    else os.put(change.payload.id ? change.payload : { ...change.payload, id: uid() });
    applied++;
  }
  return txDone(transaction, applied);
}

export async function updateSyncEvent(id, patch){
  const evt = await get('syncQueue', id);
  if (!evt) return null;
  Object.assign(evt, patch);
  return put('syncQueue', evt);
}

// Ineffizienz-Korrektur (Code-Review, Befund P5): las vormals die
// GESAMTE Warteschlange, um die 'synced'-Einträge herauszufiltern — und
// öffnete danach pro gelöschtem Eintrag eine EIGENE Read-Write-
// Transaktion (remove() einzeln aufgerufen). Der status-Index liefert die
// betroffenen ids direkt (ohne die übrigen Einträge zu laden); das
// Löschen läuft anschließend in EINER gemeinsamen Transaktion statt einer
// je Eintrag.
export async function clearSyncedEvents(){
  const readStore = await tx('syncQueue');
  const ids = await reqPromise(readStore.index('status').getAllKeys('synced'), (r) => r || []);
  if (ids.length === 0) return 0;

  const writeStore = await tx('syncQueue', 'readwrite');
  await new Promise((resolve, reject) => {
    ids.forEach(id => writeStore.delete(id));
    writeStore.transaction.oncomplete = () => resolve();
    writeStore.transaction.onerror = () => reject(writeStore.transaction.error);
  });
  return ids.length;
}

// Ineffizienz-Korrektur (Code-Review, Befund P5): las vormals bei JEDEM
// Aufruf die GESAMTE Warteschlange (inkl. aller payload-Blobs), nur um
// sie in JavaScript nach status zu filtern — läuft nach jedem Render,
// jedem Sync-Zyklus (alle 60 s) und beim Logout. Der status-Index erlaubt
// stattdessen, nur die Anzahl je gesuchtem Status abzufragen
// (objectStore.count() über den Index), ohne einen einzigen Datensatz zu
// laden. Zwei separate count()-Aufrufe statt eines Bereichs, da 'pending'
// und 'error' keine zusammenhängende Schlüsselspanne bilden (IndexedDB
// kennt kein "IN").
export async function pendingSyncCount(){
  const os = await tx('syncQueue');
  const idx = os.index('status');
  const count = (key) => reqPromise(idx.count(key));
  const [pending, error] = await Promise.all([count('pending'), count('error')]);
  return pending + error;
}
