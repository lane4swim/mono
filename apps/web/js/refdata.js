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
];

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

export const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
