// apps/api/test/auth/auth.service.test.ts
import { describe, it, expect } from 'vitest';
import {
  createAuthService,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  InvalidInvitationError,
} from '../../src/modules/auth/auth.service.js';
import { InMemoryUserRepository, InMemoryRefreshTokenRepository } from '../../src/modules/auth/auth.repository.memory.js';
import { InMemoryInvitationRepository } from '../../src/modules/invitations/invitations.repository.memory.js';
import { generateFreshKeyPair } from '../../src/auth/keys.js';
import { verifyAccessToken } from '../../src/auth/tokens.js';
import { generateInvitationToken } from '../../src/auth/tokens.js';

const CLUB_ID = '11111111-1111-1111-1111-111111111111';
const INVITER_ID = '99999999-9999-9999-9999-999999999999';

function makeService() {
  const users = new InMemoryUserRepository();
  const refreshTokens = new InMemoryRefreshTokenRepository();
  const invitations = new InMemoryInvitationRepository();
  const keyPair = generateFreshKeyPair();
  const service = createAuthService({ users, refreshTokens, invitations, keyPair, accessTtlSeconds: 900, refreshTtlDays: 30 });
  return { service, users, refreshTokens, invitations, keyPair };
}

// Erzeugt eine gültige Trainer-Einladung und liefert das Klartext-Token,
// das anschließend an service.acceptInvitation() übergeben werden kann —
// steht stellvertretend für das, was invitations.service.ts in der Praxis
// ausstellt (siehe invitations.service.test.ts für dessen eigene Tests).
async function seedInvitation(
  invitations: InMemoryInvitationRepository,
  overrides: Partial<{ email: string; role: string; clubId: string | null; expiresAt: Date; usedAt: Date | null; revokedAt: Date | null }> = {},
) {
  const { plainToken, tokenHash, expiresAt } = generateInvitationToken(7);
  const clubId = 'clubId' in overrides ? overrides.clubId! : CLUB_ID;
  await invitations.create({
    tokenHash,
    email: overrides.email ?? 'sabine.reuter@example.org',
    role: overrides.role ?? 'trainer',
    clubId,
    athleteId: null,
    invitedById: INVITER_ID,
    expiresAt: overrides.expiresAt ?? expiresAt,
  });
  return plainToken;
}

