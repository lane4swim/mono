// ============================================================
// modules/stats.js — Statistiken und Auswertungen
// ============================================================
import { getAll } from '../db.js';
import {
  el, clear, field, selectInput, badge, emptyState, laneWave, fullName,
  groupBy, average, secToTime, svgBarChart, svgLineChart, todayISO, isoAddDays, fmtDateShort, beginRender,
} from '../utils.js';
import { EVENTS } from '../refdata.js';
import { t, trCode, trOptionsFlat } from '../i18n.js';

export const statsModule = {
  id: 'stats',
  roles: ['trainer', 'admin'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`,
  async render(container) {
    const isCurrent = beginRender(container);
    clear(container);
    const [athletes, results, sessions, groups] = await Promise.all(['athletes', 'results', 'sessions', 'groups'].map(getAll));
    if (!isCurrent()) return;
    renderView(container, athletes, results, sessions, groups);
  }
};

function renderView(container, athletes, results, sessions, groups) {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [el('div', {}, [el('div', { class: 'page-eyebrow' }, t('stats.eyebrow')), el('h1', { class: 'mt-0' }, t('stats.title'))])]));
  wrap.appendChild(laneWave());

  // -------- Attendance rate per group --------
  const attCard = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('stats.attendanceTitle'))]);
  const bars = groups.map(g => {
    let present = 0, total = 0;
    sessions.filter(s => s.groupId === g.id).forEach(s => (s.attendance || []).forEach(a => { total++; if (a.present) present++; }));
    return { label: g.name, value: total ? Math.round((present / total) * 100) : 0 };
  });
  if (bars.every(b => b.value === 0) && sessions.length === 0) attCard.appendChild(el('p', {}, t('stats.noSessions')));
  else attCard.appendChild(svgBarChart({ bars, yFormat: (v) => v + '%', color: 'var(--c-petrol)' }));
  wrap.appendChild(attCard);

  // -------- RPE trend over time (team average per session) --------
  const rpeCard = el('div', { class: 'card mb-16' }, [el('h3', { class: 'mt-0' }, t('stats.rpeTitle'))]);
  const rpePoints = sessions.slice().sort((a, b) => a.date.localeCompare(b.date)).map(s => {
    const vals = (s.attendance || []).filter(a => a.present && a.rpe).map(a => a.rpe);
    return vals.length ? { y: average(vals), label: fmtDateShort(s.date) } : null;
  }).filter(Boolean);
  if (rpePoints.length < 2) rpeCard.appendChild(el('p', {}, t('stats.noRpeData')));
  else rpeCard.appendChild(svgLineChart({ points: rpePoints, yFormat: (v) => v.toFixed(1), color: 'var(--c-lane-d)' }));
  wrap.appendChild(rpeCard);

  // -------- Training volume (planned distance would need plans; use results count as activity proxy) --------
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
