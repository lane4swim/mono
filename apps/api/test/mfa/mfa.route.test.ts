// Issue #97: HTTP-Ebene der Zwei-Faktor-Anmeldung.
import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadEnv } from '../../src/config/env.js';
import { totpAt, totpStep } from '../../src/auth/totp.js';
import { makeFixture, PASSWORD } from './fixture.js';

const testEnv = loadEnv({
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  CORS_ORIGIN: 'http://localhost:5173',
});

let app: FastifyInstance | null = null;
afterEach(async () => {
  await app?.close();
  app = null;
});

async function setup() {
  const f = await makeFixture();
  app = await buildApp(testEnv, { authService: f.authService, mfaService: f.mfaService, keyPair: f.keyPair });
  const session = await f.authService.issueSessionFor(f.trainer.id);
  const auth = { authorization: `Bearer ${session.accessToken}` };
  return { f, app, auth };
}

describe('Zwei-Faktor-Anmeldung über HTTP', () => {
  it('Einrichtung, Bestätigung und zweistufige Anmeldung', async () => {
    const { f, app, auth } = await setup();
    const setupRes = await app.inject({ method: 'POST', url: '/api/me/mfa/totp/setup', headers: auth });
    expect(setupRes.statusCode).toBe(200);
    const { secret, qrSvg } = setupRes.json();
    expect(qrSvg).toMatch(/^<svg/);

    const confirmRes = await app.inject({ method: 'POST', url: '/api/me/mfa/totp/confirm', headers: auth, payload: { code: totpAt(secret, totpStep()) } });
    expect(confirmRes.statusCode).toBe(200);
    expect(confirmRes.json().recoveryCodes).toHaveLength(10);
    expect(confirmRes.json().accessToken).toBeTruthy();

    const step1 = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'trainer@a.de', password: PASSWORD, consent: true, consentVersion: f.trainer.consentVersion } });
    expect(step1.statusCode).toBe(200);
    expect(step1.json()).toEqual({ mfaRequired: true, mfaToken: expect.any(String) });

    const step2 = await app.inject({ method: 'POST', url: '/auth/login/mfa', payload: { mfaToken: step1.json().mfaToken, code: totpAt(secret, totpStep() + 1) } });
    expect(step2.statusCode).toBe(200);
    expect(step2.json().user).toMatchObject({ email: 'trainer@a.de', mfaEnabled: true });
    expect(step2.json().user).not.toHaveProperty('totpSecretEnc');
  });

  it('ein mfaToken taugt nicht als Access Token', async () => {
    const { f, app } = await setup();
    await f.enableTotp(f.trainer.id);
    const step1 = await f.login('trainer@a.de');
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${(step1 as { mfaToken: string }).mfaToken}` } });
    expect(res.statusCode).toBe(401);
  });

  it('liefert stabile Fehlercodes', async () => {
    const { f, app, auth } = await setup();
    const garbage = await app.inject({ method: 'POST', url: '/auth/login/mfa', payload: { mfaToken: 'kein-token', code: '123456' } });
    expect(garbage.statusCode).toBe(401);
    expect(garbage.json().error).toBe('invalid_mfa_token');

    const bothFactors = await app.inject({ method: 'POST', url: '/auth/login/mfa', payload: { mfaToken: 'x', code: '123456', recoveryCode: 'abcde-fghjk' } });
    expect(bothFactors.statusCode).toBe(400);

    await f.enableTotp(f.trainer.id);
    const again = await app.inject({ method: 'POST', url: '/api/me/mfa/totp/setup', headers: auth });
    // Das Access Token bleibt bis zu seinem Ablauf gültig (wie nach einem
    // Passwortwechsel); eine zweite Einrichtung scheitert fachlich.
    expect(again.statusCode).toBe(409);
    expect(again.json().error).toBe('mfa_already_enabled');
  });

  it('Zurücksetzen und Vereinspflicht sind nur für admin/superadmin erreichbar', async () => {
    const { f, app, auth } = await setup();
    const reset = await app.inject({ method: 'POST', url: `/api/users/${f.admin.id}/mfa/reset`, headers: auth, payload: { currentPassword: PASSWORD } });
    expect(reset.statusCode).toBe(403);
    const policy = await app.inject({ method: 'PATCH', url: `/api/clubs/${f.clubA.id}/mfa`, headers: auth, payload: { requiredForAdmins: true, currentPassword: PASSWORD } });
    expect(policy.statusCode).toBe(403);

    const adminSession = await f.authService.issueSessionFor(f.admin.id);
    const noTotp = await app.inject({ method: 'PATCH', url: `/api/clubs/${f.clubA.id}/mfa`, headers: { authorization: `Bearer ${adminSession.accessToken}` }, payload: { requiredForAdmins: true, currentPassword: PASSWORD } });
    expect(noTotp.statusCode).toBe(403);
    expect(noTotp.json().error).toBe('mfa_required_for_action');
  });

  it('DELETE /api/me/mfa/totp nimmt Passwort und Code im JSON-Body an', async () => {
    const { f, app } = await setup();
    const { secret } = await f.enableTotp(f.trainer.id);
    const session = await f.authService.issueSessionFor(f.trainer.id);
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/me/mfa/totp',
      headers: { authorization: `Bearer ${session.accessToken}` },
      payload: { currentPassword: PASSWORD, code: f.nextCode(secret) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.mfaEnabled).toBe(false);
  });
});
