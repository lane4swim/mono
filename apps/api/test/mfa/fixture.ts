// Gemeinsames Test-Setup für die Zwei-Faktor-Anmeldung (Issue #97): alle
// Bausteine In-Memory, echte Passwort-Hashes und echte TOTP-Codes.
import { randomBytes } from 'node:crypto';
import { CURRENT_CONSENT_VERSION } from '@lane1/shared-types';
import { createAuthService } from '../../src/modules/auth/auth.service.js';
import { InMemoryUserRepository, InMemoryRefreshTokenRepository, InMemoryPasswordResetTokenRepository, InMemoryMfaRecoveryCodeRepository } from '../../src/modules/auth/auth.repository.memory.js';
import { InMemoryClubRepository, InMemoryInvitationRepository } from '../../src/modules/invitations/invitations.repository.memory.js';
import { InMemoryAuditLogRepository } from '../../src/modules/auditLog/auditLog.repository.memory.js';
import { createAuditLogService } from '../../src/modules/auditLog/auditLog.service.js';
import { InMemoryMailSender } from '../../src/mail/mailer.memory.js';
import { InMemoryProfileDataGateway } from '../../src/modules/profile/profile.repository.memory.js';
import { InMemoryParentLinkRepository } from '../../src/modules/parents/parents.repository.memory.js';
import { generateFreshKeyPair } from '../../src/auth/keys.js';
import { hashPassword } from '../../src/auth/password.js';
import { totpAt, totpStep } from '../../src/auth/totp.js';
import { createMfaVerifier } from '../../src/modules/mfa/mfa.core.js';
import { MfaChallengeStore } from '../../src/modules/mfa/mfaChallenges.js';
import { createMfaService } from '../../src/modules/mfa/mfa.service.js';

export const PASSWORD = 'ein-sicheres-passwort';

export async function makeFixture(options: { enforce?: boolean; encryptionKey?: Buffer | null } = {}) {
  const users = new InMemoryUserRepository();
  const refreshTokens = new InMemoryRefreshTokenRepository();
  const recoveryCodes = new InMemoryMfaRecoveryCodeRepository();
  const clubs = new InMemoryClubRepository(undefined, new InMemoryInvitationRepository());
  const auditLogEntries = new InMemoryAuditLogRepository();
  const auditLog = createAuditLogService({ entries: auditLogEntries, users });
  const mailer = new InMemoryMailSender();
  const keyPair = generateFreshKeyPair();
  const verifier = createMfaVerifier({
    users,
    recoveryCodes,
    encryptionKey: options.encryptionKey === undefined ? randomBytes(32) : options.encryptionKey,
  });
  const passwordResetTokens = new InMemoryPasswordResetTokenRepository();
  const authService = createAuthService({
    users, refreshTokens, clubs, auditLog, mailer, keyPair, passwordResetTokens,
    invitations: { findValidByToken: async () => { throw new Error('unbenutzt'); }, markUsed: async () => {} },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    profileGateway: new InMemoryProfileDataGateway({ users: [], athletes: [], results: [], entries: [], actionItems: [], sessions: [] } as any),
    parentLinks: new InMemoryParentLinkRepository(),
    dataErasureRetentionDays: 30, frontendBaseUrl: 'https://app.example.org', passwordResetTtlMinutes: 60,
    accessTtlSeconds: 900, refreshTtlDays: 30,
    mfa: { verifier, challenges: new MfaChallengeStore() },
  });
  const mfaService = createMfaService({
    users, recoveryCodes, refreshTokens, clubs, verifier, auditLog, mailer,
    issueSession: (userId) => authService.issueSessionFor(userId),
    enforce: options.enforce ?? true,
    issuer: 'Lane 1',
  });

  const clubA = await clubs.create({ name: 'SV A' });
  const clubB = await clubs.create({ name: 'SV B' });
  const passwordHash = await hashPassword(PASSWORD);
  async function addUser(email: string, roles: string[], clubId: string | null) {
    return users.create({ clubId, name: email.split('@')[0]!, email, passwordHash, roles, consentGivenAt: new Date(), consentVersion: CURRENT_CONSENT_VERSION });
  }
  const admin = await addUser('admin@a.de', ['admin'], clubA.id);
  const trainer = await addUser('trainer@a.de', ['trainer'], clubA.id);
  const otherAdmin = await addUser('admin2@a.de', ['admin'], clubA.id);
  const foreignTrainer = await addUser('trainer@b.de', ['trainer'], clubB.id);
  const superadmin = await addUser('super@lane1.de', ['superadmin'], null);

  // Richtet TOTP für eine Person ein und liefert Secret und Wiederherstellungscodes.
  async function enableTotp(userId: string) {
    const { secret } = await mfaService.beginSetup(userId);
    const { recoveryCodes: codes } = await mfaService.confirmSetup(userId, totpAt(secret, totpStep()));
    return { secret, recoveryCodes: codes };
  }
  // Ein Code für einen späteren Zeitschritt als der zuletzt angenommene
  // (innerhalb des ±1-Fensters), damit Wiederverwendungsschutz nicht greift.
  const nextCode = (secret: string) => totpAt(secret, totpStep() + 1);

  function login(email: string) {
    return authService.login({ email, password: PASSWORD, consent: true, consentVersion: CURRENT_CONSENT_VERSION });
  }

  return { keyPair, users, refreshTokens, recoveryCodes, clubs, auditLogEntries, mailer, authService, mfaService, clubA, clubB, admin, trainer, otherAdmin, foreignTrainer, superadmin, enableTotp, nextCode, login };
}