describe('authService.acceptInvitation', () => {
  it('legt bei gültiger Einladung einen neuen Nutzer mit deren Rolle/Verein an', async () => {
    const { service, invitations, keyPair } = makeService();
    const token = await seedInvitation(invitations, { role: 'trainer', clubId: CLUB_ID });

    const result = await service.acceptInvitation({ token, name: 'Sabine Reuter', password: 'ein-sicheres-passwort' });

    expect(result.user.email).toBe('sabine.reuter@example.org');
    expect(result.user.role).toBe('trainer');
    expect(result.user.clubId).toBe(CLUB_ID);
    expect(result.user).not.toHaveProperty('passwordHash');

    const claims = await verifyAccessToken(result.accessToken, keyPair);
    expect(claims.role).toBe('trainer');
    expect(claims.clubId).toBe(CLUB_ID);
  });

  it('übernimmt E-Mail/Rolle/Verein IMMER aus der Einladung, niemals aus dem Client-Body', async () => {
    const { service, invitations } = makeService();
    const token = await seedInvitation(invitations, { role: 'admin', clubId: CLUB_ID });

    // Selbst wenn ein manipulierter Client versuchen würde, zusätzliche
    // Felder mitzuschicken, kennt AcceptInvitationRequest gar keine
    // role/clubId/email-Felder (siehe shared-types) — hier wird nur
    // geprüft, dass die tatsächlich vergebene Rolle aus der Einladung stammt.
    const result = await service.acceptInvitation({ token, name: 'Neue Admin', password: 'ein-sicheres-passwort' });
    expect(result.user.role).toBe('admin');
  });

  it('markiert die Einladung nach Verwendung als verbraucht (kein zweites Einlösen möglich)', async () => {
    const { service, invitations } = makeService();
    const token = await seedInvitation(invitations);
    await service.acceptInvitation({ token, name: 'X', password: 'ein-sicheres-passwort' });

    await expect(service.acceptInvitation({ token, name: 'Y', password: 'ein-anderes-passwort' })).rejects.toThrow(
      InvalidInvitationError,
    );
  });

  it('lehnt ein unbekanntes/erfundenes Einladungs-Token ab', async () => {
    const { service } = makeService();
    await expect(
      service.acceptInvitation({ token: 'kein-echtes-token', name: 'X', password: 'ein-sicheres-passwort' }),
    ).rejects.toThrow(InvalidInvitationError);
  });

  it('lehnt eine abgelaufene Einladung ab', async () => {
    const { service, invitations } = makeService();
    const token = await seedInvitation(invitations, { expiresAt: new Date(Date.now() - 1000) });
    await expect(service.acceptInvitation({ token, name: 'X', password: 'ein-sicheres-passwort' })).rejects.toThrow(
      InvalidInvitationError,
    );
  });

  it('lehnt eine widerrufene Einladung ab', async () => {
    const { service, invitations } = makeService();
    const { plainToken, tokenHash, expiresAt } = generateInvitationToken(7);
    const invitation = await invitations.create({
      tokenHash,
      email: 'x@y.de',
      role: 'trainer',
      clubId: CLUB_ID,
      athleteId: null,
      invitedById: INVITER_ID,
      expiresAt,
    });
    await invitations.revoke(invitation.id);
    await expect(
      service.acceptInvitation({ token: plainToken, name: 'X', password: 'ein-sicheres-passwort' }),
    ).rejects.toThrow(InvalidInvitationError);
  });

  it('lehnt ab, wenn die E-Mail der Einladung bereits ein Konto hat', async () => {
    const { service, invitations } = makeService();
    const tokenA = await seedInvitation(invitations, { email: 'doppel@example.org' });
    await service.acceptInvitation({ token: tokenA, name: 'Erste Person', password: 'ein-sicheres-passwort' });

    const tokenB = await seedInvitation(invitations, { email: 'doppel@example.org' });
    await expect(
      service.acceptInvitation({ token: tokenB, name: 'Zweite Person', password: 'ein-anderes-passwort' }),
    ).rejects.toThrow(EmailAlreadyRegisteredError);
  });

  it('speichert das Passwort niemals im Klartext', async () => {
    const { service, invitations, users } = makeService();
    const token = await seedInvitation(invitations);
    const result = await service.acceptInvitation({ token, name: 'X', password: 'ein-sicheres-passwort' });
    const stored = await users.findById(result.user.id);
    expect(stored?.passwordHash).not.toBe('ein-sicheres-passwort');
  });

  it('unterstützt clubId: null (z. B. bei einer — hier nur zu Testzwecken erzeugten — Einladung ohne Verein)', async () => {
    const { service, invitations } = makeService();
    const token = await seedInvitation(invitations, { role: 'trainer', clubId: null });
    const result = await service.acceptInvitation({ token, name: 'X', password: 'ein-sicheres-passwort' });
    expect(result.user.clubId).toBeNull();
  });
});

async function registerViaInvitation(
  service: ReturnType<typeof createAuthServiceForFixture>,
  invitations: InMemoryInvitationRepository,
  overrides: Partial<{ email: string; role: string; clubId: string | null }> = {},
) {
  const token = await seedInvitation(invitations, overrides);
  return service.acceptInvitation({ token, name: 'Test Person', password: 'ein-sicheres-passwort' });
}
function createAuthServiceForFixture() {
  return makeService().service;
}

describe('authService.login', () => {
  it('meldet mit korrekten Zugangsdaten erfolgreich an', async () => {
    const { service, invitations } = makeService();
    await registerViaInvitation(service, invitations, { email: 'sabine.reuter@example.org' });
    const result = await service.login({ email: 'sabine.reuter@example.org', password: 'ein-sicheres-passwort' });
    expect(result.user.email).toBe('sabine.reuter@example.org');
  });

  it('lehnt ein falsches Passwort ab', async () => {
    const { service, invitations } = makeService();
    await registerViaInvitation(service, invitations, { email: 'sabine.reuter@example.org' });
    await expect(
      service.login({ email: 'sabine.reuter@example.org', password: 'falsches-passwort' }),
    ).rejects.toThrow(InvalidCredentialsError);
  });

  it('lehnt eine unbekannte E-Mail-Adresse ab, mit derselben Fehlermeldung wie ein falsches Passwort', async () => {
    const { service, invitations } = makeService();
    await registerViaInvitation(service, invitations, { email: 'sabine.reuter@example.org' });

    let unknownEmailMessage = '';
    let wrongPasswordMessage = '';
    try {
      await service.login({ email: 'unbekannt@example.org', password: 'irgendwas' });
    } catch (err) {
      unknownEmailMessage = (err as Error).message;
    }
    try {
      await service.login({ email: 'sabine.reuter@example.org', password: 'falsch' });
    } catch (err) {
      wrongPasswordMessage = (err as Error).message;
    }
    expect(unknownEmailMessage).toBe(wrongPasswordMessage);
    expect(unknownEmailMessage).not.toBe('');
  });
});

