// apps/api/src/modules/sync/sync.route.ts
//
// Phase 3: echte Implementierung (ersetzt den Phase-0/1-501-Platzhalter).
// Siehe Abschnitt 6 des Backend-Entwicklungsplans für den Gesamtfluss.
// Nur eingeloggte Vereinsmitglieder (trainer/admin/athlete) dürfen
// synchronisieren — Superadmin hat keinen eigenen Verein und wird über
// requireRole ausgeschlossen.
import type { FastifyInstance } from 'fastify';
import { SyncPushRequestSchema, SyncPullQuerySchema } from '@lane1/shared-types';
import type { SyncService, SyncRequester } from './sync.service.js';
import { requireRole } from '../../plugins/authorize.js';
import { parseInput } from '../../plugins/parseInput.js';

// Minimale, für dieses Modul ausreichende Nachschlagemöglichkeit für die
// Modul-Pakete eines Vereins — bewusst kein volles ClubRepository, um
// keine Abhängigkeit auf das gesamte invitations-Modul einzuführen (siehe
// AthleteLookup in invitations.repository.ts für dasselbe Prinzip).
export interface ClubModulesLookup {
  findById(clubId: string): Promise<{ enabledModules: string[] } | null>;
}

export interface SyncRoutesOptions {
  syncService: SyncService;
  clubs: ClubModulesLookup;
}

// Review 30.08.2026, Befund E1: requesterFrom() rief clubs.findById() bei
// JEDER Push-/Pull-Anfrage auf — ein Erstabgleich (syncClient.js: pull()
// läuft in einer Schleife bis hasMore === false, bis zu
// MAX_PULL_ITERATIONS = 1000 Seiten) fragte damit bis zu 1.000-mal
// dieselbe, sich währenddessen nicht ändernde Club-Zeile ab. Kurzlebiger
// In-Memory-Cache statt einer echten Invalidierung: ein per Superadmin-
// Bearbeiten-Ansicht geändertes enabledModules-Set wirkt dadurch höchstens
// CLUB_MODULES_CACHE_TTL_MS später statt sofort — gegenüber der
// Access-Token-Laufzeit von 15 Minuten (JWT_ACCESS_TTL_SECONDS, siehe
// S5) ohnehin die schärfere Schranke, und exakt der in der Empfehlung
// dieses Befunds akzeptierte Trade-off.
//
// Bewusst als Closure INNERHALB syncRoutes() (unten), nicht als
// Modul-weiter Singleton: jeder buildApp()-Aufruf — insbesondere jeder
// Test über buildTestApp() — bekommt dadurch automatisch seinen eigenen,
// leeren Cache, ohne dass Tests ihn manuell zurücksetzen müssten oder
// zwischen ihnen veraltete Werte eines anderen Tests sehen könnten.
// Unproblematisch für den dokumentierten Produktivbetrieb (PM2 ohne
// Cluster-Modus, siehe docs/deployment.md — GENAU EIN Node-Prozess, kein
// Mehrprozess-Konsistenzproblem).
const CLUB_MODULES_CACHE_TTL_MS = 45_000;

interface CachedClubModules {
  enabledModules: string[];
  expiresAt: number;
}

// Sicherheitsreview 2026-08, Befund N4: push()/pull() vertrauen vollständig
// den Access-Token-Claims (clubId/role/athleteId) — keine erneute
// Datenbankabfrage gegen den aktuellen User-Datensatz. Bewusst so
// akzeptiert (siehe ausführliche Begründung in plugins/authenticate.ts,
// direkt über app.authenticate), nicht übersehen.
export async function syncRoutes(app: FastifyInstance, opts: SyncRoutesOptions) {
  const { syncService, clubs } = opts;
  const syncGuard = [app.authenticate, requireRole('trainer', 'admin', 'athlete')];

  const clubModulesCache = new Map<string, CachedClubModules>();

  async function resolveEnabledModules(clubId: string): Promise<string[]> {
    const now = Date.now();
    const cached = clubModulesCache.get(clubId);
    if (cached && cached.expiresAt > now) return cached.enabledModules;
    const club = await clubs.findById(clubId);
    const enabledModules = club?.enabledModules ?? [];
    clubModulesCache.set(clubId, { enabledModules, expiresAt: now + CLUB_MODULES_CACHE_TTL_MS });
    return enabledModules;
  }

  // requireRole hat bereits sichergestellt, dass die Rolle stimmt; eine Rolle
  // ohne Verein (theoretisch nur superadmin) kommt hier also nicht an —
  // clubId ist an dieser Stelle immer gesetzt. role/athleteId werden
  // zusätzlich mitgegeben, damit der Service die Rollen-Scopierung für
  // "athlete" anwenden kann (siehe sync.service.ts). Analog zu requesterFrom()
  // in invitations.route.ts — eine Stelle statt einer Wiederholung dieses
  // Objekt-Literals in push()/pull(). Lädt die gebuchten Module des Vereins
  // über den obigen Cache — der JWT-Claim allein (request.user) kennt sie
  // nicht, da sich enabledModules jederzeit über die Superadmin-
  // Bearbeiten-Ansicht ändern kann, ohne dass ein neues Token ausgestellt
  // wird. `sub` (Sicherheitsreview 2026-08-27, Befund M2) wird zusätzlich als
  // `userId` durchgereicht — für die Autor:innen-Prüfung eingebetteter
  // Kommentare (siehe sync.commentAuthorship.ts).
  async function requesterFrom(
    request: { user?: { sub: string; role: SyncRequester['role']; clubId: string | null; athleteId: string | null } },
  ): Promise<SyncRequester> {
    const user = request.user!;
    const enabledModules = await resolveEnabledModules(user.clubId!);
    return {
      userId: user.sub,
      clubId: user.clubId!,
      role: user.role,
      athleteId: user.athleteId,
      enabledModules,
    };
  }

  app.post('/api/sync/push', { preHandler: syncGuard }, async (request, reply) => {
    const body = parseInput(SyncPushRequestSchema, request.body, reply);
    if (!body) return;
    const results = await syncService.push(body.events, await requesterFrom(request));
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
      const result = await syncService.pull(query, await requesterFrom(request));
      return reply.code(200).send(result);
    },
  );
}
