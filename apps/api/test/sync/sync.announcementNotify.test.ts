import { describe, it, expect } from 'vitest';
import { notifyAnnouncementCreated } from '../../src/modules/sync/sync.announcementNotify.js';
import { InMemoryAnnouncementRecipientsGateway } from '../../src/modules/sync/announcementRecipients.repository.memory.js';
import { InMemoryPushSender } from '../../src/push/pusher.memory.js';
import { InMemoryPushSubscriptionRepository } from '../../src/modules/push/push.repository.memory.js';
import type { SyncEventResult } from '@lane1/shared-types';

const CLUB_ID = 'club1';
const AUTHOR_ID = 'author1';

function createEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt1',
    store: 'announcements',
    entityId: 'ann1',
    action: 'create',
    payload: { id: 'ann1', clubId: CLUB_ID, groupId: null, authorId: AUTHOR_ID, title: 'Training fällt aus', body: '...' },
    clientUpdatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const appliedResult = (eventId: string): SyncEventResult => ({ eventId, status: 'applied' });

async function subscriptionsFor(userId: string): Promise<InMemoryPushSubscriptionRepository> {
  const repo = new InMemoryPushSubscriptionRepository();
  await repo.upsert(userId, `https://push.example/${userId}`, { p256dh: 'p', auth: 'a' });
  return repo;
}

describe('notifyAnnouncementCreated()', () => {
  it('verschickt eine Push-Nachricht an alle Empfänger:innen mit Abo, nicht an die verfassende Person', async () => {
    const pusher = new InMemoryPushSender();
    const pushSubscriptions = await subscriptionsFor('recipient1');
    await pushSubscriptions.upsert(AUTHOR_ID, 'https://push.example/author', { p256dh: 'p', auth: 'a' });
    const recipients = new InMemoryAnnouncementRecipientsGateway(new Map([[`${CLUB_ID}:`, ['recipient1', AUTHOR_ID]]]));

    const event = createEvent();
    await notifyAnnouncementCreated({ pusher, pushSubscriptions, recipients }, [event], [appliedResult('evt1')], CLUB_ID, AUTHOR_ID);

    expect(pusher.sent).toHaveLength(1);
    expect(pusher.sent[0]?.subscriptions).toHaveLength(1); // nur recipient1, AUTHOR_ID wurde ausgeschlossen
  });

  it('ignoriert Events, die nicht "applied" sind (z. B. abgelehnt)', async () => {
    const pusher = new InMemoryPushSender();
    const pushSubscriptions = await subscriptionsFor('recipient1');
    const recipients = new InMemoryAnnouncementRecipientsGateway(new Map([[`${CLUB_ID}:`, ['recipient1']]]));

    const event = createEvent();
    await notifyAnnouncementCreated(
      { pusher, pushSubscriptions, recipients },
      [event],
      [{ eventId: 'evt1', status: 'error', message: 'x', code: 'y' }],
      CLUB_ID,
      AUTHOR_ID,
    );
    expect(pusher.sent).toHaveLength(0);
  });

  it('ignoriert Events anderer Stores/Aktionen', async () => {
    const pusher = new InMemoryPushSender();
    const pushSubscriptions = await subscriptionsFor('recipient1');
    const recipients = new InMemoryAnnouncementRecipientsGateway(new Map([[`${CLUB_ID}:`, ['recipient1']]]));

    const updateEvent = createEvent({ id: 'evt2', action: 'update' });
    const otherStoreEvent = createEvent({ id: 'evt3', store: 'plans' });
    await notifyAnnouncementCreated(
      { pusher, pushSubscriptions, recipients },
      [updateEvent, otherStoreEvent],
      [appliedResult('evt2'), appliedResult('evt3')],
      CLUB_ID,
      AUTHOR_ID,
    );
    expect(pusher.sent).toHaveLength(0);
  });

  it('verschickt an die Empfänger:innen einer spezifischen Gruppe, wenn groupId gesetzt ist', async () => {
    const pusher = new InMemoryPushSender();
    const pushSubscriptions = await subscriptionsFor('groupMember1');
    const recipients = new InMemoryAnnouncementRecipientsGateway(new Map([[`${CLUB_ID}:group1`, ['groupMember1']]]));

    const event = createEvent({ payload: { ...createEvent().payload, groupId: 'group1' } });
    await notifyAnnouncementCreated({ pusher, pushSubscriptions, recipients }, [event], [appliedResult('evt1')], CLUB_ID, AUTHOR_ID);
    expect(pusher.sent).toHaveLength(1);
  });

  it('sendet nichts, wenn es keine Empfänger:innen mit Abo gibt', async () => {
    const pusher = new InMemoryPushSender();
    const pushSubscriptions = new InMemoryPushSubscriptionRepository();
    const recipients = new InMemoryAnnouncementRecipientsGateway(new Map([[`${CLUB_ID}:`, ['recipient1']]]));

    const event = createEvent();
    await notifyAnnouncementCreated({ pusher, pushSubscriptions, recipients }, [event], [appliedResult('evt1')], CLUB_ID, AUTHOR_ID);
    expect(pusher.sent).toHaveLength(0);
  });
});
