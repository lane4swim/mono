import { describe, it, expect } from 'vitest';
import { PushSubscribeRequestSchema, PushUnsubscribeRequestSchema, PushPublicKeyResponseSchema } from '../src/push.js';

describe('PushSubscribeRequestSchema', () => {
  it('akzeptiert eine gültige Browser-PushSubscription', () => {
    const result = PushSubscribeRequestSchema.safeParse({
      endpoint: 'https://push.example.com/abc123',
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    });
    expect(result.success).toBe(true);
  });

  it('lehnt einen nicht-URL-Endpoint ab', () => {
    const result = PushSubscribeRequestSchema.safeParse({ endpoint: 'not-a-url', keys: { p256dh: 'p', auth: 'a' } });
    expect(result.success).toBe(false);
  });

  it('lehnt fehlende Schlüssel ab', () => {
    const result = PushSubscribeRequestSchema.safeParse({ endpoint: 'https://push.example.com/abc123' });
    expect(result.success).toBe(false);
  });
});

describe('PushUnsubscribeRequestSchema', () => {
  it('akzeptiert nur den Endpoint', () => {
    const result = PushUnsubscribeRequestSchema.safeParse({ endpoint: 'https://push.example.com/abc123' });
    expect(result.success).toBe(true);
  });
});

describe('PushPublicKeyResponseSchema', () => {
  it('akzeptiert einen gesetzten Schlüssel und null gleichermaßen', () => {
    expect(PushPublicKeyResponseSchema.safeParse({ publicKey: 'abc' }).success).toBe(true);
    expect(PushPublicKeyResponseSchema.safeParse({ publicKey: null }).success).toBe(true);
  });
});
