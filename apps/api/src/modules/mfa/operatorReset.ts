// Zurücksetzen der Zwei-Faktor-Anmeldung durch den Serverbetrieb (Issue #97,
// Plan PR 3) — der Notweg für ausgesperrte Superadmins, die niemand über die
// Oberfläche zurücksetzen kann (Admins dürfen keine Superadmins
// zurücksetzen). Aufgerufen von scripts/resetMfa.ts; wer das Skript
// ausführen kann, hat ohnehin direkten Datenbankzugriff.
import type { MfaRecoveryCodeRepository, RefreshTokenRepository, UserRepository } from '../auth/auth.repository.js';
import { SYSTEM_ACTOR_LABEL, userLabel, type AuditLogWriter } from '../auditLog/auditLog.service.js';
import type { MailSender } from '../../mail/mailer.js';

export interface OperatorResetDeps {
  users: Pick<UserRepository, 'findByEmail' | 'clearTotp'>;
  recoveryCodes: Pick<MfaRecoveryCodeRepository, 'deleteAll'>;
  refreshTokens: Pick<RefreshTokenRepository, 'revokeAllForUser'>;
  auditLog: AuditLogWriter;
  mailer: Pick<MailSender, 'sendAccountSecurityChangeNotice'>;
}

export type OperatorResetResult =
  | { status: 'reset'; userId: string; label: string }
  | { status: 'not_found' }
  | { status: 'not_enabled'; label: string };

export async function resetMfaAsOperator(deps: OperatorResetDeps, email: string): Promise<OperatorResetResult> {
  const user = await deps.users.findByEmail(email);
  if (!user) return { status: 'not_found' };
  const label = userLabel(user);
  // Auch eine begonnene, unbestätigte Einrichtung wird verworfen.
  if (!user.totpEnabledAt && !user.totpSecretEnc) return { status: 'not_enabled', label };

  await deps.users.clearTotp(user.id);
  await deps.recoveryCodes.deleteAll(user.id);
  await deps.refreshTokens.revokeAllForUser(user.id);
  await deps.auditLog.record({
    clubId: user.clubId,
    actorId: null,
    actorLabel: SYSTEM_ACTOR_LABEL,
    action: 'mfa.reset',
    targetId: user.id,
    targetLabel: label,
    metadata: { via: 'cli' },
  });
  try {
    await deps.mailer.sendAccountSecurityChangeNotice({ to: user.email, recipientName: user.name, changeType: 'mfa', locale: user.locale });
  } catch (err) {
    // Das Zurücksetzen ist bereits geschehen; ein Mailfehler ändert daran nichts.
    console.error('[reset-mfa] Sicherheitshinweis konnte nicht versendet werden:', err);
  }
  return { status: 'reset', userId: user.id, label };
}
