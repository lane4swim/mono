// ============================================================
// modules/syncQueue.js — Event-Queue zur Vorbereitung der
// Backend-Synchronisation ("Outbox-Pattern").
//
// Jede Änderung (Anlegen/Bearbeiten/Löschen) an den fachlichen
// Daten wird von db.js automatisch als Event in den Store
// "syncQueue" geschrieben (siehe db.js: enqueueSyncEvent). Diese
// Ansicht macht die Warteschlange sichtbar und erlaubt es, die
// spätere Übertragung an ein Backend in der Demo zu simulieren.
// ============================================================
import { getSyncQueue, updateSyncEvent, clearSyncedEvents, pendingSyncCount, remove } from '../db.js';
import { runSync } from '../syncClient.js';
import { ApiError, NetworkError } from '../apiClient.js';
import {
  el, clear, badge, emptyState, laneWave, toast, confirmAction, beginRender,
} from '../utils.js';
import { t, getLocale } from '../i18n.js';

const ENTITY_KEYS = {
  users: 'entityUsers', athletes: 'entityAthletes', groups: 'entityGroups', competitions: 'entityCompetitions',
  entries: 'entityEntries', results: 'entityResults', exercises: 'entityExercises', templates: 'entityTemplates',
  plans: 'entityPlans', sessions: 'entitySessions', actionItems: 'entityActionItems',
};

const ACTION_KEYS = { create: 'actionCreate', update: 'actionUpdate', delete: 'actionDelete' };

