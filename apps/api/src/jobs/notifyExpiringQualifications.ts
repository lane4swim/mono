// apps/api/src/jobs/notifyExpiringQualifications.ts
//
// Orchestrierung der Ablauf-Erinnerungen für Qualifikationen (docs/
// nutzer-qualifikationen-plan.md, Abschnitt 5). Wird von
// scripts/notifyExpiringQualifications.ts per Cron ausgeführt.
//
// Absichtlich als reine Orchestrierungsfunktion (kein eigener DB-Zugriff)
// gehalten, damit sie ohne Datenbank testbar ist (siehe
// test/jobs/notifyExpiringQualifications.test.ts) — analog
// purgeExpiredDeletions.ts.
import type { NotifyExpiringQualificationsGateway, AdminContact } from './qualificationReminder.repository.js';
import type { MailSender } from '../mail/mailer.js';
import { DEFAULT_QUALIFICATION_REMINDER_THRESHOLDS_DAYS } from '@lane1/shared-types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// 0 steht für "bereits abgelaufen" — ein impliziter zusätzlicher Marker
// zusätzlich zu den konfigurierten (positiven) Schwellen (siehe Plan,
// Abschnitt 5: "... sowie bereits abgelaufene"). Getrennt von den
// konfigurierten Schwellen gehalten, damit "abgelaufen" IMMER genau EINMAL
// erinnert wird, unabhängig davon, welche (ggf. leeren) Schwellen ein
// Verein für einen Typ konfiguriert hat.
const EXPIRED_MARKER = 0;

function daysUntil(target: Date, now: Date): number {
  return Math.ceil((target.getTime() - now.getTime()) / MS_PER_DAY);
}

export interface NotifyResult {
  remindersSent: number;
  failed: Array<{ qualificationId: string; thresholdDays: number; error: string }>;
}

export async function notifyExpiringQualifications(
  gateway: NotifyExpiringQualificationsGateway,
  mailer: MailSender,
  now: Date = new Date(),
): Promise<NotifyResult> {
  const [candidates, thresholdsByClubAndType] = await Promise.all([
    gateway.findActiveQualificationsForModuleClubs(),
    gateway.findThresholdsByClubAndType(),
  ]);

  const result: NotifyResult = { remindersSent: 0, failed: [] };
  const adminsCache = new Map<string, AdminContact[]>();

  for (const candidate of candidates) {
    // Verlängerungslehrgang bereits organisiert UND noch nicht verstrichen
    // -> kein Handlungsbedarf, überspringen (siehe Plan, Abschnitt 5). Liegt
    // renewalCourseOrganizedOn dagegen in der Vergangenheit, ohne dass eine
    // neue UserQualification mit aktuellerem acquiredOn nachgetragen wurde
    // (separate Zeile, taucht hier nicht als "derselbe Kandidat" auf), wird
    // ganz normal weiter erinnert.
    if (candidate.renewalCourseOrganizedOn && candidate.renewalCourseOrganizedOn.getTime() >= now.getTime()) continue;

    const thresholds = thresholdsByClubAndType.get(`${candidate.clubId}:${candidate.type}`) ?? DEFAULT_QUALIFICATION_REMINDER_THRESHOLDS_DAYS;
    const remainingDays = daysUntil(candidate.expiresOn, now);
    // Absteigend sortiert, damit eine frühzeitige Erinnerung (z. B. 60 Tage)
    // vor einer dringlicheren (14 Tage / abgelaufen) verschickt wird, falls
    // der Job mehrere Schwellen auf einmal nachholt (z. B. nach einer
    // längeren Pause).
    const dueMarkers = [...thresholds, EXPIRED_MARKER].filter((t) => remainingDays <= t).sort((a, b) => b - a);

    for (const thresholdDays of dueMarkers) {
      try {
        if (await gateway.hasReminderBeenSent(candidate.id, thresholdDays)) continue;

        if (!adminsCache.has(candidate.clubId)) {
          adminsCache.set(candidate.clubId, await gateway.findAdminsForClub(candidate.clubId));
        }
        const admins = adminsCache.get(candidate.clubId) ?? [];
        const recipients: AdminContact[] = [
          { email: candidate.userEmail, name: candidate.userName, locale: candidate.userLocale },
          ...admins,
        ];
        const isExpired = thresholdDays === EXPIRED_MARKER;
        for (const recipient of recipients) {
          await mailer.sendQualificationReminderEmail({
            to: recipient.email,
            recipientName: recipient.name,
            qualifiedPersonName: candidate.userName,
            type: candidate.type,
            expiresOn: candidate.expiresOn,
            isExpired,
            locale: recipient.locale,
          });
        }
        await gateway.recordReminderSent(candidate.id, thresholdDays);
        result.remindersSent += 1;
      } catch (err) {
        // Ein einzelner Fehlschlag (z. B. vorübergehendes DB-/SMTP-Problem)
        // soll nicht den gesamten Lauf abbrechen — der nächste Cron-Durchlauf
        // versucht es erneut, da recordReminderSent() für diese Schwelle
        // nicht aufgerufen wurde (analog purgeExpiredDeletions.ts).
        result.failed.push({ qualificationId: candidate.id, thresholdDays, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return result;
}
