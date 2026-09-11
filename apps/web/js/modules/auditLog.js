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
    default:
      return entry.action;
  }
}

function renderView(container, initialEntries) {
  let entries = initialEntries;
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
        el('td', {}, e.actorLabel || '—'),
        el('td', {}, e.targetLabel || '—'),
      ]));
    });
    table.appendChild(tbody);
    tableHost.appendChild(el('div', { class: 'table-wrap card' }, table));
  }

  function drawLoadMore() {
    clear(loadMoreHost);
    if (entries.length === 0 || entries.length % PAGE_SIZE !== 0) return;
    const btn = el('button', { class: 'btn btn-ghost', onclick: async () => {
      btn.disabled = true;
      try {
        const before = entries[entries.length - 1].createdAt;
        const { entries: more } = await api.listAuditLog({ before, limit: PAGE_SIZE });
        entries = entries.concat(more);
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
