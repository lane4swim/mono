import type { PushPayload, PushSendResult, PushSender, PushSubscriptionTarget } from './pusher.js';

export class InMemoryPushSender implements PushSender {
  sent: Array<{ subscriptions: readonly PushSubscriptionTarget[]; payload: PushPayload }> = [];
  // Für Tests: von der Testsuite vorab befüllte Menge an IDs, die als
  // "abgelaufen" gemeldet werden sollen (simuliert einen 404/410 vom
  // Push-Dienst, siehe pusher.webpush.ts).
  expiredIds = new Set<string>();

  async send(subscriptions: readonly PushSubscriptionTarget[], payload: PushPayload): Promise<PushSendResult> {
    this.sent.push({ subscriptions, payload });
    return { expiredSubscriptionIds: subscriptions.filter((s) => this.expiredIds.has(s.id)).map((s) => s.id) };
  }
}
