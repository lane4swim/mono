import { describe, it, expect } from 'vitest';
import {
  requireClub,
  requireClubAdmin,
  requireAdminOfSameClub,
  withoutDeletedAt,
  findActiveOwnedOrThrow,
  CLUB_REQUIRED_MESSAGE,
  NOT_SAME_CLUB_MESSAGE,
} from '../../src/modules/shared/clubAccess.js';
import { ForbiddenError } from '../../src/modules/shared/errors.js';
import { requesterFrom } from '../../src/plugins/requester.js';
import { InMemoryUserRepository } from '../../src/modules/auth/auth.repository.memory.js';
import { UserNotFoundError } from '../../src/modules/auth/auth.service.js';

const CLUB_A = '11111111-1111-1111-1111-111111111111';
const CLUB_B = '22222222-2222-2222-2222-222222222222';

class ModuleForbiddenError extends ForbiddenError {}
class ModuleNotFoundError extends Error {}

function createUser(users: InMemoryUserRepository, clubId: string | null, roles: string[], email: string) {
  return users.create({ clubId, name: email, email, passwordHash: 'x', roles, consentGivenAt: new Date(), consentVersion: 'v1' });
}

describe('requesterFrom()', () => {
  it('bildet den Requester aus den Access-Token-Claims', () => {
    const request = { user: { sub: 'user-1', roles: ['admin' as const], clubId: CLUB_A, athleteId: null } };
    expect(requesterFrom(request)).toEqual({ id: 'user-1', roles: ['admin'], clubId: CLUB_A });
  });
});

describe('requireClub()', () => {
  it('lässt eine Person mit Verein durch', () => {
    expect(() => requireClub({ clubId: CLUB_A })).not.toThrow();
  });

  it('weist eine Person ohne Verein mit der Standardmeldung ab', () => {
    expect(() => requireClub({ clubId: null })).toThrow(new ForbiddenError(CLUB_REQUIRED_MESSAGE));
  });

  it('wirft die übergebene Fehlerklasse', () => {
    expect(() => requireClub({ clubId: null }, undefined, ModuleForbiddenError)).toThrow(ModuleForbiddenError);
  });
});

describe('requireClubAdmin()', () => {
  it('lässt einen admin mit Verein durch', () => {
    expect(() => requireClubAdmin({ roles: ['trainer', 'admin'], clubId: CLUB_A }, 'nein')).not.toThrow();
  });

  it('weist Nicht-Admins und Admins ohne Verein ab', () => {
    expect(() => requireClubAdmin({ roles: ['trainer'], clubId: CLUB_A }, 'nein')).toThrow(new ForbiddenError('nein'));
    expect(() => requireClubAdmin({ roles: ['admin'], clubId: null }, 'nein')).toThrow(new ForbiddenError('nein'));
  });
});

describe('requireAdminOfSameClub()', () => {
  it('liefert die Zielperson aus dem eigenen Verein zurück', async () => {
    const users = new InMemoryUserRepository();
    const admin = await createUser(users, CLUB_A, ['admin'], 'admin@a.de');
    const member = await createUser(users, CLUB_A, ['trainer'], 'trainer@a.de');
    const target = await requireAdminOfSameClub(users, { id: admin.id, roles: admin.roles, clubId: CLUB_A }, member.id, 'nein');
    expect(target.id).toBe(member.id);
  });

  it('weist eine vereinsfremde Zielperson mit der übergebenen Fehlerklasse ab', async () => {
    const users = new InMemoryUserRepository();
    const admin = await createUser(users, CLUB_A, ['admin'], 'admin@a.de');
    const foreign = await createUser(users, CLUB_B, ['trainer'], 'trainer@b.de');
    const promise = requireAdminOfSameClub(users, { id: admin.id, roles: admin.roles, clubId: CLUB_A }, foreign.id, 'nein', ModuleForbiddenError);
    await expect(promise).rejects.toThrow(ModuleForbiddenError);
    await expect(promise).rejects.toThrow(NOT_SAME_CLUB_MESSAGE);
  });

  it('meldet eine unbekannte Zielperson als UserNotFoundError', async () => {
    const users = new InMemoryUserRepository();
    await expect(requireAdminOfSameClub(users, { id: 'admin-1', roles: ['admin'], clubId: CLUB_A }, 'unbekannt', 'nein')).rejects.toThrow(UserNotFoundError);
  });

  it('prüft die Admin-Rolle, bevor die Zielperson geladen wird', async () => {
    const users = new InMemoryUserRepository();
    await expect(requireAdminOfSameClub(users, { id: 't-1', roles: ['trainer'], clubId: CLUB_A }, 'unbekannt', 'nein')).rejects.toThrow(new ForbiddenError('nein'));
  });
});

describe('withoutDeletedAt()', () => {
  it('entfernt nur deletedAt', () => {
    expect(withoutDeletedAt({ id: 'x', note: 'n', deletedAt: null })).toEqual({ id: 'x', note: 'n' });
  });
});

describe('findActiveOwnedOrThrow()', () => {
  const rows = new Map([
    ['own', { id: 'own', userId: 'u-1', deletedAt: null }],
    ['foreign', { id: 'foreign', userId: 'u-2', deletedAt: null }],
    ['deleted', { id: 'deleted', userId: 'u-1', deletedAt: new Date() }],
  ]);
  const repository = { findById: async (id: string) => rows.get(id) ?? null };

  it('liefert einen aktiven, eigenen Datensatz', async () => {
    await expect(findActiveOwnedOrThrow(repository, 'u-1', 'own', ModuleNotFoundError)).resolves.toMatchObject({ id: 'own' });
  });

  it('behandelt unbekannte, fremde und gelöschte Datensätze gleich', async () => {
    for (const id of ['missing', 'foreign', 'deleted']) {
      await expect(findActiveOwnedOrThrow(repository, 'u-1', id, ModuleNotFoundError)).rejects.toThrow(ModuleNotFoundError);
    }
  });
});
