// apps/api/test-integration/profileErasure.integration.test.ts
//
// Prüft PrismaProfileDataGateway und PrismaErasureJobGateway (den
// zweiteiligen DSGVO-Löschprozess, Art. 15/17) gegen eine echte Datenbank
// (siehe vitest.integration.config.ts). Deckt insbesondere zwei zuvor per
// Code-Review behobene Regressionen ab, die sich nur gegen eine echte
// Transaktions-/Abfrage-Semantik verlässlich prüfen lassen:
//   - Befund 5: requestErasure() legt den DataDeletionRequest in
//     DERSELBEN Transaktion wie den Soft-Delete an.
//   - Befund 11: ein `clubId ?? undefined`-Fallback hätte in Prisma "kein
//     Filter" bedeutet — hier absichtlich mit einem invariantenwidrigen
//     Nutzer (athleteId gesetzt, clubId null) geprüft, dass die
//     Trainingseinheiten ANDERER Vereine dadurch weder gelesen noch
//     verändert werden.
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaProfileDataGateway, ErasureAlreadyRequestedError } from '../src/modules/profile/profile.repository.js';
import { PrismaErasureJobGateway } from '../src/jobs/erasure.repository.js';
import { getTestPrisma, closeTestPrisma, truncateAll, createTestClub } from './helpers.js';

const prisma = getTestPrisma();
const profileGateway = new PrismaProfileDataGateway(prisma);
const erasureGateway = new PrismaErasureJobGateway(prisma);

afterEach(async () => {
  await truncateAll();
});
afterAll(async () => {
  await closeTestPrisma();
});

async function seedAthleteUser(clubId: string | null) {
  const athlete = clubId
    ? await prisma.athlete.create({ data: { clubId, firstName: 'Mara', lastName: 'Vogel' } })
    : null;
  const user = await prisma.user.create({
    data: {
      clubId,
      name: 'Mara Vogel',
      email: `mara-${randomUUID()}@example.org`,
      passwordHash: 'hash',
      role: 'athlete',
      athleteId: athlete?.id ?? null,
    },
  });
  return { user, athlete };
}

describe('PrismaProfileDataGateway.requestErasure()', () => {
  it('legt Soft-Delete UND DataDeletionRequest atomar in einer Transaktion an', async () => {
    const club = await createTestClub();
    const { user, athlete } = await seedAthleteUser(club.id);
    await prisma.result.create({ data: { clubId: club.id, athleteId: athlete!.id, event: '100m Freistil', time: 60, date: new Date() } });

    const result = await profileGateway.requestErasure(user.id, 30);
    expect(result.id).toBeTruthy();

    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updatedUser?.deletedAt).not.toBeNull();
    const updatedAthlete = await prisma.athlete.findUnique({ where: { id: athlete!.id } });
    expect(updatedAthlete?.deletedAt).not.toBeNull();
    const deletionRequest = await prisma.dataDeletionRequest.findUnique({ where: { userId: user.id } });
    expect(deletionRequest).not.toBeNull();
  });

  it('lehnt eine zweite Löschanfrage für dasselbe Konto ab', async () => {
    const club = await createTestClub();
    const { user } = await seedAthleteUser(club.id);
    await profileGateway.requestErasure(user.id, 30);

    await expect(profileGateway.requestErasure(user.id, 30)).rejects.toBeInstanceOf(ErasureAlreadyRequestedError);
  });
});

describe('PrismaProfileDataGateway.exportUserData() — Befund-11-Regression', () => {
  it('liefert leere Anwesenheitsdaten, statt Trainingseinheiten fremder Vereine zu lesen, wenn clubId fehlt', async () => {
    const clubA = await createTestClub(prisma, 'Verein A');
    // Invariantenwidriger Zustand (sollte im Betrieb nie vorkommen, siehe
    // Kommentar bei profile.repository.ts: exportUserData()): athleteId
    // gesetzt, aber clubId null.
    const { user } = await seedAthleteUser(null);
    await prisma.trainingSession.create({
      data: { clubId: clubA.id, date: new Date(), attendance: [{ athleteId: 'irgendjemand', present: true }] },
    });

    const exportResult = await profileGateway.exportUserData(user.id);
    // Vor der Korrektur hätte `clubId: undefined` in Prisma "kein Filter"
    // bedeutet — die obige, fremde Trainingseinheit wäre geladen worden.
    expect(exportResult.attendance).toEqual([]);
  });
});

