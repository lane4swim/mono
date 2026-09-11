import { describe, it, expect } from 'vitest';
import { createParentsService, ParentNotInClubError, AthleteNotInClubError, UserNotParentError } from '../../src/modules/parents/parents.service.js';
import { InMemoryParentLinkRepository } from '../../src/modules/parents/parents.repository.memory.js';
import { InMemoryParentOverviewGateway } from '../../src/modules/parents/parents.overview.repository.memory.js';
import type { ParentChildOverview } from '@lane1/shared-types';

const CLUB_A = 'club-a';
const CLUB_B = 'club-b';
const PARENT_ID = 'parent-1';
const CHILD_A_ID = '11111111-1111-1111-1111-111111111111';
const CHILD_B_ID = '22222222-2222-2222-2222-222222222222';

function makeOverview(athleteId: string): ParentChildOverview {
  return {
    athlete: { id: athleteId, firstName: 'Mara', lastName: 'Vogel', groupId: null, groupName: null },
    upcomingSessions: [],
    upcomingCompetitions: [],
    recentResults: [],
  };
}

function makeUsers(records: Record<string, { clubId: string | null; roles: string[] }>) {
  return {
    async findById(id: string) {
      const r = records[id];
      return r ? { id, clubId: r.clubId, roles: r.roles } : null;
    },
  };
}

function makeAthletes(records: Record<string, { clubId: string; firstName: string; lastName: string }>) {
  return {
    async findById(id: string) {
      const r = records[id];
      return r ? { id, ...r } : null;
    },
  };
}

describe('parentsService.getOverview()', () => {
  it('liefert nur die eigenen verknüpften Kinder', async () => {
    const parentLinks = new InMemoryParentLinkRepository();
    await parentLinks.create(PARENT_ID, CHILD_A_ID);
    const overview = new InMemoryParentOverviewGateway(new Map([[CHILD_A_ID, makeOverview(CHILD_A_ID)]]));
    const service = createParentsService({ parentLinks, overview, users: makeUsers({}), athletes: makeAthletes({}) });

    const result = await service.getOverview({ userId: PARENT_ID, clubId: CLUB_A });
    expect(result.children).toHaveLength(1);
    expect(result.children[0]!.athlete.id).toBe(CHILD_A_ID);
  });

  it('filtert eine verwaiste Verknüpfung (Athletenprofil gelöscht) still heraus', async () => {
    const parentLinks = new InMemoryParentLinkRepository();
    await parentLinks.create(PARENT_ID, CHILD_A_ID);
    const overview = new InMemoryParentOverviewGateway(new Map()); // liefert null für CHILD_A_ID
    const service = createParentsService({ parentLinks, overview, users: makeUsers({}), athletes: makeAthletes({}) });

    const result = await service.getOverview({ userId: PARENT_ID, clubId: CLUB_A });
    expect(result.children).toHaveLength(0);
  });

  it('liefert für ein Konto ohne Verknüpfungen eine leere Liste', async () => {
    const service = createParentsService({
      parentLinks: new InMemoryParentLinkRepository(),
      overview: new InMemoryParentOverviewGateway(),
      users: makeUsers({}),
      athletes: makeAthletes({}),
    });
    const result = await service.getOverview({ userId: PARENT_ID, clubId: CLUB_A });
    expect(result.children).toEqual([]);
  });
});

describe('parentsService — Admin-Verknüpfungsverwaltung', () => {
  function build() {
    const parentLinks = new InMemoryParentLinkRepository();
    const overview = new InMemoryParentOverviewGateway();
    const users = makeUsers({
      [PARENT_ID]: { clubId: CLUB_A, roles: ['parent'] },
      'trainer-1': { clubId: CLUB_A, roles: ['trainer'] },
      'foreign-parent': { clubId: CLUB_B, roles: ['parent'] },
    });
    const athletes = makeAthletes({
      [CHILD_A_ID]: { clubId: CLUB_A, firstName: 'Mara', lastName: 'Vogel' },
      [CHILD_B_ID]: { clubId: CLUB_B, firstName: 'Jonas', lastName: 'Beck' },
    });
    const service = createParentsService({ parentLinks, overview, users, athletes });
    return { service, parentLinks };
  }

  it('legt eine Verknüpfung an, wenn Konto und Athletenprofil zum eigenen Verein gehören', async () => {
    const { service, parentLinks } = build();
    await service.addLink(PARENT_ID, CHILD_A_ID, { userId: 'admin-1', clubId: CLUB_A });
    expect(await parentLinks.listByUser(PARENT_ID)).toHaveLength(1);
  });

  it('lehnt eine Verknüpfung ab, wenn das Ziel-Konto einem fremden Verein gehört', async () => {
    const { service } = build();
    await expect(service.addLink('foreign-parent', CHILD_A_ID, { userId: 'admin-1', clubId: CLUB_A })).rejects.toThrow(ParentNotInClubError);
  });

  it('lehnt eine Verknüpfung ab, wenn das Ziel-Konto nicht die Rolle "parent" trägt', async () => {
    const { service } = build();
    await expect(service.addLink('trainer-1', CHILD_A_ID, { userId: 'admin-1', clubId: CLUB_A })).rejects.toThrow(UserNotParentError);
  });

  it('lehnt eine Verknüpfung ab, wenn das Athletenprofil einem fremden Verein gehört', async () => {
    const { service } = build();
    await expect(service.addLink(PARENT_ID, CHILD_B_ID, { userId: 'admin-1', clubId: CLUB_A })).rejects.toThrow(AthleteNotInClubError);
  });

  it('listLinks() liefert die verknüpften Kinder mit Namen', async () => {
    const { service } = build();
    await service.addLink(PARENT_ID, CHILD_A_ID, { userId: 'admin-1', clubId: CLUB_A });
    const links = await service.listLinks(PARENT_ID, { userId: 'admin-1', clubId: CLUB_A });
    expect(links).toEqual([{ athleteId: CHILD_A_ID, firstName: 'Mara', lastName: 'Vogel' }]);
  });

  it('removeLink() entfernt eine bestehende Verknüpfung', async () => {
    const { service, parentLinks } = build();
    await service.addLink(PARENT_ID, CHILD_A_ID, { userId: 'admin-1', clubId: CLUB_A });
    await service.removeLink(PARENT_ID, CHILD_A_ID, { userId: 'admin-1', clubId: CLUB_A });
    expect(await parentLinks.listByUser(PARENT_ID)).toHaveLength(0);
  });
});
