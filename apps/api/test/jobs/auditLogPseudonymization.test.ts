// Issue #96: Audit-Log-Einträge über oder von einer gelöschten Person werden
// beim Hard-Purge pseudonymisiert statt gelöscht.
import { describe, it, expect } from 'vitest';
import { pseudonymizeAuditEntry, newAuditPseudonym, DELETED_ACCOUNT_LABEL_PREFIX } from '../../src/jobs/auditLogPseudonymization.js';

const PERSON = { id: 'user-1', email: 'mara@example.org' };
const PSEUDONYM = `${DELETED_ACCOUNT_LABEL_PREFIX}abcd1234`;

function entry(overrides: Partial<Parameters<typeof pseudonymizeAuditEntry>[0]> = {}) {
  return { actorId: 'admin-1', actorLabel: 'Admina <admin@a.de>', targetId: 'other', targetLabel: 'Other <o@a.de>', metadata: {}, ...overrides };
}

describe('pseudonymizeAuditEntry()', () => {
  it('ersetzt die Person als Handelnde', () => {
    const result = pseudonymizeAuditEntry(entry({ actorId: 'user-1', actorLabel: 'Mara <mara@example.org>' }), PERSON, PSEUDONYM);
    expect(result).toMatchObject({ actorId: null, actorLabel: PSEUDONYM, targetId: 'other', targetLabel: 'Other <o@a.de>' });
  });

  it('ersetzt die Person als Betroffene und entfernt alle E-Mail-Metadaten', () => {
    const result = pseudonymizeAuditEntry(
      entry({ targetId: 'user-1', targetLabel: 'Mara <neu@example.org>', metadata: { oldEmail: 'alt@example.org', newEmail: 'neu@example.org', role: 'x' } }),
      PERSON,
      PSEUDONYM,
    );
    expect(result).toMatchObject({ actorId: 'admin-1', targetId: null, targetLabel: PSEUDONYM, metadata: { role: 'x' } });
  });

  it('erkennt eine Einladung an die Adresse der Person (targetId ist die Einladungs-ID)', () => {
    const result = pseudonymizeAuditEntry(
      entry({ targetId: 'inv-1', targetLabel: 'MARA@example.org', metadata: { role: 'trainer', email: 'mara@example.org' } }),
      PERSON,
      PSEUDONYM,
    );
    expect(result).toMatchObject({ targetId: 'inv-1', targetLabel: PSEUDONYM, metadata: { role: 'trainer' } });
  });

  it('lässt Einträge ohne Bezug zur Person unverändert (null)', () => {
    expect(pseudonymizeAuditEntry(entry(), PERSON, PSEUDONYM)).toBeNull();
  });

  it('erzeugt je Aufruf ein anderes Pseudonym mit dem Marker-Präfix', () => {
    const a = newAuditPseudonym();
    const b = newAuditPseudonym();
    expect(a.startsWith(DELETED_ACCOUNT_LABEL_PREFIX)).toBe(true);
    expect(a).not.toBe(b);
  });
});
