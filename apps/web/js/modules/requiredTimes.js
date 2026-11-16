// Pflichtzeiten-Prüfung für die Startliste: Hat die gemeldete Athlet:in
// die Pflichtzeit der Disziplin (geladen aus der Wettkampfdefinition, siehe
// resultsImport/dsv7DefinitionParser.js) bereits nachgewiesen?
//
//   'official' (grün) — in einem Wettkampf erreicht (Ergebnis mit
//                       competitionId),
//   'training' (gelb) — nur im Training erreicht (competitionId null),
//   'missing'  (rot)  — nicht erreicht,
//   'unknown'         — nicht prüfbar (kein Geburtsdatum, unbekannte
//                       Altersklasse).
//
// Zwei Quellen, eine Auswertung (docs/Plans/pflichtzeiten-manuell-plan.md):
// von Hand erfasste Regeln (comp.manualRequirements, auch aus Normtabellen
// übernommen) hängen am Disziplin-Label und ersetzen für ihre Disziplin die
// importierten; sonst gelten die Regeln der importierten Disziplin.
//
// Das Alter zählt wie in den DSV-Wettkampfbestimmungen nach dem
// Kalenderjahr des Wettkampfs (Wettkampfjahr minus Geburtsjahr), nicht
// nach dem heutigen Datum.
import { el } from '../dom.js';
import { secToTime } from '../swimTime.js';
import { t } from '../i18n.js';
import { findDisciplineIndex } from './competitionDisciplines.js';

const day = (iso) => (iso || '').slice(0, 10);
const yearOf = (iso) => Number(day(iso).slice(0, 4));

// Alter im Wettkampfjahr, null ohne Geburtsdatum.
export function competitionAge(birthdate, compDate) {
  if (!birthdate || !compDate) return null;
  return yearOf(compDate) - yearOf(birthdate);
}

const isNumber = (v) => /^\d+$/.test(v);

// Liegt `value` in den Grenzen der Altersklasse? Masters-Altersklassen
// (AK 20, 25, …) umfassen fünf Jahre, numerische Altersklassen darunter
// genau ein Jahr. Liefert null bei nicht auswertbaren Kürzeln (z. B.
// Jugend-Buchstaben, deren Jahrgänge sich mit den Wettkampfbestimmungen
// ändern).
function inAgeClass(age, min, max) {
  if ((min && !isNumber(min)) || (max && !isNumber(max))) return null;
  const lo = min ? Number(min) : -Infinity;
  const hiClass = max ? Number(max) : Infinity;
  const hi = hiClass >= 20 && hiClass !== Infinity ? hiClass + 4 : hiClass;
  return age >= lo && age <= hi;
}

// Gilt die Pflichtzeit für die Athlet:in? true/false, null = nicht prüfbar.
export function requiredTimeApplies(rt, athlete, compDate) {
  const g = athlete?.gender;
  if (rt.gender === 'M' || rt.gender === 'W') {
    if (g && g !== 'd' && rt.gender.toLowerCase() !== g) return false;
  }
  if (!rt.classType || (!rt.min && !rt.max)) return true;
  const birthYear = athlete?.birthdate ? yearOf(athlete.birthdate) : null;
  if (birthYear == null) return null;
  if (rt.classType === 'AL') {
    // Alter im Wettkampfjahr, beide Grenzen inklusive — ohne die
    // Masters-Aufweitung des DSV-Typs "AK" (von Hand erfasste Regeln).
    if ((rt.min && !isNumber(rt.min)) || (rt.max && !isNumber(rt.max))) return null;
    const age = competitionAge(athlete.birthdate, compDate);
    return age >= (rt.min ? Number(rt.min) : -Infinity) && age <= (rt.max ? Number(rt.max) : Infinity);
  }
  if (rt.classType === 'JG') {
    if ((rt.min && !isNumber(rt.min)) || (rt.max && !isNumber(rt.max))) return null;
    // JG-Grenzen sind Geburtsjahre (0–9999 = alle), unabhängig von der
    // Reihenfolge in der Datei.
    const a = rt.min ? Number(rt.min) : -Infinity;
    const b = rt.max ? Number(rt.max) : Infinity;
    return birthYear >= Math.min(a, b) && birthYear <= Math.max(a, b);
  }
  return inAgeClass(competitionAge(athlete.birthdate, compDate), rt.min, rt.max);
}

