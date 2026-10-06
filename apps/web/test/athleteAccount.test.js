// Kontozustand von Athletenprofilen (js/athleteAccount.js): nicht jede:r
// Athlet:in bekommt ein Konto (Athlete.accountMode).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiMock = vi.hoisted(() => ({ listClubMembers: vi.fn(), listInvitations: vi.fn() }));
const stateMock = vi.hoisted(() => ({ isAdmin: vi.fn(() => true) }));
const demoMock = vi.hoisted(() => ({ IS_DEMO: false }));
vi.mock('../js/apiClient.js', () => apiMock);
vi.mock('../js/state.js', () => stateMock);
vi.mock('../js/demoMode.js', () => demoMock);

import { isInvitable, buildAccountIndex, accountStatus, canInviteAthlete, loadAccountIndex } from '../js/athleteAccount.js';

const NOW = Date.parse('2026-10-06T12:00:00.000Z');
const future = '2026-10-10T00:00:00.000Z';
const past = '2026-10-01T00:00:00.000Z';

function invitation(overrides = {}) {
  return { id: 'i', role: 'athlete', athleteId: 'a1', usedAt: null, revokedAt: null, expiresAt: future, ...overrides };
}

describe('isInvitable', () => {
  it('nur accountMode "invitable" ist einladbar; fehlendes Feld gilt als "managed"', () => {
    expect(isInvitable({ accountMode: 'invitable' })).toBe(true);
    expect(isInvitable({ accountMode: 'managed' })).toBe(false);
    expect(isInvitable({})).toBe(false);
  });
});

describe('buildAccountIndex', () => {
  it('verknüpfte Konten über user.athleteId', () => {
    const index = buildAccountIndex([{ id: 'u1', athleteId: 'a1' }, { id: 'u2', athleteId: null }], [], NOW);
    expect([...index.linked.keys()]).toEqual(['a1']);
  });

  it('zählt nur offene Konto-Einladungen', () => {
    const index = buildAccountIndex([], [
      invitation({ athleteId: 'used', usedAt: past }),
      invitation({ athleteId: 'revoked', revokedAt: past }),
      invitation({ athleteId: 'expired', expiresAt: past }),
      invitation({ athleteId: 'parent', role: 'parent' }),
      invitation({ athleteId: null }),
      invitation({ athleteId: 'open' }),
    ], NOW);
    expect([...index.pending.keys()]).toEqual(['open']);
  });
});

describe('accountStatus / canInviteAthlete', () => {
  const index = buildAccountIndex([{ id: 'u1', athleteId: 'linked' }], [invitation({ athleteId: 'pending' })], NOW);

  it('ohne Kontozustand (Trainer:in, offline): nur das Flag', () => {
    expect(accountStatus({ id: 'x', accountMode: 'managed' }, null)).toBe('managed');
    expect(accountStatus({ id: 'x', accountMode: 'invitable' }, null)).toBe('invitable');
    expect(canInviteAthlete({ id: 'x', accountMode: 'invitable' }, null)).toBe(false);
  });

  it('mit Kontozustand', () => {
    expect(accountStatus({ id: 'linked', accountMode: 'invitable' }, index)).toBe('active');
    expect(accountStatus({ id: 'pending', accountMode: 'invitable' }, index)).toBe('invited');
    expect(accountStatus({ id: 'free', accountMode: 'invitable' }, index)).toBe('notInvited');
    expect(accountStatus({ id: 'free', accountMode: 'managed' }, index)).toBe('managed');
  });

  it('ein verknüpftes Konto geht dem Flag vor', () => {
    expect(accountStatus({ id: 'linked', accountMode: 'managed' }, index)).toBe('active');
  });

  it('einladbar nur: invitable, ohne Konto, ohne offene Einladung', () => {
    expect(canInviteAthlete({ id: 'free', accountMode: 'invitable' }, index)).toBe(true);
    expect(canInviteAthlete({ id: 'free', accountMode: 'managed' }, index)).toBe(false);
    expect(canInviteAthlete({ id: 'linked', accountMode: 'invitable' }, index)).toBe(false);
    expect(canInviteAthlete({ id: 'pending', accountMode: 'invitable' }, index)).toBe(false);
  });
});

describe('loadAccountIndex', () => {
  beforeEach(() => {
    apiMock.listClubMembers.mockReset().mockResolvedValue({ users: [{ id: 'u1', athleteId: 'a1' }] });
    apiMock.listInvitations.mockReset().mockResolvedValue({ invitations: [] });
    stateMock.isAdmin.mockReturnValue(true);
    demoMock.IS_DEMO = false;
  });

  it('lädt für Admins Mitglieder und Einladungen', async () => {
    const index = await loadAccountIndex();
    expect(index.linked.has('a1')).toBe(true);
  });

  it('liefert für Nicht-Admins null, ohne die Admin-Endpunkte aufzurufen', async () => {
    stateMock.isAdmin.mockReturnValue(false);
    expect(await loadAccountIndex()).toBeNull();
    expect(apiMock.listClubMembers).not.toHaveBeenCalled();
  });

  it('liefert bei einem Fehler (z. B. offline) null', async () => {
    apiMock.listInvitations.mockRejectedValue(new Error('offline'));
    expect(await loadAccountIndex()).toBeNull();
  });
});
