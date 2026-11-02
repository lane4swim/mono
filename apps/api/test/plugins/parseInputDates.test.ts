import { describe, it, expect } from 'vitest';
import { toDateOrNull, toDatePatch } from '../../src/plugins/parseInput.js';

const ISO = '2026-11-02T00:00:00.000Z';

describe('toDateOrNull()', () => {
  it('wandelt einen ISO-String um; fehlend oder null wird null', () => {
    expect(toDateOrNull(ISO)?.toISOString()).toBe(ISO);
    expect(toDateOrNull(null)).toBeNull();
    expect(toDateOrNull(undefined)).toBeNull();
  });
});

describe('toDatePatch()', () => {
  it('unterscheidet "unverändert" (undefined) von "entfernen" (null)', () => {
    expect(toDatePatch(ISO)?.toISOString()).toBe(ISO);
    expect(toDatePatch(null)).toBeNull();
    expect(toDatePatch(undefined)).toBeUndefined();
  });
});
