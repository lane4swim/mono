// Testet die reinen Auswertungsfunktionen aus js/modules/attendanceStats.js
// (Phase 1, Abschnitt 3.3 — docs/Plans/trainingsplanung-phase1-plan.md).
import { describe, it, expect } from 'vitest';
import { attendanceTrend, flagLowAttendance } from '../js/modules/attendanceStats.js';

function session(date, groupId, records) {
  return { date, groupId, attendance: records.map(([athleteId, present]) => ({ athleteId, present })) };
}

// n aufeinanderfolgende Montage ab dem 2026-01-05, als ISO-Datum (yyyy-mm-dd).
function weeklyDates(n) {
  const start = new Date(Date.UTC(2026, 0, 5));
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i * 7);
    return d.toISOString().slice(0, 10);
  });
}

describe('attendanceTrend()', () => {
  it('liefert keine Punkte ohne Einheiten der Gruppe', () => {
    expect(attendanceTrend([session('2026-01-05', 'g2', [['a', true]])], 'g1')).toEqual([]);
  });

  it('berechnet die wöchentliche Quote je Kalenderwoche', () => {
    const sessions = [
      session('2026-01-05', 'g1', [['a', true], ['b', false]]), // Montag KW1 -> 50%
      session('2026-01-12', 'g1', [['a', true], ['b', true]]),  // KW2 -> 100%
    ];
    const points = attendanceTrend(sessions, 'g1');
    expect(points.map(p => Math.round(p.rate))).toEqual([50, 75]); // KW2 geglättet über beide Wochen
  });

  it('mehrere Einheiten derselben Woche fließen gemeinsam in eine Quote ein', () => {
    const sessions = [
      session('2026-01-05', 'g1', [['a', true]]),
      session('2026-01-07', 'g1', [['a', false]]),
    ];
    expect(attendanceTrend(sessions, 'g1')).toEqual([{ week: '2026-01-05', rate: 50 }]);
  });
});

describe('flagLowAttendance()', () => {
  it('markiert niemanden ohne ausreichende Historie', () => {
    const athletes = [{ id: 'a' }];
    const sessions = [session('2026-01-05', 'g1', [['a', false]])];
    expect(flagLowAttendance(sessions, athletes)).toEqual([]);
  });

  it('markiert absolute Unterschreitung (< 50% in den letzten 4 Einheiten)', () => {
    const athletes = [{ id: 'a' }];
    const sessions = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']
      .map((d, i) => session(d, 'g1', [['a', i === 0]])); // 1 von 4 anwesend = 25%
    const flags = flagLowAttendance(sessions, athletes);
    expect(flags).toHaveLength(1);
    expect(flags[0].recentRate).toBe(25);
    expect(flags[0].baselineRate).toBeNull();
  });

  it('markiert relativen Abfall bei ausreichender Historie (12 Einheiten)', () => {
    const athletes = [{ id: 'a' }];
    const dates = weeklyDates(12);
    // 8 Baseline-Einheiten alle anwesend (100%), letzte 4 nur zur Hälfte (50%) -> Abfall 50pp >= 30pp
    const sessions = dates.map((d, i) => session(d, 'g1', [['a', i < 8 || i % 2 === 0]]));
    const flags = flagLowAttendance(sessions, athletes);
    expect(flags).toHaveLength(1);
    expect(flags[0].baselineRate).toBe(100);
    expect(flags[0].recentRate).toBe(50);
  });

  it('markiert nicht bei stabiler Anwesenheit', () => {
    const athletes = [{ id: 'a' }];
    const sessions = weeklyDates(12).map(d => session(d, 'g1', [['a', true]]));
    expect(flagLowAttendance(sessions, athletes)).toEqual([]);
  });

  it('ignoriert Einheiten vor dem Beitrittsdatum', () => {
    const athletes = [{ id: 'a', joinDate: '2026-02-01T00:00:00.000Z' }];
    // Vier Einheiten VOR dem Beitritt mit schlechter Quote dürfen nicht zählen.
    const sessions = ['2026-01-01', '2026-01-08', '2026-01-15', '2026-01-22']
      .map(d => session(d, 'g1', [['a', false]]));
    expect(flagLowAttendance(sessions, athletes)).toEqual([]);
  });

  it('sortiert nach niedrigster aktueller Quote zuerst', () => {
    const athletes = [{ id: 'a' }, { id: 'b' }];
    const dates = ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26'];
    const sessions = dates.map((d, i) => session(d, 'g1', [
      ['a', i === 0], // 25%
      ['b', i < 2],   // 50% -> nicht < 50, also nicht markiert
    ]));
    const flags = flagLowAttendance(sessions, athletes);
    expect(flags.map(f => f.athlete.id)).toEqual(['a']);
  });
});
