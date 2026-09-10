// Endpunkte für Web-Push-Abos (Phase 2, Abschnitt 1.3 —
// docs/Plans/phase2-plan.md). Läuft NICHT über die generische Sync-API —
// PushSubscription ist kein Sync-Store (reine Server-Infrastruktur, siehe
// Plan Abschnitt 1.2). Anders als qualifications/kampfrichter KEIN
// Modul-Gating (`enabledModules`) — Push-Abo ist Konto-Infrastruktur,
// unabhängig davon, welche zubuchbaren Pakete ein Verein gebucht hat;
// welche EREIGNISSE tatsächlich Push auslösen, prüft weiterhin jeder
// einzelne Auslöser selbst gegen `enabledModules` (siehe
// jobs/notifyUpcomingSessions.ts, sync.route.ts: notifyAnnouncementCreated()).
import type { FastifyInstance } from 'fastify';
import { PushSubscribeRequestSchema, PushUnsubscribeRequestSchema } from '@lane1/shared-types';
import type { PushSubscriptionRepository } from './push.repository.js';
import { requireAnyRole } from '../../plugins/authorize.js';
import { parseInput } from '../../plugins/parseInput.js';

export interface PushRoutesOptions {
  subscriptions: PushSubscriptionRepository;
  // null, wenn kein VAPID-Schlüsselpaar konfiguriert ist (siehe
  // resolvePushSender() in app.ts) — der Endpunkt liefert dann
  // { publicKey: null }, das Frontend blendet den Umschalter aus.
  vapidPublicKey: string | null;
}

// Wird in Abschnitt 4.2 um "parent" ergänzt, sobald diese Rolle existiert
// — Push-Abo ist für jede Konto-Rolle gleichermaßen sinnvoll, unabhängig
// vom (dort stark eingeschränkten) Datenzugriff dieser Rolle.
const PUSH_ROLES = ['trainer', 'admin', 'athlete'] as const;

export async function pushRoutes(app: FastifyInstance, opts: PushRoutesOptions) {
  const { subscriptions, vapidPublicKey } = opts;
  const guard = [app.authenticate, requireAnyRole(...PUSH_ROLES)];

  app.get('/api/push/public-key', { preHandler: guard }, async (_request, reply) => {
    return reply.code(200).send({ publicKey: vapidPublicKey });
  });

  app.post('/api/push/subscriptions', { preHandler: guard }, async (request, reply) => {
    const body = parseInput(PushSubscribeRequestSchema, request.body, reply);
    if (!body) return;
    await subscriptions.upsert(request.user!.sub, body.endpoint, body.keys);
    return reply.code(204).send();
  });

  app.delete('/api/push/subscriptions', { preHandler: guard }, async (request, reply) => {
    const body = parseInput(PushUnsubscribeRequestSchema, request.body, reply);
    if (!body) return;
    await subscriptions.remove(request.user!.sub, body.endpoint);
    return reply.code(204).send();
  });
}
