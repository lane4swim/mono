// apps/api/test/sync/sync.permissions.test.ts
//
// Testet die Modul-Gating-Erweiterung von canRead()/canWrite() (Module pro
// Verein aktivierbar, z. B. das Wettkampfmodul nur für bestimmte Vereine).
// Die reine Rollen-Matrix (STORE_PERMISSIONS) ist bereits über
// sync.service.test.ts indirekt abgedeckt — hier ausschließlich die neue
// enabledModules-Dimension, inklusive des "results"-Sonderfalls (von ZWEI
// Paketen gemeinsam genutzt, siehe sync.permissions.ts: STORE_MODULE_MAP).
import { describe, it, expect } from 'vitest';
import { canRead, canWrite } from '../../src/modules/sync/sync.permissions.js';

describe('canRead()/canWrite() — Modul-Gating', () => {
  it('verweigert einen Store, dessen Paket der Verein nicht gebucht hat, selbst mit passender Rolle', () => {
    expect(canRead('competitions', ['trainer'], [])).toBe(false);
    expect(canWrite('competitions', ['trainer'], [])).toBe(false);
    expect(canRead('competitions', ['trainer'], ['times'])).toBe(false); // falsches Paket gebucht
  });

  it('erlaubt einen Store, sobald sein Paket gebucht ist UND die Rolle laut STORE_PERMISSIONS passt', () => {
    expect(canRead('competitions', ['trainer'], ['competitions'])).toBe(true);
    expect(canWrite('competitions', ['trainer'], ['competitions'])).toBe(true);
  });

  it('Rollen-Prüfung bleibt zusätzlich zur Modul-Prüfung bestehen (athletes: nur admin schreibt)', () => {
    // trainer darf athletes lesen, aber nicht schreiben — auch mit gebuchtem Modul.
    expect(canRead('athletes', ['trainer'], ['athletes'])).toBe(true);
    expect(canWrite('athletes', ['trainer'], ['athletes'])).toBe(false);
    expect(canWrite('athletes', ['admin'], ['athletes'])).toBe(true);
    // Ohne gebuchtes Modul scheitert auch admin.
    expect(canWrite('athletes', ['admin'], [])).toBe(false);
  });

  it('"groups" hängt am selben Paket wie "athletes" (athletes.js verwaltet Gruppen mit)', () => {
    expect(canRead('groups', ['trainer'], ['athletes'])).toBe(true);
    expect(canRead('groups', ['trainer'], ['competitions'])).toBe(false);
  });

  it('"entries" (Startlisten) hängt am competitions-Paket, nicht an einem eigenen', () => {
    expect(canWrite('entries', ['trainer'], ['competitions'])).toBe(true);
    expect(canWrite('entries', ['trainer'], ['times'])).toBe(false);
  });

  it('"results" ist der Sonderfall: times ODER competitions reicht (von beiden Modulen genutzt)', () => {
    expect(canRead('results', ['trainer'], ['times'])).toBe(true);
    expect(canRead('results', ['trainer'], ['competitions'])).toBe(true);
    expect(canRead('results', ['trainer'], ['plans'])).toBe(false);
    expect(canRead('results', ['trainer'], [])).toBe(false);
  });

  it('ein unbekannter Store bleibt unabhängig von enabledModules verweigert', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(canRead('users' as any, ['trainer'], ['athletes', 'competitions', 'times'])).toBe(false);
  });
});