// Code-Review, Befund P3: exportUserData() lud vormals ALLE
// Trainingseinheiten des Vereins (findMany({ where: { clubId } })), nur
// um daraus per JS-.find() die Anwesenheitszeile EINER Person
// herauszufiltern — analog zur C4-Korrektur in erasure.repository.ts
// grenzt eine JSONB-Containment-Bedingung (`@>`) die Abfrage direkt in
// Postgres auf die tatsächlich betroffenen Zeilen ein.
describe('PrismaProfileDataGateway.exportUserData() — kein club-weiter Scan (Code-Review, Befund P3)', () => {
  it('liefert weiterhin genau die Anwesenheitszeilen dieser Person, unabhängig von der Zahl unbeteiligter Einheiten im Verein', async () => {
    const club = await createTestClub();
    const { user, athlete } = await seedAthleteUser(club.id);

    for (let i = 0; i < 50; i++) {
      await prisma.trainingSession.create({
        data: { clubId: club.id, date: new Date(), attendance: [{ athleteId: randomUUID(), present: true }] },
      });
    }
    const affectedA = await prisma.trainingSession.create({
      data: { clubId: club.id, date: new Date('2026-06-01'), attendance: [{ athleteId: athlete!.id, present: true, rpe: 7 }] },
    });
    const affectedB = await prisma.trainingSession.create({
      data: { clubId: club.id, date: new Date('2026-06-08'), attendance: [{ athleteId: athlete!.id, present: false, rpe: 3 }] },
    });

    const result = await profileGateway.exportUserData(user.id);

    expect(result.attendance).toHaveLength(2);
    expect(result.attendance.map((a) => a.sessionId).sort()).toEqual([affectedA.id, affectedB.id].sort());
  });

  // Der eigentliche Regressionstest: beweist, dass die Abfrage NICHT mehr
  // club-weit skaliert. Statt einer laufzeitbasierten Prüfung (in CI je
  // nach Auslastung unzuverlässig) wird gezählt, WIE VIELE Zeilen die
  // SQL-Abfrage gegen "sessions" tatsächlich zurückliefert — unabhängig
  // von der Zahl unbeteiligter Einheiten im Verein darf es dafür genau so
  // viele sein, wie diese Person tatsächlich betreffen, nicht die
  // Gesamtzahl der Einheiten des Vereins.
  it('liest von "sessions" nur so viele Zeilen, wie diese Person tatsächlich betreffen, nicht alle Einheiten des Vereins', async () => {
    const club = await createTestClub();
    const { user, athlete } = await seedAthleteUser(club.id);

    for (let i = 0; i < 50; i++) {
      await prisma.trainingSession.create({
        data: { clubId: club.id, date: new Date(), attendance: [{ athleteId: randomUUID(), present: true }] },
      });
    }
    for (let i = 0; i < 3; i++) {
      await prisma.trainingSession.create({
        data: { clubId: club.id, date: new Date(), attendance: [{ athleteId: athlete!.id, present: true }] },
      });
    }

    const instrumented = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
    const queries: string[] = [];
    instrumented.$on('query' as never, (e: { query: string }) => queries.push(e.query));
    let exportResult;
    try {
      const instrumentedGateway = new PrismaProfileDataGateway(instrumented);
      exportResult = await instrumentedGateway.exportUserData(user.id);
    } finally {
      await instrumented.$disconnect();
    }

    const sessionQueries = queries.filter((q) => q.includes('"sessions"'));
    expect(sessionQueries).toHaveLength(1);
    expect(sessionQueries[0]).toMatch(/^\s*SELECT/);
    // Der eigentliche Beweis: die Abfrage filtert per JSONB-Containment
    // (`@>`) direkt in Postgres, statt (wie vor der Korrektur) nur nach
    // "clubId" zu filtern und ALLE 53 Einheiten des Vereins zu laden.
    expect(sessionQueries[0]).toContain('@>');
    // 53 Einheiten insgesamt existieren im Verein, aber nur 3 betreffen
    // diese Person — genau die 3 kommen im Export an.
    expect(exportResult.attendance).toHaveLength(3);
  });
});

