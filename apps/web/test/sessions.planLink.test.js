// Testet die Plan-Verknüpfung erfasster Einheiten (js/modules/sessions.js):
// welcher Plan-Tag zu einer Einheit gehört, welche Pläne im Erfassen-
// Dialog wählbar sind und welcher davon vorausgewählt wird.
import { describe, it, expect, vi } from 'vitest';
vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));

const { planDayOn, linkablePlans, suggestPlanId } = await import('../js/modules/sessions.js');

const plan = (id, groupId, dates, status = 'aktiv') => ({
  id, name: `Plan ${id}`, groupId, status,
  days: dates.map(date => ({ date: `${date}T00:00:00.000Z`, sets: [] })),
});

describe('planDayOn()', () => {
  it('findet den Tag unabhängig vom Zeitanteil des Datums', () => {
    const p = plan('a', 'g1', ['2026-11-16', '2026-11-18']);
    expect(planDayOn(p, '2026-11-18')).toBe(p.days[1]);
    expect(planDayOn(p, '2026-11-18T00:00:00.000Z')).toBe(p.days[1]);
  });
  it('liefert null ohne Tag an dem Datum oder ohne Plan', () => {
    expect(planDayOn(plan('a', 'g1', ['2026-11-16']), '2026-11-17')).toBeNull();
    expect(planDayOn(undefined, '2026-11-17')).toBeNull();
  });
});

describe('linkablePlans()', () => {
  const plans = [
    plan('other', 'g2', ['2026-11-18']),
    plan('archived', 'g1', ['2026-11-18'], 'archiv'),
    plan('mine', 'g1', ['2026-11-18']),
    plan('noDay', 'g1', ['2026-11-16']),
  ];
  it('nur Pläne mit Tag am Datum; eigene Gruppe vor fremder, aktiv vor archiviert', () => {
    expect(linkablePlans(plans, '2026-11-18', 'g1').map(p => p.id)).toEqual(['mine', 'archived', 'other']);
  });
  it('leer, wenn kein Plan einen Tag am Datum hat', () => {
    expect(linkablePlans(plans, '2026-11-20', 'g1')).toEqual([]);
  });
});

describe('suggestPlanId()', () => {
  it('schlägt den aktiven Plan der eigenen Gruppe vor', () => {
    const plans = [plan('other', 'g2', ['2026-11-18']), plan('mine', 'g1', ['2026-11-18'])];
    expect(suggestPlanId(plans, '2026-11-18', 'g1')).toBe('mine');
  });
  it('wählt nie stillschweigend einen fremden oder archivierten Plan vor', () => {
    expect(suggestPlanId([plan('other', 'g2', ['2026-11-18'])], '2026-11-18', 'g1')).toBeNull();
    expect(suggestPlanId([plan('old', 'g1', ['2026-11-18'], 'archiv')], '2026-11-18', 'g1')).toBeNull();
  });
  it('null ohne passenden Tag', () => {
    expect(suggestPlanId([plan('mine', 'g1', ['2026-11-16'])], '2026-11-18', 'g1')).toBeNull();
  });
});
