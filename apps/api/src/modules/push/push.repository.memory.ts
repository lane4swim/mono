import { randomUUID } from 'node:crypto';
import type { PushSubscriptionRepository } from './push.repository.js';
import type { PushSubscriptionTarget } from '../../push/pusher.js';

interface StoredSubscription extends PushSubscriptionTarget {
  userId: string;
}

export class InMemoryPushSubscriptionRepository implements PushSubscriptionRepository {
  private rows: StoredSubscription[] = [];

  async upsert(userId: string, endpoint: string, keys: { p256dh: string; auth: string }): Promise<void> {
    const existing = this.rows.find((r) => r.endpoint === endpoint);
    if (existing) {
      existing.userId = userId;
      existing.p256dh = keys.p256dh;
      existing.auth = keys.auth;
      return;
    }
    this.rows.push({ id: randomUUID(), userId, endpoint, p256dh: keys.p256dh, auth: keys.auth });
  }

  async remove(userId: string, endpoint: string): Promise<void> {
    this.rows = this.rows.filter((r) => !(r.userId === userId && r.endpoint === endpoint));
  }

  async listByUserId(userId: string): Promise<PushSubscriptionTarget[]> {
    return this.rows.filter((r) => r.userId === userId);
  }

  async listByUserIds(userIds: readonly string[]): Promise<Map<string, PushSubscriptionTarget[]>> {
    const idSet = new Set(userIds);
    const map = new Map<string, PushSubscriptionTarget[]>();
    for (const row of this.rows) {
      if (!idSet.has(row.userId)) continue;
      const list = map.get(row.userId);
      if (list) list.push(row);
      else map.set(row.userId, [row]);
    }
    return map;
  }

  async deleteByIds(ids: readonly string[]): Promise<void> {
    const idSet = new Set(ids);
    this.rows = this.rows.filter((r) => !idSet.has(r.id));
  }
}
