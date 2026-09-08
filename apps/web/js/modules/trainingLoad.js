// Belastungssteuerung / Trainingsumfang-Auswertung (Phase 1, Abschnitt
// 3.2 — docs/trainingsplanung-phase1-plan.md). Reine, DOM-freie
// Auswertungen; Rendering übernimmt stats.js.
import { dateOnly, startOfWeek } from '../dates.js';
import { totalDistance } from './setEditor.js';

// Meter einer Einheit: actualDistance falls gesetzt, sonst aus dem
// verknüpften Plan-Tag berechnet, sonst unbekannt (null).
function sessionVolume(session, plans) {
  if (session.actualDistance != null) return session.actualDistance;
  const plan = plans.find(p => p.id === session.planId);
  const day = plan?.days.find(d => dateOnly(d.date) === dateOnly(session.date));
  return day ? totalDistance(day.sets || []) : null;
}

// Wöchentlicher Umfang einer Gruppe, gemittelt pro anwesender Person
// (damit Gruppengröße/Anwesenheitsschwankungen nicht verzerren).
export function computeWeeklyVolume(sessions, plans, groupId) {
  const byWeek = new Map();
  for (const s of sessions) {
    if (s.groupId !== groupId) continue;
    const volume = sessionVolume(s, plans);
    const present = (s.attendance || []).filter(a => a.present).length;
    if (volume == null || !present) continue;
    const week = startOfWeek(s.date);
    const tally = byWeek.get(week) || { meterHeads: 0, present: 0 };
    tally.meterHeads += volume * present;
    tally.present += present;
    byWeek.set(week, tally);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, t]) => ({ week, meters: Math.round(t.meterHeads / t.present) }));
}

// Wöchentlicher Umfang einer einzelnen Athlet:in (Summe der Einheiten, an
// denen sie anwesend war).
export function athleteWeeklyVolume(sessions, plans, athleteId) {
  const byWeek = new Map();
  for (const s of sessions) {
    const rec = s.attendance?.find(a => a.athleteId === athleteId);
    if (!rec?.present) continue;
    const volume = sessionVolume(s, plans);
    if (volume == null) continue;
    const week = startOfWeek(s.date);
    byWeek.set(week, (byWeek.get(week) || 0) + volume);
  }
  return [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, meters]) => ({ week, meters }));
}

// RPE-Verlauf einer einzelnen Athlet:in, aufsteigend nach Datum.
export function athleteRpeTrend(sessions, athleteId) {
  return sessions
    .map(s => {
      const rec = s.attendance?.find(a => a.athleteId === athleteId);
      return rec?.present && rec.rpe != null ? { date: s.date, rpe: rec.rpe } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.date.localeCompare(b.date));
}
