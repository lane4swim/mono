// apps/api/src/db/prisma.ts
//
// Lazy statt eager: die PrismaClient-Instanz wird erst bei tatsächlichem
// Bedarf erzeugt (getPrisma()), nicht schon beim Import dieses Moduls.
// Wichtig für Tests — buildApp() übergibt dort immer einen authService-
// Override (In-Memory-Repositories), sodass getPrisma() nie aufgerufen
// wird und somit kein generierter Prisma Client vorhanden sein muss.
import type { PrismaClient as PrismaClientType } from '@prisma/client';

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClientType | undefined;
}

export function getPrisma(): PrismaClientType {
  if (globalThis.__prisma) return globalThis.__prisma;

  // Dynamischer require (statt Top-Level-Import) — verhindert, dass allein
  // das *Importieren* dieser Datei bereits `new PrismaClient()` auslöst.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client');
  const instance = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
  if (process.env.NODE_ENV !== 'production') {
    globalThis.__prisma = instance;
  }
  return instance;
}
