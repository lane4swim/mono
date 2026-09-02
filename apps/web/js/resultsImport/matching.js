// ============================================================
// resultsImport/matching.js — Matching- und Overwrite-Logik für den
// Ergebnisimport (DSV7/Lenex), formatunabhängig: nimmt ImportedResult[]
// (siehe resultsImport/dsv7Parser.js) entgegen und baut daraus einen
// Vorschau-/Ausführungsplan gegen die lokalen Athlet:innen/Ergebnisse.
// Siehe docs/dsv7-lenex-import-plan.md Abschnitt 5.
//
// Bewusst als reine, seiteneffektfreie Funktionen implementiert (keine
// IndexedDB-Zugriffe hier) — resultsImport/importRunner.js verbindet das
// mit db.js/syncClient.js. Das hält diese Datei ohne Browser-Umgebung
// testbar.
import { ROUND_PRIORITY, unmappedEventKey } from './dsv7Parser.js';

// ---- Vereinsabgleich (Plan Abschnitt 5.1) --------------------------------

// Versucht automatisch, welcher VEREIN-Eintrag der Datei der eigene Verein
// ist — über Club.nationalID/nationalIDType (Plan Abschnitt 3.1). Liefert
// `null`, wenn der eigene Verein keine Kennung hinterlegt hat oder keine
// Datei-Zeile dazu passt; der Aufrufer (UI) muss dann eine manuelle
// Auswahl aus `parsedClubs` anbieten.
export function matchOwnClub(parsedClubs, localClub) {
  if (!localClub?.nationalIDType || !localClub?.nationalID) return null;
  return parsedClubs.find((c) => c.nationalIDType === localClub.nationalIDType && c.nationalID === localClub.nationalID) ?? null;
}

// Reduziert die komplette Ergebnisliste einer Wettkampfergebnisliste
// (typischerweise ALLE teilnehmenden Vereine) auf die des ausgewählten
// eigenen Vereins. Abgleich über den Vereinsnamen (nicht nationalID) —
// beide stammen aus derselben Datei und sind daher zeichengleich, auch
// wenn `selectedClub.nationalID` fehlt/"0" war.
export function filterResultsForClub(importedResults, selectedClub) {
  return importedResults.filter((r) => r.clubName === selectedClub.name);
}

// ---- Athlet:innen-Abgleich (Plan Abschnitt 5.2) --------------------------

function normalizeNamePart(s) {
  return (s ?? '').trim().toLowerCase();
}

// DSV7-Namen kommen als ein Feld "Nachname, Vorname" — lokale Athlet:innen
// als getrennte firstName/lastName. Baut aus beiden denselben
// Vergleichsschlüssel.
function nameKeyFromDsv7(name) {
  const [last, first] = String(name ?? '').split(',');
  return `${normalizeNamePart(last)}|${normalizeNamePart(first)}`;
}
function nameKeyFromAthlete(athlete) {
  return `${normalizeNamePart(athlete.lastName)}|${normalizeNamePart(athlete.firstName)}`;
}

// Liefert die passende lokale Athlet:in, oder `null` bei keinem/mehrdeutigem
// Treffer (dann markiert der Plan die Zeile als "nicht zuordenbar" statt
// automatisch ein Profil anzulegen oder zu raten — siehe Plan Abschnitt 5.2).
export function matchAthlete(athleteMatchHint, athletes) {
  if (athleteMatchHint.nationalIDType && athleteMatchHint.nationalID) {
    const hit = athletes.find((a) => a.nationalIDType === athleteMatchHint.nationalIDType && a.nationalID === athleteMatchHint.nationalID);
    if (hit) return hit;
  }
  const key = nameKeyFromDsv7(athleteMatchHint.name);
  const byName = athletes.filter((a) => nameKeyFromAthlete(a) === key);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1 && athleteMatchHint.birthYear) {
    const byYear = byName.filter((a) => a.birthdate && new Date(a.birthdate).getUTCFullYear() === athleteMatchHint.birthYear);
    if (byYear.length === 1) return byYear[0];
  }
  return null;
}

// ---- Event-Auflösung (Plan Abschnitt 3.5 / 5.3) --------------------------

