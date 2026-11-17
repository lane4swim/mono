// Testet nextSessionDay() aus js/modules/plans.js: welche Trainingseinheit
// beim Öffnen eines Plans (Detailansicht/Bearbeiten) aufgeklappt startet.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));

const { nextSessionDay } = await import('../js/modules/plans.js');

const day = (date) => ({ date, sets: [] });

describe('nextSessionDay()', () => {
  it('wählt die früheste Einheit ab heute, unabhängig von der Reihenfolge', () => {
    const days = [day('2026-11-20'), day('2026-11-15'), day('2026-11-18')];
    expect(nextSessionDay(days, '2026-11-17')).toBe(days[2]);
  });

  it('zählt eine Einheit am heutigen Tag als nächste', () => {
    const days = [day('2026-11-16'), day('2026-11-17T00:00:00.000Z'), day('2026-11-19')];
    expect(nextSessionDay(days, '2026-11-17')).toBe(days[1]);
  });

  it('fällt auf die zuletzt stattgefundene Einheit zurück, wenn alle vorbei sind', () => {
    const days = [day('2026-11-10'), day('2026-11-12'), day('2026-11-11')];
    expect(nextSessionDay(days, '2026-11-17')).toBe(days[1]);
  });

  it('liefert null für einen Plan ohne Einheiten', () => {
    expect(nextSessionDay([], '2026-11-17')).toBeNull();
    expect(nextSessionDay(undefined, '2026-11-17')).toBeNull();
  });
});
