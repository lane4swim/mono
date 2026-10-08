// Legt für JEDE Rolle (packages/shared-types/src/user.ts: RoleSchema)
// zusätzliche Testkonten an — für manuelle Tests in einem GitHub Codespace,
// nachdem scripts/setup-codespace.sh durchgelaufen ist. Ohne dieses Skript
// müsste jedes Testkonto einzeln über den Einladungsweg (Superadmin ->
// Verein -> Admin-Einladung -> Trainer:in/Athlet:in/… einladen -> Link
// annehmen) angelegt werden, ohne funktionierenden E-Mail-Versand im
// Codespace zudem nur über das Herauskopieren der Einladungslinks.
//
// Nutzung (bevorzugt über den Wrapper aus der Projektwurzel):
//   bash scripts/create-test-accounts.sh [--count=2] [--club="Testverein"] [--reset-passwords] [--disable-superadmin-mfa]
// (--disable-superadmin-mfa wertet nur der Wrapper aus, siehe dort)
// oder direkt (im Ordner apps/api):
//   TEST_ACCOUNTS_CONFIRM=yes-test-accounts npm run create-test-accounts -- [Optionen]
//
// Was angelegt wird (je Nummer n = 1..count):
//   - superadmin  test-superadmin-<n>@example.org  (ohne Verein)
//   - admin       test-admin-<n>@example.org
//   - trainer     test-trainer-<n>@example.org
//   - athlete     test-athlete-<n>@example.org     + eigenes Athletenprofil (accountMode "invitable")
//   - referee     test-referee-<n>@example.org
//   - parent      test-parent-<n>@example.org      + verknüpftes Kind-Profil (accountMode "managed")
// Alle Vereinskonten gehören zu EINEM Testverein (wird bei Bedarf mit allen
// Modul-Paketen angelegt, analog zu prisma/seed.ts) samt einer Testgruppe.
// example.org ist nach RFC 2606 reserviert — es kann nie versehentlich eine
// echte Person eine E-Mail erhalten.
//
// Passwort: ALLE in diesem Lauf neu angelegten Konten teilen sich ein
// Passwort — aus TEST_ACCOUNT_PASSWORD, sonst zufällig erzeugt und nur am
// Ende dieses Laufs einmal ausgegeben (analog zu prisma/seed.ts). Nie als
// Kommandozeilenargument (siehe Begründung in createSuperAdmin.ts).
//
// Wiederholt ausführbar: bereits vorhandene Konten (gleiche E-Mail-Adresse)
// werden übersprungen und behalten ihr Passwort — außer mit
// --reset-passwords, dann wird es auf das Passwort dieses Laufs gesetzt
// (praktisch, wenn die Ausgabe eines früheren Laufs verloren ging).
//
// Sicherungen gegen einen Lauf auf einer echten Instanz:
//   1. NODE_ENV=production bricht ab — AUSSER in einem GitHub Codespace
//      (CODESPACES=true, von GitHub selbst gesetzt): setup-codespace.sh
//      schreibt bewusst NODE_ENV=production in apps/api/.env, obwohl ein
//      Codespace laut docs/deployment/deployment-github-codespaces.md nie
//      ein echtes Deployment ist.
//   2. Zusätzlich immer eine explizite Bestätigung per
//      TEST_ACCOUNTS_CONFIRM=yes-test-accounts (analog zu SEED_CONFIRM in
//      prisma/seed.ts), die der Wrapper erst nach Rückfrage setzt.
import { randomBytes } from 'node:crypto';
import { MODULE_KEYS, RoleSchema, type Role } from '@lane1/shared-types';

export const TEST_EMAIL_DOMAIN = 'example.org';
export const DEFAULT_COUNT = 2;
export const MAX_COUNT = 20;
export const DEFAULT_CLUB_NAME = 'Testverein';
const GROUP_NAME = 'Testgruppe';

