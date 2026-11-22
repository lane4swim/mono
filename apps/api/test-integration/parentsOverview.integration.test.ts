// PrismaParentOverviewGateway gegen eine echte Datenbank (Issue #145):
// zuständige Trainer:innen nur mit Namen, Meldung mit Wettkampfnummer,
// Lauf, Bahn und Meldezeit, und die Antwort passt zum strikten Schema.
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ParentChildOverviewSchema } from '@lane1/shared-types';
import { PrismaParentOverviewGateway } from '../src/modules/parents/parents.overview.repository.js';
import { getTestPrisma, closeTestPrisma, truncateAll, createTestClub } from './helpers.js';

const prisma = getTestPrisma();
const gateway = new PrismaParentOverviewGateway(prisma);

afterEach(async () => { await truncateAll(); });
afterAll(async () => { await closeTestPrisma(); });

async function user(clubId: string, name: string, extra: Record<string, unknown> = {}) {
  return prisma.user.create({
    data: { clubId, name, email: `${randomUUID()}@example.org`, passwordHash: 'hash', role: 'trainer', roles: ['trainer'], ...extra },
  });
}

describe('PrismaParentOverviewGateway — freigegebene Felder', () => {
  it('liefert Trainer:innen-Namen der Gruppe und die Meldedetails, passend zum strikten Schema', async () => {
    const club = await createTestClub();
    const otherClub = await createTestClub(prisma, 'Anderer Verein');
    const nina = await user(club.id, 'Nina Brandt');
    const jonas = await user(club.id, 'Jonas Beck');
    const deleted = await user(club.id, 'Gelöschte Person', { deletedAt: new Date() });
    const foreign = await user(otherClub.id, 'Fremde Person');
    const group = await prisma.group.create({ data: { clubId: club.id, name: 'Nachwuchs', trainerIds: [nina.id, jonas.id, deleted.id, foreign.id] } });
    const athlete = await prisma.athlete.create({ data: { clubId: club.id, firstName: 'Mara', lastName: 'Vogel', groupId: group.id } });
    const competition = await prisma.competition.create({ data: { clubId: club.id, name: 'Kreismeisterschaften', date: new Date(Date.now() + 7 * 86_400_000) } });
    await prisma.startlistEntry.create({
      data: { clubId: club.id, competitionId: competition.id, athleteId: athlete.id, event: '100F', eventNumber: '12', heat: 3, lane: 4, seedTime: 72.35 },
    });

    const overview = await gateway.buildChildOverview(athlete.id);

    expect(ParentChildOverviewSchema.safeParse(overview).success).toBe(true);
    expect(overview!.athlete).toMatchObject({ groupName: 'Nachwuchs', trainerNames: ['Jonas Beck', 'Nina Brandt'] });
    expect(JSON.stringify(overview)).not.toContain('@example.org');
    expect(overview!.upcomingCompetitions).toEqual([{
      competitionId: competition.id, competitionName: 'Kreismeisterschaften', date: competition.date.toISOString(),
      event: '100F', eventNumber: '12', heat: 3, lane: 4, seedTime: 72.35,
    }]);
  });

  it('ohne Gruppe: keine Trainer:innen', async () => {
    const club = await createTestClub();
    const athlete = await prisma.athlete.create({ data: { clubId: club.id, firstName: 'Tim', lastName: 'Sommer' } });
    const overview = await gateway.buildChildOverview(athlete.id);
    expect(overview!.athlete.trainerNames).toEqual([]);
    expect(ParentChildOverviewSchema.safeParse(overview).success).toBe(true);
  });
});
