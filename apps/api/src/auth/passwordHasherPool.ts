// Führt argon2id-Hashing/-Prüfung in Worker-Threads aus statt auf dem
// Haupt-Thread (Issue #90). hash-wasm rechnet synchron: eine Prüfung
// blockiert die Event-Loop ~300 ms, zehn gleichzeitige Logins legten die
// gesamte API mehrere Sekunden lahm — auch für Anfragen, die gar nichts
// mit Passwörtern zu tun haben.
//
// Der Worker-Code steht bewusst inline (`eval: true`) statt in einer
// eigenen Datei: eine .ts-Worker-Datei lädt nicht unter jeder unterstützten
// Node-Version (siehe "engines"), und tsc kopiert keine .js-Dateien nach
// dist/. So läuft derselbe Code unverändert unter tsx, Vitest und node dist/.
//
// Die Warteschlange ist begrenzt: ist sie voll, wird sofort mit
// PasswordHasherBusyError (HTTP 503, siehe plugins/httpErrorHandler.ts)
// abgelehnt, statt Anfragen unbegrenzt aufzustauen.
import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export class PasswordHasherBusyError extends Error {
  constructor() {
    super('Der Server ist gerade ausgelastet. Bitte in einigen Sekunden erneut versuchen.');
  }
}

export interface Argon2Params {
  memorySize: number;
  iterations: number;
  parallelism: number;
  hashLength: number;
}

export type PasswordTask =
  | { kind: 'hash'; password: string; salt: Uint8Array; params: Argon2Params }
  | { kind: 'verify'; password: string; hash: string };

type TaskResult<T extends PasswordTask> = T extends { kind: 'hash' } ? string : boolean;

interface PendingTask {
  task: PasswordTask;
  resolve: (value: string | boolean) => void;
  reject: (err: Error) => void;
}

interface Slot {
  worker: Worker;
  current: PendingTask | null;
}

// CommonJS-Kontext (eval-Worker). Der Listener wird synchron registriert,
// damit keine Nachricht vor dem Laden von hash-wasm verloren geht.
// verify: ein fehlerhaftes/fremdes Hash-Format gilt als "stimmt nicht
// überein" (gleiches Verhalten wie zuvor in password.ts).
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const hashWasm = import(workerData.hashWasmUrl).then((m) => m.default ?? m);
parentPort.on('message', async (task) => {
  try {
    const { argon2id, argon2Verify } = await hashWasm;
    if (task.kind === 'hash') {
      const result = await argon2id({ password: task.password, salt: task.salt, ...task.params, outputType: 'encoded' });
      parentPort.postMessage({ ok: true, result });
    } else {
      let result = false;
      try { result = await argon2Verify({ password: task.password, hash: task.hash }); } catch { result = false; }
      parentPort.postMessage({ ok: true, result });
    }
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
`;

const hashWasmUrl = pathToFileURL(createRequire(import.meta.url).resolve('hash-wasm')).href;

export class PasswordHasherPool {
  private readonly slots: Slot[] = [];
  private readonly queue: PendingTask[] = [];
  private closed = false;

  constructor(private readonly options: { size: number; maxQueue: number }) {}

  run<T extends PasswordTask>(task: T): Promise<TaskResult<T>> {
    if (this.closed) return Promise.reject(new Error('PasswordHasherPool ist bereits geschlossen.'));
    return new Promise<TaskResult<T>>((resolve, reject) => {
      const pending: PendingTask = { task, resolve: resolve as (value: string | boolean) => void, reject };
      const slot = this.idleSlot();
      if (slot) {
        this.start(slot, pending);
        return;
      }
      if (this.queue.length >= this.options.maxQueue) {
        reject(new PasswordHasherBusyError());
        return;
      }
      this.queue.push(pending);
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const pending of this.queue.splice(0)) pending.reject(new Error('PasswordHasherPool wurde geschlossen.'));
    await Promise.all(this.slots.splice(0).map((slot) => slot.worker.terminate()));
  }

  // Freier Worker, oder ein neuer, solange die Poolgröße das zulässt.
  private idleSlot(): Slot | null {
    const idle = this.slots.find((slot) => slot.current === null);
    if (idle) return idle;
    if (this.slots.length < this.options.size) return this.spawn();
    return null;
  }

  private spawn(): Slot {
    const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { hashWasmUrl } });
    // Ein Worker ohne laufende Aufgabe hält den Prozess nicht am Leben
    // (Skripte, Tests); start() referenziert ihn für die Dauer einer Aufgabe.
    worker.unref();
    const slot: Slot = { worker, current: null };

    worker.on('message', (message: { ok: true; result: string | boolean } | { ok: false; error: string }) => {
      const pending = slot.current;
      slot.current = null;
      worker.unref();
      if (pending) {
        if (message.ok) pending.resolve(message.result);
        else pending.reject(new Error(`Passwort-Hashing fehlgeschlagen: ${message.error}`));
      }
      this.dispatch();
    });

    // Absturz: laufende Aufgabe ablehnen, Worker verwerfen — ein Ersatz
    // entsteht bei Bedarf in idleSlot().
    const discard = (err: Error) => {
      const index = this.slots.indexOf(slot);
      if (index === -1) return;
      this.slots.splice(index, 1);
      slot.current?.reject(err);
      slot.current = null;
      this.dispatch();
    };
    worker.on('error', discard);
    worker.on('exit', (code) => discard(new Error(`Passwort-Worker unerwartet beendet (Code ${code}).`)));

    this.slots.push(slot);
    return slot;
  }

  private start(slot: Slot, pending: PendingTask) {
    slot.current = pending;
    slot.worker.ref();
    slot.worker.postMessage(pending.task);
  }

  private dispatch() {
    if (this.closed) return;
    while (this.queue.length > 0) {
      const slot = this.idleSlot();
      if (!slot) return;
      this.start(slot, this.queue.shift()!);
    }
  }
}
