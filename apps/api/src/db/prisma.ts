// apps/api/src/db/prisma.ts
//
// Lazy statt eager: die PrismaClient-Instanz wird erst bei tatsächlichem
// Bedarf erzeugt (getPrisma()), nicht schon beim Import dieses Moduls.
// Wichtig für Tests — buildApp() übergibt dort immer einen authService-
// Override (In-Memory-Repositories), sodass getPrisma() nie aufgerufen
// wird und somit kein generierter Prisma Client vorhanden sein muss.
import { createRequire } from 'node:module';
import type { PrismaClient as PrismaClientType } from '@prisma/client';

// apps/api ist ein ECMAScript-Modul ("type": "module") — ein nackter
// `require(...)` ist dort zur Laufzeit nicht definiert
// (ReferenceError: require is not defined). `createRequire` ist die von
// Node offiziell vorgesehene Brücke, um trotzdem synchron/lazy zu laden.
const require = createRequire(import.meta.url);

declare global {
  var __prisma: PrismaClientType | undefined;
}

// Sicherheitsreview 2026-08-29, Befund M1: der Prozess-weite Cache lag
// bislang AUSSCHLIESSLICH in `globalThis.__prisma`, und dieser wurde
// bewusst nur außerhalb von Produktion gesetzt — in Produktion lieferte
// getPrisma() daher bei JEDEM Aufruf eine FRISCHE PrismaClient-Instanz.
// app.ts ruft die Funktion an elf Stellen auf (je Repository/Gateway
// einmal, siehe dortiger Kommentar), es entstanden dort also elf
// unabhängige Clients — jeder mit eigenem Query-Engine-Prozess und
// eigenem Verbindungspool (Prisma-Default für PostgreSQL:
// num_cpus * 2 + 1 Verbindungen). Auf einem Vier-Kern-Server sind das
// 99 Verbindungen gegen PostgreSQLs Standard-`max_connections` von 100:
// die API konnte sich unter Last selbst (und jeden weiteren Client, u. a.
// den DSGVO-Purge-Cronjob und `prisma migrate deploy`) von der Datenbank
// aussperren — ein Verfügbarkeitsrisiko, das erst unter Last auftritt,
// weil Prisma die Pools erst bei Bedarf fuellt.
//
// Der Cache liegt daher jetzt in einer normalen Modul-Variablen, die in
// JEDER Umgebung greift. `globalThis.__prisma` bleibt zusätzlich
// erhalten, aber nur noch für seinen eigentlichen Zweck: `tsx watch`
// (siehe package.json: `npm run dev`) lädt bei jedem Neustart ein
// frisches Modul-Registry, wodurch die Modul-Variable verloren ginge und
// sich mit jedem Speichern ein weiterer Client ansammelte. Das ist ein
// reines Entwicklungs-Problem, weshalb die globale Zuweisung wie bisher
// auf Nicht-Produktion beschränkt bleibt.
let cachedPrisma: PrismaClientType | undefined;

export function getPrisma(): PrismaClientType {
  if (globalThis.__prisma) return globalThis.__prisma;
  if (cachedPrisma) return cachedPrisma;

  // Dynamischer require (statt Top-Level-Import) — verhindert, dass allein
  // das *Importieren* dieser Datei bereits `new PrismaClient()` auslöst.
  const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client');
  const instance = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
  cachedPrisma = instance;
  if (process.env.NODE_ENV !== 'production') {
    globalThis.__prisma = instance;
  }
  return instance;
}
