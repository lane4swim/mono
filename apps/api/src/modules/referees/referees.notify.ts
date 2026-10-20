// Push-Benachrichtigungen zu Kampfrichter-Anfragen: an die Kampfrichter:in,
// sobald ein admin einen Einsatz anfragt (oder dessen Eckdaten ändert),
// und an die anfragende admin-Person, sobald die Kampfrichter:in zu- oder
// absagt. Versand ist best effort — ein Fehler (Push-Dienst nicht
// erreichbar) darf die eigentliche Anfrage/Antwort nie scheitern lassen,
// siehe referees.service.ts: notifySafely(). Texte wie bei den übrigen
// Push-Nachrichten (jobs/notifyUpcomingSessions.ts) auf Deutsch.
import type { PushSender } from '../../push/pusher.js';
import type { PushSubscriptionRepository } from '../push/push.repository.js';
import type { RefereeAssignmentRecord } from './referees.repository.js';

export interface RefereeNotifier {
  assignmentRequested(assignment: RefereeAssignmentRecord): Promise<void>;
  assignmentAnswered(assignment: RefereeAssignmentRecord, refereeName: string): Promise<void>;
}

export interface RefereeNotifierDeps {
  pusher: PushSender;
  pushSubscriptions: PushSubscriptionRepository;
}

function fmtDate(date: Date): string {
  return date.toLocaleDateString('de-DE', { timeZone: 'UTC' });
}

export function createRefereeNotifier(deps: RefereeNotifierDeps): RefereeNotifier {
  async function sendTo(userId: string, payload: { title: string; body: string; url: string }) {
    const subscriptions = await deps.pushSubscriptions.listByUserId(userId);
    if (subscriptions.length === 0) return;
    const { expiredSubscriptionIds } = await deps.pusher.send(subscriptions, payload);
    if (expiredSubscriptionIds.length > 0) await deps.pushSubscriptions.deleteByIds(expiredSubscriptionIds);
  }

  return {
    async assignmentRequested(assignment) {
      await sendTo(assignment.userId, {
        title: 'Anfrage: Kampfrichtereinsatz',
        body: `${assignment.competitionName} am ${fmtDate(assignment.date)} — bitte zu- oder absagen.`,
        url: `#/calendar/week/${assignment.date.toISOString().slice(0, 10)}`,
      });
    },
    async assignmentAnswered(assignment, refereeName) {
      if (!assignment.createdByAdminId) return;
      const verb = assignment.status === 'confirmed' ? 'zugesagt' : 'abgesagt';
      await sendTo(assignment.createdByAdminId, {
        title: `Kampfrichtereinsatz ${verb}`,
        body: `${refereeName}: ${assignment.competitionName} am ${fmtDate(assignment.date)}${assignment.responseNote ? ` — „${assignment.responseNote}“` : ''}`,
        url: '#/kampfrichter',
      });
    },
  };
}
