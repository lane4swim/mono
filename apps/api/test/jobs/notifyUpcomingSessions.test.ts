import { describe, it, expect } from 'vitest';
import { notifyUpcomingSessions, UPCOMING_SESSION_REMINDER_HOURS } from '../../src/jobs/notifyUpcomingSessions.js';
import { InMemoryNotifyUpcomingSessionsGateway } from '../../src/jobs/sessionReminder.repository.memory.js';
import { InMemoryPushSender } from '../../src/push/pusher.memory.js';
import { InMemoryPushSubscriptionRepository } from '../../src/modules/push/push.repository.memory.js';
import type { UpcomingSessionCandidate } from '../../src/jobs/sessionReminder.repository.js';

const NOW = new Date('2026-09-10T08:00:00.000Z');
const ATHLETE1_ID = 'athlete1-id';

function session(overrides: Partial<UpcomingSessionCandidate> = {}): UpcomingSessionCandidate {
  return { id: 's1', clubId: 'club1', athleteIds: [ATHLETE1_ID], date: new Date('2026-09-10T18:00:00.000Z'), ...overrides };
}

async function buildSubscriptions(userId: string, count = 1): Promise<InMemoryPushSubscriptionRepository> {
  const repo = new InMemoryPushSubscriptionRepository();
  for (let i = 0; i < count; i += 1) {
    await repo.upsert(userId, `https://push.example/${userId}/${i}`, { p256dh: 'p', auth: 'a' });
  }
  return repo;
}

describe('notifyUpcomingSessions()', () => {
  it('verschickt eine Push-Erinnerung an alle Empfänger:innen mit aktivem Abo', async () => {
    const gateway = new InMemoryNotifyUpcomingSessionsGateway(
      [session()],
      new Map([['club1', ['trainer1']]]),
      new Map([[ATHLETE1_ID, 'athlete1']]),
    );
    const pusher = new InMemoryPushSender();
    const subs = await buildSubscriptions('athlete1');
    await subs.upsert('trainer1', 'https://push.example/trainer1/0', { p256dh: 'p', auth: 'a' });

    const result = await notifyUpcomingSessions(gateway, pusher, subs, NOW);

    expect(result.remindersSent).toBe(1);
    expect(pusher.sent).toHaveLength(1);
    expect(pusher.sent[0]?.subscriptions).toHaveLength(2);
    expect(await gateway.hasReminderBeenSent('s1')).toBe(true);
  });

  // Code-Review-Korrektur: die Empfänger:innen-Ermittlung nutzte zuvor
  // die AKTUELLE Gruppen-Mitgliedschaft (groupId) statt der tatsächlichen
  // Teilnehmer:innen-Liste dieser Einheit — eine Ad-hoc-Einheit OHNE
  // Gruppe (TrainingSession.groupId ist nullable, siehe schema.prisma)
  // bekam dadurch NIE eine Athlet:innen-Benachrichtigung, obwohl
  // `attendance` die teilnehmenden Athlet:innen längst kennt.
  it('verschickt eine Erinnerung an die Athlet:innen einer Ad-hoc-Einheit ohne Gruppe', async () => {
    const gateway = new InMemoryNotifyUpcomingSessionsGateway(
      [session({ athleteIds: [ATHLETE1_ID] })], // keine groupId auf UpcomingSessionCandidate mehr — athleteIds kommt aus attendance
      new Map(),
      new Map([[ATHLETE1_ID, 'athlete1']]),
    );
    const pusher = new InMemoryPushSender();
    const subs = await buildSubscriptions('athlete1');

    const result = await notifyUpcomingSessions(gateway, pusher, subs, NOW);
    expect(result.remindersSent).toBe(1);
    expect(pusher.sent).toHaveLength(1);
    expect(pusher.sent[0]?.subscriptions).toHaveLength(1);
  });

  it('lässt eine Einheit außerhalb des Erinnerungsfensters unberührt', async () => {
    const farAway = new Date(NOW.getTime() + (UPCOMING_SESSION_REMINDER_HOURS + 5) * 60 * 60 * 1000);
    const gateway = new InMemoryNotifyUpcomingSessionsGateway(
      [session({ date: farAway })],
      new Map(),
      new Map([[ATHLETE1_ID, 'athlete1']]),
    );
    const pusher = new InMemoryPushSender();
    const subs = await buildSubscriptions('athlete1');

    const result = await notifyUpcomingSessions(gateway, pusher, subs, NOW);
    expect(result.remindersSent).toBe(0);
    expect(pusher.sent).toHaveLength(0);
  });

  it('markiert eine Einheit ohne Empfänger:innen trotzdem als erledigt (kein endloser Nachhol-Versuch)', async () => {
    const gateway = new InMemoryNotifyUpcomingSessionsGateway([session({ athleteIds: [] })], new Map(), new Map());
    const pusher = new InMemoryPushSender();
    const subs = new InMemoryPushSubscriptionRepository();

    const result = await notifyUpcomingSessions(gateway, pusher, subs, NOW);
    expect(result.remindersSent).toBe(1);
    expect(pusher.sent).toHaveLength(0);
  });

  it('löscht abgelaufene Abos, die der Pusher als 404/410 meldet', async () => {
    const gateway = new InMemoryNotifyUpcomingSessionsGateway([session()], new Map(), new Map([[ATHLETE1_ID, 'athlete1']]));
    const pusher = new InMemoryPushSender();
    const subs = await buildSubscriptions('athlete1');
    const [sub] = await subs.listByUserId('athlete1');
    pusher.expiredIds.add(sub!.id);

    await notifyUpcomingSessions(gateway, pusher, subs, NOW);
    expect(await subs.listByUserId('athlete1')).toHaveLength(0);
  });
});
