// Vertrag für Web-Push-Abos (Phase 2, Abschnitt 1.2 —
// docs/Plans/phase2-plan.md). Bewusst getrennt von entities.ts: kein
// Sync-Store, eigene REST-Endpunkte (siehe Plan, Abschnitt 1.3).
import { z } from 'zod';

// Entspricht exakt der Struktur, die der Browser über
// `PushSubscription.toJSON()` liefert — keine Transformation nötig.
export const PushSubscribeRequestSchema = z.object({
  endpoint: z.string().url().max(2000),
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
