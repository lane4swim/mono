// @vitest-environment jsdom
//
// apps/web/test/swUpdate.test.js
//
// Regressionstests für Review 30.08.2026, Befund U5: sw.js aktiviert
// einen neu installierten Worker nicht mehr von selbst (kein
// self.skipWaiting() mehr beim Install) — ohne die hier getestete Logik
// bliebe eine über Stunden offene Sitzung beliebig lange auf dem alten
// Stand, ohne jeden Hinweis. jsdom kennt keine echte Service-Worker-API;
// die Tests unten bauen ein minimales Double von
// ServiceWorkerRegistration/ServiceWorker nach (addEventListener() +
// gezieltes Auslösen der jeweiligen Events).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerServiceWorker, notifyUpdateAvailable } from '../js/swUpdate.js';

function makeFakeRegistration({ waiting = null, installing = null } = {}) {
  const listeners = {};
  return {
    waiting,
    installing,
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    _emit(type) { (listeners[type] || []).forEach((fn) => fn()); },
  };
}

function makeFakeWorker() {
  const listeners = {};
  return {
    state: 'installing',
    postMessage: vi.fn(),
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    _emit(type) { (listeners[type] || []).forEach((fn) => fn()); },
  };
}

const originalServiceWorker = navigator.serviceWorker;

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(() => {
  navigator.serviceWorker = originalServiceWorker;
  vi.restoreAllMocks();
});

describe('registerServiceWorker() — Update-Hinweis (Befund U5)', () => {
  it('zeigt sofort einen Hinweis, wenn die Registrierung bereits einen wartenden Worker meldet', async () => {
    const waitingWorker = { postMessage: vi.fn() };
    const registration = makeFakeRegistration({ waiting: waitingWorker });
    navigator.serviceWorker = {
      register: vi.fn().mockResolvedValue(registration),
      addEventListener: vi.fn(),
    };

    registerServiceWorker('sw.js');
    await Promise.resolve();
    await Promise.resolve();

    expect(document.querySelector('.update-banner')).toBeTruthy();
  });

  it('zeigt einen Hinweis, sobald ein neu installierter Worker bereitsteht UND bereits ein Controller aktiv ist (Update, kein Erstinstall)', async () => {
    const newWorker = makeFakeWorker();
    const registration = makeFakeRegistration({ installing: newWorker });
    navigator.serviceWorker = {
      register: vi.fn().mockResolvedValue(registration),
      controller: {}, // eine bereits aktive Sitzung — kein Erstinstall
      addEventListener: vi.fn(),
    };

    registerServiceWorker('sw.js');
    await Promise.resolve();
    await Promise.resolve();

    registration._emit('updatefound');
    newWorker.state = 'installed';
    newWorker._emit('statechange');

    expect(document.querySelector('.update-banner')).toBeTruthy();
  });

  it('zeigt KEINEN Hinweis beim allerersten Install (noch kein aktiver Controller)', async () => {
    const newWorker = makeFakeWorker();
    const registration = makeFakeRegistration({ installing: newWorker });
    navigator.serviceWorker = {
      register: vi.fn().mockResolvedValue(registration),
      controller: null, // erster Install dieser Seite überhaupt
      addEventListener: vi.fn(),
    };

    registerServiceWorker('sw.js');
    await Promise.resolve();
    await Promise.resolve();

    registration._emit('updatefound');
    newWorker.state = 'installed';
    newWorker._emit('statechange');

    expect(document.querySelector('.update-banner')).toBeNull();
  });

  it('lädt die Seite über controllerchange genau einmal neu, auch wenn das Event mehrfach feuert', () => {
    const addEventListener = vi.fn();
    navigator.serviceWorker = {
      register: vi.fn().mockResolvedValue(makeFakeRegistration()),
      addEventListener,
    };
    // jsdom's Location#reload lässt sich nicht per vi.spyOn() ersetzen
    // (Location.prototype-Methoden sind dort nicht konfigurierbar) — die
    // gesamte Referenz austauschen ist der gängige Workaround.
    const reloadSpy = vi.fn();
    delete window.location;
    window.location = { reload: reloadSpy };

    registerServiceWorker('sw.js');

    const controllerChangeHandler = addEventListener.mock.calls.find(([type]) => type === 'controllerchange')[1];
    controllerChangeHandler();
    controllerChangeHandler();

    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
});

describe('notifyUpdateAvailable() (Befund U5)', () => {
  it('hängt keinen zweiten Hinweis an, wenn bereits einer sichtbar ist', () => {
    notifyUpdateAvailable({ postMessage: vi.fn() });
    notifyUpdateAvailable({ postMessage: vi.fn() });
    expect(document.querySelectorAll('.update-banner')).toHaveLength(1);
  });

  it('sendet beim Klick auf den Neu-laden-Knopf "SKIP_WAITING" an den wartenden Worker', () => {
    const postMessage = vi.fn();
    notifyUpdateAvailable({ postMessage });
    document.querySelector('.update-banner button').click();
    expect(postMessage).toHaveBeenCalledWith('SKIP_WAITING');
  });
});
