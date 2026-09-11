// Eigene, stark eingeschränkte Übersicht für die Rolle "parent" (Phase 2,
// Abschnitt 4.2 — docs/Plans/phase2-plan.md). Bewusst KEIN Sync-Store/kein
// IndexedDB-Store: lädt direkt per REST (GET /api/parents/overview) —
// diese seltene, rein lesende Nutzung braucht keine
// Offline-Synchronisation (siehe Plan, Abschnitt 3.7).
import { el, clear, beginRender } from '../dom.js';
import { fmtDateLong } from '../dates.js';
import { secToTime } from '../swimTime.js';
import { badge, laneWave, emptyState } from '../ui.js';
import * as api from '../apiClient.js';
import { describeError } from '../apiClient.js';
import { t, trCode } from '../i18n.js';

export const parentViewModule = {
  id: 'parent',
  roles: ['parent'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3.6 2.9-6.2 5.5-6.2s5.5 2.6 5.5 6.2"/><circle cx="17.5" cy="9.5" r="2.4" opacity=".6"/><path d="M14.5 20c.2-2.8 1.6-4.7 3-5.4" opacity=".6"/></svg>`,
  async render(container) {
    const isCurrent = beginRender(container);
    clear(container);
    const loading = el('div', { class: 'empty-state' }, t('common.loading'));
    container.appendChild(loading);
    try {
      const { children } = await api.getParentOverview();
      if (!isCurrent()) return;
      clear(container);
      renderOverview(container, children);
    } catch (err) {
      if (!isCurrent()) return;
      clear(container);
      container.appendChild(el('div', { class: 'empty-state' }, [
        el('h3', {}, t('common.somethingWentWrong')),
        el('p', {}, describeError(err)),
      ]));
    }
  },
};

function renderOverview(container, children) {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('parentView.eyebrow')), el('h1', { class: 'mt-0' }, t('parentView.title'))]),
  ]));
  wrap.appendChild(laneWave());

  if (children.length === 0) {
    wrap.appendChild(emptyState(t('parentView.noneLinkedTitle'), t('parentView.noneLinkedMsg'), null));
    container.appendChild(wrap);
    return;
  }

  children.forEach((child) => {
    wrap.appendChild(el('div', { class: 'card mb-16' }, [
      el('h2', { class: 'mt-0' }, `${child.athlete.firstName} ${child.athlete.lastName}`),
      child.athlete.groupName ? el('div', { class: 'pill-group mb-16' }, [badge(child.athlete.groupName, 'neutral')]) : null,
      buildSection(t('parentView.upcomingSessionsTitle'), child.upcomingSessions, t('parentView.noneUpcomingSessions'), (s) => el('div', { class: 'list-row' }, [
        el('div', { style: 'flex:1' }, [el('div', {}, fmtDateLong(s.date)), s.groupName ? el('div', { class: 'text-slate text-sm' }, s.groupName) : null].filter(Boolean)),
      ])),
      buildSection(t('parentView.upcomingCompetitionsTitle'), child.upcomingCompetitions, t('parentView.noneUpcomingCompetitions'), (c) => el('div', { class: 'list-row' }, [
        el('div', { style: 'flex:1' }, [el('div', {}, c.competitionName), el('div', { class: 'text-slate text-sm' }, `${fmtDateLong(c.date)} — ${trCode(c.event, 'events')}`)]),
      ])),
      buildSection(t('parentView.recentResultsTitle'), child.recentResults, t('parentView.noneResults'), (r) => el('div', { class: 'list-row' }, [
        el('div', { style: 'flex:1' }, [el('div', {}, trCode(r.event, 'events')), el('div', { class: 'text-slate text-sm' }, fmtDateLong(r.date))]),
        el('div', { class: 'data' }, r.time != null ? secToTime(r.time) : '—'),
        r.isPB ? badge(t('parentView.pbBadge'), 'done') : null,
      ].filter(Boolean))),
    ].filter(Boolean)));
  });

  container.appendChild(wrap);
}

function buildSection(title, items, emptyMsg, renderItem) {
  const section = el('div', { class: 'mt-16' }, [el('h3', {}, title)]);
  if (items.length === 0) {
    section.appendChild(el('p', { class: 'text-sm text-slate' }, emptyMsg));
  } else {
    items.forEach((item) => section.appendChild(renderItem(item)));
  }
  return section;
}
