import { describe, it, expect, afterEach } from 'vitest';
import Fastify from 'fastify';
import { PasswordHasherPool, PasswordHasherBusyError } from '../../src/auth/passwordHasherPool.js';
import { registerHttpErrorHandler } from '../../src/plugins/httpErrorHandler.js';

const PARAMS = { memorySize: 1024, iterations: 1, parallelism: 1, hashLength: 32 };
const salt = () => new Uint8Array(16).fill(7);

describe('PasswordHasherPool', () => {
  let pool: PasswordHasherPool | null = null;
  afterEach(async () => { await pool?.close(); pool = null; });

  it('hasht und verifiziert in einem Worker', async () => {
    pool = new PasswordHasherPool({ size: 1, maxQueue: 4 });
    const hash = await pool.run({ kind: 'hash', password: 'geheim', salt: salt(), params: PARAMS });
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await pool.run({ kind: 'verify', password: 'geheim', hash })).toBe(true);
    expect(await pool.run({ kind: 'verify', password: 'falsch', hash })).toBe(false);
  });

  it('arbeitet eine Warteschlange über mehrere Worker vollständig ab', async () => {
    pool = new PasswordHasherPool({ size: 2, maxQueue: 20 });
    const hashes = await Promise.all(
      Array.from({ length: 10 }, (_, i) => pool!.run({ kind: 'hash', password: `pw-${i}`, salt: salt(), params: PARAMS })),
    );
    expect(new Set(hashes).size).toBe(10);
  });

  it('lehnt sofort mit PasswordHasherBusyError ab, wenn die Warteschlange voll ist', async () => {
    pool = new PasswordHasherPool({ size: 1, maxQueue: 1 });
    const task = () => pool!.run({ kind: 'hash', password: 'x', salt: salt(), params: PARAMS });
    const running = task(); // belegt den einzigen Worker
    const queued = task(); // belegt den einzigen Warteplatz
    await expect(task()).rejects.toBeInstanceOf(PasswordHasherBusyError);
    await expect(running).resolves.toMatch(/^\$argon2id\$/);
    await expect(queued).resolves.toMatch(/^\$argon2id\$/);
  });
});

describe('PasswordHasherBusyError im HTTP-Fehler-Handler', () => {
  it('wird zu 503 server_busy mit Retry-After', async () => {
    const app = Fastify();
    registerHttpErrorHandler(app);
    app.get('/busy', async () => { throw new PasswordHasherBusyError(); });
    const response = await app.inject({ method: 'GET', url: '/busy' });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('server_busy');
    expect(response.headers['retry-after']).toBe('5');
    await app.close();
  });
});