// `eventResolutions` ist eine Map<unmappedEventKey, EventResolution>, von
// der Importvorschau befüllt (eine Nutzerentscheidung je unmapptem
// Wettkampf-Profil, nicht je Ergebniszeile). EventResolution:
//   { action: 'map', event: string }     — bestehendem Event zuordnen
//   { action: 'create', event: string }  — neues Event (Aufrufer hat es
//                                           bereits zu EVENTS ergänzt)
//   { action: 'ignore' }                 — Wettkampf beim Import überspringen
export function resolveEventLabel(importedResult, eventResolutions) {
  if (importedResult.eventCode.label) return importedResult.eventCode.label;
  const resolution = eventResolutions?.get(unmappedEventKey(importedResult.eventCode));
  if (!resolution || resolution.action === 'ignore') return null;
  return resolution.event;
}

// ---- Rundenpriorität (Plan Abschnitt 1.4.4) ------------------------------

function roundRank(round) {
  const i = ROUND_PRIORITY.indexOf(round);
  return i === -1 ? ROUND_PRIORITY.length : i;
}

// ---- Plan-Aufbau ----------------------------------------------------------

// Eine Zeile des Importplans:
//   { kind: 'unmatched-athlete', imported }
//   { kind: 'unmatched-event',   imported, athlete }
//   { kind: 'new'   | 'update',  imported, athlete, eventLabel, existingResult, proposed }
//
// `proposed` ist ein vollständiger Result-Datensatz-Entwurf (siehe Plan
// Abschnitt 5.5/5.6): time/place/status/statusNote/splits/date/course
// werden aus der Datei übernommen, `comments`/`id`/`createdAt` eines
// bestehenden Treffers bleiben unangetastet erhalten. `isPB` wird bewusst
// NICHT hier gesetzt (hängt von der gesamten lokalen Ergebnis-Historie ab,
// nicht nur vom Importplan) — importRunner.js berechnet es nach dem
// Schreiben neu, siehe dortiger Kommentar.
export function buildImportPlan({
  importedResults,
  athletes,
  existingResults,
  eventResolutions,
  clubId,
  competitionId,
  competitionDate,
  competitionCourse,
}) {
  const rows = [];
  // athleteId|eventLabel -> { athlete, eventLabel, imported } der Zeile mit
  // der bislang höchsten Rundenpriorität (siehe roundRank oben) — mehrere
  // Runden desselben Events (Vorlauf UND Finale) reduzieren sich so auf
  // GENAU einen Datensatz, weil das lokale Result-Modell pro
  // Athlet:in/Event/Wettkampf nur einen Platz hat.
  const bestByAthleteEvent = new Map();

  for (const imported of importedResults) {
    const athlete = matchAthlete(imported.athleteMatchHint, athletes);
    if (!athlete) {
      rows.push({ kind: 'unmatched-athlete', imported });
      continue;
    }
    const eventLabel = resolveEventLabel(imported, eventResolutions);
    if (!eventLabel) {
      rows.push({ kind: 'unmatched-event', imported, athlete });
      continue;
    }
    const key = `${athlete.id}|${eventLabel}`;
    const current = bestByAthleteEvent.get(key);
    if (!current || roundRank(imported.round) < roundRank(current.imported.round)) {
      bestByAthleteEvent.set(key, { athlete, eventLabel, imported });
    }
  }

  for (const { athlete, eventLabel, imported } of bestByAthleteEvent.values()) {
    const existingResult = existingResults.find(
      (r) => r.athleteId === athlete.id && r.event === eventLabel && r.competitionId === competitionId,
    );
    const proposed = {
      id: existingResult?.id,
      clubId,
      athleteId: athlete.id,
      event: eventLabel,
      time: imported.time,
      date: competitionDate,
      course: competitionCourse,
      competitionId,
      place: imported.place,
      status: imported.status,
      statusNote: imported.statusNote ?? null,
      splits: imported.splits.length ? imported.splits : null,
      // Erhalten: bestehende Kommentare/isPB/createdAt bleiben unangetastet
      // (siehe Plan Abschnitt 5.6/5.7). isPB wird nach dem Schreiben neu
      // berechnet (siehe buildImportPlan()-Kommentar oben), hier nur der
      // bisherige Wert als Platzhalter, damit `proposed` bereits vor dem
      // Schreiben ein vollständiger Result-Entwurf ist.
      isPB: existingResult?.isPB ?? false,
      comments: existingResult?.comments ?? [],
      createdAt: existingResult?.createdAt,
    };
    rows.push({ kind: existingResult ? 'update' : 'new', imported, athlete, eventLabel, existingResult, proposed });
  }

  return rows;
}
