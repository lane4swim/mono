// Push-Auslöse-Hook für ein neu angelegtes Announcement (Phase 2,
// Abschnitt 2.4 — docs/Plans/phase2-plan.md). Bewusst AUSSERHALB von
// sync.service.ts (dessen push() reine Push/Pull-Mechanik bleibt, siehe
// dortiger Datei-Kopfkommentar) — sync.route.ts ruft diese Funktion NACH
// syncService.push() fire-and-forget auf, siehe dort.
import type { PushSender } from '../../push/pusher.js';
import type { PushSubscriptionRepository } from '../push/push.repository.js';
import type { AnnouncementRecipientsGateway } from './announcementRecipients.repository.js';

export interface AnnouncementNotifyDeps {
  pusher: PushSender;
  pushSubscriptions: PushSubscriptionRepository;
  recipients: AnnouncementRecipientsGateway;
}

// Nimmt die ROHEN, bereits an syncService.push() übergebenen Events
// entgegen — nur von dort lässt sich das Payload (title/groupId) eines NEU
// angelegten Announcements ablesen. Welche davon tatsächlich eine neue Zeile
// angelegt haben, meldet push() über `onCreated` (createdEventIds): der
// Status "applied" allein reicht nicht, er gilt auch für Idempotenz-
// Wiederholungen und für ein "create" auf eine bereits bestehende entityId —
// beides löste sonst erneut eine Benachrichtigung aus.
// `unknown[]` statt `SyncEvent[]`: sync.route.ts validiert `body.events`
// bewusst nicht vollständig VOR syncService.push() (das übernimmt dessen
// eigene, event-weise Validierung) — die Felder werden hier defensiv
// gelesen, analog sync.athleteScope.ts.
export async function notifyAnnouncementCreated(
  deps: AnnouncementNotifyDeps,
  events: readonly unknown[],
  createdEventIds: ReadonlySet<string>,
  clubId: string,
  authorUserId: string,
): Promise<void> {
  // Dieselbe event-id kann im Batch mehrfach vorkommen (Wiederholung
  // innerhalb eines Requests) — benachrichtigt wird trotzdem nur einmal.
  const notified = new Set<string>();
  for (const raw of events) {
    const event = raw as { id?: unknown; store?: unknown; payload?: unknown } | null;
    if (!event || event.store !== 'announcements') continue;
    if (typeof event.id !== 'string' || !createdEventIds.has(event.id) || notified.has(event.id)) continue;
    notified.add(event.id);

    const payload = event.payload as { title?: unknown; groupId?: unknown } | null;
    const title = typeof payload?.title === 'string' ? payload.title : '';
    const groupId = typeof payload?.groupId === 'string' ? payload.groupId : null;

    const recipientIds = await deps.recipients.findRecipientUserIds(clubId, groupId, authorUserId);
    if (recipientIds.length === 0) continue;

    const subscriptionsByUser = await deps.pushSubscriptions.listByUserIds(recipientIds);
    const allSubscriptions = [...subscriptionsByUser.values()].flat();
    if (allSubscriptions.length === 0) continue;

    const { expiredSubscriptionIds } = await deps.pusher.send(allSubscriptions, {
      title: 'Neue Ankündigung',
      body: title,
      url: '#/announcements',
    });
    if (expiredSubscriptionIds.length > 0) await deps.pushSubscriptions.deleteByIds(expiredSubscriptionIds);
  }
}
