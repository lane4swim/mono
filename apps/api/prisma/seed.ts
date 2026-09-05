// apps/api/prisma/seed.ts
//
// Seed-Skript "analog seed.js" (Phase-2-Auftrag, siehe docs/backend-plan.md
// Abschnitt 11). Spiegelt bewusst dieselben Demo-Daten wie
// apps/web/js/seed.js, damit Frontend-Demo und Backend-Demo inhaltlich
// zueinander passen, sobald Phase 4 (Frontend-Integration) beide verbindet.
//
// Aufbau in zwei Teilen:
//   - buildDemoData(): reine Funktion, erzeugt ausschließlich Plain-
//     JavaScript-Objekte mit bereits aufgelösten Querverweisen (z. B.
//     athlete.groupId zeigt auf eine tatsächlich in derselben Rückgabe
//     enthaltene Gruppe). Braucht KEINE Datenbank — dadurch lässt sich die
//     referenzielle Integrität der Demo-Daten mit einem reinen Unit-Test
//     prüfen (siehe test/prisma/seedData.test.ts).
//   - main(): nimmt das Ergebnis von buildDemoData() und schreibt es via
//     Prisma in die Datenbank. Läuft über `npx prisma db seed` bzw.
//     `npm run prisma:seed` — braucht eine echte Postgres-Verbindung.
import { randomUUID, randomBytes } from 'node:crypto';
import { MODULE_KEYS, type SetEntry } from '@lane1/shared-types';

function id(): string {
  return randomUUID();
}

// Sicherheitskorrektur (Sicherheitsreview 2026-08-28, Befund H1): vormals
// ein fest im Repository stehendes, für alle vier Demo-Konten (inkl.
// Superadmin) identisches Passwort ('ChangeMe123!') — jeder, der dieses
// Repository lesen kann, kannte damit auch die Zugangsdaten eines
// Superadmin-Kontos auf JEDER Installation, gegen die dieses Skript
// versehentlich lief. Stattdessen ein bei jedem Lauf frisch erzeugtes,
// zufälliges Passwort (128 Bit Entropie) — geteilt über alle vier
// Demo-Konten (bewusst wie zuvor, der Demo-Zweck braucht keine separaten
// Passwörter), aber nie im Quellcode sichtbar. main() gibt es unten
// genau einmal in der Konsolenausgabe aus.
function randomDemoPassword(): string {
  return randomBytes(16).toString('base64url');
}

function isoDate(date: Date): string {
  return date.toISOString();
}
function todayISO(): string {
  return isoDate(new Date());
}
function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}
function startOfWeek(iso: string): string {
  const d = new Date(iso);
  const day = (d.getDay() + 6) % 7; // Montag = 0
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return isoDate(d);
}

