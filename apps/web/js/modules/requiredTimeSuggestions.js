// Meldevorschläge und Pflichtzeiten-Übersicht je Athlet:in
// (docs/Plans/pflichtzeiten-manuell-plan.md, Abschnitt 6). Reine Logik ohne
// DOM — die Oberfläche liegt in competitionRequiredTimes.js bzw.
// athletes.js. Bewertet wird ausschließlich über evaluateRequiredTime(),
// also nach genau denselben Regeln wie die Ampel in der Startliste.
import { evaluateRequiredTime, manualRules, isRelayEvent } from './requiredTimes.js';
import { disciplineMatchesAthlete } from './competitionDisciplines.js';
import { isoAddDays } from '../dates.js';

// Wer die Pflichtzeit um höchstens diesen Anteil verfehlt, erscheint als
// "knapp verfehlt" in den Meldevorschlägen (3 % ≈ 2 s auf 100 m Freistil).
export const NEAR_MISS_RATIO = 0.03;

// Disziplinen eines Wettkampfs, für die Pflichtzeiten gelten — je
// Disziplin und Geschlecht einmal. Von Hand erfasste Regeln zählen je
// Disziplin-Label (mit der Wettkampfnummer der Definition, falls es eine
// gibt); importierte Disziplinen ohne manuelle Regeln mit ihrer Nummer.
export function requirementTargets(comp) {
  const targets = [];
  const disciplines = comp.disciplines || [];
  const manualEvents = [...new Set(manualRules(comp).map((r) => r.event))].filter((e) => !isRelayEvent(e));
  for (const event of manualEvents) {
    const d = disciplines.find((x) => x.event === event && (x.relaySize || 1) <= 1);
    targets.push({ event, eventNumber: d ? d.number : '', gender: '' });
  }
  const seen = new Set();
  for (const d of disciplines) {
    if (!d.event || !d.requiredTimes?.length || (d.relaySize || 1) > 1 || manualEvents.includes(d.event)) continue;
    const key = `${d.event}|${d.gender || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push({ event: d.event, eventNumber: d.number, gender: d.gender || '', discipline: d });
  }
  return targets;
}

export function evaluateTarget(comp, target, athlete, results) {
  if (target.discipline && !disciplineMatchesAthlete(target.discipline, athlete)) return null;
  const entry = { competitionId: comp.id, athleteId: athlete.id, event: target.event, eventNumber: target.eventNumber };
  return evaluateRequiredTime({ comp, entry, athlete, results });
}

const bestOf = (ev) => (ev.official != null ? ev.official : ev.training);
const fastest = (ev) => [ev.official, ev.training].filter((x) => x != null).reduce((a, b) => Math.min(a, b), Infinity);

// Meldevorschläge: je Disziplin die aktiven Athlet:innen, die die
// Pflichtzeit erfüllen (kind 'met') oder knapp verfehlen ('near'),
// sortiert nach Status (Wettkampf vor Training vor knapp) und Vorsprung.
// `entered` markiert, wer für diese Disziplin schon in der Startliste steht.
export function entrySuggestions({ comp, athletes, results, entries, nearMissRatio = NEAR_MISS_RATIO }) {
  const rank = { official: 0, training: 1, missing: 2 };
  const active = athletes.filter((a) => a.active !== false);
  const compEntries = entries.filter((e) => e.competitionId === comp.id);
  return requirementTargets(comp).map((target) => {
    const suggestions = [];
    for (const athlete of active) {
      const evaluation = evaluateTarget(comp, target, athlete, results);
      if (!evaluation || evaluation.status === 'unknown') continue;
      const best = fastest(evaluation);
      const met = evaluation.status !== 'missing';
      const near = !met && best <= evaluation.required * (1 + nearMissRatio);
      if (!met && !near) continue;
      suggestions.push({
        athlete, evaluation, kind: met ? 'met' : 'near',
        margin: Math.round((evaluation.required - best) * 100) / 100,
        seedTime: bestOf(evaluation) ?? best,
        entered: compEntries.some((e) => e.athleteId === athlete.id && e.event === target.event),
      });
    }
    suggestions.sort((a, b) => rank[a.evaluation.status] - rank[b.evaluation.status] || b.margin - a.margin);
    return { target, suggestions };
  });
}

// Startlisten-Eintrag für einen Vorschlag; Meldezeit = beste Wettkampfzeit,
// ersatzweise die beste Trainingszeit.
export function entryFromSuggestion(comp, target, suggestion) {
  return {
    competitionId: comp.id, athleteId: suggestion.athlete.id, event: target.event,
    eventNumber: target.eventNumber || '', heat: null, lane: null,
    seedTime: Number.isFinite(suggestion.seedTime) ? suggestion.seedTime : null,
  };
}

// Normtabelle als gedachter Wettkampf für die Übersicht: Stichtag morgen
// (damit heutige Zeiten zählen), Alter im laufenden Jahr, und ohne
// Bahnvorgabe der Tabelle jede Bahn — es gibt keinen Wettkampf, dessen
// Bahn gelten könnte.
export function setAsCompetition(set, today) {
  const w = set.qualifyingWindow || {};
  return {
    id: `set:${set.id}`, name: set.name, date: `${isoAddDays(today, 1)}T00:00:00.000Z`, course: null,
    manualRequirements: { rules: set.rules || [], qualifyingWindow: { from: w.from || null, to: w.to || null, course: w.course || 'any' }, sourceSetId: set.id, sourceSetName: set.name },
  };
}

function rowsFor(comp, athlete, results, entries) {
  const rows = [];
  for (const target of requirementTargets(comp)) {
    const evaluation = evaluateTarget(comp, target, athlete, results);
    if (!evaluation) continue;
    rows.push({ target, evaluation, entered: entries.some((e) => e.competitionId === comp.id && e.athleteId === athlete.id && e.event === target.event) });
  }
  return rows.sort((a, b) => a.target.event.localeCompare(b.target.event));
}

// Übersicht je Athlet:in: anstehende Wettkämpfe (ab heute) und
// Normtabellen, jeweils nur Disziplinen mit einer für sie geltenden Regel.
export function athleteRequirementOverview({ athlete, competitions, sets, results, entries, today }) {
  const upcoming = competitions
    .filter((c) => (c.date || '').slice(0, 10) >= today)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((comp) => ({ comp, rows: rowsFor(comp, athlete, results, entries) }))
    .filter((x) => x.rows.length > 0);
  const tables = [...sets]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((set) => { const comp = setAsCompetition(set, today); return { set, comp, rows: rowsFor(comp, athlete, results, []) }; })
    .filter((x) => x.rows.length > 0);
  return { competitions: upcoming, sets: tables };
}

export const metCount = (rows) => rows.filter((r) => r.evaluation.status === 'official' || r.evaluation.status === 'training').length;
