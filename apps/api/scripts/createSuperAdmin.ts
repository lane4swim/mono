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
//   npm run create-superadmin -- --email=admin@verein-dachverband.de --name="Max Mustermann"
//
// Sicherheitsreview 2026-08-28, Befund M1 (offen aus Vorreview N2/N6):
// das Passwort wird bewusst NICHT als Kommandozeilenargument entgegen-
// genommen — Argumente eines laufenden Prozesses sind auf Linux über
// /proc/<pid>/cmdline für JEDEN lokalen Benutzer lesbar, für die gesamte
// (bei argon2id mit 64 MiB Speicherkosten nicht ganz kurze) Laufzeit
// dieses Skripts, landen zusätzlich in der Shell-History und in npms
// eigener Protokollierung. Stattdessen entweder per Umgebungsvariable
// SUPERADMIN_PASSWORD (z. B. für einen nicht-interaktiven Lauf, siehe
// scripts/setup-codespace.sh, das diese Variable bereits selbst sicher —
// per `read -s` — einliest) oder, wenn diese leer ist, interaktiv ohne
// Terminal-Echo abgefragt (mit Bestätigung, siehe resolvePassword()
// unten).
//
// Sicherheitsreview 2026-08-28, Befund M2: ein späteres Löschen dieser
// Datei ist keine wirksame Zugangskontrolle (wer sie ausführen kann, hat
// bereits Shell-Zugriff auf den Server und damit ohnehin direkten
// Datenbankzugriff) und kostet den einzigen Wiederherstellungsweg, falls
// das Superadmin-Konto je verloren geht (keine HTTP-Route legt eines an,
// InvitationRoleSchema schließt "superadmin" von der Einladung aus). Das
// Skript bleibt daher bestehen, gehärtet stattdessen dort, wo es
// tatsächlich zählt: kein Passwort mehr als Argument (siehe oben), ein
// Selbstschutz gegen unbeabsichtigte Mehrfachanlage (siehe --force
// unten) und eine validierte E-Mail-Adresse.
//
// Bewusst NICHT über eine HTTP-Route — ein Endpoint, der frei Superadmin-
// Konten anlegen könnte, wäre selbst ein Sicherheitsrisiko.
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { hashPassword } from '../src/auth/password.js';

const USAGE =
  'Verwendung: npm run create-superadmin -- --email=<email> --name="<Name>" [--force]\n' +
  'Das Passwort wird NICHT als Argument angegeben, sondern per Umgebungsvariable ' +
  'SUPERADMIN_PASSWORD oder interaktiv (ohne Terminal-Echo) abgefragt.';

function parseArgs(argv: string[]): { options: Record<string, string>; flags: Set<string> } {
  const options: Record<string, string> = {};
  const flags = new Set<string>();
  for (const arg of argv) {
    const optionMatch = /^--([^=]+)=(.*)$/.exec(arg);
    if (optionMatch) {
      options[optionMatch[1]!] = optionMatch[2]!;
      continue;
    }
    const flagMatch = /^--([^=]+)$/.exec(arg);
    if (flagMatch) flags.add(flagMatch[1]!);
  }
  return { options, flags };
}

// Liest EINE Zeile interaktiv ein, ohne sie auf dem Terminal anzuzeigen —
// Node bietet dafür kein eingebautes Äquivalent zu `read -s`, daher der
// manuelle Raw-Mode-Umweg (analog zum bereits vorhandenen `read -rsp` in
// scripts/setup-codespace.sh, das dieselbe Bestätigungs-Logik in Bash
// abbildet). Erwartet, dass stdin bereits im Raw-Modus ist — resolvePassword()
// unten setzt das EINMAL für die gesamte Eingabe-/Bestätigungs-Sequenz,
// statt bei jedem einzelnen Aufruf dieser Funktion an- und wieder
// auszuschalten: ein Toggle je Aufruf öffnete zwischen zwei Prompts ein
// kurzes Zeitfenster mit deaktiviertem Raw-Modus, in dem eine sehr schnell
// eingegebene/eingefügte Eingabe (z. B. aus einem Passwort-Manager) doch
// echoed bzw. nicht zeichenweise zugestellt worden wäre.
function readHiddenLine(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(promptText);
    let value = '';

    const onData = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      for (const char of text) {
        if (char === '\n' || char === '\r') {
          stdin.removeListener('data', onData);
          process.stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          // Strg+C — wie ein normaler Interrupt beenden, nicht nur die
          // Eingabe abbrechen. Raw-Modus hier explizit zurücksetzen:
          // process.exit() lässt das umgebende `finally` in
          // resolvePassword() nicht mehr laufen.
          stdin.setRawMode(false);
          process.stdout.write('\n');
          process.exit(130);
        }
        if (char === '\u007f' || char === '\b') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    stdin.on('data', onData);
  });
}