export function buildDemoData() {
  const club = { id: id(), name: 'Demo Schwimmverein e.V.' };

  const groupA = { id: id(), clubId: club.id, name: 'Leistungsgruppe', description: 'Wettkampforientierte Athlet:innen, 6–8 Einheiten/Woche' };
  const groupB = { id: id(), clubId: club.id, name: 'Nachwuchs', description: 'Aufbaugruppe, Technik- und Grundlagenausbildung' };
  const groups = [groupA, groupB];

  const athletes = [
    { id: id(), clubId: club.id, firstName: 'Mara', lastName: 'Vogel', birthdate: '2009-03-14', gender: 'w', groupId: groupA.id, joinDate: '2019-08-01', active: true, notes: '' },
    { id: id(), clubId: club.id, firstName: 'Jonas', lastName: 'Brandt', birthdate: '2008-11-02', gender: 'm', groupId: groupA.id, joinDate: '2018-02-15', active: true, notes: 'Schwerpunkt Sprint' },
    { id: id(), clubId: club.id, firstName: 'Elif', lastName: 'Kaya', birthdate: '2010-06-22', gender: 'w', groupId: groupA.id, joinDate: '2020-01-10', active: true, notes: '' },
    { id: id(), clubId: club.id, firstName: 'Lukas', lastName: 'Weber', birthdate: '2011-09-05', gender: 'm', groupId: groupB.id, joinDate: '2021-09-01', active: true, notes: '' },
    { id: id(), clubId: club.id, firstName: 'Nele', lastName: 'Schuster', birthdate: '2012-01-30', gender: 'w', groupId: groupB.id, joinDate: '2022-03-01', active: true, notes: '' },
    { id: id(), clubId: club.id, firstName: 'Finn', lastName: 'Hartmann', birthdate: '2011-04-18', gender: 'm', groupId: groupB.id, joinDate: '2021-05-20', active: true, notes: 'Rückenschwimmen ausbauen' },
  ];

  const demoPassword = randomDemoPassword();
  const superAdminUser = { id: id(), clubId: null as string | null, name: 'System-Superadmin', role: 'superadmin', athleteId: null as string | null, email: 'superadmin@example.org', locale: 'de-DE', password: demoPassword };
  const trainerUser = { id: id(), clubId: club.id, name: 'Sabine Reuter', role: 'trainer', athleteId: null as string | null, email: 'sabine.reuter@example.org', locale: 'de-DE', password: demoPassword };
  const adminUser = { id: id(), clubId: club.id, name: 'Team-Administrator', role: 'admin', athleteId: null as string | null, email: 'admin@example.org', locale: 'de-DE', password: demoPassword };
  const athleteUser = { id: id(), clubId: club.id, name: `${athletes[0]!.firstName} ${athletes[0]!.lastName}`, role: 'athlete', athleteId: athletes[0]!.id, email: 'mara.vogel@example.org', locale: 'en-US', password: demoPassword };
  const users = [superAdminUser, trainerUser, adminUser, athleteUser];

  const exercises = [
    { id: id(), clubId: club.id, name: 'Kraulbeine mit Brett', category: 'kick', stroke: 'Freistil', description: 'Beinarbeit isoliert mit Schwimmbrett, Fokus auf Hüftrotation.', defaultDistance: 200, tags: ['aufwärmen'], equipment: ['brett'] },
    { id: id(), clubId: club.id, name: '6-Schlag-Drill', category: 'technik', stroke: 'Freistil', description: 'Kraul mit betonter 6-Schlag-Beinachse pro Armzug.', defaultDistance: 100, tags: ['technik'], equipment: [] },
    { id: id(), clubId: club.id, name: 'Wendenserie', category: 'start-wende', stroke: 'Freistil', description: 'Kraulwenden mit Abstoß und Unterwasserphase, je 15m Anschwimmen.', defaultDistance: 25, tags: ['wende'], equipment: [] },
    { id: id(), clubId: club.id, name: 'Startsprünge', category: 'start-wende', stroke: 'Freistil', description: 'Blockstarts mit Reaktionszeitmessung, 15m Ausschwimmen.', defaultDistance: 15, tags: ['start'], equipment: ['startblock'] },
    { id: id(), clubId: club.id, name: 'Brustbeinarbeit am Brett', category: 'kick', stroke: 'Brust', description: 'Isolierte Brustbeinarbeit, Fokus auf Peitschenbewegung.', defaultDistance: 200, tags: [], equipment: ['brett'] },
    { id: id(), clubId: club.id, name: 'Fahrtspiel 400', category: 'ausdauer', stroke: 'Freistil', description: '400m im Wechsel 50 locker / 50 zügig.', defaultDistance: 400, tags: ['ausdauer'], equipment: [] },
    { id: id(), clubId: club.id, name: 'Sprints 25m all-out', category: 'sprint', stroke: 'Freistil', description: 'Maximale Sprints mit voller Erholung dazwischen.', defaultDistance: 25, tags: ['sprint'], equipment: ['paddles', 'kurzflossen'] },
    { id: id(), clubId: club.id, name: 'Lagenwechsel-Drill', category: 'koordination', stroke: 'Lagen', description: '4x25 je Lage mit Fokus auf Übergänge.', defaultDistance: 100, tags: [], equipment: [] },
    { id: id(), clubId: club.id, name: 'Bilaterales Atmen', category: 'atmung', stroke: 'Freistil', description: 'Kraul mit Atmung alle 3 Züge zur Symmetrieschulung.', defaultDistance: 200, tags: ['technik'], equipment: ['schnorchel'] },
    { id: id(), clubId: club.id, name: 'Trockenkraft Rumpf', category: 'kraft', stroke: null as string | null, description: 'Zirkel: Plank, Superman, Seitstütz, je 3 Runden.', defaultDistance: null as number | null, tags: ['land'], equipment: ['medizinball'] },
  ];
  const kickboardEx = exercises.find((e) => e.name === 'Kraulbeine mit Brett')!;
  const sprintEx = exercises.find((e) => e.name === 'Sprints 25m all-out')!;

  const template1 = {
    id: id(), clubId: club.id, name: 'Grundlagenausdauer – Standardwoche', description: 'Klassische GA1/GA2-Einheit für die Basisperiode.',
    tags: ['ausdauer', 'basis'],
    sets: [
      { kind: 'set' as const, id: id(), description: 'Einschwimmen gemischt', distance: 400, reps: 1, intensity: 'locker', restSec: 0, comments: [] },
      { kind: 'set' as const, id: id(), description: '8x100 Freistil', distance: 100, reps: 8, intensity: 'ga1', restSec: 20, comments: [] },
      { kind: 'set' as const, id: id(), description: '4x50 Beine', distance: 50, reps: 4, intensity: 'locker', restSec: 15, exerciseId: kickboardEx.id, comments: [] },
      { kind: 'set' as const, id: id(), description: 'Ausschwimmen', distance: 200, reps: 1, intensity: 'locker', restSec: 0, comments: [] },
    ],
  };
  const template2 = {
    id: id(), clubId: club.id, name: 'Sprint & Wenden', description: 'Kurze, intensive Serien mit Fokus auf Renntempo.',
    tags: ['sprint', 'wettkampf'],
    sets: [
      { kind: 'set' as const, id: id(), description: 'Einschwimmen', distance: 300, reps: 1, intensity: 'locker', restSec: 0, comments: [] },
      {
        kind: 'block' as const, id: id(), label: 'Hauptserie Sprint', repeatCount: 3,
        sets: [
          { kind: 'set' as const, id: id(), description: '2x25 Sprint ab Wende', distance: 25, reps: 2, intensity: 'sprint', restSec: 30, exerciseId: sprintEx.id, comments: [] },
          { kind: 'set' as const, id: id(), description: '50 locker ausschwimmen', distance: 50, reps: 1, intensity: 'locker', restSec: 20, comments: [] },
        ],
      },
      { kind: 'set' as const, id: id(), description: '4x50 Renntempo', distance: 50, reps: 4, intensity: 'renotempo', restSec: 40, comments: [] },
      { kind: 'set' as const, id: id(), description: 'Ausschwimmen locker', distance: 150, reps: 1, intensity: 'locker', restSec: 0, comments: [] },
    ],
  };
  const templates = [template1, template2];

  function cloneSets(sets: SetEntry[]): SetEntry[] {
    return sets.map((s) =>
      s.kind === 'block'
        ? { ...s, id: id(), sets: s.sets.map((x) => ({ ...x, id: id() })) }
        : { ...s, id: id() },
    );
  }

  const wkStart = startOfWeek(todayISO());
  const plan1 = {
    id: id(), clubId: club.id, name: `Trainingswoche ${wkStart.slice(0, 10)}`, weekStart: wkStart, groupId: groupA.id, status: 'aktiv',
    days: [
      { date: wkStart, sets: cloneSets(template1.sets) },
      { date: addDays(wkStart, 2), sets: cloneSets(template2.sets) },
      { date: addDays(wkStart, 4), sets: cloneSets(template1.sets) },
    ],
  };
  const plans = [plan1];

  const groupAAthletes = athletes.filter((a) => a.groupId === groupA.id);
  const session1 = {
    id: id(), clubId: club.id, date: wkStart, groupId: groupA.id, planId: plan1.id, trainerNote: 'Gute Energie, Fokus auf Wenden verbessert.',
    attendance: groupAAthletes.map((a) => ({ athleteId: a.id, present: true, rpe: 7, note: '' })),
  };
  const session2 = {
    id: id(), clubId: club.id, date: addDays(wkStart, -7), groupId: groupA.id, planId: null as string | null, trainerNote: 'Eine Athletin krank gemeldet.',
    attendance: groupAAthletes.map((a, i) => ({ athleteId: a.id, present: i !== 2, rpe: i !== 2 ? 7 : null, note: i === 2 ? 'Krankheit' : '' })),
  };
  const sessions = [session1, session2];

  // assignedTrainerId: standardmäßig die/der Erfasser:in (siehe
  // apps/web/js/modules/actionItems.js: openItemModal) — hier exemplarisch
  // Sabine Reuter (trainerUser) für die ersten beiden, und der Admin für
  // das dritte (zeigt, dass auch ein Admin-Konto zuständig sein kann).
  const actionItems = [
    { id: id(), clubId: club.id, athleteId: athletes[1]!.id, title: 'Atemtechnik bei Sprints', description: 'Neigt zum Luftanhalten in den letzten 15m. Bilaterales Atmen in Drills festigen.', status: 'progress', category: 'technik', assignedTrainerId: trainerUser.id, createdDate: addDays(todayISO(), -14), dueDate: addDays(todayISO(), 14) },
    { id: id(), clubId: club.id, athleteId: athletes[5]!.id, title: 'Rückenlage stabilisieren', description: 'Hüfte sinkt bei längeren Rückenserien ab. Rumpfkraft priorisieren.', status: 'offen', category: 'technik', assignedTrainerId: trainerUser.id, createdDate: addDays(todayISO(), -5), dueDate: addDays(todayISO(), 25) },
    { id: id(), clubId: club.id, athleteId: athletes[0]!.id, title: 'Wettkampf-Nervosität', description: 'Zeigt vor Wettkämpfen erhöhte Anspannung. Mentale Routine erarbeiten.', status: 'offen', category: 'mental', assignedTrainerId: adminUser.id, createdDate: addDays(todayISO(), -3), dueDate: addDays(todayISO(), 20) },
  ];

  const competition1 = { id: id(), clubId: club.id, name: 'Bezirksmeisterschaften Kurzbahn', date: addDays(todayISO(), 21), location: 'Hallenbad Nord', course: 'SCM', notes: 'Meldeschluss 10 Tage vorher' };
  const competition2 = { id: id(), clubId: club.id, name: 'Vereinsvergleich Frühjahr', date: addDays(todayISO(), -18), location: 'Freibad Ost', course: 'LCM', notes: '' };
  const competitions = [competition1, competition2];

  return { club, groups, athletes, users, exercises, templates, plans, sessions, actionItems, competitions };
}

