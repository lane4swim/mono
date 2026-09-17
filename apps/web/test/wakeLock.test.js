// Testet js/wakeLock.js gegen einen minimalen navigator.wakeLock-Stub
// (Issue #78) — analog zu push.test.js: reine Browser-API, in einer
// Node-Testumgebung nur über globalThis-Stubs sinnvoll unit-testbar.
import { describe, it, expect, afterEach, vi } from 'vitest';

function clearGlobals() {
  delete globalThis.navigator;
  delete globalThis.document;
}

// Ein minimaler EventTarget-Ersatz für den Sentinel: release() markiert
// `released` und feuert den 'release'-Listener, den wakeLock.js registriert
// — genug, um dessen release-getriebene Aufräumlogik zu testen, ohne einen
// echten Browser zu brauchen.
function makeSentinel() {
  const listeners = [];
  const sentinel = {
    released: false,
    addEventListener: (evt, fn) => { if (evt === 'release') listeners.push(fn); },
    release: vi.fn(async () => { sentinel.released = true; listeners.forEach(fn => fn()); }),
  };
  return sentinel;
}

describe('wakeLock', () => {
  afterEach(() => { clearGlobals(); vi.resetModules(); });

  it('fordert bei acquireWakeLock() einen Sentinel über navigator.wakeLock an, wenn das Dokument sichtbar ist', async () => {
    clearGlobals();
    const sentinel = makeSentinel();
    const request = vi.fn(async () => sentinel);
    globalThis.navigator = { wakeLock: { request } };
    globalThis.document = { visibilityState: 'visible', addEventListener: () => {} };

    const { acquireWakeLock } = await import('../js/wakeLock.js');
    await acquireWakeLock();
    expect(request).toHaveBeenCalledWith('screen');
  });

  it('released den gehaltenen Sentinel bei releaseWakeLock()', async () => {
    clearGlobals();
    const sentinel = makeSentinel();
    globalThis.navigator = { wakeLock: { request: vi.fn(async () => sentinel) } };
    globalThis.document = { visibilityState: 'visible', addEventListener: () => {} };

    const { acquireWakeLock, releaseWakeLock } = await import('../js/wakeLock.js');
    await acquireWakeLock();
    releaseWakeLock();
    expect(sentinel.release).toHaveBeenCalled();
  });

  it('bricht nicht ab, wenn navigator.wakeLock fehlt (nicht unterstützter Browser)', async () => {
    clearGlobals();
    globalThis.navigator = {};
    globalThis.document = { visibilityState: 'visible', addEventListener: () => {} };

    const { acquireWakeLock, releaseWakeLock } = await import('../js/wakeLock.js');
    await expect(acquireWakeLock()).resolves.toBeUndefined();
    expect(() => releaseWakeLock()).not.toThrow();
  });

  it('bricht nicht ab, wenn navigator.wakeLock.request ablehnt', async () => {
    clearGlobals();
    globalThis.navigator = { wakeLock: { request: vi.fn(async () => { throw new Error('denied'); }) } };
    globalThis.document = { visibilityState: 'visible', addEventListener: () => {} };

    const { acquireWakeLock } = await import('../js/wakeLock.js');
    await expect(acquireWakeLock()).resolves.toBeUndefined();
  });

  // Code-Review-Befund: request() ist ein echter asynchroner Aufruf — ein
  // releaseWakeLock() KURZ NACH acquireWakeLock(), aber VOR dessen
  // Auflösung, darf den dann eintreffenden Sentinel nicht mehr festhalten.
  it('gibt einen erst nach releaseWakeLock() eintreffenden Sentinel sofort wieder frei, statt ihn zu halten', async () => {
    clearGlobals();
    let resolveRequest;
    const pending = new Promise((resolve) => { resolveRequest = resolve; });
    const request = vi.fn(() => pending);
    globalThis.navigator = { wakeLock: { request } };
    globalThis.document = { visibilityState: 'visible', addEventListener: () => {} };

    const { acquireWakeLock, releaseWakeLock } = await import('../js/wakeLock.js');
    const acquiring = acquireWakeLock();
    releaseWakeLock(); // läuft, während request() noch offen ist

    const lateSentinel = makeSentinel();
    resolveRequest(lateSentinel);
    await acquiring;

    expect(lateSentinel.release).toHaveBeenCalled();
  });

  it('fordert beim erneuten Sichtbarwerden automatisch einen neuen Sentinel an, solange der Lock noch gewünscht ist', async () => {
    clearGlobals();
    const firstSentinel = makeSentinel();
    const secondSentinel = makeSentinel();
    const request = vi.fn()
      .mockResolvedValueOnce(firstSentinel)
      .mockResolvedValueOnce(secondSentinel);
    let visibilityHandler;
    globalThis.navigator = { wakeLock: { request } };
    globalThis.document = {
      visibilityState: 'visible',
      addEventListener: (evt, fn) => { if (evt === 'visibilitychange') visibilityHandler = fn; },
    };

    const { acquireWakeLock } = await import('../js/wakeLock.js');
    await acquireWakeLock();

    // Der Browser gibt den Sentinel automatisch frei, sobald der Tab
    // unsichtbar wird (hier simuliert, ohne den Test-Sentinel selbst zu
    // 'releasen', da das echte API-Verhalten den 'release'-Listener auch
    // in diesem Fall feuert).
    firstSentinel.released = true;
    firstSentinel.release(); // simuliert das browsereigene Release-Event
    globalThis.document.visibilityState = 'visible';
    await visibilityHandler();

    expect(request).toHaveBeenCalledTimes(2);
  });

  it('fordert nach releaseWakeLock() beim Sichtbarwerden KEINEN neuen Sentinel mehr an', async () => {
    clearGlobals();
    const sentinel = makeSentinel();
    const request = vi.fn(async () => sentinel);
    let visibilityHandler;
    globalThis.navigator = { wakeLock: { request } };
    globalThis.document = {
      visibilityState: 'visible',
      addEventListener: (evt, fn) => { if (evt === 'visibilitychange') visibilityHandler = fn; },
    };

    const { acquireWakeLock, releaseWakeLock } = await import('../js/wakeLock.js');
    await acquireWakeLock();
    releaseWakeLock();
    request.mockClear();

    await visibilityHandler();
    expect(request).not.toHaveBeenCalled();
  });
});
