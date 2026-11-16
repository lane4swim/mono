// Meldevorschläge und Pflichtzeiten-Übersicht je Athlet:in
// (js/modules/requiredTimeSuggestions.js, athleteRequiredTimes.js,
// competitionRequiredTimes.js: openSuggestionsModal()).
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ stores: {} }));
vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));
vi.mock('../js/router.js', () => ({ navigate: vi.fn() }));
vi.mock('../js/db.js', () => ({
  getAll: vi.fn(async (store) => [...(db.stores[store] || [])]),
  put: vi.fn(async (store, obj) => { (db.stores[store] ||= []).push({ id: `e${db.stores[store].length + 1}`, ...obj }); return obj; }),
}));

import { requirementTargets, entrySuggestions, entryFromSuggestion, athleteRequirementOverview, setAsCompetition, metCount } from '../js/modules/requiredTimeSuggestions.js';
import { athleteRequiredTimesCard } from '../js/modules/athleteRequiredTimes.js';
import { openSuggestionsModal } from '../js/modules/competitionRequiredTimes.js';

const COMP = {
  id: 'c1', name: 'Bezirk', date: '2026-12-05T00:00:00.000Z', course: 'SCM',
  disciplines: [
    { number: '1', round: 'V', distanceM: 100, stroke: 'F', style: 'GL', relaySize: 1, gender: 'W', event: '100 Freistil', requiredTimes: [{ classType: '', min: '', max: '', gender: 'W', time: 75 }] },
    { number: '2', round: 'V', distanceM: 100, stroke: 'F', style: 'GL', relaySize: 1, gender: 'M', event: '100 Freistil', requiredTimes: [{ classType: '', min: '', max: '', gender: 'M', time: 70 }] },
    { number: '3', round: 'V', distanceM: 50, stroke: 'B', style: 'GL', relaySize: 1, gender: 'X', event: '50 Brust', requiredTimes: [{ classType: '', min: '', max: '', gender: '', time: 45 }] },
    { number: '4', round: 'V', distanceM: 200, stroke: 'F', style: 'GL', relaySize: 4, gender: 'X', event: '4x50 Freistil', requiredTimes: [{ classType: '', min: '', max: '', gender: '', time: 150 }] },
  ],
  manualRequirements: { rules: [{ event: '50 Brust', gender: '', classType: 'AL', min: '10', max: '20', time: 44 }], qualifyingWindow: {}, sourceSetId: null, sourceSetName: '' },
};
const ath = (id, gender, extra = {}) => ({ id, firstName: id, lastName: 'X', gender, birthdate: '2012-05-01T00:00:00.000Z', active: true, ...extra });
const res = (athleteId, event, time, extra = {}) => ({ athleteId, event, time, date: '2026-10-01T00:00:00.000Z', course: 'SCM', competitionId: 'old', status: 'OK', ...extra });

describe('requirementTargets', () => {
  it('je Disziplin und Geschlecht einmal, manuelle Regeln ersetzen importierte, ohne Staffeln', () => {
    expect(requirementTargets(COMP).map((t) => `${t.event}|${t.gender}|${t.eventNumber}`)).toEqual([
      '50 Brust||3', '100 Freistil|W|1', '100 Freistil|M|2',
    ]);
  });
});

