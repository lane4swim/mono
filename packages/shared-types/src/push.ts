// Vertrag für Web-Push-Abos (Phase 2, Abschnitt 1.2 —
// docs/Plans/phase2-plan.md). Bewusst getrennt von entities.ts: kein
// Sync-Store, eigene REST-Endpunkte (siehe Plan, Abschnitt 1.3).
import { z } from 'zod';

// Sicherheitskorrektur (Code-Review): `endpoint` wird serverseitig
// unverändert als Ziel-URL eines echten HTTP-POST verwendet
// (apps/api/src/push/pusher.webpush.ts: webpush.sendNotification()) —
// ausgelöst NICHT von der anfragenden Person selbst, sondern zeitversetzt
// von einem Cron-Job oder einem Push-Auslöse-Hook (siehe
// jobs/notifyUpcomingSessions.ts, sync.announcementNotify.ts). Ohne
// Einschränkung auf die tatsächlichen Web-Push-Dienste der Browser-
// Hersteller könnte JEDES authentifizierte Konto (auch die am wenigsten
// privilegierte Rolle "athlete") eine beliebige interne/private Adresse
// (z. B. ein Cloud-Metadaten-Endpunkt oder ein Dienst im selben Netz) als
// "endpoint" registrieren und den Server damit zu einem SSRF-Werkzeug
// machen — ein reines `.url()` erlaubt jede syntaktisch gültige URL.
// Die hier gelisteten Hosts sind die einzigen, die der Browser über
// `PushManager.subscribe()` tatsächlich je liefert (Chrome/Edge/Opera/
// Samsung Internet -> FCM, Firefox -> Mozilla Autopush, Safari -> Apple,
// älteres Edge/Windows -> WNS) — ein legitimes Abo trifft diese Liste
// immer, ein manipulierter Wert nie.
const ALLOWED_PUSH_ENDPOINT_HOSTS = [
  'fcm.googleapis.com',
  'android.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
  'notify.windows.com',
];

function isKnownPushServiceEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return ALLOWED_PUSH_ENDPOINT_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

// Entspricht exakt der Struktur, die der Browser über
// `PushSubscription.toJSON()` liefert — keine Transformation nötig.
export const PushSubscribeRequestSchema = z.object({
  endpoint: z.string().url().max(2000).refine(isKnownPushServiceEndpoint, {
    message: 'Der Push-Endpunkt gehört zu keinem bekannten Push-Dienst.',
  }),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(500),
  }),
});
export type PushSubscribeRequest = z.infer<typeof PushSubscribeRequestSchema>;

export const PushUnsubscribeRequestSchema = z.object({
  endpoint: z.string().url().max(2000),
});
export type PushUnsubscribeRequest = z.infer<typeof PushUnsubscribeRequestSchema>;

export const PushPublicKeyResponseSchema = z.object({
  // null, wenn der Server kein VAPID-Schlüsselpaar konfiguriert hat
  // (z. B. lokale Entwicklung ohne .env-Eintrag) — das Frontend blendet
  // den Umschalter in diesem Fall aus (siehe apps/web/js/push.js).
  publicKey: z.string().nullable(),
});
export type PushPublicKeyResponse = z.infer<typeof PushPublicKeyResponseSchema>;
