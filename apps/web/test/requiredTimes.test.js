// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));
vi.mock('../js/db.js', () => ({ put: vi.fn(async () => {}) }));

import { competitionAge, requiredTimeApplies, evaluateRequiredTime, requiredTimeLight, hasRequiredTimes, manualWindow } from '../js/modules/requiredTimes.js';

const COMP = {
  id: 'comp', date: '2026-11-14T00:00:00.000Z', course: 'LCM',
  disciplines: [
    {
      number: '1', round: 'E', distanceM: 100, stroke: 'F', style: 'GL', relaySize: 1, gender: 'W', event: '100 Freistil',
      requiredTimes: [
        { classType: 'JG', min: '2012', max: '2013', gender: 'W', time: 75 },
        { classType: 'JG', min: '2010', max: '2011', gender: 'W', time: 70 },
      ],
    },
    { number: '2', round: 'E', distanceM: 50, stroke: 'R', style: 'GL', relaySize: 1, gender: 'M', event: '50 Rücken',
      requiredTimes: [{ classType: 'AK', min: '30', max: '30', gender: 'M', time: 40 }],
      qualifyingWindow: { from: '2026-01-01', to: '2026-10-31', course: null } },
    { number: '3', round: 'E', distanceM: 100, stroke: 'B', style: 'GL', relaySize: 1, gender: 'X', event: '100 Brust' },
  ],
};
const girl = { id: 'a1', gender: 'w', birthdate: '2011-12-31T00:00:00.000Z' };
const entry = (number, event, athleteId = 'a1') => ({ competitionId: 'comp', athleteId, eventNumber: number, event });
const result = (time, extra = {}) => ({ athleteId: 'a1', event: '100 Freistil', time, date: '2026-06-01T00:00:00.000Z', course: 'LCM', competitionId: 'other', status: 'OK', ...extra });

describe('competitionAge', () => {
  it('zählt nach dem Kalenderjahr des Wettkampfs, nicht nach heute', () => {
    expect(competitionAge('2011-12-31', '2026-01-02')).toBe(15);
    expect(competitionAge('2011-12-31', '2027-06-01')).toBe(16);
    expect(competitionAge(null, '2026-01-02')).toBeNull();
  });
});

describe('requiredTimeApplies', () => {
  it('prüft Jahrgang und Geschlecht', () => {
    const rt = COMP.disciplines[0].requiredTimes[1];
    expect(requiredTimeApplies(rt, girl, COMP.date)).toBe(true);
    expect(requiredTimeApplies(rt, { ...girl, gender: 'm' }, COMP.date)).toBe(false);
    expect(requiredTimeApplies(rt, { ...girl, birthdate: '2012-01-01' }, COMP.date)).toBe(false);
    expect(requiredTimeApplies(rt, { ...girl, birthdate: null }, COMP.date)).toBeNull();
  });

  it('Masters-AK umfasst fünf Jahre, berechnet zum Wettkampfjahr', () => {
    const rt = { classType: 'AK', min: '30', max: '30', gender: '', time: 40 };
    expect(requiredTimeApplies(rt, { gender: 'm', birthdate: '1992-05-05' }, '2026-11-14')).toBe(true); // 34
    expect(requiredTimeApplies(rt, { gender: 'm', birthdate: '1991-05-05' }, '2026-11-14')).toBe(false); // 35
    expect(requiredTimeApplies(rt, { gender: 'm', birthdate: '1991-05-05' }, '2025-11-14')).toBe(true); // 34 im Jahr 2025
  });

  it('meldet unbekannte Altersklassen-Kürzel als nicht prüfbar', () => {
    expect(requiredTimeApplies({ classType: 'AK', min: 'C', max: 'C', gender: '', time: 1 }, girl, COMP.date)).toBeNull();
  });
});

describe('evaluateRequiredTime', () => {
  const evaluate = (results, e = entry('1', '100 Freistil'), athlete = girl) => evaluateRequiredTime({ comp: COMP, entry: e, athlete, results });

  it('grün bei Wettkampfzeit, gelb bei Trainingszeit, rot sonst', () => {
    expect(evaluate([result(69.9)]).status).toBe('official');
    expect(evaluate([result(70)]).status).toBe('official');
    expect(evaluate([result(72), result(69, { competitionId: null })]).status).toBe('training');
    expect(evaluate([result(72), result(70.5, { competitionId: null })])).toMatchObject({ status: 'missing', required: 70, official: 72, training: 70.5 });
  });

  it('wählt die Pflichtzeit nach dem Alter zum Wettkampf', () => {
    expect(evaluate([], entry('1', '100 Freistil'), { ...girl, birthdate: '2012-03-01' }).required).toBe(75);
  });

  it('ignoriert Zeiten nach dem Wettkampftag, aus diesem Wettkampf, andere Bahn, andere Strecke und ungewertete', () => {
    expect(evaluate([
      result(60, { date: '2026-11-14T00:00:00.000Z' }),
      result(60, { competitionId: 'comp', date: '2026-06-01T00:00:00.000Z' }),
      result(60, { course: 'SCM' }),
      result(60, { event: '200 Freistil' }),
      result(60, { status: 'DS' }),
      result(60, { athleteId: 'other' }),
    ]).status).toBe('missing');
  });

  it('beachtet den Nachweiszeitraum und lässt dort jede Bahn zu', () => {
    const man = { id: 'a1', gender: 'm', birthdate: '1994-01-01' };
    const back = (extra) => result(39, { event: '50 Rücken', course: 'SCM', ...extra });
    expect(evaluate([back({})], entry('2', '50 Rücken'), man).status).toBe('official');
    expect(evaluate([back({ date: '2025-12-31T00:00:00.000Z' })], entry('2', '50 Rücken'), man).status).toBe('missing');
  });

  it('null ohne Pflichtzeit, nicht prüfbar ohne Geburtsdatum', () => {
    expect(evaluate([], entry('3', '100 Brust'))).toBeNull();
    expect(evaluate([], entry('1', '100 Freistil'), { ...girl, gender: 'm' })).toBeNull();
    expect(evaluate([], entry('1', '100 Freistil'), { ...girl, birthdate: null })).toEqual({ status: 'unknown', source: 'import' });
  });
});

