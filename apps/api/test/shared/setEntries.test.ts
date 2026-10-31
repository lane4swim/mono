import { describe, it, expect } from 'vitest';
import { isRecord, forEachPlainSet, mapPlainSets } from '../../src/modules/shared/setEntries.js';

const SET_A = { kind: 'set', id: 'a', exerciseId: 'ex-a' };
const SET_B = { kind: 'set', id: 'b', exerciseId: 'ex-b' };
const SET_C = { kind: 'set', id: 'c' };
const ENTRIES = [
  SET_A,
  { kind: 'block', id: 'blk', sets: [SET_B] },
  { kind: 'section', id: 'sec', entries: [{ kind: 'block', id: 'blk2', sets: [SET_C] }] },
];

describe('isRecord()', () => {
  it('erkennt Objekte, aber keine Arrays oder null', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });
});

describe('forEachPlainSet()', () => {
  it('besucht jeden Satz, auch in Blöcken und Abschnitten', () => {
    const visited: unknown[] = [];
    forEachPlainSet(ENTRIES, (set) => visited.push(set.id));
    expect(visited).toEqual(['a', 'b', 'c']);
  });

  it('überspringt unerwartete Formen, statt zu werfen', () => {
    const visited: unknown[] = [];
    forEachPlainSet([null, 'x', [], { kind: 'unknown' }, { kind: 'block', sets: 'kaputt' }, SET_A], (set) => visited.push(set.id));
    expect(visited).toEqual(['a']);
    forEachPlainSet(undefined, () => visited.push('nie'));
    expect(visited).toEqual(['a']);
  });
});

describe('mapPlainSets()', () => {
  it('ersetzt nur die gemeldeten Sätze und behält unveränderte Teile identisch', () => {
    const { changed, value } = mapPlainSets(ENTRIES, (set) => (set.id === 'b' ? { ...set, note: 'neu' } : null));
    expect(changed).toBe(true);
    const result = value as typeof ENTRIES;
    expect(result[0]).toBe(SET_A);
    expect(result[2]).toBe(ENTRIES[2]);
    expect(result[1]).toEqual({ kind: 'block', id: 'blk', sets: [{ ...SET_B, note: 'neu' }] });
  });

  it('meldet keine Änderung, wenn kein Satz ersetzt wird', () => {
    const { changed, value } = mapPlainSets(ENTRIES, () => null);
    expect(changed).toBe(false);
    expect(value).toEqual(ENTRIES);
  });

  it('gibt Nicht-Arrays unverändert zurück', () => {
    expect(mapPlainSets(undefined, () => ({}))).toEqual({ changed: false, value: undefined });
  });
});
