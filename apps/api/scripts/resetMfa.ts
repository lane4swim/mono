// Setzt die Zwei-Faktor-Anmeldung eines Kontos zurück (Issue #97) — der
// Notweg für Superadmins, die ihr Gerät und ihre Wiederherstellungscodes
// verloren haben. Für alle anderen gibt es "2FA zurücksetzen" in der
// Mitgliederverwaltung.
//
// Nutzung (im Ordner apps/api):
//   npm run reset-mfa -- --email=person@example.org
//
// Fragt vor dem Zurücksetzen nach; --yes überspringt die Rückfrage (z. B.
// ohne Terminal). Danach beginnt die Person bei der nächsten Anmeldung mit
// der Einrichtung neu — ist TOTP für sie Pflicht, wird sie dazu gezwungen.
import { createInterface } from 'node:readline/promises';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { loadEnv } from '../src/config/env.js';
import { resolveMailer } from '../src/app.js';
import { PrismaUserRepository, PrismaRefreshTokenRepository, PrismaMfaRecoveryCodeRepository } from '../src/modules/auth/auth.repository.js';
import { PrismaAuditLogRepository } from '../src/modules/auditLog/auditLog.repository.js';
import { createAuditLogService } from '../src/modules/auditLog/auditLog.service.js';
import { resetMfaAsOperator } from '../src/modules/mfa/operatorReset.js';

const USAGE = 'Verwendung: npm run reset-mfa -- --email=<email> [--yes]';

async function confirm(email: string): Promise<boolean> {
  if (!process.stdin.isTTY) {
    console.error('Kein interaktives Terminal — zum Bestätigen --yes anhängen.');
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`Zwei-Faktor-Anmeldung von ${email} wirklich zurücksetzen? Alle Sitzungen enden. [j/N] `);
    return /^(j|ja|y|yes)$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const email = args.map((arg) => /^--email=(.+)$/.exec(arg)?.[1]).find(Boolean);
  const parsed = z.string().email().safeParse(email);
  if (!parsed.success) {
    console.error(USAGE);
    process.exit(1);
  }
  if (!args.includes('--yes') && !(await confirm(parsed.data))) {
    console.error('Abgebrochen.');
    process.exit(1);
  }

  const env = loadEnv();
  const prisma = new PrismaClient();
  try {
    const users = new PrismaUserRepository(prisma);
    const result = await resetMfaAsOperator(
      {
        users,
        recoveryCodes: new PrismaMfaRecoveryCodeRepository(prisma),
        refreshTokens: new PrismaRefreshTokenRepository(prisma),
        auditLog: createAuditLogService({ entries: new PrismaAuditLogRepository(prisma), users }),
        mailer: resolveMailer(env),
      },
      parsed.data,
    );
    if (result.status === 'not_found') {
      console.error(`Kein aktives Konto mit der E-Mail-Adresse "${parsed.data}".`);
      process.exitCode = 1;
    } else if (result.status === 'not_enabled') {
      console.log(`${result.label} hat keine Zwei-Faktor-Anmeldung eingerichtet — nichts zu tun.`);
    } else {
      console.log(`✔ Zwei-Faktor-Anmeldung zurückgesetzt: ${result.label}`);
      console.log('Alle Sitzungen sind beendet. Bei der nächsten Anmeldung richtet die Person TOTP neu ein.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[reset-mfa] Unerwarteter Fehler:', err);
  process.exit(1);
});