// Env-Variable hat Vorrang (nicht-interaktiver Lauf, z. B. per
// scripts/setup-codespace.sh, das die Variable bereits selbst sicher
// einliest); sonst interaktive, maskierte Eingabe mit Bestätigung —
// wiederholt bei zu kurzem Passwort oder abweichender Bestätigung, analog
// zur `while true`-Schleife in scripts/setup-codespace.sh. Bricht klar ab,
// wenn stdin kein TTY ist (z. B. eine Pipe/ein nicht-interaktiver CI-Lauf)
// — für diesen Fall ist SUPERADMIN_PASSWORD der vorgesehene Weg.
async function resolvePassword(): Promise<string> {
  const fromEnv = process.env.SUPERADMIN_PASSWORD;
  if (fromEnv) return fromEnv;

  const stdin = process.stdin;
  if (!stdin.isTTY) {
    throw new Error(
      'Kein interaktives Terminal verfügbar — bitte SUPERADMIN_PASSWORD als Umgebungsvariable setzen.',
    );
  }

  stdin.setRawMode(true);
  stdin.resume();
  try {
    for (;;) {
      const first = await readHiddenLine('Superadmin-Passwort (mind. 8 Zeichen, wird nicht angezeigt): ');
      if (first.length < 8) {
        console.error('Das Passwort muss mindestens 8 Zeichen lang sein — bitte erneut eingeben.');
        continue;
      }
      const second = await readHiddenLine('Superadmin-Passwort (Bestätigung): ');
      if (first !== second) {
        console.error('Die beiden Eingaben stimmen nicht überein — bitte erneut eingeben.');
        continue;
      }
      return first;
    }
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
  }
}

async function main() {
  const { options, flags } = parseArgs(process.argv.slice(2));
  const { email, name } = options;

  if (!email || !name) {
    console.error(USAGE);
    process.exit(1);
  }

  // Sicherheitsreview 2026-08-28, Befund M2, Empfehlung 3: bislang wurde
  // jeder beliebige String als E-Mail-Adresse akzeptiert und dauerhaft
  // gespeichert — konsistent zu z.string().email() an allen übrigen
  // Stellen des Systems (siehe z. B. LoginRequestSchema).
  const emailCheck = z.string().email().safeParse(email);
  if (!emailCheck.success) {
    console.error(`"${email}" ist keine gültige E-Mail-Adresse.`);
    process.exit(1);
  }
  const validEmail = emailCheck.data;

  let password: string;
  try {
    password = await resolvePassword();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  // Deckt den Fall SUPERADMIN_PASSWORD=<zu kurz> ab — die interaktive
  // Eingabe in resolvePassword() prüft die Länge bereits vor der
  // Bestätigung, ein per Umgebungsvariable vorgegebener Wert durchläuft
  // diese Prüfung sonst gar nicht.
  if (password.length < 8) {
    console.error('Das Passwort muss mindestens 8 Zeichen lang sein.');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const existingByEmail = await prisma.user.findUnique({ where: { email: validEmail } });
    if (existingByEmail) {
      console.error(`Es existiert bereits ein Konto mit der E-Mail-Adresse "${validEmail}".`);
      process.exit(1);
    }

    // Sicherheitsreview 2026-08-28, Befund M2, Empfehlung 2: verhindert
    // eine unbeabsichtigte Mehrfachanlage (z. B. ein zweiter Lauf mit
    // versehentlich abweichender E-Mail-Adresse) — vormals prüfte dieses
    // Skript ausschließlich, ob die ANGEGEBENE E-Mail-Adresse bereits
    // vergeben war, nie ob bereits IRGENDEIN Superadmin-Konto existiert.
    // --force für den bewussten Ausnahmefall (z. B. ein zusätzliches
    // Notfall-Konto für einen zweiten Dachverband auf derselben Instanz).
    if (!flags.has('force')) {
      const existingSuperadmin = await prisma.user.findFirst({ where: { role: 'superadmin' } });
      if (existingSuperadmin) {
        console.error(
          `Es existiert bereits ein Superadmin-Konto (${existingSuperadmin.email}). ` +
            'Für den bewussten Ausnahmefall (z. B. ein zusätzliches Notfall-Konto) --force anhängen.',
        );
        process.exit(1);
      }
    }

    const passwordHash = await hashPassword(password);
    const user = await prisma.user.create({
      data: {
        clubId: null,
        name,
        email: validEmail,
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
