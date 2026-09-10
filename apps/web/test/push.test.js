// Testet nur den reinen Feature-Detection-Teil von js/push.js —
// subscribeToPush()/unsubscribeFromPush() hängen vollständig von echten
// Browser-APIs (ServiceWorkerRegistration.pushManager, Notification) ab
// und sind ohne einen echten Browser nicht sinnvoll unit-testbar (siehe
// docs/Plans/phase2-plan.md, Abschnitt 1.6).
import { describe, it, expect, afterEach } from 'vitest';
import { isPushSupported } from '../js/push.js';

function clearGlobals() {
  delete globalThis.navigator;
  delete globalThis.window;
  delete globalThis.Notification;
}

describe('isPushSupported()', () => {
  afterEach(clearGlobals);

  it('liefert false, wenn eine der drei benötigten APIs fehlt', () => {
    clearGlobals();
    globalThis.navigator = {};
    globalThis.window = {};
    expect(isPushSupported()).toBe(false);
  });

  it('liefert true, wenn serviceWorker, PushManager und Notification vorhanden sind', () => {
    clearGlobals();
    globalThis.navigator = { serviceWorker: {} };
    globalThis.window = { PushManager: class {}, Notification: class {} };
    expect(isPushSupported()).toBe(true);
  });
});
