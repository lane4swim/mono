// apps/api/src/jobs/syncBookkeeping.repository.ts
//
// Aufräumarbeit (Code-Review): sowohl SyncedEvent (Idempotenz-Ledger für
// POST /api/sync/push, siehe sync.gateway.ts: isEventProcessed()) als auch
// SyncTombstone (Löschmarkierungen für endgültig gepurgte Zeilen, siehe
// jobs/erasure.repository.ts) wuchsen bislang unbegrenzt — für beide
// Tabellen gab es keinerlei Aufräum-Job. Dieses Gateway kapselt das
// zeitbasierte Löschen alter Zeilen aus beiden Tabellen, orchestriert von
// jobs/purgeSyncBookkeeping.ts.
import type { PrismaClient } from '@prisma/client';

export interface SyncBookkeepingGateway {
  // SyncedEvent dient AUSSCHLIESSLICH der Erkennung eines wiederholt
  // gesendeten Push-Events (z. B. nach einem Verbindungsabbruch mitten in
  // der Antwort) — ein solcher Wiederholungsversuch geschieht praktisch
  // immer innerhalb derselben Sitzung (Sekunden bis wenige Stunden), nie
  // Wochen später. Die Aufbewahrungsfrist kann daher vergleichsweise kurz
  // sein, ohne die eigentliche Funktion zu gefährden.
  deleteSyncedEventsOlderThan(cutoff: Date): Promise<number>;
  // SyncTombstone muss dagegen so lange bestehen bleiben, bis JEDES Gerät
  // seinen Sync-Cursor über den Löschzeitpunkt hinaus vorangetrieben hat —
  // ein länger inaktives Gerät würde eine zu früh gelöschte Löschmarkierung
  // sonst nie zu sehen bekommen (die referenzierte Zeile existiert dann ja
  // bereits physisch nicht mehr, siehe erasure.repository.ts). Die
  // Aufbewahrungsfrist ist deshalb bewusst deutlich großzügiger.
  deleteSyncTombstonesOlderThan(cutoff: Date): Promise<number>;
}

export class PrismaSyncBookkeepingGateway implements SyncBookkeepingGateway {
  constructor(private readonly prisma: PrismaClient) {}

  async deleteSyncedEventsOlderThan(cutoff: Date): Promise<number> {
    const result = await this.prisma.syncedEvent.deleteMany({ where: { appliedAt: { lt: cutoff } } });
    return result.count;
  }

  async deleteSyncTombstonesOlderThan(cutoff: Date): Promise<number> {
    const result = await this.prisma.syncTombstone.deleteMany({ where: { deletedAt: { lt: cutoff } } });
    return result.count;
  }
}
