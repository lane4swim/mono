// Anwesenheitsstatistik & -prognose (Phase 1, Abschnitt 3.3 —
// docs/trainingsplanung-phase1-plan.md). Reine, DOM-freie Auswertungen
// über TrainingSession.attendance; Rendering übernehmen stats.js/dashboard.js.
import { dateOnly, startOfWeek } from '../dates.js';

const RECENT_WINDOW = 4;
const BASELINE_WINDOW = 8;
const RELATIVE_DROP_PCT = 30;
const ABSOLUTE_FLOOR_PCT = 50;

function rate(records) {
  return records.length ? (records.filter(r => r.present).length / records.length) * 100 : null;
}

// Wöchentliche Anwesenheitsquote einer Gruppe, geglättet über einen
// gleitenden windowWeeks-Wochen-Durchschnitt. Liefert nur Wochen mit
// mindestens einer Einheit, aufsteigend sortiert.
export function attendanceTrend(sessions, groupId, windowWeeks = RECENT_WINDOW) {
  const byWeek = new Map();
  for (const s of sessions) {
    if (s.groupId !== groupId) continue;
    const week = startOfWeek(s.date);
    const tally = byWeek.get(week) || { present: 0, total: 0 };
    for (const a of s.attendance || []) { tally.total++; if (a.present) tally.present++; }
    byWeek.set(week, tally);
  }
  const weeks = [...byWeek.keys()].sort();
  const weeklyRates = weeks.map(w => { const t = byWeek.get(w); return t.total ? (t.present / t.total) * 100 : null; });
  return weeks
    .map((week, i) => {
      const win = weeklyRates.slice(Math.max(0, i - windowWeeks + 1), i + 1).filter(r => r !== null);
      return { week, rate: win.length ? win.reduce((a, b) => a + b, 0) / win.length : null };
    })
    .filter(p => p.rate !== null);
}

// Athlet:innen mit auffällig gesunkener Anwesenheit. Kriterien (siehe Plan,
// Abschnitt 7.1): absolut < 50% in den letzten 4 Einheiten, ODER — bei
// mindestens 12 Einheiten Historie seit Beitritt (Athlete.joinDate) — ein
// Abfall von mindestens 30 Prozentpunkten ggü. den 8 Einheiten davor.
// Sortiert nach niedrigster aktueller Quote zuerst.
export function flagLowAttendance(sessions, athletes) {
  const flags = [];
  for (const athlete of athletes) {
    const records = sessions
      .filter(s => s.attendance?.some(a => a.athleteId === athlete.id))
      .filter(s => !athlete.joinDate || dateOnly(s.date) >= dateOnly(athlete.joinDate))
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(s => ({ present: s.attendance.find(a => a.athleteId === athlete.id).present }));

    if (records.length < RECENT_WINDOW) continue;
    const recent = records.slice(-RECENT_WINDOW);
    const recentRate = rate(recent);

    if (recentRate < ABSOLUTE_FLOOR_PCT) {
      flags.push({ athlete, recentRate, baselineRate: null });
      continue;
    }
    if (records.length >= RECENT_WINDOW + BASELINE_WINDOW) {
      const baseline = records.slice(-(RECENT_WINDOW + BASELINE_WINDOW), -RECENT_WINDOW);
      const baselineRate = rate(baseline);
      if (baselineRate - recentRate >= RELATIVE_DROP_PCT) flags.push({ athlete, recentRate, baselineRate });
    }
  }
  return flags.sort((a, b) => a.recentRate - b.recentRate);
}
