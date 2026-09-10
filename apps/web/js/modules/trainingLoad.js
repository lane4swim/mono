// Belastungssteuerung / Trainingsumfang-Auswertung (Phase 1, Abschnitt
// 3.2 — docs/Plans/trainingsplanung-phase1-plan.md). Reine, DOM-freie
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

// Wöchentlicher Umfang einer Gruppe, gemittelt über die Athlet:innen, die
// diese Woche mindestens einmal anwesend waren (nicht über die Summe der
// Anwesenheits-EINTRÄGE — sonst verwässert eine Woche mit mehreren
// Einheiten den Wert auf den Schnitt PRO EINHEIT statt den Wochenumfang
// PRO KOPF zu liefern; Bug gefunden im Code-Review, athleteWeeklyVolume()
// zeigte für dieselbe Woche einen höheren Wert). Rechnerisch äquivalent
// zum Mittel der athleteWeeklyVolume()-Werte aller anwesenden Athlet:innen.
export function computeWeeklyVolume(sessions, plans, groupId) {
  const byWeek = new Map();
  for (const s of sessions) {
    if (s.groupId !== groupId) continue;
    const volume = sessionVolume(s, plans);
    const presentIds = (s.attendance || []).filter(a => a.present).map(a => a.athleteId);
    if (volume == null || presentIds.length === 0) continue;
    const week = startOfWeek(s.date);
    const tally = byWeek.get(week) || { athleteMeters: 0, athletes: new Set() };
    tally.athleteMeters += volume * presentIds.length;
    presentIds.forEach(id => tally.athletes.add(id));
    byWeek.set(week, tally);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, t]) => ({ week, meters: Math.round(t.athleteMeters / t.athletes.size) }));
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
