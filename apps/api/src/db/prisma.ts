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

export function getPrisma(): PrismaClientType {
  if (globalThis.__prisma) return globalThis.__prisma;

  // Dynamischer require (statt Top-Level-Import) — verhindert, dass allein
  // das *Importieren* dieser Datei bereits `new PrismaClient()` auslöst.
  const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client');
  const instance = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
  if (process.env.NODE_ENV !== 'production') {
    globalThis.__prisma = instance;
  }
  return instance;
}
