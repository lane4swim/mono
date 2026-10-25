// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));
vi.mock('../js/db.js', () => ({ put: vi.fn(async () => {}) }));

import { competitionAge, requiredTimeApplies, evaluateRequiredTime, requiredTimeLight } from '../js/modules/requiredTimes.js';

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
    expect(evaluate([], entry('1', '100 Freistil'), { ...girl, birthdate: null })).toEqual({ status: 'unknown' });
  });
});

describe('requiredTimeLight', () => {
  it('zeigt Ampelfarbe und Pflichtzeit', () => {
    const node = requiredTimeLight({ status: 'training', required: 70, official: null, training: 69 });
    expect(node.querySelector('.req-light-yellow')).not.toBeNull();
    expect(node.textContent).toContain('1:10.00');
  });
});
