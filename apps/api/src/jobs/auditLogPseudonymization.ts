// Pseudonymisiert Audit-Log-Einträge beim Art.-17-Hard-Purge (Issue #96).
// Die Einträge selbst bleiben erhalten (was ist wann in welchem Verein
// geschehen), aber Name, E-Mail-Adresse und Konto-ID der gelöschten Person
// verschwinden. Alle Einträge dieser Person tragen dasselbe Pseudonym, damit
// zusammengehörige Vorfälle weiterhin als solche erkennbar bleiben — es ist
// je Purge zufällig und lässt sich nicht auf Konto-ID oder Adresse
// zurückführen.
//
// Wie commentAnonymization.ts: reine, DB-freie Funktionen, von
// erasure.repository.ts (Prisma) UND erasure.repository.memory.ts
// gemeinsam genutzt.
import { randomBytes } from 'node:crypto';

// Sprachneutraler Marker statt Anzeigetext (analog ANONYMIZED_COMMENT_AUTHOR):
// apps/web/js/modules/auditLog.js übersetzt ihn zur Anzeigezeit.
export const DELETED_ACCOUNT_LABEL_PREFIX = '__deleted_account__#';

export function newAuditPseudonym(): string {
  return `${DELETED_ACCOUNT_LABEL_PREFIX}${randomBytes(4).toString('hex')}`;
}

// Metadaten-Schlüssel, die E-Mail-Adressen tragen (invitation.created,
// user.emailChanged).
const EMAIL_METADATA_KEYS = ['email', 'oldEmail', 'newEmail'] as const;

export interface AuditEntryFields {
  actorId: string | null;
  actorLabel: string;
  targetId: string | null;
  targetLabel: string;
  metadata: unknown;
}

export interface ErasedPerson {
  id: string;
  email: string;
}

function sameEmail(a: unknown, b: string): boolean {
  return typeof a === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();
}

// Liefert die pseudonymisierten Felder oder `null`, wenn der Eintrag die
// Person nicht betrifft.
//   - handelnde Person (actorId) → actorId null, actorLabel Pseudonym
//   - betroffene Person (targetId) → targetId null, targetLabel Pseudonym
//   - Einladung an diese Adresse (targetLabel bzw. metadata.email ist die
//     Adresse, targetId ist die Einladungs-ID) → targetLabel Pseudonym
//   - E-Mail-Schlüssel in metadata: bei einem Eintrag über die Person alle,
//     sonst die mit ihrer Adresse
export function pseudonymizeAuditEntry(entry: AuditEntryFields, person: ErasedPerson, pseudonym: string): AuditEntryFields | null {
  const metadata = entry.metadata && typeof entry.metadata === 'object' && !Array.isArray(entry.metadata)
    ? { ...(entry.metadata as Record<string, unknown>) }
    : {};

  const isActor = entry.actorId === person.id;
  const isTarget = entry.targetId === person.id;
  const isInvitee = sameEmail(entry.targetLabel, person.email) || sameEmail(metadata.email, person.email);
  const aboutPerson = isActor || isTarget || isInvitee;

  let metadataChanged = false;
  for (const key of EMAIL_METADATA_KEYS) {
    if (key in metadata && (aboutPerson || sameEmail(metadata[key], person.email))) {
      delete metadata[key];
      metadataChanged = true;
    }
  }

  if (!aboutPerson && !metadataChanged) return null;

  return {
    actorId: isActor ? null : entry.actorId,
    actorLabel: isActor ? pseudonym : entry.actorLabel,
    targetId: isTarget ? null : entry.targetId,
    targetLabel: isTarget || isInvitee ? pseudonym : entry.targetLabel,
    metadata,
  };
}
