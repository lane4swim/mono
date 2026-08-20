// db.js — thin promise-based wrapper around IndexedDB.
// One database, one object store per entity. Generic CRUD so new
// modules can add a store name and get get/getAll/put/remove for free.
import { getCurrentUser } from './state.js';

const DB_NAME = 'lane1-db';
const DB_VERSION = 2; // v2: 'clubs' + 'invitations' Stores ergänzt (Nutzerverwaltung)

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
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode = 'readonly'){
  return openDb().then(db => db.transaction(store, mode).objectStore(store));
}

export function uid(){
  if (crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

export async function getAll(store){
  const os = await tx(store);
  return new Promise((resolve, reject) => {
    const req = os.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function get(store, id){
  const os = await tx(store);
  return new Promise((resolve, reject) => {
    const req = os.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

// Stores that represent internal bookkeeping rather than user content —
// changes to these are never queued for sync (that would be circular for
// syncQueue itself, and 'meta' is purely local app state).
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
    const clubId = getCurrentUser()?.clubId;
    if (clubId) obj.clubId = clubId;
  }
  obj.updatedAt = new Date().toISOString();
  if (!obj.createdAt) obj.createdAt = obj.updatedAt;
  const os = await tx(store, 'readwrite');
  const saved = await new Promise((resolve, reject) => {
    const req = os.put(obj);
    req.onsuccess = () => resolve(obj);
    req.onerror = () => reject(req.error);
  });
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
    const { deletedAt, ...payload } = saved;
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
  return new Promise((resolve, reject) => {
    const req = os.put(obj);
    req.onsuccess = () => resolve(obj);
    req.onerror = () => reject(req.error);
  });
}

export async function bulkPut(store, items){
  // Used for seeding/import — deliberately does NOT enqueue sync events,
  // since seeded/imported data isn't an "offline change" made by a user.
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
  await new Promise((resolve, reject) => {
    const req = os.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
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
  await new Promise((resolve, reject) => {
    const req = os.delete(id);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
  return true;
}

export async function clearStore(store){
  const os = await tx(store, 'readwrite');
  return new Promise((resolve, reject) => {
    const req = os.clear();
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

export async function countAll(store){
  const items = await getAll(store);
  return items.length;
}

export async function isDbEmpty(){
  const athletes = await getAll('athletes');
  return athletes.length === 0;
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
// Sync queue (Event Queue) — every create/update/delete made by a
// user against a "syncable" store is appended here. A separate
// sync engine (js/sync.js) later drains this queue toward a server.
// ============================================================

export async function enqueueSyncEvent(store, entityId, action, payload){
  const evt = {
    id: uid(), store, entityId, action, payload,
    createdAt: new Date().toISOString(), status: 'pending',
    attempts: 0, lastError: null, syncedAt: null,
  };
  return put('syncQueue', evt);
}

export function getSyncQueue(){
  return getAll('syncQueue');
}

export async function updateSyncEvent(id, patch){
  const evt = await get('syncQueue', id);
  if (!evt) return null;
  Object.assign(evt, patch);
  return put('syncQueue', evt);
}

export async function clearSyncedEvents(){
  const all = await getAll('syncQueue');
  const synced = all.filter(e => e.status === 'synced');
  for (const e of synced) await remove('syncQueue', e.id);
  return synced.length;
}

export async function pendingSyncCount(){
  const all = await getAll('syncQueue');
  return all.filter(e => e.status === 'pending' || e.status === 'error').length;
}
