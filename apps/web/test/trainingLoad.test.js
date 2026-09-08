// Testet die reinen Auswertungsfunktionen aus js/modules/trainingLoad.js
// (Phase 1, Abschnitt 3.2 — docs/trainingsplanung-phase1-plan.md).
import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

// setEditor.js zieht über db.js demoMode.js nach (siehe attendanceStats.js/
// setEditor.test.js) — in reiner Node-Umgebung ohne `location` gestubbt.
vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));

const { computeWeeklyVolume, athleteWeeklyVolume, athleteRpeTrend } = await import('../js/modules/trainingLoad.js');

function planDay(distance, reps = 1) {
  return { kind: 'set', id: 's1', description: '', distance, reps, intensity: '', restSec: 0, comments: [] };
}
function session({ date, groupId = 'g1', planId = null, actualDistance = null, attendance = [] }) {
  return { date, groupId, planId, actualDistance, attendance: attendance.map(([athleteId, present, rpe]) => ({ athleteId, present, rpe: rpe ?? null, note: '' })) };
}

describe('computeWeeklyVolume()', () => {
  it('berechnet den Umfang pro Kopf aus dem verknüpften Plan-Tag', () => {
    const plans = [{ id: 'p1', days: [{ date: '2026-01-05', sets: [planDay(1000)] }] }];
    const sessions = [session({ date: '2026-01-05', planId: 'p1', attendance: [['a', true], ['b', true]] })];
    expect(computeWeeklyVolume(sessions, plans, 'g1')).toEqual([{ week: '2026-01-05', meters: 1000 }]);
  });

  it('nutzt actualDistance statt des Plan-Tags, wenn gesetzt', () => {
    const sessions = [session({ date: '2026-01-05', actualDistance: 2500, attendance: [['a', true]] })];
    expect(computeWeeklyVolume(sessions, [], 'g1')).toEqual([{ week: '2026-01-05', meters: 2500 }]);
  });

  it('ignoriert Einheiten ohne bekannten Umfang und ohne Anwesenheit', () => {
    const sessions = [
      session({ date: '2026-01-05', attendance: [['a', true]] }), // kein Plan, kein actualDistance -> unbekannt
      session({ date: '2026-01-06', actualDistance: 1000, attendance: [['a', false]] }), // niemand anwesend
    ];
    expect(computeWeeklyVolume(sessions, [], 'g1')).toEqual([]);
  });

  it('filtert nach Gruppe', () => {
    const sessions = [session({ date: '2026-01-05', groupId: 'g2', actualDistance: 1000, attendance: [['a', true]] })];
    expect(computeWeeklyVolume(sessions, [], 'g1')).toEqual([]);
  });
});

describe('athleteWeeklyVolume()', () => {
  it('summiert die Einheiten einer Woche, an denen die Athlet:in anwesend war', () => {
    const sessions = [
      session({ date: '2026-01-05', actualDistance: 1000, attendance: [['a', true]] }),
      session({ date: '2026-01-07', actualDistance: 800, attendance: [['a', true]] }),
      session({ date: '2026-01-07', actualDistance: 500, attendance: [['a', false]] }), // abwesend -> zählt nicht
    ];
    expect(athleteWeeklyVolume(sessions, [], 'a')).toEqual([{ week: '2026-01-05', meters: 1800 }]);
  });
});

describe('athleteRpeTrend()', () => {
  it('liefert nur Einheiten mit Anwesenheit und RPE-Wert, aufsteigend sortiert', () => {
    const sessions = [
      session({ date: '2026-01-12', attendance: [['a', true, 8]] }),
      session({ date: '2026-01-05', attendance: [['a', true, 5]] }),
      session({ date: '2026-01-06', attendance: [['a', false, 9]] }), // abwesend
      session({ date: '2026-01-07', attendance: [['a', true, null]] }), // kein RPE
    ];
    expect(athleteRpeTrend(sessions, 'a')).toEqual([
      { date: '2026-01-05', rpe: 5 },
      { date: '2026-01-12', rpe: 8 },
    ]);
  });
});
