import { describe, it, expect } from 'vitest';
import { isDue, nextDueAt, isStale } from '../../../src/jobs/scheduler/schedule.js';

const daily = { kind: 'daily', hourUtc: 2 } as const;
const sixHourly = { kind: 'interval', hours: 6 } as const;
const at = (iso: string) => new Date(iso);

describe('isDue / nextDueAt — täglich', () => {
  it('ist ohne bisherigen Lauf sofort fällig', () => {
    expect(isDue(daily, null, at('2026-10-11T10:00:00Z'))).toBe(true);
  });

  it('ist nach dem heutigen Lauf erst am nächsten Tag zur Zielstunde wieder fällig', () => {
    const last = at('2026-10-11T02:00:30Z');
    expect(isDue(daily, last, at('2026-10-11T23:59:00Z'))).toBe(false);
    expect(isDue(daily, last, at('2026-10-12T01:59:00Z'))).toBe(false);
    expect(isDue(daily, last, at('2026-10-12T02:00:00Z'))).toBe(true);
    expect(nextDueAt(daily, last, at('2026-10-11T12:00:00Z')).toISOString()).toBe('2026-10-12T02:00:00.000Z');
  });

  it('holt einen verpassten Termin nach, statt bis zum Folgetag zu warten', () => {
    // Server war von gestern 01:00 bis heute 01:30 aus.
    const last = at('2026-10-10T02:00:00Z');
    expect(isDue(daily, last, at('2026-10-11T01:30:00Z'))).toBe(false);
    expect(isDue(daily, at('2026-10-09T02:00:00Z'), at('2026-10-11T01:30:00Z'))).toBe(true);
  });

  it('läuft nach einem Erstlauf am Nachmittag nicht erneut vor der nächsten Zielstunde', () => {
    const last = at('2026-10-11T15:00:00Z');
    expect(isDue(daily, last, at('2026-10-12T01:00:00Z'))).toBe(false);
    expect(isDue(daily, last, at('2026-10-12T02:05:00Z'))).toBe(true);
  });
});

describe('isDue / nextDueAt — Intervall', () => {
  it('ist nach Ablauf des Intervalls fällig', () => {
    const last = at('2026-10-11T06:00:00Z');
    expect(isDue(sixHourly, last, at('2026-10-11T11:59:59Z'))).toBe(false);
    expect(isDue(sixHourly, last, at('2026-10-11T12:00:00Z'))).toBe(true);
    expect(nextDueAt(sixHourly, last, at('2026-10-11T07:00:00Z')).toISOString()).toBe('2026-10-11T12:00:00.000Z');
  });

  it('nextDueAt ist "jetzt", wenn der Job bereits fällig ist', () => {
    const now = at('2026-10-11T20:00:00Z');
    expect(nextDueAt(sixHourly, at('2026-10-11T06:00:00Z'), now)).toEqual(now);
  });
});

describe('isStale', () => {
  const now = at('2026-10-11T12:00:00Z');

  it('ein nie gelaufener Job gilt nicht als auffällig', () => {
    expect(isStale(daily, undefined, now)).toBe(false);
    expect(isStale(daily, { lastStartedAt: null, consecutiveFailures: 0 }, now)).toBe(false);
  });

  it('auffällig nach mehr als zwei Perioden ohne Lauf', () => {
    expect(isStale(daily, { lastStartedAt: at('2026-10-09T13:00:00Z'), consecutiveFailures: 0 }, now)).toBe(false);
    expect(isStale(daily, { lastStartedAt: at('2026-10-09T11:00:00Z'), consecutiveFailures: 0 }, now)).toBe(true);
    expect(isStale(sixHourly, { lastStartedAt: at('2026-10-10T23:00:00Z'), consecutiveFailures: 0 }, now)).toBe(true);
  });

  it('auffällig nach drei Fehlschlägen in Folge', () => {
    expect(isStale(daily, { lastStartedAt: at('2026-10-11T02:00:00Z'), consecutiveFailures: 2 }, now)).toBe(false);
    expect(isStale(daily, { lastStartedAt: at('2026-10-11T02:00:00Z'), consecutiveFailures: 3 }, now)).toBe(true);
  });
});
