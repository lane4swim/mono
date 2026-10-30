import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify, { type FastifyRequest } from 'fastify';
import { createClubModulesResolver, requireClubModule, CLUB_MODULES_CACHE_TTL_MS } from '../../src/plugins/clubModules.js';

const CLUB_A = '11111111-1111-1111-1111-111111111111';
const CLUB_B = '22222222-2222-2222-2222-222222222222';

function lookupWith(modulesByClub: Record<string, string[]>) {
  return { findById: vi.fn(async (clubId: string) => (clubId in modulesByClub ? { enabledModules: modulesByClub[clubId]! } : null)) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createClubModulesResolver()', () => {
  it('liest je Verein nur einmal und hält die Vereine getrennt', async () => {
    const app = Fastify();
    const clubs = lookupWith({ [CLUB_A]: ['qualifications'], [CLUB_B]: ['kampfrichter'] });
    const resolve = createClubModulesResolver(app, clubs);

    expect(await resolve(CLUB_A)).toEqual(['qualifications']);
    expect(await resolve(CLUB_A)).toEqual(['qualifications']);
    expect(await resolve(CLUB_B)).toEqual(['kampfrichter']);
    expect(clubs.findById).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('liest nach Ablauf der TTL erneut', async () => {
    const app = Fastify();
    const clubs = lookupWith({ [CLUB_A]: ['qualifications'] });
    const resolve = createClubModulesResolver(app, clubs);

    await resolve(CLUB_A);
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => realNow + CLUB_MODULES_CACHE_TTL_MS + 1_000);
    await resolve(CLUB_A);
    expect(clubs.findById).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('liefert für einen unbekannten Verein keine Module', async () => {
    const app = Fastify();
    const resolve = createClubModulesResolver(app, lookupWith({}));
    expect(await resolve(CLUB_A)).toEqual([]);
    await app.close();
  });

  it('beendet den Sweep-Timer beim Schließen der App', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const app = Fastify();
    createClubModulesResolver(app, lookupWith({}));
    await app.ready();
    await app.close();
    expect(clearSpy).toHaveBeenCalled();
  });
});

describe('requireClubModule()', () => {
  async function buildGatedApp(modules: string[]) {
    const app = Fastify();
    const resolve = createClubModulesResolver(app, lookupWith({ [CLUB_A]: modules }));
    // Ersetzt app.authenticate: setzt nur die für das Gate nötigen Claims.
    const fakeAuth = async (request: FastifyRequest) => {
      request.user = { sub: 'user-1', roles: ['admin'], clubId: CLUB_A, athleteId: null };
    };
    app.get('/gated', { preHandler: [fakeAuth, requireClubModule(resolve, 'qualifications', 'Nicht gebucht.')] }, async () => ({ ok: true }));
    return app;
  }

  it('lässt die Anfrage durch, wenn das Modul gebucht ist', async () => {
    const app = await buildGatedApp(['qualifications']);
    const response = await app.inject({ method: 'GET', url: '/gated' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
    await app.close();
  });

  it('antwortet mit 403 module_not_enabled, wenn das Modul fehlt', async () => {
    const app = await buildGatedApp(['kampfrichter']);
    const response = await app.inject({ method: 'GET', url: '/gated' });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: 'module_not_enabled', message: 'Nicht gebucht.' });
    await app.close();
  });
});
