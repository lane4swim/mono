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

// Prüft einen Startlisten-Eintrag. null, wenn für ihn keine Pflichtzeit
// hinterlegt ist (keine passende Disziplin, Staffel, keine Pflichtzeit
// für Geschlecht/Alter).
export function evaluateRequiredTime({ comp, entry, athlete, results }) {
  const disciplines = comp.disciplines || [];
  const d = disciplines[findDisciplineIndex(disciplines, entry)];
  if (!d?.requiredTimes?.length || d.relaySize > 1 || !athlete) return null;
  const matches = d.requiredTimes.map(rt => ({ rt, applies: requiredTimeApplies(rt, athlete, comp.date) }));
  const rule = matches.find(m => m.applies === true)?.rt;
  if (!rule) return matches.some(m => m.applies === null) ? { status: 'unknown' } : null;
  const best = bestQualifyingTimes(results, { athleteId: athlete.id, event: entry.event, comp, window: d.qualifyingWindow });
  const met = (time) => time != null && time <= rule.time;
  const status = met(best.official) ? 'official' : met(best.training) ? 'training' : 'missing';
  return { status, required: rule.time, rule, ...best };
}

const LIGHT_CLASS = { official: 'green', training: 'yellow', missing: 'red', unknown: 'grey' };

// Ampel + Pflichtzeit für die Startlisten-Zeile; Details im Tooltip.
export function requiredTimeLight(evaluation) {
  if (!evaluation) return '—';
  const label = t(`competitions.requiredTime_${evaluation.status}`);
  const title = evaluation.status === 'unknown' ? label : [
    label,
    t('competitions.requiredTimeValue', { time: secToTime(evaluation.required) }),
    t('competitions.requiredTimeBestOfficial', { time: secToTime(evaluation.official) }),
    t('competitions.requiredTimeBestTraining', { time: secToTime(evaluation.training) }),
  ].join('\n');
  return el('span', { class: 'req-time', title }, [
    el('span', { class: `req-light req-light-${LIGHT_CLASS[evaluation.status]}`, role: 'img', 'aria-label': label }),
    evaluation.required ? el('span', { class: 'data' }, secToTime(evaluation.required)) : null,
  ]);
}

export function hasRequiredTimes(comp) {
  return (comp.disciplines || []).some(d => d.requiredTimes?.length > 0);
}
