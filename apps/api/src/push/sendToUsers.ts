// Zentrale Stelle für den Versand einer Push-Nachricht an Konten: Abos der
// Konten laden, an alle Geräte senden, vom Push-Dienst als abgelaufen
// gemeldete Abos (HTTP 404/410, siehe pusher.webpush.ts) löschen. Jeder
// Auslöser (Kampfrichter-Anfragen, neue Ankündigungen, Trainings- und
// Qualifikations-Erinnerungen) ruft sendPushToUsers() auf, statt diese
// Abfolge selbst nachzubauen.
//
// Fehler werden bewusst NICHT abgefangen: wie mit einem Fehlschlag
// umzugehen ist, entscheidet der Aufrufer (best effort bei Anfragen und
// Ankündigungen, Wiederholung beim nächsten Lauf in den Erinnerungs-Jobs).
import type { PushPayload, PushSender } from './pusher.js';
import type { PushSubscriptionRepository } from '../modules/push/push.repository.js';

export interface PushDeliveryDeps {
  pusher: PushSender;
  pushSubscriptions: Pick<PushSubscriptionRepository, 'listByUserIds' | 'deleteByIds'>;
}

// Sendet `payload` in EINEM Aufruf an alle Abos aller genannten Konten.
// Konten ohne Abo werden übersprungen; ohne ein einziges Abo wird gar
// nichts gesendet.
export async function sendPushToUsers(deps: PushDeliveryDeps, userIds: readonly string[], payload: PushPayload): Promise<void> {
  if (userIds.length === 0) return;
  const subscriptionsByUser = await deps.pushSubscriptions.listByUserIds(userIds);
  const subscriptions = [...subscriptionsByUser.values()].flat();
  if (subscriptions.length === 0) return;
  const { expiredSubscriptionIds } = await deps.pusher.send(subscriptions, payload);
  if (expiredSubscriptionIds.length > 0) await deps.pushSubscriptions.deleteByIds(expiredSubscriptionIds);
}

// Datumsangabe in Push-Texten (deutsch, wie alle Push-Nachrichten).
// Termine (Trainingseinheiten, Wettkampfeinsätze) sind reine Kalendertage
// und werden als UTC-Mitternacht gespeichert (siehe apps/web/js/dates.js:
// toIsoDateTime()); formatiert wird deshalb in UTC. In der lokalen
// Zeitzone des Servers zeigte ein Server westlich von UTC sonst den
// Vortag.
export function formatPushDate(date: Date): string {
  return date.toLocaleDateString('de-DE', { timeZone: 'UTC' });
}