describe('authService.refresh', () => {
  it('stellt bei gültigem Refresh Token neue Tokens aus', async () => {
    const { service, invitations } = makeService();
    const { refreshToken } = await registerViaInvitation(service, invitations);
    const result = await service.refresh(refreshToken);
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });

  it('rotiert das Refresh Token: das alte Token ist nach Benutzung ungültig', async () => {
    const { service, invitations } = makeService();
    const { refreshToken } = await registerViaInvitation(service, invitations);
    await service.refresh(refreshToken);
    await expect(service.refresh(refreshToken)).rejects.toThrow(InvalidRefreshTokenError);
  });

  it('das neue Refresh Token aus refresh() funktioniert für den nächsten Refresh', async () => {
    const { service, invitations } = makeService();
    const first = await registerViaInvitation(service, invitations);
    const second = await service.refresh(first.refreshToken);
    const third = await service.refresh(second.refreshToken);
    expect(third.accessToken).toBeTruthy();
  });

  it('lehnt ein unbekanntes/erfundenes Refresh Token ab', async () => {
    const { service } = makeService();
    await expect(service.refresh('kein-echtes-token')).rejects.toThrow(InvalidRefreshTokenError);
  });
});

describe('authService.logout', () => {
  it('invalidiert das Refresh Token, sodass ein nachfolgender Refresh fehlschlägt', async () => {
    const { service, invitations } = makeService();
    const { refreshToken } = await registerViaInvitation(service, invitations);
    await service.logout(refreshToken);
    await expect(service.refresh(refreshToken)).rejects.toThrow(InvalidRefreshTokenError);
  });

  it('ist idempotent — ein zweiter Logout mit demselben (bereits ungültigen) Token wirft nicht', async () => {
    const { service, invitations } = makeService();
    const { refreshToken } = await registerViaInvitation(service, invitations);
    await service.logout(refreshToken);
    await expect(service.logout(refreshToken)).resolves.not.toThrow();
  });
});

describe('authService.getMe / updateMe', () => {
  it('liefert das öffentliche Profil ohne Passwort-Hash', async () => {
    const { service, invitations } = makeService();
    const { user } = await registerViaInvitation(service, invitations, { email: 'sabine.reuter@example.org' });
    const me = await service.getMe(user.id);
    expect(me.email).toBe('sabine.reuter@example.org');
    expect(me).not.toHaveProperty('passwordHash');
  });

  it('aktualisiert den Namen erfolgreich', async () => {
    const { service, invitations } = makeService();
    const { user } = await registerViaInvitation(service, invitations);
    const updated = await service.updateMe(user.id, { name: 'Neuer Name' });
    expect(updated.name).toBe('Neuer Name');
  });

  it('lehnt eine E-Mail-Änderung auf eine bereits vergebene Adresse ab', async () => {
    const { service, invitations } = makeService();
    const { user } = await registerViaInvitation(service, invitations, { email: 'erste@example.org' });
    await registerViaInvitation(service, invitations, { email: 'andere@example.org' });
    await expect(service.updateMe(user.id, { email: 'andere@example.org' })).rejects.toThrow(EmailAlreadyRegisteredError);
  });

  it('erlaubt es, die eigene E-Mail unverändert beizubehalten (kein Konflikt mit sich selbst)', async () => {
    const { service, invitations } = makeService();
    const { user } = await registerViaInvitation(service, invitations, { email: 'gleich@example.org' });
    const updated = await service.updateMe(user.id, { email: 'gleich@example.org', name: 'Trotzdem geändert' });
    expect(updated.email).toBe('gleich@example.org');
    expect(updated.name).toBe('Trotzdem geändert');
  });
});