// Bestzeit je Kontext (Wettkampf/Training) aus den Ergebnissen, die als
// Nachweis zählen: gleiche Athlet:in und Disziplin, gewertete Zeit, vor dem
// Wettkampftag, nicht aus diesem Wettkampf, im Nachweiszeitraum und auf der
// geforderten Bahn (ohne NACHWEIS: Bahn des Wettkampfs).
export function bestQualifyingTimes(results, { athleteId, event, comp, window }) {
  const course = window ? window.course : comp.course;
  const compDay = day(comp.date);
  let official = null;
  let training = null;
  for (const r of results) {
    if (r.athleteId !== athleteId || r.event !== event || r.competitionId === comp.id) continue;
    if (!(r.time > 0) || (r.status && r.status !== 'OK')) continue;
    const d = day(r.date);
    if (d >= compDay) continue;
    if (window?.from && d < window.from) continue;
    if (window?.to && d > window.to) continue;
    if (course && r.course !== course) continue;
    if (r.competitionId) official = official == null ? r.time : Math.min(official, r.time);
    else training = training == null ? r.time : Math.min(training, r.time);
  }
  return { official, training };
}

export const isRelayEvent = (event) => /^\d+\s*x/i.test(event || '');

export function manualRules(comp) {
  return comp?.manualRequirements?.rules || [];
}

// Nachweiszeitraum manueller Regeln in der Form von bestQualifyingTimes():
// course null = Bahn des Wettkampfs, 'any' = jede Bahn. Ohne Angaben
// undefined — dann gilt wie bisher die Bahn des Wettkampfs.
export function manualWindow(comp) {
  const w = comp?.manualRequirements?.qualifyingWindow;
  if (!w || (!w.from && !w.to && !w.course)) return undefined;
  return { from: w.from || null, to: w.to || null, course: w.course === 'any' ? null : (w.course || comp.course) };
}

// Regeln und Nachweiszeitraum, die für einen Startlisten-Eintrag gelten,
// samt Quelle ('manual' | 'import'); null ohne Regeln oder bei Staffeln.
export function rulesForEntry(comp, entry) {
  if (isRelayEvent(entry?.event)) return null;
  const manual = manualRules(comp).filter(r => r.event === entry.event);
  if (manual.length > 0) return { rules: manual, window: manualWindow(comp), source: 'manual' };
  const disciplines = comp.disciplines || [];
  const d = disciplines[findDisciplineIndex(disciplines, entry)];
  if (!d?.requiredTimes?.length || d.relaySize > 1) return null;
  return { rules: d.requiredTimes, window: d.qualifyingWindow, source: 'import' };
}

// Prüft einen Startlisten-Eintrag. null, wenn für ihn keine Pflichtzeit
// hinterlegt ist (keine Regel für die Disziplin, Staffel, keine Pflichtzeit
// für Geschlecht/Alter).
export function evaluateRequiredTime({ comp, entry, athlete, results }) {
  const found = rulesForEntry(comp, entry);
  if (!found || !athlete) return null;
  const matches = found.rules.map(rt => ({ rt, applies: requiredTimeApplies(rt, athlete, comp.date) }));
  const rule = matches.find(m => m.applies === true)?.rt;
  if (!rule) return matches.some(m => m.applies === null) ? { status: 'unknown', source: found.source } : null;
  const best = bestQualifyingTimes(results, { athleteId: athlete.id, event: entry.event, comp, window: found.window });
  const met = (time) => time != null && time <= rule.time;
  const status = met(best.official) ? 'official' : met(best.training) ? 'training' : 'missing';
  return { status, required: rule.time, rule, source: found.source, ...best };
}

const LIGHT_CLASS = { official: 'green', training: 'yellow', missing: 'red', unknown: 'grey' };

function sourceLabel(evaluation, comp) {
  if (evaluation.source === 'import') return t('requiredTimes.sourceImport');
  const setName = comp?.manualRequirements?.sourceSetName;
  return setName ? t('requiredTimes.sourceSet', { name: setName }) : t('requiredTimes.sourceManual');
}

// Ampel + Pflichtzeit für die Startlisten-Zeile; Details im Tooltip.
export function requiredTimeLight(evaluation, comp) {
  if (!evaluation) return '—';
  const label = t(`competitions.requiredTime_${evaluation.status}`);
  const source = evaluation.source ? sourceLabel(evaluation, comp) : null;
  const title = (evaluation.status === 'unknown' ? [label, source] : [
    label,
    t('competitions.requiredTimeValue', { time: secToTime(evaluation.required) }),
    t('competitions.requiredTimeBestOfficial', { time: secToTime(evaluation.official) }),
    t('competitions.requiredTimeBestTraining', { time: secToTime(evaluation.training) }),
    source,
  ]).filter(Boolean).join('\n');
  return el('span', { class: 'req-time', title }, [
    el('span', { class: `req-light req-light-${LIGHT_CLASS[evaluation.status]}`, role: 'img', 'aria-label': label }),
    evaluation.required ? el('span', { class: 'data' }, secToTime(evaluation.required)) : null,
  ]);
}

export function hasRequiredTimes(comp) {
  return manualRules(comp).length > 0 || (comp.disciplines || []).some(d => d.requiredTimes?.length > 0);
}