const ROLE_LABELS: Record<Role, string> = {
  superadmin: 'Superadmin',
  admin: 'Admin',
  trainer: 'Trainer:in',
  athlete: 'Athlet:in',
  referee: 'Kampfrichter:in',
  parent: 'Elternteil',
};

export interface PlannedAccount {
  role: Role;
  index: number;
  email: string;
  name: string;
}

// Reine Funktion (ohne Datenbank), damit sie sich ohne Postgres testen
// lässt — analog zu buildDemoData() in prisma/seed.ts.
export function buildTestAccountPlan(count: number): PlannedAccount[] {
  const accounts: PlannedAccount[] = [];
  for (let index = 1; index <= count; index++) {
    for (const role of RoleSchema.options) {
      accounts.push({
        role,
        index,
        email: `test-${role}-${index}@${TEST_EMAIL_DOMAIN}`,
        name: `Test ${ROLE_LABELS[role]} ${index}`,
      });
    }
  }
  return accounts;
}

export interface Options {
  count: number;
  clubName: string;
  resetPasswords: boolean;
}

export function parseOptions(argv: string[]): Options {
  const options: Options = { count: DEFAULT_COUNT, clubName: DEFAULT_CLUB_NAME, resetPasswords: false };
  for (const arg of argv) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`Unbekanntes Argument "${arg}".`);
    const [, key, value] = match;
    if (key === 'count' && value !== undefined) {
      const count = Number(value);
      if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
        throw new Error(`--count muss eine ganze Zahl zwischen 1 und ${MAX_COUNT} sein.`);
      }
      options.count = count;
    } else if (key === 'club' && value) {
      options.clubName = value;
    } else if (key === 'reset-passwords' && value === undefined) {
      options.resetPasswords = true;
    } else {
      throw new Error(`Unbekannte Option "${arg}".`);
    }
  }
  return options;
}

export function assertSafeToRun(env: NodeJS.ProcessEnv): void {
  if (env.NODE_ENV === 'production' && env.CODESPACES !== 'true') {
    throw new Error(
      'Abgebrochen: NODE_ENV=production außerhalb eines GitHub Codespace. Testkonten mit ' +
        'bekanntem Passwort (inkl. Superadmin) gehören nie auf eine echte Instanz.',
    );
  }
  if (env.TEST_ACCOUNTS_CONFIRM !== 'yes-test-accounts') {
    throw new Error(
      'Abgebrochen: fehlende Bestätigung. Bitte über den Wrapper starten:\n' +
        '  bash scripts/create-test-accounts.sh\n' +
        'oder den Lauf explizit bestätigen:\n' +
        '  TEST_ACCOUNTS_CONFIRM=yes-test-accounts npm run create-test-accounts --workspace=apps/api',
    );
  }
}

const USAGE =
  'Verwendung: npm run create-test-accounts -- [--count=N] [--club="<Vereinsname>"] [--reset-passwords]\n' +
  'Das Passwort wird NICHT als Argument angegeben, sondern per Umgebungsvariable ' +
  'TEST_ACCOUNT_PASSWORD vorgegeben oder zufällig erzeugt.';

