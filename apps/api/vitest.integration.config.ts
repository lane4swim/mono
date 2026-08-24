// apps/api/vitest.integration.config.ts
//
// Eigene Konfiguration statt eines gemeinsamen Configs mit vitest.config.ts
// (siehe Code-Review, Befund 14): die dortige Suite (test/**/*.test.ts)
// läuft bewusst OHNE Datenbank — ausschließlich gegen die *.repository.
// memory.ts-Test-Doubles —, damit sie überall (auch ohne lokal laufendes
// Postgres) sofort lauffähig ist. Diese Suite prüft dagegen GENAU das
// Gegenstück: die echten Prisma-Implementierungen (PrismaSyncGateway,
// PrismaUserRepository, PrismaProfileDataGateway, PrismaErasureJobGateway)
// gegen eine ECHTE PostgreSQL-Datenbank — dort sitzt das sicherheitskritische
// Vereins-Scoping ("where: { id, clubId }") und die Pull-Pagination, die
// kein In-Memory-Double abbilden kann. Braucht DATABASE_URL (siehe
// test-integration/helpers.ts); lokal z. B. per `docker compose up -d db`
// (siehe docker-compose.yml) oder gegen einen lokalen Postgres-Server.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test-integration/**/*.test.ts'],
    // Reihenfolge unwichtig, aber NICHT parallel über mehrere Worker/Dateien
    // hinweg: jede Testdatei räumt sich selbst per truncateAll() in
    // afterEach() auf (siehe helpers.ts) — parallele Dateien gegen dieselbe
    // Datenbank würden sich sonst gegenseitig die Tabellen leeren.
    fileParallelism: false,
    // Reale Netzwerk-Roundtrips zu Postgres sind langsamer als die reinen
    // In-Memory-Tests — dasselbe großzügigere Timeout wie in vitest.config.ts.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
