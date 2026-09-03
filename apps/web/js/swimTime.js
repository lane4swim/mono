// ============================================================
// swimTime.js — Schwimmzeit-Formatierung: Sekunden (Fließkommazahl)
// <-> "mm:ss.cc".
//
// Code-Review, Befund L4: aus utils.js herausgelöst (siehe dom.js für
// den vollständigen Hintergrund der Aufteilung).
// ============================================================
export function secToTime(sec) {
  if (sec === null || sec === undefined || isNaN(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  const sStr = s.toFixed(2).padStart(5, '0');
  return m > 0 ? `${m}:${sStr}` : `${s.toFixed(2)}`;
}
// Akzeptiert "ss.cc", "mm:ss.cc" UND "hh:mm:ss.cc" (Komma oder Punkt als
// Dezimaltrennzeichen) — die letzte Form kommt in der App selbst nicht vor
// (Eingabefelder erwarten mm:ss.cc), aber im DSV7-Ergebnisimport, dessen
// "Zeit"-Datentyp als HH:MM:SS,hh mit führenden Nullen spezifiziert ist
// (siehe docs/dsv7-lenex-import-plan.md Abschnitt 1.1) — reale Exporte
// lassen führende Nullen/Segmente bei kurzen Zeiten aber teils weg
// (z. B. "1:01,44" oder "0:30,00"), daher hier bewusst für 1-3 Segmente statt
// nur exakt zwei.
export function timeToSec(str) {
  if (!str) return null;
  str = String(str).trim().replace(',', '.');
  const parts = str.split(':').map((p) => parseFloat(p));
  if (parts.some((p) => isNaN(p))) return NaN;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

// Code-Review 2026-09-02, Befund K2: `time` in `Result` kann `null` sein
// (DS/NA/AB/AU/ZU — Ergebnisse ohne gewertete Zeit, siehe
// docs/dsv7-lenex-import-plan.md Abschnitt 3.4). Ein direkter Vergleich
// `neueZeit < r.time` wertet `neueZeit < null` als `neueZeit < 0` aus
// (JavaScript wandelt `null` dafür in `0` um) — praktisch immer `false`,
// wodurch `others.every(...)` bei JEDEM ergebnislosen Datensatz in der
// Vergleichsmenge abbricht und die Person auf dieser Strecke NIE wieder
// als persönliche Bestzeit erkannt wird, unabhängig davon, wie schnell sie
// tatsächlich schwimmt. Diese eine Funktion ersetzt die zuvor an drei
// Stellen unabhängig wiederholte (und an zwei davon fehlerhafte)
// Inline-Berechnung (modules/competitions.js, modules/competitionLive.js,
// resultsImport/importRunner.js) — ergebnislose Datensätze werden hier
// aus dem Vergleich entfernt, statt sie fälschlich als "unschlagbar
// langsam" zu behandeln.
export function isPersonalBest(time, otherResults) {
  if (time == null) return false;
  const timed = otherResults.filter((r) => r.time != null);
  return timed.every((r) => time < r.time);
}
