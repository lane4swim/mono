// Hardening regression for Sicherheitsreview 2026-08-29, Befund H1
// (shared-device cross-tenant read via the offline IndexedDB cache).
//
// Complements state.localStoreOwner.test.js (which mocks db.js): this suite
// drives the REAL db.js against a real (fake-indexeddb) IndexedDB and the
// REAL state.js guard, mocking only the network/UI edges. It measures what
// the "next user on a shared device" can actually read, rather than
// asserting that wipeAll() was called.
//
// Scenario: a shared poolside tablet. A club-B account uses the app and
// syncs club-B data into IndexedDB, then the tab is simply closed — no
// logout(). Later a club-A account opens the app.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));
vi.mock('../js/i18n.js', () => ({ setLocale: vi.fn(), detectInitialLocale: () => 'de-DE' }));
vi.mock('../js/syncClient.js', () => ({ resetCursor: vi.fn() }));
vi.mock('../js/apiClient.js', () => ({
  login: vi.fn(),
  refreshTokens: vi.fn(),
  getStoredRefreshToken: vi.fn(() => 'stored-refresh-token'),
  clearTokens: vi.fn(),
  logoutRemote: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

import * as api from '../js/apiClient.js';
import * as db from '../js/db.js'; // REAL db.js, real IndexedDB
import { login, logout } from '../js/state.js'; // REAL guard (ensureLocalStoreBelongsTo)

const CLUB_B_USER = { id: 'userB', clubId: 'club-B', name: 'Coach B', roles: ['trainer'], role: 'trainer', locale: 'de-DE', enabledModules: [] };
const CLUB_A_USER = { id: 'userA', clubId: 'club-A', name: 'Athlet A', roles: ['athlete'], role: 'athlete', locale: 'de-DE', enabledModules: [] };

// Exactly what a completed sync pull leaves behind for club B: full rows,
// including fields the server deliberately redacts for other roles
// (athletes.notes, sessions.trainerNote — see sync.athleteScope.ts).
async function clubBSyncsItsData() {
  await db.putWithoutSync('athletes', {
    id: 'athlete-B1', clubId: 'club-B', firstName: 'Bea', lastName: 'Berger',
    groupId: 'g-B', active: true, notes: 'coach-intern: Knieverletzung',
    birthdate: '2009-04-02', gender: 'f', joinDate: '2021-09-01',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  });
  await db.putWithoutSync('sessions', {
    id: 'session-B1', clubId: 'club-B', date: '2026-02-01T18:00:00.000Z', groupId: 'g-B',
    trainerNote: 'coach-intern: nur Technik',
    attendance: [{ athleteId: 'athlete-B1', present: true, rpe: 7 }],
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z',
  });
  await db.putWithoutSync('results', {
    id: 'result-B1', clubId: 'club-B', athleteId: 'athlete-B1', event: '100 Freistil',
    time: '00:58.31', date: '2026-02-10T00:00:00.000Z', isPB: true, status: 'official',
    createdAt: '2026-02-10T00:00:00.000Z', updatedAt: '2026-02-10T00:00:00.000Z',
  });
}

beforeEach(async () => {
  await db.wipeAll();
  vi.clearAllMocks();
  api.getStoredRefreshToken.mockReturnValue('stored-refresh-token');
});

describe('H1 — shared-device offline cache, real db.js + real state.js', () => {
  it('the local cache is read with NO clubId/role filter (the exploit payoff if foreign data survives)', async () => {
    await clubBSyncsItsData();

    // db.js: getAll() is the read path every UI module uses — no auth context.
    const athletes = await db.getAll('athletes');
    const sessions = await db.getAll('sessions');

    expect(athletes).toHaveLength(1);
    expect(athletes[0].clubId).toBe('club-B');
    // Server-redacted fields are present verbatim in the local cache:
    expect(athletes[0].notes).toBe('coach-intern: Knieverletzung');
    expect(athletes[0].birthdate).toBe('2009-04-02');
    expect(sessions[0].trainerNote).toBe('coach-intern: nur Technik');
  });

  it('a club-A login after a club-B session (no logout) wipes club B before any read', async () => {
    api.login.mockResolvedValue(CLUB_B_USER);
    await login('coachB@example.org', 'pw', true); // stamps localStoreOwner = userB
    await clubBSyncsItsData();
    expect(await db.getAll('athletes')).toHaveLength(1); // data really is on the device

    // Tab closed, NO logout(). Club A opens the app -> real state.js path.
    api.login.mockResolvedValue(CLUB_A_USER);
    await login('athletA@example.org', 'pw', true);

    expect(await db.getAll('athletes')).toHaveLength(0);
    expect(await db.getAll('sessions')).toHaveLength(0);
    expect(await db.getAll('results')).toHaveLength(0);
    expect((await db.get('meta', 'localStoreOwner')).userId).toBe('userA');
  });

  it('legacy residue (foreign data, NO owner stamp) is also wiped on first login', async () => {
    await clubBSyncsItsData();
    expect(await db.get('meta', 'localStoreOwner')).toBeNull();

    api.login.mockResolvedValue(CLUB_A_USER);
    await login('athletA@example.org', 'pw', true);

    expect(await db.getAll('athletes')).toHaveLength(0);
  });

  it('re-login as the same person keeps the cache (pending offline edits survive)', async () => {
    api.login.mockResolvedValue(CLUB_B_USER);
    await login('coachB@example.org', 'pw', true);
    await clubBSyncsItsData();

    await login('coachB@example.org', 'pw', true); // same userB

    expect(await db.getAll('athletes')).toHaveLength(1);
    expect((await db.get('meta', 'localStoreOwner')).userId).toBe('userB');
  });

  it('logout() wipes the cache', async () => {
    api.login.mockResolvedValue(CLUB_B_USER);
    await login('coachB@example.org', 'pw', true);
    await clubBSyncsItsData();

    api.logoutRemote.mockResolvedValue(undefined);
    await logout();

    expect(await db.getAll('athletes')).toHaveLength(0);
    expect(await db.get('meta', 'localStoreOwner')).toBeNull();
  });

  it('logout() wipes the cache even when the server revocation fails (finally)', async () => {
    api.login.mockResolvedValue(CLUB_B_USER);
    await login('coachB@example.org', 'pw', true);
    await clubBSyncsItsData();

    // Offline / server error: logoutRemote() rejects. Local cleanup must
    // still run, and the error must still surface to the caller.
    api.logoutRemote.mockRejectedValue(new Error('network down'));
    await expect(logout()).rejects.toThrow('network down');

    expect(await db.getAll('athletes')).toHaveLength(0);
    expect(await db.getAll('sessions')).toHaveLength(0);
    expect(await db.getAll('results')).toHaveLength(0);
  });
});
