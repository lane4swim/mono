// apps/api/test/env.test.ts
import { describe, it, expect } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '4000',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/lane1',
  CORS_ORIGIN: 'https://training.example.org',
};

describe('loadEnv', () => {
  it('lädt eine vollständige, gültige Konfiguration', () => {
    const env = loadEnv(validEnv);
    expect(env.PORT).toBe(4000);
    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
  });

  it('wirft einen Fehler, wenn DATABASE_URL fehlt', () => {
    const { DATABASE_URL: _unused, ...rest } = validEnv;
    expect(() => loadEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('wandelt PORT als String korrekt in eine Zahl um', () => {
    const env = loadEnv({ ...validEnv, PORT: '8080' });
    expect(env.PORT).toBe(8080);
    expect(typeof env.PORT).toBe('number');
  });

  it('nutzt Standardwerte für optionale Felder (PORT, JWT-TTLs)', () => {
    const { PORT: _unused, ...rest } = validEnv;
    const env = loadEnv(rest);
    expect(env.PORT).toBe(3000);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.JWT_REFRESH_TTL_DAYS).toBe(30);
  });

  it('nutzt Standardwerte für die Sync-Bookkeeping-Aufbewahrungsfristen', () => {
    const env = loadEnv(validEnv);
    expect(env.SYNC_EVENT_RETENTION_DAYS).toBe(90);
    expect(env.SYNC_TOMBSTONE_RETENTION_DAYS).toBe(180);
  });

  it('lehnt einen ungültigen NODE_ENV-Wert ab', () => {
    expect(() => loadEnv({ ...validEnv, NODE_ENV: 'sandbox' })).toThrow();
  });

  it('lehnt CORS_ORIGIN="*" in Produktion ab (Sicherheitshärtung, Patch #5)', () => {
    expect(() =>
      loadEnv({
        ...validEnv,
        NODE_ENV: 'production',
        CORS_ORIGIN: '*',
        JWT_PRIVATE_KEY: 'dummy-private-key',
        JWT_PUBLIC_KEY: 'dummy-public-key',
      }),
    ).toThrow(/CORS_ORIGIN/);
  });

  it('akzeptiert CORS_ORIGIN="*" AUSSERHALB von Produktion (z. B. lokale Entwicklung)', () => {
    const env = loadEnv({ ...validEnv, NODE_ENV: 'development', CORS_ORIGIN: '*' });
    expect(env.CORS_ORIGIN).toBe('*');
  });

  it('akzeptiert eine konkrete Origin in Produktion', () => {
    const env = loadEnv({
      ...validEnv,
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://app.lane1.example.org',
      JWT_PRIVATE_KEY: 'dummy-private-key',
      JWT_PUBLIC_KEY: 'dummy-public-key',
    });
    expect(env.CORS_ORIGIN).toBe('https://app.lane1.example.org');
  });

  // Regressionstest für die Code-Review-Korrektur: z.coerce.boolean()
  // wandelte JEDEN nichtleeren String in `true` um — auch den Text
  // "false" (Boolean("false") === true in JS). Betraf konkret genau den
  // in .env.example dokumentierten Fall: SMTP_SECURE explizit auf "false"
  // gesetzt (korrekt für Port 587/STARTTLS) wurde fälschlich als `true`
  // interpretiert.
  describe('SMTP_SECURE', () => {
    it('ist standardmäßig false, wenn die Variable komplett fehlt', () => {
      const env = loadEnv(validEnv);
      expect(env.SMTP_SECURE).toBe(false);
    });

    it('interpretiert den String "false" korrekt als false (vormals fälschlich true)', () => {
      const env = loadEnv({ ...validEnv, SMTP_SECURE: 'false' });
      expect(env.SMTP_SECURE).toBe(false);
    });

    it('interpretiert den String "true" korrekt als true', () => {
      const env = loadEnv({ ...validEnv, SMTP_SECURE: 'true' });
      expect(env.SMTP_SECURE).toBe(true);
    });

    it('lehnt einen nicht erkannten Wert ab, statt ihn stillschweigend als true zu interpretieren', () => {
      expect(() => loadEnv({ ...validEnv, SMTP_SECURE: 'yes' })).toThrow(/SMTP_SECURE/);
    });
  });
});
