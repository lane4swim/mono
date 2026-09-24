// @vitest-environment jsdom
//
// Issue #96: neue Aktionstypen erhalten lesbare Beschreibungen, und die
// sprachneutralen Server-Marker (unbekannt/System/gelöschtes Konto) werden
// übersetzt statt roh angezeigt.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));
const listAuditLog = vi.fn();
vi.mock('../js/apiClient.js', () => ({ listAuditLog, describeError: (err) => String(err?.message || err) }));

const { auditLogModule } = await import('../js/modules/auditLog.js');
const { t } = await import('../js/i18n.js');

function entry(overrides) {
  return { id: overrides.action, createdAt: '2026-09-01T10:00:00.000Z', actorLabel: 'Admina <a@b.de>', targetLabel: 'Mara <m@b.de>', metadata: {}, ...overrides };
}

async function renderRows(entries) {
  listAuditLog.mockResolvedValueOnce({ entries });
  const container = document.createElement('div');
  await auditLogModule.render(container);
  return [...container.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent));
}

describe('auditLog — Beschriftungen (Issue #96)', () => {
  it('übersetzt die Server-Marker für unbekannte, System- und gelöschte Konten', async () => {
    const rows = await renderRows([
      entry({ action: 'auth.loginFailed', actorLabel: '__unknown__' }),
      entry({ action: 'auth.refreshTokenReuse', actorLabel: '__system__' }),
      entry({ action: 'user.passwordChanged', actorLabel: '__deleted_account__#a1b2c3d4', targetLabel: '__deleted_account__#a1b2c3d4' }),
    ]);

    expect(rows[0][2]).toBe(t('auditLog.unknownActor'));
    expect(rows[1][2]).toBe(t('auditLog.systemActor'));
    expect(rows[2][2]).toBe(t('auditLog.deletedAccount', { ref: 'a1b2c3d4' }));
    expect(rows[2][3]).toContain('a1b2c3d4');
    expect(rows.flat().join(' ')).not.toContain('__');
  });

  it('beschreibt jeden neuen Aktionstyp mit einem übersetzten Text statt des rohen Aktionsnamens', async () => {
    const actions = [
      'auth.loginFailed', 'auth.refreshTokenReuse', 'auth.passwordResetRequested', 'auth.passwordReset',
      'user.passwordChanged', 'user.emailChanged', 'club.created', 'club.modulesChanged', 'club.identityChanged',
      'club.legalInfoChanged', 'parentLink.added', 'parentLink.removed', 'qualification.created', 'qualification.updated',
      'qualification.deleted', 'refereeAssignment.created', 'refereeAssignment.updated', 'refereeAssignment.deleted',
    ];
    const rows = await renderRows(actions.map((action) => entry({ action })));
    rows.forEach((row, i) => {
      expect(row[1]).not.toBe(actions[i]);
      expect(row[1]).not.toMatch(/auditLog\./); // kein fehlender i18n-Schlüssel
    });
  });
});
