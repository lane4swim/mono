// Audit-Log sicherheitsrelevanter Aktionen (docs/Plans/vereinsverwaltung-
// phase3-plan.md, Abschnitt 2) — rein lesend, Einträge entstehen
// ausschließlich serverseitig (invitations.service.ts/auth.service.ts).
import { el, clear, beginRender } from '../dom.js';
import { fmtDateTime } from '../dates.js';
import { emptyState } from '../ui.js';
import { t } from '../i18n.js';
import * as api from '../apiClient.js';
import { describeError } from '../apiClient.js';
import { IS_DEMO } from '../demoMode.js';

const PAGE_SIZE = 50;

export const auditLogModule = {
  id: 'auditlog',
  roles: ['admin', 'superadmin'],
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>`,
  async render(container) {
    const isCurrent = beginRender(container);
    clear(container);
    // Läuft ausschließlich über den echten REST-Endpunkt — demo.html hat
    // kein apps/api dahinter (analog userManagement.js: IS_DEMO-Guard).
    if (IS_DEMO) { renderDemoDisabled(container); return; }
    try {
      const { entries } = await api.listAuditLog({ limit: PAGE_SIZE });
      if (!isCurrent()) return;
      renderView(container, entries);
    } catch (err) {
      if (!isCurrent()) return;
      renderError(container, err);
    }
  },
};

function renderDemoDisabled(container) {
  container.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('auditLog.eyebrow')), el('h1', { class: 'mt-0' }, t('auditLog.title'))]),
  ]));
  container.appendChild(emptyState(t('auditLog.title'), t('auditLog.demoDisabled'), null));
}

function renderError(container, err) {
  container.appendChild(el('div', { class: 'empty-state' }, [
    el('h3', {}, t('common.somethingWentWrong')),
    el('p', {}, describeError(err)),
  ]));
}

// docs/Plans/vereinsverwaltung-phase3-plan.md, Abschnitt 2.3 — action-
// spezifische Zusatzdaten (metadata) menschenlesbar zusammenfassen, statt
// rohes JSON anzuzeigen.
// Server-seitige Marker (auditLog.service.ts, jobs/auditLogPseudonymization.ts)
// statt fest gespeicherter Anzeigetexte — hier in die UI-Sprache übersetzt.
const DELETED_ACCOUNT_PREFIX = '__deleted_account__#';
function describePerson(label) {
  if (!label) return '—';
  if (label === '__unknown__') return t('auditLog.unknownActor');
  if (label === '__system__') return t('auditLog.systemActor');
  if (label.startsWith(DELETED_ACCOUNT_PREFIX)) return t('auditLog.deletedAccount', { ref: label.slice(DELETED_ACCOUNT_PREFIX.length) });
  return label;
}

function describeEntry(entry) {
  const meta = entry.metadata || {};
  switch (entry.action) {
    case 'invitation.created':
      return t('auditLog.action.invitationCreated', { role: meta.role || '—' });
    case 'invitation.revoked':
      return t('auditLog.action.invitationRevoked', { role: meta.role || '—' });
    case 'user.rolesChanged':
      return t('auditLog.action.rolesChanged', {
        oldRoles: (meta.oldRoles || []).join(', ') || '—',
        newRoles: (meta.newRoles || []).join(', ') || '—',
      });
    case 'user.deletionRequested':
      return t('auditLog.action.deletionRequested');
    case 'auth.loginFailed':
      return t('auditLog.action.loginFailed');
    case 'auth.refreshTokenReuse':
      return t('auditLog.action.refreshTokenReuse');
    case 'auth.passwordResetRequested':
      return t('auditLog.action.passwordResetRequested');
    case 'auth.passwordReset':
      return t('auditLog.action.passwordReset');
    case 'user.passwordChanged':
      return t('auditLog.action.passwordChanged');
    case 'user.emailChanged':
      return t('auditLog.action.emailChanged');
    case 'club.created':
      return t('auditLog.action.clubCreated');
    case 'club.modulesChanged':
      return t('auditLog.action.clubModulesChanged', {
        oldModules: (meta.oldModules || []).join(', ') || '—',
        newModules: (meta.newModules || []).join(', ') || '—',
      });
    case 'club.identityChanged':
      return t('auditLog.action.clubIdentityChanged');
    case 'club.legalInfoChanged':
      return t('auditLog.action.clubLegalInfoChanged', { fields: (meta.fields || []).join(', ') || '—' });
    case 'parentLink.added':
      return t('auditLog.action.parentLinkAdded');
    case 'parentLink.removed':
      return t('auditLog.action.parentLinkRemoved');
    case 'qualification.created':
      return t('auditLog.action.qualificationCreated', { type: meta.type || '—' });
    case 'qualification.updated':
      return t('auditLog.action.qualificationUpdated', { type: meta.type || '—' });
    case 'qualification.deleted':
      return t('auditLog.action.qualificationDeleted', { type: meta.type || '—' });
    case 'refereeAssignment.created':
      return t('auditLog.action.refereeAssignmentCreated', { competition: meta.competitionName || '—' });
    case 'refereeAssignment.updated':
      return t('auditLog.action.refereeAssignmentUpdated', { competition: meta.competitionName || '—' });
    case 'refereeAssignment.deleted':
      return t('auditLog.action.refereeAssignmentDeleted', { competition: meta.competitionName || '—' });
    default:
      return entry.action;
  }
}

function renderView(container, initialEntries) {
  let entries = initialEntries;
  // Weitere Seiten gibt es nur, solange die ZULETZT geladene Seite voll war.
  // Die Gesamtlänge taugt dafür nicht: bei genau 50 (100, …) Einträgen
  // bliebe der Button sonst nach einer leeren Antwort ewig stehen.
  let hasMore = initialEntries.length === PAGE_SIZE;
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'page-head' }, [
    el('div', {}, [el('div', { class: 'page-eyebrow' }, t('auditLog.eyebrow')), el('h1', { class: 'mt-0' }, t('auditLog.title'))]),
  ]));
  wrap.appendChild(el('p', { class: 'hint' }, t('auditLog.intro')));

  const tableHost = el('div');
  const loadMoreHost = el('div', { class: 'mt-16' });
  wrap.appendChild(tableHost);
  wrap.appendChild(loadMoreHost);
  container.appendChild(wrap);

  function drawTable() {
    clear(tableHost);
    if (entries.length === 0) {
      tableHost.appendChild(emptyState(t('auditLog.emptyTitle'), t('auditLog.emptyMsg'), null));
      return;
    }
    const table = el('table');
    table.appendChild(el('thead', {}, el('tr', {}, [
      el('th', {}, t('auditLog.colTime')), el('th', {}, t('auditLog.colAction')), el('th', {}, t('auditLog.colActor')), el('th', {}, t('auditLog.colTarget')),
    ])));
    const tbody = el('tbody');
    entries.forEach((e) => {
      tbody.appendChild(el('tr', {}, [
        el('td', {}, fmtDateTime(e.createdAt)),
        el('td', {}, describeEntry(e)),
        el('td', {}, describePerson(e.actorLabel)),
        el('td', {}, describePerson(e.targetLabel)),
      ]));
    });
    table.appendChild(tbody);
    tableHost.appendChild(el('div', { class: 'table-wrap card' }, table));
  }

  function drawLoadMore() {
    clear(loadMoreHost);
    if (!hasMore) return;
    const btn = el('button', { class: 'btn btn-ghost', onclick: async () => {
      btn.disabled = true;
      try {
        const before = entries[entries.length - 1].createdAt;
        const { entries: more } = await api.listAuditLog({ before, limit: PAGE_SIZE });
        entries = entries.concat(more);
        hasMore = more.length === PAGE_SIZE;
        drawTable();
        drawLoadMore();
      } catch (err) {
        renderError(loadMoreHost, err);
      }
    } }, t('auditLog.loadMore'));
    loadMoreHost.appendChild(btn);
  }

  drawTable();
  drawLoadMore();
}
