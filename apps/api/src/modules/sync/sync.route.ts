// Phase 3: echte Implementierung (ersetzt den Phase-0/1-501-Platzhalter).
// Siehe Abschnitt 6 des Backend-Entwicklungsplans für den Gesamtfluss.
// Nur eingeloggte Vereinsmitglieder (trainer/admin/athlete) dürfen
// synchronisieren — Superadmin hat keinen eigenen Verein und wird über
// requireAnyRole ausgeschlossen.
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { SyncPushRequestSchema, SyncPullQuerySchema } from '@lane1/shared-types';
import type { SyncService, SyncRequester } from './sync.service.js';
import { notifyAnnouncementCreated, type AnnouncementNotifyDeps } from './sync.announcementNotify.js';
import { requireAnyRole } from '../../plugins/authorize.js';
import { parseInput } from '../../plugins/parseInput.js';
import { requesterFrom } from '../../plugins/requester.js';
import type { ClubModulesResolver } from '../../plugins/clubModules.js';

export interface SyncRoutesOptions {
  syncService: SyncService;
  // Gebuchte Module des Vereins, siehe plugins/clubModules.ts.
  clubModules: ClubModulesResolver;
  // Phase 2, Abschnitt 2.4 (docs/Plans/phase2-plan.md): optional, damit
  // Tests, die den Announcement-Push-Hook nicht brauchen, ihn weglassen
  // können (dann ein No-op, siehe requestHandler unten).
  announcementNotify?: AnnouncementNotifyDeps;
}

// Sicherheitsreview 2026-08, Befund N4: push()/pull() vertrauen vollständig
// den Access-Token-Claims (clubId/role/athleteId) — keine erneute
// Datenbankabfrage gegen den aktuellen User-Datensatz. Bewusst so
// akzeptiert (siehe ausführliche Begründung in plugins/authenticate.ts,
// direkt über app.authenticate), nicht übersehen.
export async function syncRoutes(app: FastifyInstance, opts: SyncRoutesOptions) {
  const { syncService, clubModules, announcementNotify } = opts;
  const syncGuard = [app.authenticate, requireAnyRole('trainer', 'admin', 'athlete')];

  // requireAnyRole hat bereits sichergestellt, dass die Rolle stimmt; eine Rolle
  // ohne Verein (theoretisch nur superadmin) kommt hier also nicht an —
  // clubId ist an dieser Stelle immer gesetzt. role/athleteId werden
  // zusätzlich mitgegeben, damit der Service die Rollen-Scopierung für
  // "athlete" anwenden kann (siehe sync.service.ts). Baut auf dem
  // gemeinsamen requesterFrom() (plugins/requester.ts) auf — eine Stelle
  // statt einer Wiederholung dieses Objekt-Literals in push()/pull(). Die
  // gebuchten Module des Vereins kommen aus dem gemeinsamen, kurzlebigen
  // Cache (plugins/clubModules.ts) — der JWT-Claim allein kennt sie
  // nicht. `sub` (Sicherheitsreview 2026-08-27, Befund M2) wird zusätzlich als
  // `userId` durchgereicht — für die Autor:innen-Prüfung eingebetteter
  // Kommentare (siehe sync.commentAuthorship.ts).
  async function syncRequesterFrom(request: FastifyRequest): Promise<SyncRequester> {
    const { id, clubId } = requesterFrom(request);
    const user = request.user!;
    const enabledModules = await clubModules(clubId!);
    return {
      userId: id,
      clubId: clubId!,
      // Direkt aus den Claims statt aus Requester.roles (`string[]`):
      // sync.permissions.ts braucht die engere `Role[]`-Typisierung.
      roles: user.roles,
      athleteId: user.athleteId,
      enabledModules,
    };
  }

  app.post('/api/sync/push', { preHandler: syncGuard }, async (request, reply) => {
    const body = parseInput(SyncPushRequestSchema, request.body, reply);
    if (!body) return;
    const requester = await syncRequesterFrom(request);
    const createdEventIds = new Set<string>();
    const results = await syncService.push(body.events, requester, { onCreated: (eventId) => createdEventIds.add(eventId) });

    // Phase 2, Abschnitt 2.4: fire-and-forget — läuft NACH dem Senden der
    // Sync-Antwort (siehe .then() statt await) und blockiert diese daher
    // nicht; ein Fehler hier darf einen ansonsten erfolgreichen Sync-Push
    // nicht scheitern lassen (nur geloggt).
    if (announcementNotify) {
      notifyAnnouncementCreated(announcementNotify, body.events, createdEventIds, requester.clubId, requester.userId).catch((err) => {
        app.log.error({ err }, 'Push-Benachrichtigung für neues Announcement fehlgeschlagen');
      });
    }

    return reply.code(200).send({ results });
  });

  app.get<{ Querystring: { since?: string; cursor?: string } }>(
    '/api/sync/pull',
    { preHandler: syncGuard },
    async (request, reply) => {
      // Ohne diese Prüfung erzeugte ein ungültiger "cursor"/"since"-Wert
      // (z. B. "?cursor=abc") in syncService.pull() ein `Invalid Date`,
      // das die Datenbankabfrage mit einem ungefangenen Fehler statt einer
      // regulären 400-Antwort quittierte.
      const query = parseInput(SyncPullQuerySchema, request.query, reply);
      if (!query) return;
      const result = await syncService.pull(query, await syncRequesterFrom(request));
      return reply.code(200).send(result);
    },
  );
}