export const syncQueueModule = {
  id: 'syncqueue',
  roles: ['trainer', 'admin'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4v6h6"/><path d="M20 20v-6h-6"/><path d="M5.6 15a8 8 0 0013.9 2.3M18.4 9a8 8 0 00-13.9-2.3"/></svg>`,
  async render(container) {
    const isCurrent = beginRender(container);
    clear(container);
    const queue = await getSyncQueue();
    if (!isCurrent()) return;
    renderView(container, queue);
  }
};

function renderView(container, queue) {
  const wrap = el('div');
  const pending = queue.filter(e => e.status === 'pending').length;
  const errored = queue.filter(e => e.status === 'error').length;
  const synced = queue.filter(e => e.status === 'synced').length;

  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('syncqueue.eyebrow', { count: queue.length })), el('h1', { class: 'mt-0' }, t('syncqueue.title'))]),
    el('div', { class: 'page-actions' }, [
      el('button', { class: 'btn btn-ghost', disabled: synced === 0, onclick: () => confirmAction(t('syncqueue.cleanupConfirm'), async () => { const n = await clearSyncedEvents(); toast(t('syncqueue.cleanupDone', { count: n })); refresh(); }) }, t('syncqueue.cleanupButton')),
      el('button', { class: 'btn btn-primary', disabled: pending + errored === 0, onclick: () => runRealSync(refresh) }, t('syncqueue.syncButton')),
    ]),
  ]));
  wrap.appendChild(laneWave());

  wrap.appendChild(el('div', { class: 'card mb-16' }, [
    el('p', { class: 'mt-0' }, t('syncqueue.introP1')),
    el('p', { style: 'margin-bottom:0' }, t('syncqueue.introP2')),
  ]));

  wrap.appendChild(el('div', { class: 'grid grid-3 mb-16' }, [
    (() => { const d = el('div', { class: 'stat-card' }); d.innerHTML = `<div class="stat-label">${t('syncqueue.statPending')}</div><div class="stat-value">${pending}</div><div class="stat-sub">${t('syncqueue.statPendingSub')}</div>`; return d; })(),
    (() => { const d = el('div', { class: 'stat-card alt' }); d.innerHTML = `<div class="stat-label">${t('syncqueue.statError')}</div><div class="stat-value">${errored}</div><div class="stat-sub">${t('syncqueue.statErrorSub')}</div>`; return d; })(),
    (() => { const d = el('div', { class: 'stat-card' }); d.innerHTML = `<div class="stat-label">${t('syncqueue.statSynced')}</div><div class="stat-value">${synced}</div><div class="stat-sub">${t('syncqueue.statSyncedSub')}</div>`; return d; })(),
  ]));

  const host = el('div');
  wrap.appendChild(host);
  container.appendChild(wrap);

  function draw() {
    clear(host);
    if (queue.length === 0) { host.appendChild(emptyState(t('syncqueue.emptyTitle'), t('syncqueue.emptyMsg'), null)); return; }
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, t('syncqueue.colTime')), el('th', {}, t('syncqueue.colEntity')), el('th', {}, t('syncqueue.colAction')), el('th', {}, t('syncqueue.colStatus')), el('th', {}, t('syncqueue.colAttempts')), el('th', {}, ''),
    ])));
    const tbody = el('tbody');
    queue.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).forEach(evt => {
      const label = t(`syncqueue.${ENTITY_KEYS[evt.store] || ''}`) !== `syncqueue.${ENTITY_KEYS[evt.store] || ''}` ? t(`syncqueue.${ENTITY_KEYS[evt.store]}`) : evt.store;
      const statusEl = evt.status === 'synced' ? badge(t('syncqueue.statusSynced'), 'done')
        : evt.status === 'error' ? badge(t('syncqueue.statusError'), 'open')
        : badge(t('syncqueue.statusPending'), 'progress');
      const dt = new Date(evt.createdAt);
      const timeLabel = dt.toLocaleString(getLocale(), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      const row = el('tr', {}, [
        el('td', { class: 'data text-sm' }, timeLabel),
        el('td', {}, label),
        el('td', {}, t(`syncqueue.${ACTION_KEYS[evt.action] || ''}`) !== `syncqueue.${ACTION_KEYS[evt.action] || ''}` ? t(`syncqueue.${ACTION_KEYS[evt.action]}`) : evt.action),
        el('td', {}, [statusEl, evt.status === 'error' && evt.lastError ? el('div', { class: 'hint', style: 'margin-top:3px' }, evt.lastError) : null]),
        el('td', {}, String(evt.attempts || 0)),
        el('td', {}, evt.status !== 'synced' ? el('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { await updateSyncEvent(evt.id, { status: 'pending', lastError: null }); toast(t('syncqueue.retryQueued')); refresh(); } }, t('common.retry')) : el('button', { class: 'btn btn-danger btn-sm', onclick: async () => { await remove('syncQueue', evt.id); toast(t('syncqueue.entryRemoved')); refresh(); } }, t('common.remove'))),
      ]);
      tbody.appendChild(row);
    });
    table.appendChild(tbody);
    host.appendChild(el('div', { class: 'table-wrap card' }, table));
  }
  draw();

  async function refresh() { const q2 = await getSyncQueue(); clear(container); renderView(container, q2); }
}

// Führt einen echten Sync-Zyklus aus (Push dann Pull, siehe
// syncClient.js). Netzwerkfehler (Backend nicht erreichbar) und
// API-Fehler (z. B. abgelaufene Sitzung) werden mit unterschiedlichen,
// verständlichen Meldungen angezeigt statt eines rohen Fehlertexts.
async function runRealSync(onDone) {
  const queue = await getSyncQueue();
  const toSend = queue.filter(e => e.status === 'pending' || e.status === 'error');
  if (toSend.length === 0) { toast(t('syncqueue.nothingToSync')); return; }
  toast(t('syncqueue.syncing', { count: toSend.length }));
  try {
    const result = await runSync();
    if (result.errors > 0) {
      toast(t('syncqueue.syncDoneFailed', { count: result.errors }), 'error');
    } else {
      toast(t('syncqueue.syncDoneOk'));
    }
  } catch (err) {
    if (err instanceof NetworkError) toast(t('syncqueue.errorOffline'), 'error');
    else if (err instanceof ApiError) toast(t('syncqueue.errorApi', { message: err.message }), 'error');
    else toast(t('syncqueue.errorUnknown'), 'error');
  }
  onDone?.();
}
