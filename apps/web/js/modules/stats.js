// Statistiken und Auswertungen
import { getAll } from '../db.js';
import { el, clear, beginRender } from '../dom.js';
import { fmtDateShort } from '../dates.js';
import { secToTime } from '../swimTime.js';
import { badge, emptyState, laneWave, fullName, groupBy, average } from '../ui.js';
import { field, selectInput } from '../forms.js';
import { svgBarChart, svgLineChart } from '../charts.js';
import { EVENTS } from '../refdata.js';
import { t, trOptionsFlat } from '../i18n.js';
import { navigate } from '../router.js';
import { attendanceTrend, flagLowAttendance } from './attendanceStats.js';
import { computeWeeklyVolume, athleteWeeklyVolume, athleteRpeTrend } from './trainingLoad.js';

export const statsModule = {
  id: 'stats',
  roles: ['trainer', 'admin'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`,
  async render(container) {
    const isCurrent = beginRender(container);
    clear(container);
    const [athletes, results, sessions, groups, plans] = await Promise.all(['athletes', 'results', 'sessions', 'groups', 'plans'].map(getAll));
    if (!isCurrent()) return;
    renderView(container, athletes, results, sessions, groups, plans);
  }
};

function renderView(container, athletes, results, sessions, groups, plans) {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [el('div', {}, [el('div', { class: 'page-eyebrow' }, t('stats.eyebrow')), el('h1', { class: 'mt-0' }, t('stats.title'))])]));
  wrap.appendChild(laneWave());

  // -------- Attendance rate per group --------
  const attCard = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('stats.attendanceTitle'))]);
  // Ineffizienz-Korrektur: lief vormals als `sessions.filter(...)` INNERHALB
  // der Gruppen-Schleife, also einmal komplett über alle Trainingseinheiten
  // je Gruppe (Gruppen × Einheiten). Ein einziger Durchlauf über die
  // Einheiten summiert dasselbe direkt in die jeweilige Gruppe.
  const attendanceByGroup = new Map(groups.map(g => [g.id, { present: 0, total: 0 }]));
  for (const s of sessions) {
    const tally = attendanceByGroup.get(s.groupId);
    if (!tally) continue; // Einheit ohne (bekannte) Gruppe — zählt in keinen Balken, wie zuvor
    for (const a of s.attendance || []) {
      tally.total++;
      if (a.present) tally.present++;
    }
  }
  const bars = groups.map(g => {
    const { present, total } = attendanceByGroup.get(g.id);
    return { label: g.name, value: total ? Math.round((present / total) * 100) : 0 };
  });
  if (bars.every(b => b.value === 0) && sessions.length === 0) attCard.appendChild(el('p', {}, t('stats.noSessions')));
  else attCard.appendChild(svgBarChart({ bars, yFormat: (v) => v + '%', color: 'var(--c-petrol)' }));
  wrap.appendChild(attCard);

  // -------- Anwesenheitstrend über Zeit je Gruppe (Phase 1, Abschnitt 3.3) --------
  const trendCard = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('stats.attendanceTrendTitle'))]);
  let trendGroupId = groups[0]?.id;
  if (groups.length > 0) {
    trendCard.appendChild(field(t('stats.filterGroup'), selectInput(groups.map(g => ({ value: g.id, label: g.name })), trendGroupId, { onchange: (e) => { trendGroupId = e.target.value; drawTrend(); } })));
  }
  const trendHost = el('div');
  trendCard.appendChild(trendHost);
  wrap.appendChild(trendCard);

  function drawTrend() {
    clear(trendHost);
    const points = attendanceTrend(sessions, trendGroupId).map(p => ({ y: p.rate, label: fmtDateShort(p.week) }));
    if (points.length < 2) trendHost.appendChild(el('p', {}, t('stats.noAttendanceTrend')));
    else trendHost.appendChild(svgLineChart({ points, yFormat: (v) => Math.round(v) + '%', color: 'var(--c-petrol)' }));
  }
  drawTrend();

  // -------- Anwesenheits-Frühindikator (Phase 1, Abschnitt 3.3) --------
  const flagCard = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('stats.attendanceFlagsTitle'))]);
  const flags = flagLowAttendance(sessions, athletes);
  if (flags.length === 0) flagCard.appendChild(el('p', {}, t('stats.noAttendanceFlags')));
  else flags.forEach(f => flagCard.appendChild(el('div', { class: 'list-row row-click', onclick: () => navigate('athletes', f.athlete.id) }, [
    el('div', { style: 'flex:1' }, [
      el('div', {}, fullName(f.athlete)),
      el('div', { class: 'text-slate text-sm' }, t('stats.attendanceFlagLine', { recent: Math.round(f.recentRate) })),
    ]),
    badge(t('stats.attendanceFlagBadge'), 'open'),
  ])));
  wrap.appendChild(flagCard);

  // -------- Trainingsumfang je Gruppe (Phase 1, Abschnitt 3.2) --------
  const loadCard = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('stats.loadVolumeTitle'))]);
  let loadGroupId = groups[0]?.id;
  if (groups.length > 0) {
    loadCard.appendChild(field(t('stats.filterGroup'), selectInput(groups.map(g => ({ value: g.id, label: g.name })), loadGroupId, { onchange: (e) => { loadGroupId = e.target.value; drawLoad(); } })));
  }
  const loadHost = el('div');
  loadCard.appendChild(loadHost);
  wrap.appendChild(loadCard);

  function drawLoad() {
    clear(loadHost);
    const bars = computeWeeklyVolume(sessions, plans, loadGroupId).map(p => ({ label: fmtDateShort(p.week), value: p.meters }));
    if (bars.length === 0) loadHost.appendChild(el('p', {}, t('stats.noLoadVolume')));
    else loadHost.appendChild(svgBarChart({ bars, yFormat: (v) => v + ' m', color: 'var(--c-chlorine-d)' }));
  }
  drawLoad();

  // -------- RPE trend over time — Team-Durchschnitt oder je Athlet:in (Phase 1, Abschnitt 3.2) --------
  const rpeCard = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('stats.rpeTitle'))]);
  let rpeAthleteId = '';
  rpeCard.appendChild(field(t('stats.filterAthleteOptional'), selectInput([{ value: '', label: t('stats.teamAverage') }, ...athletes.map(a => ({ value: a.id, label: fullName(a) }))], rpeAthleteId, { onchange: (e) => { rpeAthleteId = e.target.value; drawRpe(); } })));
  const rpeHost = el('div');
  rpeCard.appendChild(rpeHost);
  wrap.appendChild(rpeCard);

  function drawRpe() {
    clear(rpeHost);
    const points = rpeAthleteId
      ? athleteRpeTrend(sessions, rpeAthleteId).map(p => ({ y: p.rpe, label: fmtDateShort(p.date) }))
      : sessions.slice().sort((a, b) => a.date.localeCompare(b.date)).map(s => {
          const vals = (s.attendance || []).filter(a => a.present && a.rpe).map(a => a.rpe);
          return vals.length ? { y: average(vals), label: fmtDateShort(s.date) } : null;
        }).filter(Boolean);
    if (points.length < 2) rpeHost.appendChild(el('p', {}, t('stats.noRpeData')));
    else rpeHost.appendChild(svgLineChart({ points, yFormat: (v) => v.toFixed(1), color: 'var(--c-lane-d)' }));
  }
  drawRpe();

  // -------- Umfang vs. RPE je Athlet:in (Phase 1, Abschnitt 3.2) --------
  const combinedCard = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('stats.loadVsRpeTitle'))]);
  let combinedAthleteId = athletes[0]?.id;
  if (athletes.length > 0) {
    combinedCard.appendChild(field(t('stats.filterAthlete'), selectInput(athletes.map(a => ({ value: a.id, label: fullName(a) })), combinedAthleteId, { onchange: (e) => { combinedAthleteId = e.target.value; drawCombined(); } })));
  }
  const combinedVolHost = el('div');
  const combinedRpeHost = el('div');
  combinedCard.appendChild(el('p', { class: 'text-slate text-sm mb-16' }, t('stats.loadVsRpeVolumeLabel')));
  combinedCard.appendChild(combinedVolHost);
  combinedCard.appendChild(el('p', { class: 'text-slate text-sm mb-16' }, t('stats.loadVsRpeRpeLabel')));
  combinedCard.appendChild(combinedRpeHost);
  wrap.appendChild(combinedCard);

  function drawCombined() {
    clear(combinedVolHost); clear(combinedRpeHost);
    const volPoints = athleteWeeklyVolume(sessions, plans, combinedAthleteId).map(p => ({ y: p.meters, label: fmtDateShort(p.week) }));
    const rpePoints = athleteRpeTrend(sessions, combinedAthleteId).map(p => ({ y: p.rpe, label: fmtDateShort(p.date) }));
    combinedVolHost.appendChild(volPoints.length < 2 ? el('p', {}, t('stats.noLoadVolume')) : svgLineChart({ points: volPoints, yFormat: (v) => v + ' m', color: 'var(--c-chlorine-d)' }));
    combinedRpeHost.appendChild(rpePoints.length < 2 ? el('p', {}, t('stats.noRpeData')) : svgLineChart({ points: rpePoints, yFormat: (v) => v.toFixed(1), color: 'var(--c-lane-d)' }));
  }
  drawCombined();

  // -------- Erfasste Wettkampfzeiten pro Monat (Wettkampfaktivität, nicht Trainingsumfang — siehe loadCard oben) --------
  const volCard = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('stats.volumeTitle'))]);
  const byMonth = groupBy(results, r => r.date.slice(0, 7));
  const months = Object.keys(byMonth).sort().slice(-6);
  if (months.length === 0) volCard.appendChild(el('p', {}, t('stats.noTimes')));
  else volCard.appendChild(svgBarChart({ bars: months.map(m => ({ label: m.slice(5) + '/' + m.slice(2, 4), value: byMonth[m].length })), color: 'var(--c-chlorine-d)' }));
  wrap.appendChild(volCard);

  // -------- Individual progress explorer --------
  const exploreCard = el('div', { class: 'card' }, [el('h3', { class: 'mt-0' }, t('stats.exploreTitle'))]);
  let athleteId = athletes[0]?.id, event = EVENTS[0];
  const controls = el('div', { class: 'grid grid-2 mb-16' }, [
    field(t('stats.filterAthlete'), selectInput(athletes.map(a => ({ value: a.id, label: fullName(a) })), athleteId, { onchange: (e) => { athleteId = e.target.value; drawExplore(); } })),
    field(t('stats.filterEvent'), selectInput(trOptionsFlat(EVENTS, 'events'), event, { onchange: (e) => { event = e.target.value; drawExplore(); } })),
  ]);
  exploreCard.appendChild(controls);
  const exploreHost = el('div');
  exploreCard.appendChild(exploreHost);
  wrap.appendChild(exploreCard);
  container.appendChild(wrap);

  function drawExplore() {
    clear(exploreHost);
    const series = results.filter(r => r.athleteId === athleteId && r.event === event).sort((a, b) => a.date.localeCompare(b.date));
    if (series.length === 0) { exploreHost.appendChild(emptyState(t('stats.noDataTitle'), t('stats.noDataMsg'), null)); return; }
    if (series.length === 1) { exploreHost.appendChild(el('p', {}, t('stats.onlyOneTime', { time: secToTime(series[0].time), date: fmtDateShort(series[0].date) }))); return; }
    const first = series[0].time, last = series[series.length - 1].time;
    const delta = first - last;
    exploreHost.appendChild(el('p', {}, [
      t('stats.progressLine', { count: series.length }),
      el('span', { class: 'data' }, secToTime(first)), ' → ', el('span', { class: 'data' }, secToTime(last)), ' ',
      badge(delta > 0 ? t('stats.faster', { delta: delta.toFixed(2) }) : delta < 0 ? t('stats.slower', { delta: (-delta).toFixed(2) }) : t('stats.unchanged'), delta > 0 ? 'done' : delta < 0 ? 'open' : 'neutral'),
    ]));
    exploreHost.appendChild(svgLineChart({ points: series.map(r => ({ y: r.time, label: fmtDateShort(r.date) })), yFormat: secToTime, invertY: true, color: 'var(--c-chlorine-d)' }));
  }
  drawExplore();
}
