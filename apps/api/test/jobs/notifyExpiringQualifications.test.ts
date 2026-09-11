import { describe, it, expect } from 'vitest';
import { notifyExpiringQualifications } from '../../src/jobs/notifyExpiringQualifications.js';
import { InMemoryNotifyExpiringQualificationsGateway } from '../../src/jobs/qualificationReminder.repository.memory.js';
import { InMemoryMailSender } from '../../src/mail/mailer.memory.js';
import { InMemoryPushSender } from '../../src/push/pusher.memory.js';
import { InMemoryPushSubscriptionRepository } from '../../src/modules/push/push.repository.memory.js';
import type { QualificationReminderCandidate } from '../../src/jobs/qualificationReminder.repository.js';
import type { QualificationReminderMailPayload } from '../../src/mail/mailer.js';

// Issue #59: ein Fehlschlag bei EINEM Empfänger (z. B. ein bouncendes
// Admin-Postfach) durfte nicht dazu führen, dass die qualifizierte Person —
// die ihre Erinnerung bereits erfolgreich erhalten hat — beim nächsten
// Cron-Lauf erneut angeschrieben wird. Dieser Mailer lässt genau eine
// konfigurierte Zieladresse dauerhaft fehlschlagen, alle anderen normal
// durchlaufen (wie InMemoryMailSender).
class PartiallyFailingMailSender extends InMemoryMailSender {
  constructor(private readonly failingRecipient: string) {
    super();
  }
  override async sendQualificationReminderEmail(payload: QualificationReminderMailPayload): Promise<void> {
    if (payload.to === this.failingRecipient) throw new Error('SMTP: mailbox unavailable');
    return super.sendQualificationReminderEmail(payload);
  }
}

const NOW = new Date('2026-09-03T00:00:00.000Z');

function candidate(overrides: Partial<QualificationReminderCandidate> = {}): QualificationReminderCandidate {
  return {
    id: 'q1',
    userId: 'u1',
    userEmail: 'person@sv.de',
    userName: 'Petra Klein',
    userLocale: 'de-DE',
    clubId: 'club1',
    type: 'trainer_c',
    expiresOn: new Date('2026-10-03T00:00:00.000Z'), // 30 Tage entfernt
    renewalCourseOrganizedOn: null,
    ...overrides,
  };
}

const admins = [{ email: 'admin@sv.de', name: 'Admina Musterfrau', locale: 'de-DE' }];