describe('entrySuggestions', () => {
  const athletes = [ath('anna', 'w'), ath('ben', 'm'), ath('cora', 'w'), ath('dora', 'w', { active: false }), ath('emma', 'w')];
  const results = [
    res('anna', '100 Freistil', 74), // erfüllt im Wettkampf
    res('cora', '100 Freistil', 74.5, { competitionId: null }), // nur Training
    res('emma', '100 Freistil', 76.5), // 2 % zu langsam → knapp
    res('ben', '100 Freistil', 69.9),
    res('dora', '100 Freistil', 60), // inaktiv
    res('anna', '50 Brust', 44.5), // manuell 44 s → knapp verfehlt
  ];
  const entries = [{ competitionId: 'c1', athleteId: 'ben', event: '100 Freistil' }];
  const byKey = (list) => Object.fromEntries(list.map((g) => [`${g.target.event}|${g.target.gender}`, g.suggestions]));

  it('sortiert erfüllt im Wettkampf, im Training, knapp verfehlt; filtert Geschlecht und Inaktive', () => {
    const g = byKey(entrySuggestions({ comp: COMP, athletes, results, entries }));
    expect(g['100 Freistil|W'].map((s) => [s.athlete.id, s.kind, s.evaluation.status])).toEqual([
      ['anna', 'met', 'official'], ['cora', 'met', 'training'], ['emma', 'near', 'missing'],
    ]);
    expect(g['100 Freistil|W'][2].margin).toBe(-1.5);
    expect(g['100 Freistil|M'].map((s) => [s.athlete.id, s.entered])).toEqual([['ben', true]]);
    expect(g['50 Brust|'].map((s) => s.athlete.id)).toEqual(['anna']);
  });

  it('baut den Startlisten-Eintrag mit Wettkampfnummer und Meldezeit', () => {
    const g = entrySuggestions({ comp: COMP, athletes, results, entries });
    const w = g.find((x) => x.target.gender === 'W');
    expect(entryFromSuggestion(COMP, w.target, w.suggestions[1])).toEqual({
      competitionId: 'c1', athleteId: 'cora', event: '100 Freistil', eventNumber: '1', heat: null, lane: null, seedTime: 74.5,
    });
  });
});

describe('athleteRequirementOverview', () => {
  const SET = { id: 's1', name: 'Land 2027', rules: [{ event: '100 Freistil', gender: 'W', classType: 'AL', min: '14', max: '14', time: 80 }], qualifyingWindow: { from: null, to: null, course: null } };
  it('zeigt anstehende Wettkämpfe und Normtabellen mit geltender Regel', () => {
    const past = { ...COMP, id: 'c0', date: '2026-01-01T00:00:00.000Z' };
    const o = athleteRequirementOverview({
      athlete: ath('anna', 'w'), competitions: [COMP, past], sets: [SET],
      results: [res('anna', '100 Freistil', 74, { course: 'LCM', date: '2026-11-16T00:00:00.000Z' })],
      entries: [{ competitionId: 'c1', athleteId: 'anna', event: '100 Freistil' }], today: '2026-11-16',
    });
    expect(o.competitions.map((c) => c.comp.id)).toEqual(['c1']);
    // Bahn des Wettkampfs (SCM): die LCM-Zeit zählt dort nicht.
    expect(o.competitions[0].rows.map((r) => [r.target.event, r.evaluation.status, r.entered])).toEqual([
      ['100 Freistil', 'missing', true], ['50 Brust', 'missing', false],
    ]);
    // Normtabelle ohne Bahnvorgabe: jede Bahn, heutige Zeit zählt, Alter 2026 = 14.
    expect(o.sets[0].rows.map((r) => r.evaluation.status)).toEqual(['official']);
    expect(metCount(o.sets[0].rows)).toBe(1);
    expect(setAsCompetition(SET, '2026-11-16').date).toBe('2026-11-17T00:00:00.000Z');
  });

  it('Karte nur, wenn irgendwo eine Regel gilt', () => {
    const none = athleteRequiredTimesCard({ athlete: ath('ben', 'm'), competitions: [], sets: [], results: [], entries: [], today: '2026-11-16' });
    expect(none).toBeNull();
    const card = athleteRequiredTimesCard({ athlete: ath('anna', 'w'), competitions: [COMP], sets: [], results: [], entries: [], today: '2026-11-16' });
    expect(card.textContent).toContain('Bezirk');
    expect(card.textContent).toContain('0 von 2 erfüllt');
  });
});

describe('Dialog "Meldevorschläge"', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="modal-root" hidden></div>';
    db.stores = {
      athletes: [ath('anna', 'w'), ath('cora', 'w')],
      results: [res('anna', '100 Freistil', 74), res('cora', '100 Freistil', 73)],
      entries: [],
    };
  });
  it('meldet einzeln und alle Erfüllten einer Disziplin', async () => {
    const onChanged = vi.fn();
    await openSuggestionsModal(COMP, onChanged);
    const all = [...document.querySelectorAll('#modal-root button')].find((b) => b.textContent.includes('Alle 2'));
    all.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(db.stores.entries.map((e) => e.athleteId).sort()).toEqual(['anna', 'cora']);
    expect(onChanged).toHaveBeenCalled();
    expect(document.querySelectorAll('#modal-root .badge').length).toBe(2); // jetzt "gemeldet"
  });
});
