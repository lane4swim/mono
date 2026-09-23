// @vitest-environment jsdom
//
// Regressionstests für Issue #82: Detail-/Live-Renderer, die nach einem
// eigenen `await` weiterzeichnen, müssen per beginRender()/isCurrent()
// (dom.js) abbrechen, sobald ein neuerer Render oder eine Navigation
// denselben Container übernommen hat — sonst hängt der überholte,
// langsamere Aufruf seine Ansicht zusätzlich an (doppelter Inhalt) bzw.
// zeichnet über eine inzwischen geöffnete andere Ansicht.
//
// getAll() wird durch eine manuell auflösbare Warteschlange ersetzt, damit
// jeder Test die Reihenfolge, in der Datenabrufe fertig werden, exakt
// vorgibt.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));
vi.mock('../js/state.js', () => ({
  isTrainerOrAdmin: () => true,
  isAthleteScoped: () => false,
  isAdminOrSuperAdmin: () => false,
  getCurrentUser: () => null,
}));

const DATA = {
  plans: [
    { id: 'p1', name: 'Plan 1', weekStart: '2026-09-21', status: 'aktiv', groupId: null, days: [], comments: [] },
    { id: 'p2', name: 'Plan 2', weekStart: '2026-09-28', status: 'aktiv', groupId: null, days: [], comments: [] },
  ],
  competitions: [{ id: 'c1', name: 'Wettkampf 1', date: '2026-09-21', course: 'SCM' }],
};
const queue = [];
const fetched = [];
vi.mock('../js/db.js', () => ({
  getAll: (store) => { fetched.push(store); return new Promise((resolve) => queue.push(() => resolve(DATA[store] || []))); },
  put: async (_store, value) => value,
  remove: async () => {},
}));
vi.mock('../js/modules/actionItems.js', () => ({ fetchAssignableTrainers: async () => [] }));

const { plansModule } = await import('../js/modules/plans.js');
const { renderLiveMode } = await import('../js/modules/competitionLive.js');
const { beginRender, el, redraw } = await import('../js/dom.js');

function flush() { return new Promise((r) => setTimeout(r, 0)); }

// Löst alle Datenabrufe, die bis JETZT gestartet wurden, und lässt die
// davon abhängigen Fortsetzungen laufen (die ggf. neue Abrufe starten).
async function resolvePending() {
  const batch = queue.splice(0);
  batch.forEach((resolve) => resolve());
  await flush();
}

async function drain() {
  while (queue.length) await resolvePending();
}

// Jede Detail-/Live-Ansicht beginnt mit genau einem Zurück-Button — die
// Anzahl zeigt, wie viele Ansichten im Container gelandet sind.
const backButtons = (container) => container.querySelectorAll('button.mb-16');

describe('plans.js: renderDetail()', () => {
  beforeEach(() => { queue.length = 0; fetched.length = 0; });

  it('ein überholter, langsamerer Detail-Render hängt nichts an und überschreibt den neueren nicht', async () => {
    const container = document.createElement('div');
    const a = plansModule.render(container, ['p1']);
    const heldA = queue.splice(0); // A wartet in renderDetail() auf seine Daten

    const b = plansModule.render(container, ['p2']);
    await drain(); // B zeichnet vollständig
    await b;

    heldA.forEach((resolve) => resolve()); // A wird erst danach fertig
    await flush();
    await a;

    expect(backButtons(container)).toHaveLength(1);
    expect([...container.querySelectorAll('h1')].map((h) => h.textContent)).toEqual(['Plan 2']);
  });

  it('eine Navigation während des Detail-Abrufs wird nicht überschrieben', async () => {
    const container = document.createElement('div');
    const pending = plansModule.render(container, ['p1']);

    // Simuliert shell.js: renderRoute() für eine andere Route.
    beginRender(container);
    container.replaceChildren(el('p', { id: 'other-view' }, 'andere Ansicht'));

    await drain();
    await pending;

    expect(container.children).toHaveLength(1);
    expect(container.firstChild.id).toBe('other-view');
  });

  it('liest für die Detailansicht jeden Store nur einmal (keine vorgeschaltete Listenabfrage)', async () => {
    const container = document.createElement('div');
    const pending = plansModule.render(container, ['p1']);
    await drain();
    await pending;
    expect(fetched.filter((store) => store === 'plans')).toHaveLength(1);
    expect(container.querySelectorAll('h1')).toHaveLength(1);
  });
});

describe('dom.js: redraw()', () => {
  it('ersetzt den Inhalt erst, wenn die Daten da sind', async () => {
    const container = document.createElement('div');
    container.appendChild(el('p', { id: 'old' }));
    let release;
    const done = redraw(container, () => new Promise((r) => { release = r; }), (text) => container.appendChild(el('p', { id: 'new' }, text)));
    expect(container.firstChild.id).toBe('old'); // bleibt während des Ladens sichtbar
    release('fertig');
    await done;
    expect([...container.children].map((c) => c.id)).toEqual(['new']);
  });

  it('zeichnet nicht, wenn inzwischen ein neuerer Render den Container übernommen hat', async () => {
    const container = document.createElement('div');
    let release;
    const draw = vi.fn();
    const done = redraw(container, () => new Promise((r) => { release = r; }), draw);
    beginRender(container);
    container.appendChild(el('p', { id: 'other-view' }));
    release();
    await done;
    expect(draw).not.toHaveBeenCalled();
    expect(container.firstChild.id).toBe('other-view');
  });
});

describe('competitionLive.js: renderLiveMode()', () => {
  beforeEach(() => { queue.length = 0; });

  it('zwei überlappende Aufrufe ergeben genau eine Ansicht, auch wenn der ältere zuletzt fertig wird', async () => {
    const container = document.createElement('div');
    const a = renderLiveMode(container, 'c1', 0);
    const heldA = queue.splice(0);
    container.replaceChildren(); // wie competitions.js: render(), das vor renderLiveMode() leert
    const b = renderLiveMode(container, 'c1', 1);
    await drain();
    await b;

    heldA.forEach((resolve) => resolve());
    await flush();
    await a;

    expect(backButtons(container)).toHaveLength(1);
  });
});