// ---- Prisma-Runner (braucht eine echte Datenbankverbindung) --------------
//
// Sicherheitskorrektur (Sicherheitsreview 2026-08-28, Befund H1): dieses
// Skript legt u. a. ein Superadmin-Konto an (siehe buildDemoData() oben)
// — auf einer Produktivinstanz höbe das die gesamte einladungsbasierte
// Registrierung aus. Zwei unabhängige Sicherungen, ANALOG zu den
// bestehenden Produktionsprüfungen in config/env.ts:
//   1. NODE_ENV=production bricht immer ab, ohne Umgehungsmöglichkeit —
//      Demo-Daten gehören nie auf eine Produktivinstanz.
//   2. Unabhängig davon (auch außerhalb von NODE_ENV=production) eine
//      explizite Bestätigung per Umgebungsvariable verlangen — fängt
//      einen versehentlichen Lauf gegen die falsche DATABASE_URL ab (z. B.
//      eine lokal exportierte Produktions-.env), den NODE_ENV allein
//      nicht verhindern würde. Bewusst eine Umgebungsvariable statt eines
//      CLI-Arguments (analog zu SUPERADMIN_PASSWORD in
//      setup-codespace.sh): "npm run prisma:seed" ruft intern
//      `prisma db seed` auf, das zusätzliche CLI-Argumente nur über eine
//      eigene, hier vermeidbare "--"-Verkettung durchreicht — eine
//      Umgebungsvariable erreicht diesen Prozess unabhängig davon, wie
//      viele Wrapper dazwischenliegen.
function assertSafeToSeed(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Abgebrochen: NODE_ENV=production. Dieses Skript legt Demo-Daten inkl. eines ' +
        'Superadmin-Kontos an und darf niemals gegen eine Produktivdatenbank laufen. ' +
        'Für den echten Superadmin-Bootstrap siehe apps/api/scripts/createSuperAdmin.ts.',
    );
  }
  if (process.env.SEED_CONFIRM !== 'yes-demo-data') {
    throw new Error(
      'Abgebrochen: fehlende Bestätigung. Dieses Skript legt Demo-Daten inkl. eines ' +
        'Superadmin-Kontos an — bitte erst prüfen, dass DATABASE_URL tatsächlich auf eine ' +
        'leere Entwicklungsdatenbank zeigt, und den Lauf dann explizit bestätigen:\n' +
        '  SEED_CONFIRM=yes-demo-data npm run prisma:seed --workspace=apps/api',
    );
  }
}

