// apps/api/src/modules/sync/sync.pagination.ts
//
// Code-Review, Befund L2: aus sync.service.ts herausgelöst (eine von fünf
// Zuständigkeiten der ehemaligen 737-Zeilen-Datei) — bereits vorher als
// eigenständige, exportierte, reine Funktion angelegt, um sie direkt ohne
// Gateway/Datenbank testen zu können; jetzt zusätzlich in einer eigenen
// Datei, wie es der Kommentar unten ohnehin schon nahelegte.
import type { ChangedRecord } from './sync.gateway.js';

export const PULL_PAGE_SIZE = 200;

// Sicherheitsnetz für den in splitAtSafeTimestampBoundary() beschriebenen
// Extremfall (das GESAMTE Blickfenster von PULL_PAGE_SIZE+1 Zeilen teilt
// sich einen einzigen Zeitstempel): eine gezielte Nachfrage GENAU dieses
// Zeitstempels darf nicht unbegrenzt viele Zeilen laden — dieser Wert
// deckelt sie. Deutlich größer als PULL_PAGE_SIZE, da er einen praktisch
// nie erreichten Rand abdeckt, nicht den Normalfall.
export const PULL_TIE_SAFETY_LIMIT = 5000;

// listChangedSince() liefert Zeilen aufsteigend nach `updatedAt` sortiert,
// über alle zehn fachlichen Stores UND Tombstones hinweg zusammengeführt.
// Teilen sich zwei Zeilen exakt denselben Zeitstempel (z. B. weil mehrere
// Events desselben Push-Batches innerhalb derselben Millisekunde
// angewendet wurden — auf schnellem lokalem Postgres realistisch) und
// läge die Seitengrenze GENAU zwischen ihnen, würde die zweite Zeile beim
// nächsten Pull übersprungen: der neue Cursor ist exakt dieser Zeitstempel,
// die Folgeabfrage filtert mit `updatedAt > cursor` (strikt) — eine Zeile
// mit GLEICHEM Zeitstempel, die "hinter" dieser Grenze lag, erscheint
// darin nie wieder (stiller Datenverlust für andere Geräte).
//
// Diese Funktion verschiebt die Seitengrenze deshalb NIE mitten in eine
// Gruppe gleicher Zeitstempel: sie kürzt die übergebenen (bereits sortierten)
// Zeilen so weit, bis entweder eine echte Zeitstempel-Grenze erreicht ist,
// oder — im Extremfall, dass ALLE `pageSize + 1` gepufferten Zeilen
// denselben Zeitstempel tragen — nichts übrig bleibt. Dieser Randfall wird
// von pull() (sync.service.ts) gesondert über eine gezielte Nachfrage
// aufgelöst; ansonsten werden die abgeschnittenen Zeilen einfach NICHT
// ausgeliefert — sie kommen vollständig (nie aufgeteilt) auf der nächsten
// Seite an, sobald der Cursor noch auf der letzten sicheren
// Zeitstempel-Grenze steht.
export function splitAtSafeTimestampBoundary(rows: ChangedRecord[], pageSize: number): ChangedRecord[] {
  if (rows.length <= pageSize) return rows;
  let cut = pageSize;
  while (cut > 0 && rows[cut]!.updatedAt.getTime() === rows[cut - 1]!.updatedAt.getTime()) cut--;
  return rows.slice(0, cut);
}
