// Ausweichlösung ohne konfiguriertes VAPID-Schlüsselpaar (siehe
// resolvePushSender() in app.ts) — protokolliert statt zu versenden,
// analog mail/mailer.ts: ConsoleMailSender. Praktisch für lokale
// Entwicklung/Demo ohne eigenes Schlüsselpaar.
import type { PushPayload, PushSendResult, PushSender, PushSubscriptionTarget } from './pusher.js';

export class ConsolePushSender implements PushSender {
  async send(subscriptions: readonly PushSubscriptionTarget[], payload: PushPayload): Promise<PushSendResult> {
    if (subscriptions.length > 0) {
      console.warn(`[push] Kein VAPID-Schlüssel konfiguriert — ${subscriptions.length} Abo(s) nicht erreicht: "${payload.title}" — ${payload.body}`);
    }
    return { expiredSubscriptionIds: [] };
  }
}
