import { describe, it, expect } from 'vitest';
import { startOfUtcDay } from '../../src/modules/shared/dates.js';

describe('startOfUtcDay()', () => {
  it('liefert Mitternacht (UTC) desselben Kalendertags', () => {
    expect(startOfUtcDay(new Date('2026-11-02T23:59:59.999Z')).toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(startOfUtcDay(new Date('2026-11-02T00:00:00.000Z')).toISOString()).toBe('2026-11-02T00:00:00.000Z');
  });
});
