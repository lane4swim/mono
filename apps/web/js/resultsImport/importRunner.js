// ============================================================
// resultsImport/importRunner.js — verbindet resultsImport/matching.js
// (reine Logik) mit db.js/syncClient.js (IndexedDB + Sync), für den
// tatsächlichen Schreibvorgang eines Ergebnisimports. Siehe
// docs/dsv7-lenex-import-plan.md Abschnitt 5/6.
import { getAll, put } from '../db.js';
import { pull, push } from '../syncClient.js';

// Lädt den für buildImportPlan() (matching.js) nötigen lokalen Stand.
// Pullt VORHER explizit den aktuellsten Server-Stand (statt auf den
// nächsten periodischen Sync-Zyklus zu warten) — Voraussetzung dafür,
// dass der anschließende Push keinen never-overwrite-Konflikt auslöst
// (siehe packages/sync-protocol/src/conflictResolution.ts, Kommentar am
// 'results'-Zweig, sowie Plan Abschnitt 3.6).
export async function loadImportContext(competitionId) {
  await pull();
  const [athletes, allResults] = await Promise.all([getAll('athletes'), getAll('results')]);
  const existingResults = allResults.filter((r) => r.competitionId === competitionId);
  return { athletes, allResults, existingResults };
}

// Schreibt alle 'new'/'update'-Zeilen eines Importplans (siehe
// matching.js: buildImportPlan()). `allResults` ist der VOLLSTÄNDIGE,
// unfilterte lokale Ergebnisbestand (nicht nur der dieses Wettkampfs) —
// nötig, weil isPB (wie beim manuellen Schnellerfassen, siehe
// modules/competitions.js: appendEntryRows()) über ALLE Ergebnisse
// derselben Athlet:in/desselben Events hinweg bestimmt wird, unabhängig
// von Wettkampf oder Bahnlänge. Ein disqualifiziertes/nicht angetretenes
// Ergebnis (`time === null`) kann nie ein PB sein.
//
// Schreibt bewusst NACHEINANDER (kein bulkPut) über db.js' normales
// put(), damit jedes Ergebnis sein eigenes, korrektes 'create'/'update'-
// Sync-Event erhält (siehe db.js: put()) — anschließend wird sofort
// gepusht statt auf den nächsten periodischen Zyklus zu warten, damit
// der Import unmittelbar sichtbar synchronisiert.
export async function executeImportPlan(rows, allResults) {
  const writable = rows.filter((row) => row.kind === 'new' || row.kind === 'update');
  const working = [...allResults];
  const saved = [];

  for (const row of writable) {
    const proposed = row.proposed;
    if (proposed.time != null) {
      const others = working.filter((r) => r.athleteId === proposed.athleteId && r.event === proposed.event && r.id !== proposed.id);
      proposed.isPB = others.length === 0 || others.every((r) => r.time != null && proposed.time < r.time);
    } else {
      proposed.isPB = false;
    }

    const result = await put('results', proposed);
    saved.push(result);
    const idx = working.findIndex((r) => r.id === result.id);
    if (idx === -1) working.push(result); else working[idx] = result;
  }

  if (writable.length > 0) await push();
  return saved;
}
