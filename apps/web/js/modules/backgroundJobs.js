// Statuskarte der Hintergrundjobs für Superadmins (docs/future-features-
// brainstorm.md, 6.4) — Reiter "Hintergrundjobs" in der Nutzerverwaltung
// (userManagement.js). Rein lesend über GET /api/admin/jobs; die Jobs
// selbst laufen im integrierten Scheduler des Servers.
import { el, clear } from '../dom.js';
import { fmtDateTime } from '../dates.js';
import { badge } from '../ui.js';
import { t, getLocale } from '../i18n.js';
import * as api from '../apiClient.js';
import { describeError } from '../apiClient.js';

// Bekannte Jobnamen (src/jobs/scheduler/schedule.ts: JOB_NAMES) auf ihre
// i18n-Schlüssel; ein unbekannter (neuerer) Job erscheint mit Rohnamen.
const JOB_LABEL_KEYS = {
  'purge-deleted-data': 'purgeDeletedData',
  'notify-expiring-qualifications': 'notifyExpiringQualifications',
  'notify-upcoming-sessions': 'notifyUpcomingSessions',
};

export function jobLabel(name) {
  const key = JOB_LABEL_KEYS[name];
  return key ? t(`jobs.name.${key}`) : name;
}

function jobDescription(name) {
  const key = JOB_LABEL_KEYS[name];
  return key ? t(`jobs.description.${key}`) : '';
}

// Tägliche Jobs sind serverseitig in UTC terminiert — hier in die lokale
// Uhrzeit der betrachtenden Person umgerechnet.
export function describeSchedule(schedule) {
  if (schedule?.kind === 'daily') {
    const slot = new Date();
    slot.setUTCHours(schedule.hourUtc, 0, 0, 0);
    return t('jobs.scheduleDaily', { time: slot.toLocaleTimeString(getLocale(), { hour: '2-digit', minute: '2-digit' }) });
  }
  if (schedule?.kind === 'interval') return t('jobs.scheduleInterval', { hours: schedule.hours });
  return '—';
}

// Feste Reihenfolge der Zähler: Postgres (JSONB) speichert die Schlüssel
// sortiert nach Länge statt in der Reihenfolge, in der der Job sie liefert.
const SUMMARY_ORDER = ['purgedAccounts', 'failedAccounts', 'deletedSyncedEvents', 'deletedSyncTombstones', 'deletedAuditEntries', 'remindersSent', 'failed'];
const summaryRank = (key) => (SUMMARY_ORDER.includes(key) ? SUMMARY_ORDER.indexOf(key) : SUMMARY_ORDER.length);

export function describeSummary(summary) {
  const entries = Object.entries(summary || {}).sort(([a], [b]) => summaryRank(a) - summaryRank(b));
  if (entries.length === 0) return '—';
  return entries.map(([key, value]) => {
    const label = t(`jobs.summary.${key}`);
    // t() liefert den Schlüssel selbst zurück, wenn es keine Übersetzung
    // gibt — dann lieber den rohen Zählernamen zeigen.
    return `${label === `jobs.summary.${key}` ? key : label}: ${value}`;
  }).join(', ');
}

export function statusBadges(job) {
  const badges = [];
  if (job.running) badges.push(badge(t('jobs.statusRunning'), 'scheduled'));
  else if (job.lastStatus === 'success') badges.push(badge(t('jobs.statusSuccess'), 'done'));
  else if (job.lastStatus === 'partial') badges.push(badge(t('jobs.statusPartial'), 'progress'));
  else if (job.lastStatus === 'failed') badges.push(badge(t('jobs.statusFailed'), 'open'));
  else badges.push(badge(t('jobs.statusNever'), 'neutral'));
  if (job.stale) badges.push(badge(t('jobs.statusStale'), 'open'));
  return badges;
}

function describeNextRun(job, schedulerEnabled) {
  if (!schedulerEnabled) return t('jobs.nextRunCronOnly');
  if (new Date(job.nextDueAt).getTime() <= Date.now()) return t('jobs.nextRunNow');
  return fmtDateTime(job.nextDueAt);
}

function renderTable(overview) {
  const table = el('table');
  table.appendChild(el('thead', {}, el('tr', {}, [
    el('th', {}, t('jobs.colJob')), el('th', {}, t('jobs.colSchedule')), el('th', {}, t('jobs.colLastRun')),
    el('th', {}, t('jobs.colStatus')), el('th', {}, t('jobs.colResult')), el('th', {}, t('jobs.colNextRun')),
  ])));
  const tbody = el('tbody');
  overview.jobs.forEach((job) => {
    const resultCell = el('td', {}, describeSummary(job.lastSummary));
    if (job.lastError) resultCell.appendChild(el('div', { class: 'form-error' }, job.lastError));
    if (job.consecutiveFailures > 1) resultCell.appendChild(el('div', { class: 'hint' }, t('jobs.consecutiveFailures', { count: job.consecutiveFailures })));
    tbody.appendChild(el('tr', {}, [
      el('td', {}, [el('strong', {}, jobLabel(job.name)), el('div', { class: 'hint' }, jobDescription(job.name))]),
      el('td', {}, describeSchedule(job.schedule)),
      el('td', {}, job.running ? t('jobs.runningSince', { time: fmtDateTime(job.runningSince) }) : fmtDateTime(job.lastStartedAt)),
      el('td', {}, el('div', { class: 'flex gap-8' }, statusBadges(job))),
      resultCell,
      el('td', {}, describeNextRun(job, overview.schedulerEnabled)),
    ]));
  });
  table.appendChild(tbody);
  return el('div', { class: 'table-wrap' }, table);
}

export function renderBackgroundJobsCard() {
  const body = el('div');
  const refreshBtn = el('button', { class: 'btn btn-ghost btn-sm', onclick: () => load() }, t('jobs.refresh'));
  const card = el('div', { class: 'card mb-16' }, [
    el('div', { class: 'flex justify-between items-center mb-16' }, [el('h3', { class: 'mt-0' }, t('jobs.title')), refreshBtn]),
    body,
  ]);

  async function load() {
    refreshBtn.disabled = true;
    clear(body);
    body.appendChild(el('p', { class: 'hint' }, t('jobs.loading')));
    try {
      const overview = await api.getJobsStatus();
      clear(body);
      body.appendChild(el('p', { class: overview.schedulerEnabled ? 'hint' : 'form-error' },
        overview.schedulerEnabled ? t('jobs.schedulerEnabled') : t('jobs.schedulerDisabled')));
      body.appendChild(renderTable(overview));
    } catch (err) {
      clear(body);
      body.appendChild(el('p', { class: 'form-error' }, describeError(err)));
    } finally {
      refreshBtn.disabled = false;
    }
  }

  load();
  return card;
}
