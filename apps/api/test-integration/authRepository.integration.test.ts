// apps/api/test-integration/authRepository.integration.test.ts
//
// Prüft PrismaUserRepository gegen eine echte Datenbank (siehe
// vitest.integration.config.ts). Fokus: findByEmail()/findById() müssen
// ein bereits soft-gelöschtes Konto als "nicht existent" behandeln (Code-
// Review, Befund 7) — genau die Art Regression, die ein In-Memory-Double
// beliebig lange unbemerkt lassen kann (siehe auth.service.ts-Kommentar:
// "die beiden Prüfungen waren bereits einmal auseinandergelaufen").
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PrismaUserRepository } from '../src/modules/auth/auth.repository.js';
import { getTestPrisma, closeTestPrisma, truncateAll, createTestClub } from './helpers.js';

const prisma = getTestPrisma();
const repo = new PrismaUserRepository(prisma);

afterEach(async () => {
  await truncateAll();
});
afterAll(async () => {
  await closeTestPrisma();
});

async function seedUser(clubId: string, overrides: Partial<{ email: string; deletedAt: Date | null; role: string }> = {}) {
  return prisma.user.create({
    data: {
      clubId,
      name: 'Mara Vogel',
      email: overrides.email ?? `mara-${randomUUID()}@example.org`,
      passwordHash: 'hash',
      role: overrides.role ?? 'trainer',
      athleteId: null,
      deletedAt: overrides.deletedAt ?? null,
    },
  });
}

describe('PrismaUserRepository.findByEmail()', () => {
  it('findet ein aktives Konto', async () => {
    const club = await createTestClub();
    const user = await seedUser(club.id, { email: 'aktiv@example.org' });

    const found = await repo.findByEmail('aktiv@example.org');
    expect(found?.id).toBe(user.id);
  });

  it('liefert null für ein bereits soft-gelöschtes Konto', async () => {
    const club = await createTestClub();
    await seedUser(club.id, { email: 'geloescht@example.org', deletedAt: new Date() });

    const found = await repo.findByEmail('geloescht@example.org');
    expect(found).toBeNull();
  });
});

describe('PrismaUserRepository.findById()', () => {
  it('findet ein aktives Konto', async () => {
    const club = await createTestClub();
    const user = await seedUser(club.id);

    const found = await repo.findById(user.id);
    expect(found?.id).toBe(user.id);
  });

  // Regressionstest für Befund 7: vormals `findUnique({ where: { id } })`
  // ohne deletedAt-Filter — refresh()/getMe()/updateMe() (siehe
  // auth.service.ts) funktionierten dadurch für ein bereits zur Löschung
  // vorgemerktes Konto weiter, solange noch ein gültiges Token existierte.
  it('liefert null für ein bereits soft-gelöschtes Konto (Regressionstest, Befund 7)', async () => {
    const club = await createTestClub();
    const user = await seedUser(club.id, { deletedAt: new Date() });

    const found = await repo.findById(user.id);
    expect(found).toBeNull();
  });
});

describe('PrismaUserRepository.listByClub()', () => {
  it('liefert nur aktive Mitglieder des angegebenen Vereins', async () => {
    const clubA = await createTestClub(prisma, 'Verein A');
    const clubB = await createTestClub(prisma, 'Verein B');
    const active = await seedUser(clubA.id, { email: 'aktiv-a@example.org' });
    await seedUser(clubA.id, { email: 'geloescht-a@example.org', deletedAt: new Date() });
    await seedUser(clubB.id, { email: 'aktiv-b@example.org' });

    const members = await repo.listByClub(clubA.id);
    expect(members.map((m) => m.id)).toEqual([active.id]);
  });
});

