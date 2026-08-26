// apps/api/test-integration/helpers.ts
//
// Gemeinsame Hilfsfunktionen für die Prisma-Integrationstests (siehe
// vitest.integration.config.ts für den Hintergrund). Diese Tests brauchen
// eine echte, leere PostgreSQL-Datenbank mit bereits angewendetem Schema
// (siehe README/CI: `prisma migrate deploy`).
import { PrismaClient } from '@prisma/client';
import { MODULE_KEYS } from '@lane1/shared-types';

let prisma: PrismaClient | null = null;

// Eine einzige, wiederverwendete Verbindung über die gesamte Testdatei
// hinweg (statt je Test eine neue) — analog zu getPrisma() in src/db/
// prisma.ts, hier aber bewusst eigenständig gehalten: die Testsuite soll
// unabhängig von Produktionscode-Details wie NODE_ENV-Caching bleiben.
export function getTestPrisma(): PrismaClient {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

export async function closeTestPrisma(): Promise<void> {
  await prisma?.$disconnect();
  prisma = null;
}

// Entfernt sämtliche Zeilen aller Anwendungstabellen. TRUNCATE ... CASCADE
// löst dabei automatisch jede Fremdschlüssel-Abhängigkeit auf (Club ->
// User/Group/Athlete -> Result/StartlistEntry/ActionItem/... -> Invitation/
// RefreshToken/DataDeletionRequest/SyncedEvent/SyncTombstone), ohne dass
// diese Funktion die recht verzweigte Lösch-Reihenfolge manuell nachbilden
// müsste. Wird nach JEDEM Test aufgerufen (siehe afterEach in den
// *.test.ts-Dateien dieses Verzeichnisses) — jeder Test startet dadurch mit
// einer leeren Datenbank, unabhängig von Ausführungsreihenfolge oder einem
// zuvor fehlgeschlagenen Test.
export async function truncateAll(client: PrismaClient = getTestPrisma()): Promise<void> {
  await client.$executeRawUnsafe(`
    TRUNCATE TABLE
      "action_items", "sessions", "plans", "templates", "exercises", "results",
      "startlist_entries", "competitions", "athletes", "groups",
      "sync_tombstones", "synced_events",
      "data_deletion_requests", "refresh_tokens", "invitations",
      "users", "clubs"
    RESTART IDENTITY CASCADE
  `);
}

// Legt einen minimalen Verein an — praktisch jede fachliche Tabelle führt
// clubId als Pflichtfeld (siehe schema.prisma), die meisten Tests brauchen
// also mindestens einen. Standardmäßig mit ALLEN Modul-Paketen aktiv
// (MODULE_KEYS) — die meisten Tests wollen ganz normalen, ungehinderten
// Sync-Zugriff prüfen, nicht das Modul-Gating selbst; wer gezielt ein
// eingeschränktes Modul-Set testen will, übergibt `enabledModules` explizit.
export async function createTestClub(
  client: PrismaClient = getTestPrisma(),
  name = 'Testverein',
  enabledModules: string[] = MODULE_KEYS,
): Promise<{ id: string; name: string; enabledModules: string[] }> {
  return client.club.create({ data: { name, enabledModules } });
}