async function main() {
  let options: Options;
  try {
    options = parseOptions(process.argv.slice(2));
    assertSafeToRun(process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(USAGE);
    process.exit(1);
  }

  const { PrismaClient } = await import('@prisma/client');
  const { hashPassword } = await import('../src/auth/password.js');
  const { assertPasswordPolicy } = await import('../src/auth/passwordPolicy.js');

  const passwordFromEnv = process.env.TEST_ACCOUNT_PASSWORD;
  const password = passwordFromEnv || randomBytes(18).toString('base64url');
  // Strengste Regel (admin/superadmin) für alle, da ein Passwort für alle
  // Rollen gilt.
  try {
    assertPasswordPolicy(password, ['superadmin']);
  } catch (err) {
    console.error(`TEST_ACCOUNT_PASSWORD ungültig: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const club =
      (await prisma.club.findFirst({ where: { name: options.clubName }, orderBy: { createdAt: 'asc' } })) ??
      (await prisma.club.create({ data: { name: options.clubName, enabledModules: MODULE_KEYS } }));
    const group =
      (await prisma.group.findFirst({ where: { clubId: club.id, name: GROUP_NAME }, orderBy: { createdAt: 'asc' } })) ??
      (await prisma.group.create({ data: { clubId: club.id, name: GROUP_NAME } }));
    console.log(`Verein: ${club.name} (id: ${club.id})`);

    const created: PlannedAccount[] = [];
    const reset: PlannedAccount[] = [];
    const skipped: PlannedAccount[] = [];

    for (const account of buildTestAccountPlan(options.count)) {
      const existing = await prisma.user.findUnique({ where: { email: account.email } });
      if (existing) {
        if (options.resetPasswords) {
          await prisma.user.update({ where: { id: existing.id }, data: { passwordHash: await hashPassword(password) } });
          reset.push(account);
        } else {
          skipped.push(account);
        }
        continue;
      }

      const passwordHash = await hashPassword(password);
      await prisma.$transaction(async (tx) => {
        let athleteId: string | null = null;
        if (account.role === 'athlete') {
          const athlete = await tx.athlete.create({
            data: {
              clubId: club.id,
              firstName: 'Test',
              lastName: `Athlet:in ${account.index}`,
              groupId: group.id,
              accountMode: 'invitable',
            },
          });
          athleteId = athlete.id;
        }

        const user = await tx.user.create({
          data: {
            clubId: account.role === 'superadmin' ? null : club.id,
            name: account.name,
            email: account.email,
            passwordHash,
            role: account.role,
            roles: [account.role],
            athleteId,
          },
        });

        if (account.role === 'parent') {
          const child = await tx.athlete.create({
            data: {
              clubId: club.id,
              firstName: 'Test',
              lastName: `Kind ${account.index}`,
              groupId: group.id,
              accountMode: 'managed',
            },
          });
          await tx.parentLink.create({ data: { userId: user.id, athleteId: child.id } });
        }
      });
      created.push(account);
    }

    const print = (title: string, accounts: PlannedAccount[]) => {
      if (accounts.length === 0) return;
      console.log(`\n${title}`);
      for (const a of accounts) console.log(`  ${a.role.padEnd(10)} ${a.email}`);
    };
    print('✔ Neu angelegt:', created);
    print('✔ Passwort zurückgesetzt:', reset);
    print('– Übersprungen (existiert bereits, Passwort unverändert; --reset-passwords zum Zurücksetzen):', skipped);

    if (created.length + reset.length > 0) {
      if (passwordFromEnv) {
        console.log('\nPasswort der oben angelegten/zurückgesetzten Konten: wie in TEST_ACCOUNT_PASSWORD vorgegeben.');
      } else {
        console.log(`\nPasswort der oben angelegten/zurückgesetzten Konten: ${password}`);
        console.log('(wird nur jetzt angezeigt — bei Verlust erneut mit --reset-passwords ausführen)');
      }
    }
    // MFA_ENFORCE fehlt = "true" (siehe config/env.ts).
    const mfaEnforced = process.env.MFA_ENFORCE !== 'false';
    if (mfaEnforced && [...created, ...reset].some((a) => a.role === 'superadmin')) {
      console.log(
        'Hinweis: Superadmin-Konten müssen bei aktivem MFA_ENFORCE bei der ersten Anmeldung eine ' +
          'Authenticator-App einrichten (abschalten: bash scripts/create-test-accounts.sh --disable-superadmin-mfa).',
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('createTestAccounts.ts') || process.argv[1]?.endsWith('createTestAccounts.js')) {
  main().catch((err) => {
    console.error('Fehler beim Anlegen der Testkonten:', err);
    process.exit(1);
  });
}
