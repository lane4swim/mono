// apps/api/test/auth/password.test.ts
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
}, 20000);