describe('PrismaErasureJobGateway.purgeUserAndDependents()', () => {
  it('löscht unwiderruflich RefreshTokens/Athlet:innen-Profil samt abhängiger Daten und legt Tombstones an', async () => {
    const club = await createTestClub();
    const { user, athlete } = await seedAthleteUser(club.id);
    await prisma.refreshToken.create({ data: { userId: user.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 1000) } });
    const result = await prisma.result.create({ data: { clubId: club.id, athleteId: athlete!.id, event: '100m Freistil', time: 60, date: new Date() } });
    const session = await prisma.trainingSession.create({
      data: { clubId: club.id, date: new Date(), attendance: [{ athleteId: athlete!.id, present: true }, { athleteId: 'andere-person', present: false }] },
    });

    await erasureGateway.purgeUserAndDependents(user.id);

    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.athlete.findUnique({ where: { id: athlete!.id } })).toBeNull();
    expect(await prisma.result.findUnique({ where: { id: result.id } })).toBeNull();
    expect(await prisma.refreshToken.findMany({ where: { userId: user.id } })).toEqual([]);

    // Die Anwesenheit der gelöschten Person wurde aus der Einheit entfernt,
    // die der anderen Person bleibt erhalten.
    const updatedSession = await prisma.trainingSession.findUnique({ where: { id: session.id } });
    expect(updatedSession?.attendance).toEqual([{ athleteId: 'andere-person', present: false }]);

    // Tombstone für den gelöschten Athleten UND das gelöschte Ergebnis.
    const tombstones = await prisma.syncTombstone.findMany({ where: { clubId: club.id } });
    expect(tombstones.map((t) => `${t.store}:${t.entityId}`).sort()).toEqual(
      [`athletes:${athlete!.id}`, `results:${result.id}`].sort(),
    );
  });

  it('ist idempotent — ein bereits gelöschtes Konto führt zu keinem Fehler', async () => {
    const club = await createTestClub();
    const { user } = await seedAthleteUser(club.id);
    await erasureGateway.purgeUserAndDependents(user.id);
    await expect(erasureGateway.purgeUserAndDependents(user.id)).resolves.toBeUndefined();
  });

  // Code-Review, Befund C4: die Anwesenheits-Bereinigung lief vormals über
  // eine JS-Schleife, die ALLE Trainingseinheiten des Vereins lud und
  // einzeln per update() zurückschrieb — bei einer mehrjährigen
  // Trainingshistorie konnte allein das Laden aller Zeilen die interaktive
  // Transaktion über Prismas Standard-Timeout (5 s) treiben, und eine
  // fehlgeschlagene Transaktion lässt die Löschanfrage unverändert
  // "pending" (nächster Cron-Lauf scheitert am selben Timeout erneut —
  // niemals erfolgreicher Purge für einen einmal zu großen Verein). Ersetzt
  // durch ein einzelnes, per JSONB-Containment (`@>`) gescoptes SQL-UPDATE.
  // Diese drei Tests prüfen genau diese Korrektur, nicht nur das bereits
  // oben abgedeckte funktionale Verhalten (Anwesenheit wird entfernt,
  // andere Person bleibt erhalten).
  describe('Anwesenheits-Bereinigung ohne club-weiten Scan (Code-Review, Befund C4)', () => {
    it('bumpt "updatedAt" der geänderten Einheit, lässt eine UNBETROFFENE Einheit im selben Verein content- UND zeitstempelgleich unangetastet', async () => {
      const club = await createTestClub();
      const { user, athlete } = await seedAthleteUser(club.id);
      const affected = await prisma.trainingSession.create({
        data: { clubId: club.id, date: new Date(), attendance: [{ athleteId: athlete!.id, present: true }] },
      });
      const unrelated = await prisma.trainingSession.create({
        data: { clubId: club.id, date: new Date(), attendance: [{ athleteId: 'andere-person', present: true }] },
      });
      // Künstlich in die Vergangenheit gesetzt, damit ein späteres "hat sich
      // updatedAt verändert?" nicht durch Zeitablauf allein zufällig
      // zutrifft (beide Zeilen wurden ja gerade erst angelegt).
      await prisma.$executeRaw`UPDATE "sessions" SET "updatedAt" = ${new Date(Date.now() - 60_000)} WHERE id IN (${affected.id}, ${unrelated.id})`;
      const beforeUnrelated = await prisma.trainingSession.findUnique({ where: { id: unrelated.id } });

      await erasureGateway.purgeUserAndDependents(user.id);

      const afterAffected = await prisma.trainingSession.findUnique({ where: { id: affected.id } });
      expect(afterAffected?.attendance).toEqual([]);
      expect(afterAffected!.updatedAt.getTime()).toBeGreaterThan(beforeUnrelated!.updatedAt.getTime());

      const afterUnrelated = await prisma.trainingSession.findUnique({ where: { id: unrelated.id } });
      expect(afterUnrelated?.attendance).toEqual(beforeUnrelated?.attendance);
      expect(afterUnrelated?.updatedAt.getTime()).toBe(beforeUnrelated?.updatedAt.getTime());
    });

    it('setzt "attendance" auf ein leeres Array statt NULL, wenn die gelöschte Person der einzige Eintrag war', async () => {
      const club = await createTestClub();
      const { user, athlete } = await seedAthleteUser(club.id);
      const session = await prisma.trainingSession.create({
        data: { clubId: club.id, date: new Date(), attendance: [{ athleteId: athlete!.id, present: true }] },
      });

      await erasureGateway.purgeUserAndDependents(user.id);

      const updated = await prisma.trainingSession.findUnique({ where: { id: session.id } });
      expect(updated?.attendance).toEqual([]);
      expect(updated?.attendance).not.toBeNull();
    });

    // Der eigentliche Regressionstest: beweist, dass die Bereinigung NICHT
    // mehr club-weit skaliert. Statt einer laufzeitbasierten Prüfung (in
    // CI je nach Auslastung unzuverlässig) wird die Anzahl der
    // tatsächlich gegen "sessions" ausgeführten SQL-Anweisungen gezählt —
    // unabhängig von der Zahl unbeteiligter Einheiten darf es dafür
    // GENAU EINE geben (das gescopte UPDATE), nicht "eine Abfrage aller
    // Zeilen plus eine Aktualisierung je betroffener Zeile" wie zuvor.
    it('löst für die Anwesenheits-Bereinigung GENAU EINE SQL-Anweisung aus, unabhängig von der Zahl unbeteiligter Einheiten im Verein', async () => {
      const club = await createTestClub();
      const { user, athlete } = await seedAthleteUser(club.id);

      // 50 Einheiten, die mit der zu löschenden Person NICHTS zu tun haben.
      for (let i = 0; i < 50; i++) {
        await prisma.trainingSession.create({
          data: { clubId: club.id, date: new Date(), attendance: [{ athleteId: randomUUID(), present: true }] },
        });
      }
      // 3 tatsächlich betroffene Einheiten.
      for (let i = 0; i < 3; i++) {
        await prisma.trainingSession.create({
          data: { clubId: club.id, date: new Date(), attendance: [{ athleteId: athlete!.id, present: true }] },
        });
      }

      const instrumented = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
      const queries: string[] = [];
      instrumented.$on('query' as never, (e: { query: string }) => queries.push(e.query));
      try {
        const instrumentedGateway = new PrismaErasureJobGateway(instrumented);
        await instrumentedGateway.purgeUserAndDependents(user.id);
      } finally {
        await instrumented.$disconnect();
      }

      const sessionQueries = queries.filter((q) => q.includes('"sessions"'));
      expect(sessionQueries).toHaveLength(1);
      expect(sessionQueries[0]).toMatch(/^\s*UPDATE "sessions"/);

      // Funktional weiterhin korrekt: alle drei betroffenen Einheiten sind
      // tatsächlich bereinigt.
      const remaining = await prisma.trainingSession.findMany({ where: { clubId: club.id } });
      for (const session of remaining) {
        const attendance = session.attendance as Array<{ athleteId?: string }>;
        expect(attendance.some((a) => a.athleteId === athlete!.id)).toBe(false);
      }
    });
  });
});

describe('PrismaErasureJobGateway.findDuePendingRequests()', () => {
  it('liefert nur Anfragen, deren purgeAfter bereits erreicht ist', async () => {
    const club = await createTestClub();
    const { user: dueUser } = await seedAthleteUser(club.id);
    const { user: notYetDueUser } = await seedAthleteUser(club.id);

    const now = new Date();
    await prisma.dataDeletionRequest.create({ data: { userId: dueUser.id, purgeAfter: new Date(now.getTime() - 1000) } });
    await prisma.dataDeletionRequest.create({ data: { userId: notYetDueUser.id, purgeAfter: new Date(now.getTime() + 100_000) } });
    // Ein bereits abgearbeitetes Konto hinterlässt gar KEINE Zeile mehr
    // (weder User noch DataDeletionRequest, siehe onDelete: Cascade) —
    // anders als vor Befund R8 gibt es dafür kein separates
    // status: 'purged' mehr zu simulieren.

    const due = await erasureGateway.findDuePendingRequests(now);
    expect(due.map((d) => d.userId)).toEqual([dueUser.id]);
  });
});
