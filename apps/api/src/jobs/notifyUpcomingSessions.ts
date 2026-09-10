// Orchestrierung der Push-Erinnerung an bevorstehende Trainingseinheiten
// (Phase 2, Abschnitt 1.5.2 — docs/Plans/phase2-plan.md). Wird von
// scripts/notifyUpcomingSessions.ts per Cron ausgeführt.
//
// Absichtlich als reine Orchestrierungsfunktion (kein eigener DB-Zugriff)
// gehalten, damit sie ohne Datenbank testbar ist — analog
// notifyExpiringQualifications.ts.
import type { NotifyUpcomingSessionsGateway } from './sessionReminder.repository.js';
import type { PushSender } from '../push/pusher.js';
import type { PushSubscriptionRepository } from '../modules/push/push.repository.js';

// Knapp unter "ein Tag vorher", robust gegen einen Cron-Takt von z. B.
// alle 6h (siehe Plan, Abschnitt 1.5.2) — eine Einheit fällt damit
// spätestens beim übernächsten Lauf ins Erinnerungsfenster, nie erst kurz
// vorher.
export const UPCOMING_SESSION_REMINDER_HOURS = 20;

export interface NotifyUpcomingSessionsResult {
  remindersSent: number;
  failed: Array<{ sessionId: string; error: string }>;
}

export async function notifyUpcomingSessions(
  gateway: NotifyUpcomingSessionsGateway,
  pusher: PushSender,
  pushSubscriptions: PushSubscriptionRepository,
  now: Date = new Date(),
  windowHours: number = UPCOMING_SESSION_REMINDER_HOURS,
): Promise<NotifyUpcomingSessionsResult> {
  const windowEnd = new Date(now.getTime() + windowHours * 60 * 60 * 1000);
  const candidates = await gateway.findUpcomingSessionsNeedingReminder(now, windowEnd);

  const result: NotifyUpcomingSessionsResult = { remindersSent: 0, failed: [] };

  for (const candidate of candidates) {
    try {
      // Erneute Prüfung direkt vor dem Versand (die Kandidatenliste oben
      // filtert bereits über die Datenbank, siehe Gateway-Kommentar) —
      // schützt gegen einen doppelten Versand, falls zwei Job-Läufe sich
      // zeitlich überschneiden (z. B. ein sehr langer vorheriger Lauf).
      if (await gateway.hasReminderBeenSent(candidate.id)) continue;

      const recipientIds = await gateway.findRecipientUserIds(candidate.clubId, candidate.groupId);
      if (recipientIds.length > 0) {
        const subscriptionsByUser = await pushSubscriptions.listByUserIds(recipientIds);
        const allSubscriptions = [...subscriptionsByUser.values()].flat();
        if (allSubscriptions.length > 0) {
          const { expiredSubscriptionIds } = await pusher.send(allSubscriptions, {
            title: 'Bevorstehendes Training',
            body: `Deine nächste Trainingseinheit ist am ${candidate.date.toLocaleDateString('de-DE')}.`,
            url: '#/sessions',
          });
          if (expiredSubscriptionIds.length > 0) await pushSubscriptions.deleteByIds(expiredSubscriptionIds);
        }
      }

      // Wird auch OHNE Empfänger:innen/Abos als erledigt markiert (kein
      // Nachhol-Versuch bei jedem künftigen Lauf für eine Einheit, deren
      // Gruppe z. B. gar keine Konten mit Push-Abo hat).
      await gateway.recordReminderSent(candidate.id);
      result.remindersSent += 1;
    } catch (err) {
      // Analog notifyExpiringQualifications.ts: recordReminderSent() wurde
      // für diese Einheit NICHT aufgerufen — der nächste Lauf versucht sie
      // erneut, solange sie noch im Erinnerungsfenster liegt.
      result.failed.push({ sessionId: candidate.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}
