// Push-Benachrichtigungen zu Kampfrichter-Anfragen: an die Kampfrichter:in,
// sobald ein admin einen Einsatz anfragt (oder dessen Eckdaten ändert),
// und an die anfragende admin-Person, sobald die Kampfrichter:in zu- oder
// absagt. Versand ist best effort — ein Fehler (Push-Dienst nicht
// erreichbar) darf die eigentliche Anfrage/Antwort nie scheitern lassen,
// siehe referees.service.ts: notifySafely(). Texte wie bei den übrigen
// Push-Nachrichten (jobs/notifyUpcomingSessions.ts) auf Deutsch.
import { sendPushToUsers, formatPushDate, type PushDeliveryDeps } from '../../push/sendToUsers.js';
import type { RefereeAssignmentRecord } from './referees.repository.js';

export interface RefereeNotifier {
  assignmentRequested(assignment: RefereeAssignmentRecord): Promise<void>;
  assignmentAnswered(assignment: RefereeAssignmentRecord, refereeName: string): Promise<void>;
}

export type RefereeNotifierDeps = PushDeliveryDeps;

export function createRefereeNotifier(deps: RefereeNotifierDeps): RefereeNotifier {
  return {
    async assignmentRequested(assignment) {
      await sendPushToUsers(deps, [assignment.userId], {
        title: 'Anfrage: Kampfrichtereinsatz',
        body: `${assignment.competitionName} am ${formatPushDate(assignment.date)} — bitte zu- oder absagen.`,
        url: `#/calendar/week/${assignment.date.toISOString().slice(0, 10)}`,
      });
    },
    async assignmentAnswered(assignment, refereeName) {
      if (!assignment.createdByAdminId) return;
      const verb = assignment.status === 'confirmed' ? 'zugesagt' : 'abgesagt';
      await sendPushToUsers(deps, [assignment.createdByAdminId], {
        title: `Kampfrichtereinsatz ${verb}`,
        body: `${refereeName}: ${assignment.competitionName} am ${formatPushDate(assignment.date)}${assignment.responseNote ? ` — „${assignment.responseNote}“` : ''}`,
        url: '#/kampfrichter',
      });
    },
  };
}
