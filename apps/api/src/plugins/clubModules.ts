// Zentrale Stelle für die gebuchten Modul-Pakete eines Vereins
// (`Club.enabledModules`, siehe packages/shared-types/src/modules.ts) —
// sowohl für das Nachschlagen samt Cache als auch für das Sperren von
// Routen eines nicht gebuchten Moduls. app.ts legt GENAU EINEN Resolver je
// App-Instanz an und reicht ihn an alle Routen weiter, die Module prüfen
// (Sync, Qualifikationen, Kampfrichter); keine Route hält einen eigenen
// Cache oder eine eigene Gate-Funktion.
//
// Warum ein Cache: der JWT-Claim allein kennt die Module nicht (sie lassen
// sich jederzeit über die Superadmin-Bearbeiten-Ansicht ändern, ohne dass
// ein neues Token ausgestellt wird), ein Erstabgleich des Sync-Clients
// (bis zu 1.000 Pull-Seiten) würde ohne Cache aber jedes Mal dieselbe
// Club-Zeile lesen. Der kurze TTL ist der bewusste Trade-off: eine
// Änderung an enabledModules wirkt höchstens CLUB_MODULES_CACHE_TTL_MS
// später — gegenüber der Access-Token-Laufzeit (15 Minuten) ohnehin die
// schärfere Schranke.
//
// Warum je App-Instanz statt modulweit: jeder buildApp()-Aufruf —
// insbesondere jeder Test — bekommt automatisch einen eigenen, leeren
// Cache. Für den Produktivbetrieb unproblematisch, da genau ein
// Node-Prozess läuft (siehe docs/deployment/deployment.md).
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ModuleKey } from '@lane1/shared-types';

// Die einzige Abhängigkeit auf die Club-Daten — bewusst kein volles
// ClubRepository, damit diese Datei nicht vom invitations-Modul abhängt.
export interface ClubModulesLookup {
  findById(clubId: string): Promise<{ enabledModules: string[] } | null>;
}

export const CLUB_MODULES_CACHE_TTL_MS = 45_000;

export interface CachedClubModules {
  enabledModules: string[];
  expiresAt: number;
}

// Liefert die gebuchten Module eines Vereins; ein unbekannter Verein hat
// keine.
export type ClubModulesResolver = (clubId: string) => Promise<string[]>;

// Entfernt abgelaufene Einträge. Ohne den Sweep würde ein Eintrag nur bei
// erneutem Zugriff überschrieben, nie entfernt — ein Verein, der nie
// wieder abgefragt wird (z. B. nach einem harten DSGVO-Purge), bliebe
// dauerhaft in der Map. Als reine Funktion exportiert, damit die Logik
// ohne Timer/Fastify-Instanz testbar ist. `<=` passend zu `>` beim Lesen:
// ein Eintrag mit `expiresAt === now` gilt in beiden Prüfungen als
// abgelaufen.
export function sweepExpiredClubModules(cache: Map<string, CachedClubModules>, now: number): void {
  for (const [clubId, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(clubId);
  }
}

// Legt den Cache samt periodischem Sweep an und hängt dessen Aufräumen an
// den Lebenszyklus der übergebenen App-Instanz. `.unref()`: der Timer
// allein soll den Prozess nicht am Beenden hindern (relevant für Tests
// ohne app.close()); `onClose` beendet ihn zusätzlich für geschlossene
// Test-Apps.
export function createClubModulesResolver(
  app: FastifyInstance,
  clubs: ClubModulesLookup,
  ttlMs: number = CLUB_MODULES_CACHE_TTL_MS,
): ClubModulesResolver {
  const cache = new Map<string, CachedClubModules>();
  const sweepInterval = setInterval(() => sweepExpiredClubModules(cache, Date.now()), ttlMs);
  sweepInterval.unref?.();
  app.addHook('onClose', async () => clearInterval(sweepInterval));

  return async function resolveEnabledModules(clubId: string): Promise<string[]> {
    const now = Date.now();
    const cached = cache.get(clubId);
    if (cached && cached.expiresAt > now) return cached.enabledModules;
    const club = await clubs.findById(clubId);
    const enabledModules = club?.enabledModules ?? [];
    cache.set(clubId, { enabledModules, expiresAt: now + ttlMs });
    return enabledModules;
  };
}

// preHandler, der eine Route für Vereine ohne das gebuchte Modul sperrt
// (403 `module_not_enabled`). Muss NACH requireAnyRole() stehen und darf
// nur Rollen mit eigenem Verein zulassen — superadmin (clubId: null)
// kommt hier also nie an.
export function requireClubModule(resolve: ClubModulesResolver, module: ModuleKey, message: string) {
  return async function clubModuleGuard(request: FastifyRequest, reply: FastifyReply) {
    const enabledModules = await resolve(request.user!.clubId!);
    if (!enabledModules.includes(module)) {
      return reply.code(403).send({ error: 'module_not_enabled', message });
    }
  };
}
