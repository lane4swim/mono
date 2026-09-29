// Anwesenheitsstatistik für die Vereinsverwaltung: fasst zusammen, welche
// Athlet:innen und Trainer:innen bei den erfassten Trainingseinheiten
// anwesend waren. Bewusst ohne RPE und Notizen — die bleiben im Modul
// "Einheiten & Feedback" (sessions.js) den Trainer:innen vorbehalten.
// Auswertung selbst: attendanceStats.js: summarizeAttendance().
import { getAll } from '../db.js';
import { el, clear, beginRender } from '../dom.js';
import { fmtDateLong, todayISO, isoAddDays } from '../dates.js';
import { emptyState, laneWave, fullName, statCard, tabbedView } from '../ui.js';
import { field, selectInput } from '../forms.js';
import { t } from '../i18n.js';
import { summarizeAttendance } from './attendanceStats.js';
import { fetchAssignableTrainers } from './actionItems.js';

// Zeitraum-Auswahl: Anzahl Tage zurück ab heute, '' = alle Einheiten.
const PERIODS = [
  { value: '28', labelKey: 'attendance.period4w' },
  { value: '84', labelKey: 'attendance.period12w' },
  { value: '365', labelKey: 'attendance.period12m' },
  { value: '', labelKey: 'attendance.periodAll' },
];

export const attendanceOverviewModule = {
  id: 'attendance',
  roles: ['admin'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18"/><path d="M8 2.5v4M16 2.5v4"/><path d="M8.5 15l2.3 2.3 4.7-4.8"/></svg>`,
  async render(container) {
    const isCurrent = beginRender(container);
    clear(container);
    const [sessions, athletes, groups, trainers] = await Promise.all([
      getAll('sessions'), getAll('athletes'), getAll('groups'), fetchAssignableTrainers(),
    ]);
    if (!isCurrent()) return;
    renderView(container, sessions, athletes, groups, trainers);
  }
};

function renderView(container, sessions, athletes, groups, trainers) {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('attendance.eyebrow')), el('h1', { class: 'mt-0' }, t('attendance.title'))]),
  ]));
  wrap.appendChild(laneWave());
  container.appendChild(wrap);

  if (sessions.length === 0) {
    wrap.appendChild(emptyState(t('attendance.noSessionsTitle'), t('attendance.noSessionsMsg'), null));
    return;
  }

  let groupId = '';
  let period = PERIODS[1].value;
  const filters = el('div', { class: 'form-grid mb-16' }, [
    field(t('attendance.filterGroup'), selectInput([{ value: '', label: t('attendance.allGroups') }, ...groups.map(g => ({ value: g.id, label: g.name }))], groupId, { onchange: (e) => { groupId = e.target.value; draw(); } })),
    field(t('attendance.filterPeriod'), selectInput(PERIODS.map(p => ({ value: p.value, label: t(p.labelKey) })), period, { onchange: (e) => { period = e.target.value; draw(); } })),
  ]);
  wrap.appendChild(filters);
  const host = el('div');
  wrap.appendChild(host);

  const groupName = (id) => groups.find(g => g.id === id)?.name || '—';
  const trainerName = (id) => trainers.find(tr => tr.id === id)?.name || t('attendance.unknownTrainer');
  const pct = (v) => v == null ? '—' : `${Math.round(v)}%`;

  function draw() {
    clear(host);
    const from = period ? isoAddDays(todayISO(), -Number(period)) : '';
    const summary = summarizeAttendance(sessions, athletes, { groupId, from });

    host.appendChild(el('div', { class: 'grid grid-4 mb-16' }, [
      statCard({ label: t('attendance.statSessions'), value: summary.sessionCount }),
      statCard({ label: t('attendance.statAvgPresent'), value: summary.avgPresent == null ? '—' : summary.avgPresent.toFixed(1), sub: t('attendance.statAvgPresentSub'), alt: true }),
      statCard({ label: t('attendance.statRate'), value: pct(summary.rate), sub: t('attendance.statRateSub', { present: summary.present, total: summary.total }) }),
      statCard({ label: t('attendance.statCoaches'), value: summary.coaches.length, alt: true }),
    ]));

    if (summary.sessionCount === 0) {
      host.appendChild(el('p', {}, t('attendance.noSessionsInPeriod')));
      return;
    }

    host.appendChild(tabbedView('attendance', [
      { id: 'athletes', label: t('attendance.tabAthletes'), render: () => athleteTable(summary) },
      { id: 'coaches', label: t('attendance.tabCoaches'), render: () => coachTable(summary) },
      { id: 'sessions', label: t('attendance.tabSessions'), render: () => sessionTable(summary) },
    ]));
  }

  function athleteTable(summary) {
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [el('th', {}, t('attendance.colAthlete')), el('th', {}, t('attendance.colGroup')), el('th', {}, t('attendance.colPresent')), el('th', {}, t('attendance.colRate'))])));
    const tbody = el('tbody');
    summary.athletes.forEach(row => tbody.appendChild(el('tr', {}, [
      el('td', {}, fullName(row.athlete)), el('td', {}, groupName(row.athlete?.groupId)),
      el('td', {}, `${row.present} / ${row.total}`), el('td', {}, pct(row.rate)),
    ])));
    table.appendChild(tbody);
    return el('div', { class: 'table-wrap card' }, table);
  }

  function coachTable(summary) {
    if (summary.coaches.length === 0) return el('div', { class: 'card' }, el('p', { class: 'mt-0' }, t('attendance.noCoaches')));
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [el('th', {}, t('attendance.colCoach')), el('th', {}, t('attendance.colSessions'))])));
    const tbody = el('tbody');
    summary.coaches.forEach(row => tbody.appendChild(el('tr', {}, [el('td', {}, trainerName(row.trainerId)), el('td', {}, String(row.sessions))])));
    table.appendChild(tbody);
    return el('div', { class: 'table-wrap card' }, table);
  }

  function sessionTable(summary) {
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [el('th', {}, t('attendance.colDate')), el('th', {}, t('attendance.colGroup')), el('th', {}, t('attendance.colPresent')), el('th', {}, t('attendance.colCoaches'))])));
    const tbody = el('tbody');
    summary.sessions.forEach(row => tbody.appendChild(el('tr', {}, [
      el('td', {}, fmtDateLong(row.date)), el('td', {}, groupName(row.groupId)),
      el('td', {}, `${row.present} / ${row.total}`),
      el('td', {}, row.coachIds.length ? row.coachIds.map(trainerName).join(', ') : '—'),
    ])));
    table.appendChild(tbody);
    return el('div', { class: 'table-wrap card' }, table);
  }

  draw();
}
