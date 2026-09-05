// ============================================================
// refdata.js — static reference lists (not user-editable data,
// just vocab used across forms/filters).
// ============================================================

export const STROKES = ['Freistil', 'Rücken', 'Brust', 'Schmetterling', 'Lagen'];

export const COURSES = [
  { value: 'LCM', label: 'LCM · 50m Bahn' },
  { value: 'SCM', label: 'SCM · 25m Bahn' },
];

export const EVENTS = [
  '50 Freistil', '100 Freistil', '200 Freistil', '400 Freistil', '800 Freistil', '1500 Freistil',
  '50 Rücken', '100 Rücken', '200 Rücken',
  '50 Brust', '100 Brust', '200 Brust',
  '50 Schmetterling', '100 Schmetterling', '200 Schmetterling',
  '200 Lagen', '400 Lagen',
  // Staffeln (Format "<Anzahl>x<Strecke je Schwimmer:in> <Technik>") — bis
  // hierhin fehlten diese, DSV7-Wettkampfergebnislisten enthalten aber
  // regelmäßig Staffelwettbewerbe (siehe docs/dsv7-lenex-import-plan.md
  // Abschnitt 3.5). Reine Freistil- und Lagenstaffeln, die bei
  // DSV-Wettkämpfen üblichen Kombinationen — Rücken-/Brust-/
  // Schmetterlingsstaffeln sind im deutschen Wettkampfbetrieb unüblich.
  '4x50 Freistil', '4x100 Freistil', '4x200 Freistil',
  '4x50 Lagen', '4x100 Lagen',
];

// Code-Review 2026-09-02, Befund P3: Session-Erweiterung der
// Event-Referenzliste für den DSV7-Ergebnisimport (siehe
// modules/resultsImportUI.js: "neues Event anlegen" bei einem nicht
// zuordenbaren Wettkampf-Profil) — EVENTS ist reine, ungespeicherte
// Vorschlagsliste ohne eigenen Backend-Store, Result.event selbst ist ein
// freies Textfeld ohne Enum-Zwang, das neue Label ist also sofort gültig.
// Ein Neuladen der Seite setzt die Erweiterung zurück; wer das Event
// dauerhaft in den Auswahllisten sehen will, ergänzt es regulär oben.
//
// Bewusst als benannte Funktion HIER (statt eines direkten
// `EVENTS.push(...)` im aufrufenden UI-Modul, wie es vor dieser
// Korrektur der Fall war): der Seiteneffekt auf ein exportiertes
// Referenzdaten-Array steht damit dort, wo die Daten wohnen, statt
// verstreut in einem UI-Modul, das die Existenz/den Zweck von EVENTS
// sonst nirgends dokumentiert. Verhalten unverändert — `EVENTS` bleibt
// dieselbe, von allen Modulen (times.js/competitions.js/stats.js) als
// lebendiges Array gelesene Referenz, kein Wechsel auf einen Getter.
export function registerSessionEvent(label) {
  if (!EVENTS.includes(label)) EVENTS.push(label);
}

// DSV7-Technik-Code -> Name in EVENTS/STROKES, siehe "DSV Standard"
// (Format 7), Element WETTKAMPF, Attribut "Technik". 'X' (beliebige
// Sonderform) hat bewusst keine Entsprechung — ein Sonderform-Wettkampf
// lässt sich nicht auf ein festes Streckenformat abbilden und muss beim
// Import interaktiv aufgelöst werden (siehe Abschnitt 3.5 des Plans).
export const DSV7_STROKE_TO_NAME = { F: 'Freistil', R: 'Rücken', B: 'Brust', S: 'Schmetterling', L: 'Lagen' };

// Baut aus den DSV7-WETTKAMPF-Attributen (Technik, Einzelstrecke,
// AnzahlStarter) den passenden EVENTS-String, oder `null`, wenn keine
// Entsprechung existiert (unbekannter Technik-Code, oder eine
// Streckenlänge/Staffelgröße, die nicht in EVENTS geführt wird — dann
// entscheidet die Importvorschau interaktiv, siehe
// docs/dsv7-lenex-import-plan.md Abschnitt 3.5).
export function dsv7EventLabel({ technik, distanzM, isRelay, relaySize }) {
  const strokeName = DSV7_STROKE_TO_NAME[technik];
  if (!strokeName || !distanzM) return null;
  const label = isRelay && relaySize > 1
    ? `${relaySize}x${distanzM} ${strokeName}`
    : `${distanzM} ${strokeName}`;
  return EVENTS.includes(label) ? label : null;
}