describe('PrismaUserRepository.create()/update()', () => {
  it('legt ein Konto an und aktualisiert es anschließend', async () => {
    const club = await createTestClub();
    const created = await repo.create({
      clubId: club.id,
      name: 'Neu Angelegt',
      email: `neu-${randomUUID()}@example.org`,
      passwordHash: 'hash',
      role: 'athlete',
      athleteId: null,
      consentGivenAt: new Date(),
      consentVersion: '2026-01-01',
    });
    expect(created.id).toBeTruthy();

    const updated = await repo.update(created.id, { name: 'Geänderter Name' });
    expect(updated.name).toBe('Geänderter Name');
  });

  // Regressionstest für Befund S5 (Code-Review): update() filterte
  // bislang — anders als findByEmail()/findById()/listByClub() oben —
  // NICHT auf `deletedAt: null` (`where: { id }` allein). Ein zwischen
  // Prüfung und Aktualisierung (z. B. durch eine gleichzeitige DSGVO-
  // Löschanfrage) soft-gelöschtes Konto hätte die Änderung dadurch
  // trotzdem stillschweigend übernommen.
  it('lehnt eine Aktualisierung eines bereits soft-gelöschten Kontos ab (Befund S5)', async () => {
    const club = await createTestClub();
    const user = await seedUser(club.id, { deletedAt: new Date() });

    await expect(repo.update(user.id, { name: 'Sollte nicht ankommen' })).rejects.toMatchObject({ code: 'P2025' });

    // Der Datensatz selbst bleibt unverändert (kein Teil-Update).
    const stillDeleted = await prisma.user.findUnique({ where: { id: user.id } });
    expect(stillDeleted?.name).toBe('Mara Vogel');
    expect(stillDeleted?.deletedAt).not.toBeNull();
  });

  it('lehnt eine Aktualisierung einer unbekannten id identisch ab (bestehendes Verhalten bleibt erhalten)', async () => {
    await expect(repo.update(randomUUID(), { name: 'X' })).rejects.toMatchObject({ code: 'P2025' });
  });
});

// Regressionstest für die Code-Review-Korrektur: User.athleteId war
// vormals ein nackter String ohne Fremdschlüssel/Unique-Constraint — zwei
// Konten hätten unbemerkt auf dasselbe Athletenprofil zeigen können. Nur
// gegen eine echte Datenbank prüfbar (ein In-Memory-Double kennt keine
// DB-Constraints).
describe('User.athleteId — Unique-Constraint (Schema-Integrität)', () => {
  it('lehnt ein zweites Konto mit derselben athleteId ab', async () => {
    const club = await createTestClub();
    const athlete = await prisma.athlete.create({ data: { clubId: club.id, firstName: 'Mara', lastName: 'Vogel' } });

    await repo.create({
      clubId: club.id, name: 'Erstes Konto', email: `erste-${randomUUID()}@example.org`,
      passwordHash: 'hash', role: 'athlete', athleteId: athlete.id,
      consentGivenAt: new Date(), consentVersion: '2026-01-01',
    });

    await expect(
      repo.create({
        clubId: club.id, name: 'Zweites Konto', email: `zweite-${randomUUID()}@example.org`,
        passwordHash: 'hash', role: 'athlete', athleteId: athlete.id,
        consentGivenAt: new Date(), consentVersion: '2026-01-01',
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('setzt athleteId auf null (statt die Löschung zu blockieren), wenn das referenzierte Athletenprofil gelöscht wird', async () => {
    const club = await createTestClub();
    const athlete = await prisma.athlete.create({ data: { clubId: club.id, firstName: 'Mara', lastName: 'Vogel' } });
    const user = await repo.create({
      clubId: club.id, name: 'Konto', email: `konto-${randomUUID()}@example.org`,
      passwordHash: 'hash', role: 'athlete', athleteId: athlete.id,
      consentGivenAt: new Date(), consentVersion: '2026-01-01',
    });

    await prisma.athlete.delete({ where: { id: athlete.id } });

    const reloaded = await repo.findById(user.id);
    expect(reloaded?.athleteId).toBeNull();
  });
});
