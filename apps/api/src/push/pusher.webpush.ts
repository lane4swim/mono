// Echter Versand über das `web-push`-Paket (VAPID) — kein Drittanbieter-
// Dienst (FCM/APNs) nötig, der Browser liefert den Push-Endpunkt selbst.
import webpush from 'web-push';
import type { PushPayload, PushSendResult, PushSender, PushSubscriptionTarget } from './pusher.js';

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export class WebPushSender implements PushSender {
  constructor(config: VapidConfig) {
    webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  }

  async send(subscriptions: readonly PushSubscriptionTarget[], payload: PushPayload): Promise<PushSendResult> {
    const body = JSON.stringify(payload);
    const expiredSubscriptionIds: string[] = [];

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
          );
        } catch (err) {
          // 404/410: der Push-Dienst kennt diesen Endpoint nicht mehr
          // (Browser-Daten gelöscht, Deinstallation) — dauerhaft, kein
          // erneuter Versuch sinnvoll. Jeder andere Fehler (z. B.
          // vorübergehender Netzwerkfehler des Push-Diensts) wird
          // stillschweigend übersprungen — der nächste Versand-Versuch
          // (nächstes Ereignis) holt ihn automatisch nach, kein
          // eigener Retry-Mechanismus nötig für einen Zusatzkanal neben
          // E-Mail (siehe docs/Plans/phase2-plan.md, Abschnitt 1.5.1).
          const statusCode = (err as { statusCode?: number })?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            expiredSubscriptionIds.push(sub.id);
          }
        }
      }),
    );

    return { expiredSubscriptionIds };
  }
}