export const EXERCISE_CATEGORIES = [
  { value: 'technik', label: 'Technik' },
  { value: 'ausdauer', label: 'Ausdauer' },
  { value: 'sprint', label: 'Sprint' },
  { value: 'kraft', label: 'Kraft (Land/Wasser)' },
  { value: 'kick', label: 'Beinarbeit' },
  { value: 'atmung', label: 'Atmung' },
  { value: 'start-wende', label: 'Start & Wende' },
  { value: 'koordination', label: 'Koordination' },
];

// Common swim-training equipment. Exercises reference these by `value`
// (stable code, independent of display language); `label` is only the
// German fallback shown if a locale is missing a translation for it.
export const EQUIPMENT_ITEMS = [
  { value: 'brett', label: 'Schwimmbrett' },
  { value: 'pullbuoy', label: 'Pull Buoy' },
  { value: 'flossen', label: 'Flossen' },
  { value: 'kurzflossen', label: 'Kurzflossen' },
  { value: 'paddles', label: 'Paddles' },
  { value: 'schnorchel', label: 'Schnorchel' },
  { value: 'zugband', label: 'Zugband / Stretchcordel' },
  { value: 'bremswiderstand', label: 'Bremswiderstand (Parachute/Bucket)' },
  { value: 'medizinball', label: 'Medizinball' },
  { value: 'startblock', label: 'Startblock' },
];

export const SET_INTENSITIES = [
  { value: 'locker', label: 'Locker (GA2)' },
  { value: 'ga1', label: 'Grundlage (GA1)' },
  { value: 'schwelle', label: 'Schwelle' },
  { value: 'renotempo', label: 'Renn­tempo' },
  { value: 'sprint', label: 'Sprint / Maximal' },
];

export const ACTION_CATEGORIES = [
  { value: 'technik', label: 'Technik' },
  { value: 'kondition', label: 'Kondition' },
  { value: 'mental', label: 'Mental / Wettkampf' },
  { value: 'verhalten', label: 'Verhalten / Einstellung' },
  { value: 'verletzung', label: 'Gesundheit / Belastung' },
  { value: 'sonstiges', label: 'Sonstiges' },
];

export const ACTION_STATUS = [
  { value: 'offen', label: 'Offen' },
  { value: 'progress', label: 'In Bearbeitung' },
  { value: 'done', label: 'Erledigt' },
];

// Qualifikationsmanagement (docs/nutzer-qualifikationen-plan.md, Abschnitt
// 2.2) — MUSS mit QualificationTypeSchema in
// packages/shared-types/src/qualification.ts übereinstimmen (apps/web läuft
// ohne Build-Schritt und kann dieses Backend-Paket nicht importieren, siehe
// entsprechender Kommentar bei ROUTE_TO_PACKAGE in router.js).
export const QUALIFICATION_TYPES = [
  { value: 'trainer_c', label: 'Trainer-C-Lizenz' },
  { value: 'trainer_b', label: 'Trainer-B-Lizenz' },
  { value: 'trainer_a', label: 'Trainer-A-Lizenz' },
  { value: 'rettungsschwimmer_silber', label: 'Rettungsschwimmschein Silber' },
  { value: 'rettungsschwimmer_gold', label: 'Rettungsschwimmschein Gold' },
  { value: 'erste_hilfe', label: 'Erste-Hilfe-Kurs' },
  { value: 'kinderschutz', label: 'Kinderschutz-Schulung' },
  // Kampfrichter-Ämter (docs/kampfrichter-modul-plan.md, Abschnitt 3.1) —
  // siehe REFEREE_QUALIFICATION_TYPES für die Teilmenge dieser sechs Werte.
  { value: 'kampfrichter', label: 'Kampfrichter:in' },
  { value: 'schiedsrichter', label: 'Schiedsrichter:in' },
  { value: 'startrichter', label: 'Startrichter:in' },
  { value: 'zeitnehmer', label: 'Zeitnehmer:in' },
  { value: 'bahnrichter', label: 'Bahnrichter:in' },
  { value: 'wettkampfsekretaer', label: 'Wettkampfsekretär:in (Protokoll)' },
  { value: 'sonstige', label: 'Sonstige' },
];

// Teilmenge von QUALIFICATION_TYPES, die fachlich zu einer Kampfrichter:in
// gehört (docs/kampfrichter-modul-plan.md, Abschnitt 3.2) — MUSS mit
// REFEREE_QUALIFICATION_TYPES in packages/shared-types/src/qualification.ts
// übereinstimmen (apps/web kann dieses Backend-Paket nicht importieren,
// siehe Kommentar bei QUALIFICATION_TYPES oben). Wird vom künftigen
// Kampfrichter-Modul (Phase C) genutzt, um qualifications.js' volle Liste
// auf die Kampfrichter-relevanten Typen zu filtern.
export const REFEREE_QUALIFICATION_TYPES = ['kampfrichter', 'schiedsrichter', 'startrichter', 'zeitnehmer', 'bahnrichter', 'wettkampfsekretaer'];
