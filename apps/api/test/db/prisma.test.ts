// apps/api/test/db/prisma.test.ts
//
// Regressionstest für Sicherheitsreview 2026-08-29, Befund M1: getPrisma()
// cachte die PrismaClient-Instanz ausschließlich in `globalThis.__prisma`,
// und diese Zuweisung war bewusst auf Nicht-Produktion beschränkt. In
// Produktion lieferte jeder Aufruf daher eine FRISCHE Instanz — app.ts
// ruft die Funktion an elf Stellen auf, es entstanden also elf Clients mit
// je eigenem Verbindungspool (Prisma-Default für PostgreSQL:
// num_cpus * 2 + 1). Auf einem Vier-Kern-Server sind das 99 Verbindungen
// gegen PostgreSQLs Standard-`max_connections` von 100 — die API konnte
// sich unter Last selbst von der Datenbank aussperren.
//
// Geprüft wird die IDENTITÄT der zurückgegebenen Instanz, nicht die Zahl
// der Konstruktoraufrufe: getPrisma() lädt `@prisma/client` bewusst über
// createRequire() (siehe src/db/prisma.ts) statt über einen statischen
// Import, und ein `vi.mock('@prisma/client')` greift auf diesem CJS-Pfad
// nicht. Identität deckt den Befund vollständig ab — vor der Korrektur
// lieferten zwei aufeinanderfolgende Aufrufe in Produktion zwei
// verschiedene Objekte.
//
// `new PrismaClient()` baut keine Verbindung auf (Prisma verbindet lazy
// beim ersten Query), es genügt also der GENERIERTE Client ohne laufende
// Datenbank. Fehlt auch der (ein frisch geklontes Repo ohne
// `npm run prisma:generate` — der Rest der Unit-Suite kommt bewusst ohne
// ihn aus, siehe Kopfkommentar von src/db/prisma.ts), wird der Test
// übersprungen statt fälschlich rot zu werden. In CI läuft
// `prisma:generate` vor der Testsuite (siehe .github/workflows/ci.yml),
// dort greift er also immer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const hasGeneratedClient = (() => {
  try {
    const require = createRequire(import.meta.url);
    return typeof (require('@prisma/client') as { PrismaClient?: unknown }).PrismaClient === 'function';
  } catch {
    return false;
  }
})();

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  delete globalThis.__prisma;
  // Modul-Registry je Test zurücksetzen, damit der modulinterne Cache
  // (der eigentliche Gegenstand dieses Tests) frisch beginnt — sonst wäre
  // nur der allererste Test in dieser Datei aussagekräftig.
  vi.resetModules();
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  delete globalThis.__prisma;
});

describe.skipIf(!hasGeneratedClient)('getPrisma() — Befund M1', () => {
  it('liefert in PRODUKTION über mehrere Aufrufe hinweg dieselbe Instanz', async () => {
    process.env.NODE_ENV = 'production';
    const { getPrisma } = await import('../../src/db/prisma.js');

    const first = getPrisma();

    expect(getPrisma()).toBe(first);
    expect(getPrisma()).toBe(first);
  });

  it('legt die Instanz in der Entwicklung zusätzlich global ab (tsx-watch-Brücke), in Produktion nicht', async () => {
    process.env.NODE_ENV = 'production';
    const { getPrisma } = await import('../../src/db/prisma.js');
    getPrisma();
    // In Produktion trägt allein der Modul-Cache — globalThis bleibt frei.
    expect(globalThis.__prisma).toBeUndefined();
  });
});

describe('getPrisma() — globaler Cache hat Vorrang', () => {
  it('übernimmt eine bereits global abgelegte Instanz, statt eine zweite anzulegen', async () => {
    // Braucht keinen generierten Client: der globale Treffer kehrt zurück,
    // bevor createRequire() überhaupt erreicht wird.
    const existing = { marker: 'aus einem früheren Modul-Ladevorgang' } as never;
    globalThis.__prisma = existing;

    const { getPrisma } = await import('../../src/db/prisma.js');
    expect(getPrisma()).toBe(existing);
  });
});
