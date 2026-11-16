// Von Hand erfasste Pflichtzeiten: Prüfen der Formularzeilen, Überlappung
// und Einlesen aus einer kopierten Tabelle (js/modules/requiredTimeRules.js,
// docs/Plans/pflichtzeiten-manuell-plan.md).
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));
vi.mock('../js/db.js', () => ({ put: vi.fn(async () => {}) }));

import {
  validateRows, findOverlaps, parsePastedRows, parseGender, matchEvent, ruleEvents, ruleToRow, formatRuleTime, windowError, emptyRow,
} from '../js/modules/requiredTimeRules.js';
import { EVENTS } from '../js/refdata.js';

const options = [{ value: '100 Freistil', label: '100 Freestyle' }, { value: '50 Brust', label: '50 Breaststroke' }];

describe('validateRows', () => {
  it('wandelt gültige Zeilen um, überspringt leere und sortiert Jahrgänge', () => {
    const { rules, errors } = validateRows([
      emptyRow({ event: '100 Freistil', gender: 'W', classType: 'AL', min: '11', max: '12', time: '1:12,50' }),
      emptyRow(),
      emptyRow({ event: '50 Brust', classType: 'JG', min: '2015', max: '2012', time: '45.1' }),
    ]);
    expect(errors).toEqual([]);
    expect(rules).toEqual([
      { event: '100 Freistil', gender: 'W', classType: 'AL', min: '11', max: '12', time: 72.5 },
      { event: '50 Brust', gender: '', classType: 'JG', min: '2012', max: '2015', time: 45.1 },
    ]);
  });

  it('meldet den ersten Fehler je Zeile mit Zeilennummer', () => {
    const { errors } = validateRows([
      emptyRow({ time: '1:00' }),
      emptyRow({ event: '50 Brust', time: 'abc' }),
      emptyRow({ event: '50 Brust', time: '40', classType: 'AL', min: '1x' }),
      emptyRow({ event: '50 Brust', time: '40', min: '10' }),
      emptyRow({ event: '50 Brust', time: '40', classType: 'AL', min: '13', max: '12' }),
    ]);
    expect(errors).toEqual([
      { key: 'errEvent', n: 1 }, { key: 'errTime', n: 2 }, { key: 'errBound', n: 3 },
      { key: 'errBoundsWithoutClass', n: 4 }, { key: 'errOrder', n: 5 },
    ]);
  });
});

describe('findOverlaps', () => {
  const r = (o) => ({ event: '100 Freistil', gender: 'W', classType: 'AL', min: '', max: '', time: 70, ...o });
  it('findet überlappende Altersgrenzen derselben Disziplin und desselben Geschlechts', () => {
    expect(findOverlaps([r({ min: '10', max: '12' }), r({ min: '12', max: '14' })])).toEqual([[1, 2]]);
    expect(findOverlaps([r({ min: '10', max: '11' }), r({ min: '12', max: '14' })])).toEqual([]);
    expect(findOverlaps([r({ min: '10' }), r({ gender: 'M', min: '10' })])).toEqual([]);
    expect(findOverlaps([r({ min: '10' }), r({ event: '50 Brust', min: '10' })])).toEqual([]);
  });
  it('"alle" bei Geschlecht oder Alter überlappt mit allem', () => {
    expect(findOverlaps([r({ gender: '', min: '10', max: '10' }), r({ min: '10', max: '10' })])).toEqual([[1, 2]]);
    expect(findOverlaps([r({ classType: '' }), r({ classType: 'JG', min: '2012', max: '2013' })])).toEqual([[1, 2]]);
    // Jahrgang und Alter sind ohne Wettkampfjahr nicht vergleichbar.
    expect(findOverlaps([r({ classType: 'AL', min: '10' }), r({ classType: 'JG', min: '2012' })])).toEqual([]);
  });
});

describe('Einfügen aus einer Tabelle', () => {
  it('erkennt Disziplin, Geschlecht und Trenner', () => {
    const text = '100m Freistil\tw\t11\t12\t1:12,50\n\n50 Breaststroke;male;;;0:45,10\n100 Freistil  weiblich  13  14  1:08,00';
    const { rows, errors } = parsePastedRows(text, { classType: 'AL', eventOptions: options });
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      emptyRow({ event: '100 Freistil', gender: 'W', classType: 'AL', min: '11', max: '12', time: '1:12,50' }),
      emptyRow({ event: '50 Brust', gender: 'M', classType: 'AL', min: '', max: '', time: '0:45,10' }),
      emptyRow({ event: '100 Freistil', gender: 'W', classType: 'AL', min: '13', max: '14', time: '1:08,00' }),
    ]);
    expect(validateRows(rows).errors).toEqual([]);
  });
  it('meldet nicht erkannte Zeilen', () => {
    const text = '200 Delfin;w;11;12;2:40\n100 Freistil;x?;11;12;1:00\n100 Freistil;w;11;12\n100 Freistil;w;11;12;1:00';
    expect(parsePastedRows(text, { classType: 'AL', eventOptions: options }).errors).toEqual([1, 2, 3]);
    // Grenzen ohne Altersangabe sind nicht eindeutig.
    expect(parsePastedRows('100 Freistil;w;11;12;1:00', { classType: '', eventOptions: options }).errors).toEqual([1]);
  });
  it('Hilfsfunktionen', () => {
    expect(parseGender('Damen')).toBe('W');
    expect(parseGender('')).toBe('');
    expect(parseGender('?')).toBeNull();
    expect(matchEvent('100 m freestyle', options)).toBe('100 Freistil');
    expect(ruleEvents(EVENTS).some((e) => e.startsWith('4x'))).toBe(false);
    expect(formatRuleTime(72.5)).toBe('1:12.50');
    expect(formatRuleTime(28.9)).toBe('28.90');
    expect(ruleToRow({ event: '50 Brust', gender: '', classType: '', min: '', max: '', time: 61.05 }).time).toBe('1:01.05');
    expect(windowError({ from: '2026-05-01', to: '2026-04-01' })).toBe('errWindow');
    expect(windowError({ from: null, to: '2026-04-01' })).toBeNull();
  });
});
