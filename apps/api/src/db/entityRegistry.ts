// apps/api/src/db/entityRegistry.ts
//
// Zentrale Zuordnung SyncStore -> Prisma-Delegate. Vorbereitung für Phase 3
// (generische Sync-API): Ein eingehendes Event `{ store: "athletes", ... }`
// muss dynamisch auf `prisma.athlete` (bzw. dessen create/update/…)
// abgebildet werden, ohne für jeden der zehn fachlichen Stores einen
// eigenen if/else-Zweig zu schreiben.
//
// Bewusst als reine Zuordnungstabelle (Funktion statt Objekt-Literal mit
// `prisma`-Referenz), damit sie ohne eine offene Datenbankverbindung
// importiert und getestet werden kann (siehe test/db/entityRegistry.test.ts,
// das einen Prisma-Client-Stub statt einer echten Instanz verwendet).
import type { PrismaClient } from '@prisma/client';
import type { EntityStoreName } from '@lane1/shared-types';

// Minimale Form, die jedes verwendete Prisma-Delegate erfüllen muss —
// reicht für generische CRUD-Operationen in Phase 3, ohne den vollen
// (deutlich umfangreicheren) generierten Prisma-Typ zu benötigen.
//
// `any` statt `unknown` ist hier bewusst: Prismas generierte Delegates
// (z. B. `Prisma.AthleteDelegate`) haben streng typisierte, JE MODELL
// UNTERSCHIEDLICHE Parametertypen (z. B. `AthleteFindManyArgs` vs.
// `GroupFindManyArgs`). Ein Parameter vom Typ `unknown` ist mit einem
// solchen konkreten, engeren Parametertyp NICHT kontravariant kompatibel
// (TypeScript verlangt, dass eine Methode mit `unknown`-Parameter JEDEN
// Wert entgegennimmt — das kann ein Prisma-Delegate mit spezifischeren
// Typen nicht zusichern). `any` ist hier der korrekte, von TypeScript
// bewusst bivariant behandelte Kompromiss für diesen generischen Adapter
// über heterogene, streng typisierte Delegates hinweg.
export interface EntityDelegate {
  findMany: (args?: any) => Promise<any[]>; // eslint-disable-line @typescript-eslint/no-explicit-any
  findUnique: (args: any) => Promise<any | null>; // eslint-disable-line @typescript-eslint/no-explicit-any
  create: (args: any) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  update: (args: any) => Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export function getEntityDelegate(prisma: PrismaClient, store: EntityStoreName): EntityDelegate {
  switch (store) {
    case 'athletes': return prisma.athlete;
    case 'groups': return prisma.group;
    case 'competitions': return prisma.competition;
    case 'entries': return prisma.startlistEntry;
    case 'results': return prisma.result;
    case 'exercises': return prisma.exercise;
    case 'templates': return prisma.template;
    case 'plans': return prisma.plan;
    case 'sessions': return prisma.trainingSession;
    case 'actionItems': return prisma.actionItem;
    default: {
      const _exhaustive: never = store;
      throw new Error(`Kein Prisma-Delegate für Store "${_exhaustive}" registriert.`);
    }
  }
}

// Alle unterstützten fachlichen Store-Namen — von Tests genutzt, um zu
// prüfen, dass getEntityDelegate() für jeden davon tatsächlich etwas
// liefert (siehe entityRegistry.test.ts).
export const ENTITY_STORE_NAMES: EntityStoreName[] = [
  'athletes', 'groups', 'competitions', 'entries', 'results',
  'exercises', 'templates', 'plans', 'sessions', 'actionItems',
];
