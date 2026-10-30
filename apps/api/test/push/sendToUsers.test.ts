import { describe, it, expect, afterEach } from 'vitest';
import { sendPushToUsers, formatPushDate } from '../../src/push/sendToUsers.js';
import { InMemoryPushSender } from '../../src/push/pusher.memory.js';
import { InMemoryPushSubscriptionRepository } from '../../src/modules/push/push.repository.memory.js';

const PAYLOAD = { title: 'Titel', body: 'Text', url: '#/x' };

async function subscribe(repo: InMemoryPushSubscriptionRepository, userId: string, device: number) {
  await repo.upsert(userId, `https://push.example/${userId}/${device}`, { p256dh: 'p', auth: 'a' });
}

describe('sendPushToUsers()', () => {
  it('sendet in EINEM Aufruf an alle Geräte aller Konten', async () => {
    const pusher = new InMemoryPushSender();
    const pushSubscriptions = new InMemoryPushSubscriptionRepository();
    await subscribe(pushSubscriptions, 'u1', 0);
    await subscribe(pushSubscriptions, 'u1', 1);
    await subscribe(pushSubscriptions, 'u2', 0);

    await sendPushToUsers({ pusher, pushSubscriptions }, ['u1', 'u2', 'ohne-abo'], PAYLOAD);

    expect(pusher.sent).toHaveLength(1);
    expect(pusher.sent[0]!.subscriptions).toHaveLength(3);
    expect(pusher.sent[0]!.payload).toEqual(PAYLOAD);
  });

  it('sendet nichts ohne Konten oder ohne ein einziges Abo', async () => {
    const pusher = new InMemoryPushSender();
    const pushSubscriptions = new InMemoryPushSubscriptionRepository();

    await sendPushToUsers({ pusher, pushSubscriptions }, [], PAYLOAD);
    await sendPushToUsers({ pusher, pushSubscriptions }, ['ohne-abo'], PAYLOAD);

    expect(pusher.sent).toHaveLength(0);
  });

  it('löscht vom Push-Dienst als abgelaufen gemeldete Abos, die übrigen bleiben', async () => {
    const pusher = new InMemoryPushSender();
    const pushSubscriptions = new InMemoryPushSubscriptionRepository();
    await subscribe(pushSubscriptions, 'u1', 0);
    await subscribe(pushSubscriptions, 'u1', 1);
    const [expired, alive] = await pushSubscriptions.listByUserId('u1');
    pusher.expiredIds.add(expired!.id);

    await sendPushToUsers({ pusher, pushSubscriptions }, ['u1'], PAYLOAD);

    expect((await pushSubscriptions.listByUserId('u1')).map((s) => s.id)).toEqual([alive!.id]);
  });
});

describe('formatPushDate()', () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  // Termine sind Kalendertage, gespeichert als UTC-Mitternacht — auch ein
  // Server westlich von UTC muss denselben Tag anzeigen.
  it('formatiert in UTC, unabhängig von der Server-Zeitzone', () => {
    process.env.TZ = 'America/New_York';
    expect(formatPushDate(new Date('2026-09-11T00:00:00.000Z'))).toBe('11.9.2026');
  });
});