async function main() {
  assertSafeToSeed();

  const { PrismaClient } = await import('@prisma/client');
  const { hashPassword } = await import('../src/auth/password.js');
  const prisma = new PrismaClient();

  const data = buildDemoData();

  try {
    await prisma.club.create({ data: { id: data.club.id, name: data.club.name, enabledModules: MODULE_KEYS } });
    await prisma.group.createMany({ data: data.groups });
    await prisma.athlete.createMany({ data: data.athletes.map((a) => ({ ...a, birthdate: new Date(a.birthdate), joinDate: new Date(a.joinDate) })) });

    for (const user of data.users) {
      const passwordHash = await hashPassword(user.password);
      await prisma.user.create({
        data: {
          id: user.id, clubId: user.clubId, name: user.name, email: user.email,
          passwordHash, role: user.role, roles: [user.role], athleteId: user.athleteId, locale: user.locale,
        },
      });
    }

    await prisma.exercise.createMany({ data: data.exercises });
    await prisma.template.createMany({ data: data.templates.map((t) => ({ id: t.id, clubId: t.clubId, name: t.name, description: t.description, tags: t.tags, sets: t.sets })) });
    await prisma.plan.createMany({ data: data.plans.map((p) => ({ id: p.id, clubId: p.clubId, name: p.name, weekStart: new Date(p.weekStart), groupId: p.groupId, status: p.status, days: p.days })) });
    await prisma.trainingSession.createMany({ data: data.sessions.map((s) => ({ id: s.id, clubId: s.clubId, date: new Date(s.date), groupId: s.groupId, planId: s.planId, trainerNote: s.trainerNote, attendance: s.attendance })) });
    await prisma.actionItem.createMany({ data: data.actionItems.map((a) => ({ ...a, createdDate: new Date(a.createdDate), dueDate: a.dueDate ? new Date(a.dueDate) : null })) });
    await prisma.competition.createMany({ data: data.competitions.map((c) => ({ ...c, date: new Date(c.date) })) });

    console.log(`✔ Demo-Daten eingefügt: 1 Verein, ${data.athletes.length} Athlet:innen, ${data.users.length} Nutzer:innen, ${data.exercises.length} Übungen, ${data.templates.length} Vorlagen, ${data.plans.length} Plan(e), ${data.sessions.length} Einheit(en), ${data.actionItems.length} Handlungsfeld(er), ${data.competitions.length} Wettkampf/-kämpfe.`);
    // Sicherheitsreview 2026-08-28, Befund H1: alle vier Demo-Konten
    // (inkl. Superadmin) teilen sich das oben zufällig erzeugte
    // demoPassword — dieses erscheint NUR hier in der Konsolenausgabe des
    // aktuellen Laufs, nirgends im Quellcode. Alle vier Logins aufgeführt
    // (nicht mehr nur das Admin-Konto), da sonst insbesondere der
    // Superadmin-Zugang nach diesem Lauf nirgends mehr nachlesbar wäre.
    console.log('   Demo-Logins (bitte nach dem ersten Login jeweils das Passwort ändern):');
    for (const user of data.users) {
      console.log(`     ${user.role.padEnd(10)} ${user.email} / ${user.password}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  main().catch((err) => {
    console.error('Fehler beim Einfügen der Demo-Daten:', err);
    process.exit(1);
  });
}
