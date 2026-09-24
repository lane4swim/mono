// @vitest-environment jsdom
//
// Issue #65, Befund 5: "Weitere laden" richtete seine Sichtbarkeit nach der
// Gesamtzahl der Einträge (`% PAGE_SIZE`) — bei genau 50 Einträgen blieb
// der Button nach einer leeren Folgeseite stehen und lud ins Leere.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));

const listAuditLog = vi.fn();
vi.mock('../js/apiClient.js', () => ({ listAuditLog, describeError: (err) => String(err?.message || err) }));

const { auditLogModule } = await import('../js/modules/auditLog.js');
const { t } = await import('../js/i18n.js');

function page(count, offset = 0) {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${offset + i}`,
    createdAt: new Date(Date.UTC(2026, 8, 1) - (offset + i) * 60_000).toISOString(),
    action: 'user.deletionRequested',
    actorLabel: 'A',
    targetLabel: 'B',
    metadata: {},
  }));
}

function loadMoreButton(container) {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === t('auditLog.loadMore'));
}

async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  listAuditLog.mockReset();
  document.body.innerHTML = '';
});

describe('auditLog "Weitere laden"', () => {
  it('blendet den Button aus, sobald eine Folgeseite leer zurückkommt (exakt 50 Einträge)', async () => {
    listAuditLog.mockResolvedValueOnce({ entries: page(50) }).mockResolvedValueOnce({ entries: [] });
    const container = document.createElement('div');
    document.body.appendChild(container);

    await auditLogModule.render(container);
    const btn = loadMoreButton(container);
    expect(btn).toBeTruthy();

    btn.click();
    await flush();

    expect(listAuditLog).toHaveBeenCalledTimes(2);
    expect(loadMoreButton(container)).toBeUndefined();
  });

  it('zeigt den Button weiter, solange volle Seiten zurückkommen, und blendet ihn nach einer unvollständigen aus', async () => {
    listAuditLog
      .mockResolvedValueOnce({ entries: page(50) })
      .mockResolvedValueOnce({ entries: page(50, 50) })
      .mockResolvedValueOnce({ entries: page(3, 100) });
    const container = document.createElement('div');
    document.body.appendChild(container);

    await auditLogModule.render(container);
    loadMoreButton(container).click();
    await flush();
    expect(loadMoreButton(container)).toBeTruthy();

    loadMoreButton(container).click();
    await flush();
    expect(loadMoreButton(container)).toBeUndefined();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(103);
  });

  it('zeigt keinen Button, wenn schon die erste Seite unvollständig ist', async () => {
    listAuditLog.mockResolvedValueOnce({ entries: page(12) });
    const container = document.createElement('div');
    document.body.appendChild(container);

    await auditLogModule.render(container);
    expect(loadMoreButton(container)).toBeUndefined();
  });
});