describe('notifyExpiringQualifications()', () => {
  it('verschickt eine Erinnerung, wenn eine konfigurierte Schwelle erreicht ist, an die Person UND die Admins', async () => {
    const gateway = new InMemoryNotifyExpiringQualificationsGateway(
      [candidate()],
      new Map([['club1:trainer_c', [60, 14]]]),
      new Map([['club1', admins]]),
    );
    const mailer = new InMemoryMailSender();
    const result = await notifyExpiringQualifications(gateway, mailer, NOW);

    expect(result.remindersSent).toBe(1);
    expect(result.failed).toHaveLength(0);
    // 2 Empfänger:innen (Person + 1 Admin) für DIESE eine Erinnerung.
    expect(mailer.sentQualificationReminderEmails).toHaveLength(2);
    expect(mailer.sentQualificationReminderEmails.map((e) => e.to).sort()).toEqual(['admin@sv.de', 'person@sv.de']);
    expect(mailer.sentQualificationReminderEmails[0]?.isExpired).toBe(false);
  });

  it('sendet keine Erinnerung, solange keine konfigurierte Schwelle erreicht ist', async () => {
    const gateway = new InMemoryNotifyExpiringQualificationsGateway(
      [candidate({ expiresOn: new Date('2027-01-01T00:00:00.000Z') })], // weit in der Zukunft
      new Map([['club1:trainer_c', [60, 14]]]),
      new Map([['club1', admins]]),
    );
    const mailer = new InMemoryMailSender();
    const result = await notifyExpiringQualifications(gateway, mailer, NOW);
    expect(result.remindersSent).toBe(0);
    expect(mailer.sentQualificationReminderEmails).toHaveLength(0);
  });

  it('verwendet DEFAULT_QUALIFICATION_REMINDER_THRESHOLDS_DAYS, wenn der Verein/Typ keine eigene Konfiguration hat', async () => {
    const gateway = new InMemoryNotifyExpiringQualificationsGateway(
      [candidate({ expiresOn: new Date('2026-09-10T00:00:00.000Z') })], // 7 Tage entfernt -> innerhalb BEIDER Default-Schwellen (60 UND 14)
      new Map(), // keine Konfiguration
      new Map([['club1', admins]]),
    );
    const mailer = new InMemoryMailSender();
    const result = await notifyExpiringQualifications(gateway, mailer, NOW);
    // Beide Default-Schwellen (60/14 Tage) sind zugleich erreicht — je
    // Schwelle einmalig, siehe Job-Kommentar zum Nachhol-Verhalten.
    expect(result.remindersSent).toBe(2);
  });

  it('markiert eine bereits abgelaufene Qualifikation als "isExpired" und erinnert trotz erschöpfter Schwellen', async () => {
    const gateway = new InMemoryNotifyExpiringQualificationsGateway(
      [candidate({ expiresOn: new Date('2026-08-01T00:00:00.000Z') })], // in der Vergangenheit
      new Map([['club1:trainer_c', [60, 14]]]),
      new Map([['club1', admins]]),
    );
    const mailer = new InMemoryMailSender();
    const result = await notifyExpiringQualifications(gateway, mailer, NOW);
    // 60-Tage-, 14-Tage- UND "abgelaufen"-Schwelle sind gleichzeitig fällig
    // (Nachhol-Fall, siehe Job-Kommentar) — je Schwelle EIN Versand.
    expect(result.remindersSent).toBe(3);
    expect(mailer.sentQualificationReminderEmails.filter((e) => e.isExpired)).toHaveLength(2); // Person + Admin
  });

  it('verschickt bei zweimaligem Lauf am selben Tag keine doppelte Erinnerung für dieselbe Schwelle', async () => {
    const gateway = new InMemoryNotifyExpiringQualificationsGateway(
      [candidate()],
      new Map([['club1:trainer_c', [60, 14]]]),
      new Map([['club1', admins]]),
    );
    const mailer = new InMemoryMailSender();
    await notifyExpiringQualifications(gateway, mailer, NOW);
    const second = await notifyExpiringQualifications(gateway, mailer, NOW);
    expect(second.remindersSent).toBe(0);
    expect(mailer.sentQualificationReminderEmails).toHaveLength(2); // unverändert seit dem ersten Lauf
  });

  it('überspringt eine Zeile mit gesetztem, noch in der Zukunft liegendem renewalCourseOrganizedOn', async () => {
    const gateway = new InMemoryNotifyExpiringQualificationsGateway(
      [candidate({ renewalCourseOrganizedOn: new Date('2026-09-20T00:00:00.000Z') })],
      new Map([['club1:trainer_c', [60, 14]]]),
      new Map([['club1', admins]]),
    );
    const mailer = new InMemoryMailSender();
    const result = await notifyExpiringQualifications(gateway, mailer, NOW);
    expect(result.remindersSent).toBe(0);
  });

  it('erinnert erneut, wenn renewalCourseOrganizedOn bereits in der Vergangenheit liegt (vermutlich stattgefunden, aber nicht nachgepflegt)', async () => {
    const gateway = new InMemoryNotifyExpiringQualificationsGateway(
      [candidate({ renewalCourseOrganizedOn: new Date('2026-08-01T00:00:00.000Z') })],
      new Map([['club1:trainer_c', [60, 14]]]),
      new Map([['club1', admins]]),
    );
    const mailer = new InMemoryMailSender();
    const result = await notifyExpiringQualifications(gateway, mailer, NOW);
    expect(result.remindersSent).toBeGreaterThan(0);
  });

  it('schreibt die bereits erfolgreich benachrichtigte Person NICHT erneut an, wenn nur der Versand an einen Admin scheitert (Issue #59)', async () => {
    const gateway = new InMemoryNotifyExpiringQualificationsGateway(
      [candidate()],
      new Map([['club1:trainer_c', [60, 14]]]),
      new Map([['club1', admins]]), // admins[0].email === 'admin@sv.de'
    );
    const mailer = new PartiallyFailingMailSender('admin@sv.de');

    const first = await notifyExpiringQualifications(gateway, mailer, NOW);
    // Die Schwelle gilt trotz des gescheiterten Admin-Versands als erledigt
    // (die qualifizierte Person selbst hat ihre Mail erhalten) — der
    // Fehlschlag wird protokolliert, bricht den Lauf aber nicht ab.
    expect(first.remindersSent).toBe(1);
    expect(first.failed).toHaveLength(1);
    expect(first.failed[0]?.error).toContain('admin@sv.de');
    // Ein Admin-Fehlschlag wird NICHT automatisch wiederholt (die Schwelle
    // gilt bereits als erledigt, siehe NotifyResult.willRetry-Kommentar) —
    // anders als ein Fehlschlag beim Versand an die Person selbst.
    expect(first.failed[0]?.willRetry).toBe(false);
    expect(mailer.sentQualificationReminderEmails.map((e) => e.to)).toEqual(['person@sv.de']);

    const second = await notifyExpiringQualifications(gateway, mailer, NOW);
    // Kein erneuter Lauf für diese Schwelle — insbesondere KEINE zweite
    // Mail an die Person, nur weil der Admin-Versand einmal fehlschlug.
    expect(second.remindersSent).toBe(0);
    expect(mailer.sentQualificationReminderEmails.map((e) => e.to)).toEqual(['person@sv.de']);
  });

  it('markiert einen Fehlschlag beim Versand an die Person selbst als willRetry: true (Code-Review zu Issue #59)', async () => {
    const gateway = new InMemoryNotifyExpiringQualificationsGateway(
      [candidate()],
      new Map([['club1:trainer_c', [60, 14]]]),
      new Map([['club1', admins]]),
    );
    const mailer = new PartiallyFailingMailSender('person@sv.de');

    const result = await notifyExpiringQualifications(gateway, mailer, NOW);
    expect(result.remindersSent).toBe(0);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.willRetry).toBe(true);
    // Der Admin wird für diese Schwelle gar nicht erst angeschrieben — der
    // Fehlschlag bei der Person (direktes await, VOR dem Promise.all über
    // die Admins) wirft sofort in den äußeren catch.
    expect(mailer.sentQualificationReminderEmails).toHaveLength(0);
  });

  it('verschickt bei gesetztem push-Parameter zusätzlich eine Push-Nachricht an die qualifizierte Person, nicht an Admins (Phase 2, Abschnitt 1.5.1)', async () => {
    const gateway = new InMemoryNotifyExpiringQualificationsGateway(
      [candidate()],
      new Map([['club1:trainer_c', [60, 14]]]),
      new Map([['club1', admins]]),
    );
    const mailer = new InMemoryMailSender();
    const pusher = new InMemoryPushSender();
    const pushSubscriptions = new InMemoryPushSubscriptionRepository();
    await pushSubscriptions.upsert('u1', 'https://push.example/u1', { p256dh: 'p', auth: 'a' });

    const result = await notifyExpiringQualifications(gateway, mailer, NOW, { pusher, pushSubscriptions });
    expect(result.remindersSent).toBe(1);
    expect(pusher.sent).toHaveLength(1);
    expect(pusher.sent[0]?.subscriptions).toHaveLength(1);
  });

  it('sendet keine Push-Nachricht, wenn die Person kein Abo hat, und lässt den E-Mail-Versand unberührt', async () => {
    const gateway = new InMemoryNotifyExpiringQualificationsGateway(
      [candidate()],
      new Map([['club1:trainer_c', [60, 14]]]),
      new Map([['club1', admins]]),
    );
    const mailer = new InMemoryMailSender();
    const pusher = new InMemoryPushSender();
    const pushSubscriptions = new InMemoryPushSubscriptionRepository();

    const result = await notifyExpiringQualifications(gateway, mailer, NOW, { pusher, pushSubscriptions });
    expect(result.remindersSent).toBe(1);
    expect(pusher.sent).toHaveLength(0);
    expect(mailer.sentQualificationReminderEmails).toHaveLength(2);
  });
});
