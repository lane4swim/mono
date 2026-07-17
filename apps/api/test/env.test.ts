// apps/api/test/env.test.ts
import { describe, it, expect } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '4000',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/lane1',
  JWT_SIGNING_KEY: 'x'.repeat(32),
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

  it('wirft einen Fehler, wenn JWT_SIGNING_KEY zu kurz ist', () => {
    expect(() => loadEnv({ ...validEnv, JWT_SIGNING_KEY: 'zu-kurz' })).toThrow(/JWT_SIGNING_KEY/);
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
    expect(env.JWT_ACCESS_TTL).toBe('15m');
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.JWT_REFRESH_TTL_DAYS).toBe(30);
  });

  it('lehnt einen ungültigen NODE_ENV-Wert ab', () => {
    expect(() => loadEnv({ ...validEnv, NODE_ENV: 'sandbox' })).toThrow();
  });
});
