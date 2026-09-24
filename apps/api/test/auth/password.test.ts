import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/auth/password.js';

describe('password hashing (argon2id)', () => {
  it('erzeugt einen Hash, der nicht dem Klartext-Passwort entspricht', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('erzeugt für dasselbe Passwort unterschiedliche Hashes (zufälliges Salt)', async () => {
    const hash1 = await hashPassword('gleiches-passwort');
    const hash2 = await hashPassword('gleiches-passwort');
    expect(hash1).not.toBe(hash2);
  });

  it('verifiziert das korrekte Passwort erfolgreich', async () => {
    const hash = await hashPassword('mein-sicheres-passwort');
    expect(await verifyPassword('mein-sicheres-passwort', hash)).toBe(true);
  });

  it('lehnt ein falsches Passwort ab', async () => {
    const hash = await hashPassword('mein-sicheres-passwort');
    expect(await verifyPassword('falsches-passwort', hash)).toBe(false);
  });

  it('lehnt ein leeres Passwort gegen einen echten Hash ab', async () => {
    const hash = await hashPassword('etwas');
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('verify() wirft nicht, sondern liefert false bei einem ungültigen Hash-Format', async () => {
    await expect(verifyPassword('irgendwas', 'kein-gueltiger-argon2-hash')).resolves.toBe(false);
  });

  it('nutzt unverändert die argon2id-Parameter m=65536, t=3, p=1 (bestehende Hashes bleiben gültig)', async () => {
    expect(await hashPassword('parameter-check')).toMatch(/^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  });

  // Issue #90: das Hashing läuft im Worker-Pool, der Haupt-Thread bleibt
  // währenddessen reaktionsfähig (vorher: keine einzige Timer-Ausführung
  // während einer ~300-ms-Prüfung).
  it('blockiert die Event-Loop des Haupt-Threads nicht', async () => {
    const hash = await hashPassword('event-loop'); // Worker ist danach warm
    let ticks = 0;
    const interval = setInterval(() => { ticks++; }, 5);
    await Promise.all([verifyPassword('event-loop', hash), verifyPassword('falsch', hash)]);
    clearInterval(interval);
    expect(ticks).toBeGreaterThan(5);
  });
}, 20000);