describe('requiredTimeLight', () => {
  it('zeigt Ampelfarbe und Pflichtzeit', () => {
    const node = requiredTimeLight({ status: 'training', required: 70, official: null, training: 69 });
    expect(node.querySelector('.req-light-yellow')).not.toBeNull();
    expect(node.textContent).toContain('1:10.00');
  });
});

// Von Hand erfasste Pflichtzeiten (docs/Plans/pflichtzeiten-manuell-plan.md).
describe('manuelle Pflichtzeiten', () => {
  const manual = (rules, qualifyingWindow = {}) => ({ ...COMP, manualRequirements: { rules, qualifyingWindow, sourceSetId: null, sourceSetName: '' } });
  const evalManual = (comp, results, e, athlete = girl) => evaluateRequiredTime({ comp, entry: e, athlete, results });

  it('AL zählt das Alter im Wettkampfjahr ohne Masters-Aufweitung', () => {
    const rt = { classType: 'AL', min: '18', max: '25', gender: '', time: 60 };
    const born = (y) => ({ id: 'x', gender: 'm', birthdate: `${y}-06-01T00:00:00.000Z` });
    expect(requiredTimeApplies(rt, born(2001), COMP.date)).toBe(true); // 25
    expect(requiredTimeApplies(rt, born(2000), COMP.date)).toBe(false); // 26 — bei "AK" wäre es true
    expect(requiredTimeApplies(rt, born(2008), COMP.date)).toBe(true); // 18
    expect(requiredTimeApplies(rt, born(2009), COMP.date)).toBe(false); // 17
    expect(requiredTimeApplies({ ...rt, max: '' }, born(1950), COMP.date)).toBe(true);
    expect(requiredTimeApplies(rt, { id: 'x', gender: 'm', birthdate: null }, COMP.date)).toBeNull();
  });

  it('ersetzt die importierten Regeln für dieselbe Disziplin', () => {
    // girl ist 2026 15 Jahre alt; importiert gälte 70 s (JG 2010–2011).
    const comp = manual([{ event: '100 Freistil', gender: 'W', classType: 'AL', min: '15', max: '15', time: 72 }]);
    const r = evalManual(comp, [result(71)], entry('1', '100 Freistil'));
    expect(r).toMatchObject({ status: 'official', required: 72, source: 'manual' });
    // Andere Disziplinen behalten ihre importierten Regeln.
    expect(evalManual(comp, [], entry('2', '50 Rücken'), { id: 'a1', gender: 'm', birthdate: '1996-01-01T00:00:00.000Z' })).toMatchObject({ source: 'import' });
  });

  it('greift über den Disziplinnamen auch ohne Wettkampfnummer und ohne Definition', () => {
    const comp = { id: 'comp', date: COMP.date, course: 'SCM', manualRequirements: { rules: [{ event: '50 Brust', gender: '', classType: '', min: '', max: '', time: 45 }] } };
    const e = { competitionId: 'comp', athleteId: 'a1', eventNumber: '', event: '50 Brust' };
    expect(evalManual(comp, [result(44, { event: '50 Brust', course: 'SCM', competitionId: null })], e).status).toBe('training');
    // Bahn des Wettkampfs (SCM): eine 50-m-Bahn-Zeit zählt nicht.
    expect(evalManual(comp, [result(44, { event: '50 Brust', course: 'LCM' })], e).status).toBe('missing');
    expect(hasRequiredTimes(comp)).toBe(true);
    expect(evalManual(comp, [], { ...e, event: '4x50 Freistil' })).toBeNull();
  });

  it('beachtet Nachweiszeitraum und Bahn "beliebig"', () => {
    const rules = [{ event: '100 Freistil', gender: '', classType: '', min: '', max: '', time: 72 }];
    const any = manual(rules, { from: '2026-05-01', to: null, course: 'any' });
    expect(evalManual(any, [result(71, { course: 'SCM' })], entry('1', '100 Freistil')).status).toBe('official');
    expect(evalManual(any, [result(71, { date: '2026-04-30T00:00:00.000Z' })], entry('1', '100 Freistil')).status).toBe('missing');
    expect(manualWindow(manual(rules))).toBeUndefined();
    expect(manualWindow(manual(rules, { from: null, to: '2026-10-01', course: null }))).toEqual({ from: null, to: '2026-10-01', course: 'LCM' });
  });

  it('nennt die Quelle im Tooltip', () => {
    const comp = { ...manual([]), manualRequirements: { rules: [], sourceSetName: 'Bezirk 2027' } };
    const node = requiredTimeLight({ status: 'missing', required: 70, official: null, training: null, source: 'manual' }, comp);
    expect(node.getAttribute('title')).toContain('Bezirk 2027');
  });
});
