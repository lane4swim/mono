// apps/api/test/jobs/notifyExpiringQualifications.test.ts
import { describe, it, expect } from 'vitest';
import { notifyExpiringQualifications } from '../../src/jobs/notifyExpiringQualifications.js';
import { InMemoryNotifyExpiringQualificationsGateway } from '../../src/jobs/qualificationReminder.repository.memory.js';
import { InMemoryMailSender } from '../../src/mail/mailer.memory.js';
import type { QualificationReminderCandidate } from '../../src/jobs/qualificationReminder.repository.js';

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
});
