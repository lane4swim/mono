// Repository-Pattern (wie überall sonst im Backend) — push.route.ts und
// die Erinnerungs-Jobs (jobs/notifyExpiringQualifications.ts,
// jobs/notifyUpcomingSessions.ts) hängen nur von diesem Interface ab, nie
// direkt von Prisma.
import type { PrismaClient } from '@prisma/client';
import type { PushSubscriptionTarget } from '../../push/pusher.js';

export interface PushSubscriptionRepository {
  // `endpoint` ist @unique (siehe schema.prisma) — ein wiederholtes
  // Abonnieren desselben Geräts aktualisiert die bestehende Zeile
  // (upsert) statt eine doppelte anzulegen.
  upsert(userId: string, endpoint: string, keys: { p256dh: string; auth: string }): Promise<void>;
  remove(userId: string, endpoint: string): Promise<void>;
  listByUserId(userId: string): Promise<PushSubscriptionTarget[]>;
  // Mehrere Konten auf einmal (Erinnerungs-Jobs: eine Abfrage statt einer
  // je betroffenem Konto) — Map bleibt leer für Konten ohne Abo.
  listByUserIds(userIds: readonly string[]): Promise<Map<string, PushSubscriptionTarget[]>>;
  // Aufräumen abgelaufener Abos (siehe pusher.webpush.ts: 404/410-Antwort
  // des Push-Diensts) — Fehler beim Löschen werden vom Aufrufer bewusst
  // ignoriert (best effort, kein kritischer Pfad).
  deleteByIds(ids: readonly string[]): Promise<void>;
}

export class PrismaPushSubscriptionRepository implements PushSubscriptionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsert(userId: string, endpoint: string, keys: { p256dh: string; auth: string }): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId, endpoint, p256dh: keys.p256dh, auth: keys.auth },
      update: { userId, p256dh: keys.p256dh, auth: keys.auth },
    });
  }

  async remove(userId: string, endpoint: string): Promise<void> {
    // deleteMany statt delete: verhindert, dass ein Konto per erratenem
    // Endpoint das Abo eines fremden Kontos löscht (userId muss passen) —
    // delete() bräche stattdessen mit einer "Datensatz nicht gefunden"-
    // Ausnahme ab, wenn Endpoint und userId nicht zusammenpassen.
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  async listByUserId(userId: string): Promise<PushSubscriptionTarget[]> {
    return this.prisma.pushSubscription.findMany({ where: { userId } });
  }

  async listByUserIds(userIds: readonly string[]): Promise<Map<string, PushSubscriptionTarget[]>> {
    const rows = await this.prisma.pushSubscription.findMany({ where: { userId: { in: [...userIds] } } });
    const map = new Map<string, PushSubscriptionTarget[]>();
    for (const row of rows) {
      const list = map.get(row.userId);
      if (list) list.push(row);
      else map.set(row.userId, [row]);
    }
    return map;
  }

  async deleteByIds(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.pushSubscription.deleteMany({ where: { id: { in: [...ids] } } });
  }
}
