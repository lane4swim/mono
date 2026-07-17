// apps/api/test/db/entityRegistry.test.ts
import { describe, it, expect } from 'vitest';
import { getEntityDelegate, ENTITY_STORE_NAMES } from '../../src/db/entityRegistry.js';
import type { PrismaClient } from '@prisma/client';

// Ein Stub reicht hier völlig aus: der Test prüft nur, dass
// getEntityDelegate() für jeden Store-Namen ein UNTERSCHIEDLICHES,
// tatsächlich vorhandenes Objekt vom (Fake-)Prisma-Client zurückgibt —
// keine echte Datenbankverbindung nötig.
function makeFakePrismaClient(): PrismaClient {
  const makeDelegate = (name: string) => ({ __name: name, findMany: async () => [], findUnique: async () => null, create: async () => ({}), update: async () => ({}) });
  return {
    athlete: makeDelegate('athlete'),
    group: makeDelegate('group'),
    competition: makeDelegate('competition'),
    startlistEntry: makeDelegate('startlistEntry'),
    result: makeDelegate('result'),
    exercise: makeDelegate('exercise'),
    template: makeDelegate('template'),
    plan: makeDelegate('plan'),
    trainingSession: makeDelegate('trainingSession'),
    actionItem: makeDelegate('actionItem'),
  } as unknown as PrismaClient;
}

describe('getEntityDelegate', () => {
  const prisma = makeFakePrismaClient();

  it('liefert für jeden fachlichen Store ein Delegate', () => {
    ENTITY_STORE_NAMES.forEach((store) => {
      expect(() => getEntityDelegate(prisma, store)).not.toThrow();
    });
  });

  it('bildet "entries" korrekt auf das startlistEntry-Delegate ab (abweichender Name)', () => {
    const delegate = getEntityDelegate(prisma, 'entries') as unknown as { __name: string };
    expect(delegate.__name).toBe('startlistEntry');
  });

  it('bildet "sessions" korrekt auf das trainingSession-Delegate ab (abweichender Name)', () => {
    const delegate = getEntityDelegate(prisma, 'sessions') as unknown as { __name: string };
    expect(delegate.__name).toBe('trainingSession');
  });

  it('bildet "athletes" korrekt auf das athlete-Delegate ab', () => {
    const delegate = getEntityDelegate(prisma, 'athletes') as unknown as { __name: string };
    expect(delegate.__name).toBe('athlete');
  });

  it('liefert für jeden Store ein Delegate mit den erwarteten CRUD-Methoden', () => {
    ENTITY_STORE_NAMES.forEach((store) => {
      const delegate = getEntityDelegate(prisma, store);
      expect(typeof delegate.findMany).toBe('function');
      expect(typeof delegate.findUnique).toBe('function');
      expect(typeof delegate.create).toBe('function');
      expect(typeof delegate.update).toBe('function');
    });
  });
});

describe('ENTITY_STORE_NAMES', () => {
  it('enthält genau die zehn fachlichen Stores (ohne "users")', () => {
    expect(ENTITY_STORE_NAMES).toHaveLength(10);
    expect(ENTITY_STORE_NAMES).not.toContain('users');
  });
});
