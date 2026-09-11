import { describe, it, expect } from 'vitest';
import { PushSubscribeRequestSchema, PushUnsubscribeRequestSchema, PushPublicKeyResponseSchema } from '../src/push.js';

describe('PushSubscribeRequestSchema', () => {
  it('akzeptiert eine gültige Browser-PushSubscription (FCM-Endpunkt)', () => {
    const result = PushSubscribeRequestSchema.safeParse({
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      keys: { p256dh: 'p256dh-key', auth: 'auth-key' },
    });
    expect(result.success).toBe(true);
  });

  it.each([
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QAB...',
    'https://wns2-xx1.notify.windows.com/w/abc',
    'https://android.googleapis.com/gcm/send/abc',
  ])('akzeptiert den bekannten Push-Dienst-Host %s', (endpoint) => {
    const result = PushSubscribeRequestSchema.safeParse({ endpoint, keys: { p256dh: 'p', auth: 'a' } });
    expect(result.success).toBe(true);
  });

  it('lehnt einen nicht-URL-Endpoint ab', () => {
    const result = PushSubscribeRequestSchema.safeParse({ endpoint: 'not-a-url', keys: { p256dh: 'p', auth: 'a' } });
    expect(result.success).toBe(false);
  });

  it('lehnt fehlende Schlüssel ab', () => {
    const result = PushSubscribeRequestSchema.safeParse({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc123' });
    expect(result.success).toBe(false);
  });

  // Sicherheitskorrektur (Code-Review): ohne Allowlist könnte ein
  // authentifiziertes Konto beliebige interne/private Adressen als
  // "endpoint" registrieren — der Server sendet dorthin später
  // serverseitig eine echte HTTP-Anfrage (SSRF), siehe Kommentar in push.ts.
  it.each([
    'http://169.254.169.254/latest/meta-data/',
    'https://localhost:5432/',
    'https://internal.example.org/webhook',
    'https://push.example.com/abc123', // beliebiger, nicht gelisteter Host
    'https://evil.com/fcm.googleapis.com', // Host-Spoofing-Versuch im Pfad
    'https://fcm.googleapis.com.evil.com/abc', // Suffix-Trick
  ])('lehnt einen unbekannten/nicht-https-Endpunkt ab: %s', (endpoint) => {
    const result = PushSubscribeRequestSchema.safeParse({ endpoint, keys: { p256dh: 'p', auth: 'a' } });
    expect(result.success).toBe(false);
  });
});

describe('PushUnsubscribeRequestSchema', () => {
  it('akzeptiert nur den Endpoint (keine Allowlist nötig — löst keine HTTP-Anfrage aus, nur einen DB-Delete)', () => {
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
