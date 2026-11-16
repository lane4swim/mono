// Reine Logik für von Hand erfasste Pflichtzeiten (docs/Plans/
// pflichtzeiten-manuell-plan.md): Prüfen der Formularzeilen, Erkennen
// überlappender Regeln und Einlesen aus einer kopierten Tabelle — ohne DOM,
// damit sie direkt testbar ist. Die Auswertung selbst liegt unverändert in
// requiredTimes.js (evaluateRequiredTime()).
import { timeToSec } from '../swimTime.js';
import { isRelayEvent } from './requiredTimes.js';

export const RULE_GENDERS = ['', 'W', 'M'];
export const RULE_CLASS_TYPES = ['', 'AL', 'JG'];
const DIGITS = /^\d{0,4}$/;

// Eine Formularzeile: alle Werte als Text, wie sie in den Eingabefeldern
// stehen. `time` ist die eingegebene Zeit ("1:12,50"), nicht Sekunden.
export function emptyRow(overrides = {}) {
  return { event: '', gender: '', classType: '', min: '', max: '', time: '', ...overrides };
}

export function ruleToRow(rule) {
  return emptyRow({ ...rule, time: rule.time != null ? formatRuleTime(rule.time) : '' });
}

// Zeit für das Eingabefeld: "1:12.50" bzw. "28.90" — wie secToTime(), aber
// ohne den Gedankenstrich für fehlende Werte.
export function formatRuleTime(sec) {
  const m = Math.floor(sec / 60);
  const s = (sec - m * 60).toFixed(2);
  return m > 0 ? `${m}:${s.padStart(5, '0')}` : s;
}

// Prüft und wandelt Formularzeilen in Regeln um (RequiredTimeRuleSchema).
// Fehler als { key, n } (n = Zeilennummer ab 1) für die i18n-Meldungen
// unter requiredTimes.*. Komplett leere Zeilen werden übersprungen.
export function validateRows(rows) {
  const rules = [];
  const errors = [];
  rows.forEach((row, i) => {
    const n = i + 1;
    const min = String(row.min ?? '').trim();
    const max = String(row.max ?? '').trim();
    const timeText = String(row.time ?? '').trim();
    if (!row.event && !timeText && !min && !max) return;
    if (!row.event) { errors.push({ key: 'errEvent', n }); return; }
    const time = timeToSec(timeText);
    if (!(time > 0) || !Number.isFinite(time) || time > 36000) { errors.push({ key: 'errTime', n }); return; }
    if (!DIGITS.test(min) || !DIGITS.test(max)) { errors.push({ key: 'errBound', n }); return; }
    const classType = row.classType || '';
    if (!classType && (min || max)) { errors.push({ key: 'errBoundsWithoutClass', n }); return; }
    let lo = min;
    let hi = max;
    if (classType === 'AL' && lo && hi && Number(lo) > Number(hi)) { errors.push({ key: 'errOrder', n }); return; }
    // Jahrgänge dürfen in beliebiger Reihenfolge eingegeben werden.
    if (classType === 'JG' && lo && hi && Number(lo) > Number(hi)) [lo, hi] = [hi, lo];
    rules.push({ event: row.event, gender: row.gender || '', classType, min: lo, max: hi, time: Math.round(time * 100) / 100 });
  });
  return { rules, errors };
}

const range = (rule) => [rule.min ? Number(rule.min) : -Infinity, rule.max ? Number(rule.max) : Infinity];

// Paare von Regeln (Indizes ab 1), die dieselbe Person treffen können:
// gleiche Disziplin, Geschlecht gleich oder eines davon "alle", und
// überlappende Altersgrenzen. Regeln mit unterschiedlicher Altersangabe
// (Jahrgang vs. Alter) lassen sich ohne Wettkampfjahr nicht vergleichen und
// gelten nur dann als überlappend, wenn eine davon für alle Altersstufen gilt.
export function findOverlaps(rules) {
  const pairs = [];
  for (let i = 0; i < rules.length; i++) {
    for (let j = i + 1; j < rules.length; j++) {
      const a = rules[i];
      const b = rules[j];
      if (a.event !== b.event) continue;
      if (a.gender && b.gender && a.gender !== b.gender) continue;
      if (a.classType && b.classType && a.classType !== b.classType) continue;
      const [aLo, aHi] = a.classType ? range(a) : [-Infinity, Infinity];
      const [bLo, bHi] = b.classType ? range(b) : [-Infinity, Infinity];
      if (aLo <= bHi && bLo <= aHi) pairs.push([i + 1, j + 1]);
    }
  }
  return pairs;
}

const GENDER_WORDS = {
  W: ['w', 'weiblich', 'female', 'f', 'frauen', 'damen', 'mädchen', 'women', 'girls'],
  M: ['m', 'männlich', 'male', 'männer', 'herren', 'jungen', 'men', 'boys'],
  '': ['', '-', '–', 'alle', 'all', 'x', 'mixed', 'beide', 'both'],
};

export function parseGender(text) {
  const v = String(text ?? '').trim().toLowerCase();
  for (const [code, words] of Object.entries(GENDER_WORDS)) if (words.includes(v)) return code;
  return null;
}

// "100m Freistil", "100 m freistil" und "100 Freistil" gelten als gleich.
export const normalizeEventText = (text) => String(text ?? '').toLowerCase().replace(/(\d)\s*m\b/g, '$1').replace(/\s+/g, ' ').trim();

// Wählbare Einzeldisziplinen (Staffeln haben keine Pflichtzeiten-Prüfung).
export function ruleEvents(allEvents) {
  return allEvents.filter((e) => !isRelayEvent(e));
}

// Zuordnung eines eingefügten Disziplin-Textes zu einem Disziplin-Label;
// `options` = [{ value, label }] (label in der Oberflächensprache).
export function matchEvent(text, options) {
  const wanted = normalizeEventText(text);
  if (!wanted) return null;
  const hit = options.find((o) => normalizeEventText(o.value) === wanted || normalizeEventText(o.label) === wanted);
  return hit ? hit.value : null;
}

// Liest kopierte Tabellenzeilen "Disziplin; Geschlecht; von; bis; Zeit"
// (Tab, Semikolon oder mindestens zwei Leerzeichen als Trenner). Die
// Altersangabe gilt für alle Zeilen. Liefert Formularzeilen und die
// Nummern nicht erkannter Zeilen; leere Zeilen werden übersprungen.
export function parsePastedRows(text, { classType = '', eventOptions = [] } = {}) {
  const rows = [];
  const errors = [];
  String(text ?? '').split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const cells = line.split(/\t|;|\s{2,}/).map((c) => c.trim());
    while (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
    const event = matchEvent(cells[0], eventOptions);
    const gender = parseGender(cells[1]);
    const [min = '', max = ''] = [cells[2], cells[3]];
    const timeText = cells[4] ?? '';
    const time = timeToSec(timeText);
    const boundsOk = DIGITS.test(min) && DIGITS.test(max) && (classType || (!min && !max));
    if (cells.length !== 5 || !event || gender === null || !boundsOk || !(time > 0)) { errors.push(i + 1); return; }
    rows.push(emptyRow({ event, gender, classType: classType || '', min, max, time: timeText }));
  });
  return { rows, errors };
}

// Nachweiszeitraum aus dem Formular; null-Werte für leere Felder.
// course: '' = Bahn des Wettkampfs (null), sonst 'LCM' | 'SCM' | 'any'.
export function windowFromInputs({ from, to, course }) {
  return { from: from || null, to: to || null, course: course || null };
}

export function windowError(window) {
  return window.from && window.to && window.to < window.from ? 'errWindow' : null;
}
