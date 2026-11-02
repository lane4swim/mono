import { describe, it, expect } from 'vitest';
import { applyDefinedPatch, softDeleteRow } from '../../src/db/inMemoryRows.js';

describe('applyDefinedPatch()', () => {
  it('übernimmt gesetzte Felder, auch null, lässt undefined unverändert und setzt updatedAt', () => {
    const before = new Date('2020-01-01T00:00:00.000Z');
    const row = { id: 'r1', note: 'alt', expiresOn: new Date('2030-01-01T00:00:00.000Z') as Date | null, updatedAt: before };
    const result = applyDefinedPatch(row, { note: undefined, expiresOn: null });
    expect(result).toBe(row);
    expect(row.note).toBe('alt');
    expect(row.expiresOn).toBeNull();
    expect(row.updatedAt.getTime()).toBeGreaterThan(before.getTime());
  });
});

describe('softDeleteRow()', () => {
  it('setzt deletedAt nur für die genannte Zeile; eine unbekannte ID ist ein No-op', () => {
    const rows = [
      { id: 'a', deletedAt: null as Date | null },
      { id: 'b', deletedAt: null as Date | null },
    ];
    softDeleteRow(rows, 'a');
    softDeleteRow(rows, 'unbekannt');
    expect(rows[0]!.deletedAt).toBeInstanceOf(Date);
    expect(rows[1]!.deletedAt).toBeNull();
  });
});
