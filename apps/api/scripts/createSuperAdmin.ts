// apps/api/scripts/createSuperAdmin.ts
//
// Bootstrapping-Problem: seit der Umstellung auf einladungsbasierte
// Registrierung gibt es keinen offenen Weg mehr, ein Konto anzulegen — das
// ist gewollt (siehe Aufgabenstellung), führt aber zur Henne-Ei-Frage: wer
// lädt die allererste Person ein? Antwort: niemand über die API. Der/die
// erste Superadministrator:in wird einmalig über dieses CLI-Skript direkt
// in der Datenbank angelegt (analog zu z. B. Djangos `createsuperuser`).
//
// Nutzung (im Ordner apps/api):
//   npm run create-superadmin -- --email=admin@verein-dachverband.de --password='...' --name="Max Mustermann"
//
// Bewusst NICHT über eine HTTP-Route — ein Endpoint, der frei Superadmin-
// Konten anlegen könnte, wäre selbst ein Sicherheitsrisiko.
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password.js';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.*)$/.exec(arg);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { email, password, name } = args;

  if (!email || !password || !name) {
    console.error(
      'Verwendung: npm run create-superadmin -- --email=<email> --password=<passwort> --name="<Name>"',
    );
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Das Passwort muss mindestens 8 Zeichen lang sein.');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      console.error(`Es existiert bereits ein Konto mit der E-Mail-Adresse "${email}".`);
      process.exit(1);
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        clubId: null,
        name,
        email,
        passwordHash,
        role: 'superadmin',
        athleteId: null,
      },
    });

    console.log(`✔ Superadministrator:in angelegt: ${user.name} <${user.email}> (id: ${user.id})`);
    console.log('Diese Person kann sich jetzt über POST /auth/login anmelden und über');
    console.log('POST /api/clubs neue Vereine samt deren erster Admin-Einladung anlegen.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fehler beim Anlegen des Superadministrator-Kontos:', err);
  process.exit(1);
});
