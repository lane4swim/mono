// @vitest-environment jsdom
//
// Regressionstest für Issue #82: renderRoute() hielt für seine eigene
// Prüfung nach `await mod.render()` das Token aus beginRender(viewEl) —
// jedes Modul ruft beginRender() auf demselben Container aber selbst
// erneut auf und überschrieb es, wodurch focus()/updateSyncBadge() nach
// einem regulären Routenwechsel nie liefen.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const pendingSyncCount = vi.fn(async () => 0);
vi.mock('../js/db.js', () => ({ pendingSyncCount: () => pendingSyncCount() }));
vi.mock('../js/state.js', () => ({
  getRoles: () => ['trainer'],
  getCurrentUser: () => null,
  getEnabledModules: () => [],
}));

const { renderRoute } = await import('../js/shell.js');
const { registerModule } = await import('../js/router.js');
const { beginRender, el } = await import('../js/dom.js');

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

const pending = [];
registerModule({
  id: 'dashboard', // Kernmodul (router.js: CORE_MODULE_IDS) — unabhängig von gebuchten Paketen sichtbar
  roles: ['trainer'],
  async render(container, params) {
    const isCurrent = beginRender(container);
    const d = deferred();
    pending.push(d);
    await d.promise;
    if (!isCurrent()) return;
    container.replaceChildren(el('p', {}, `view ${params[0] || ''}`));
  },
});

function flush() { return new Promise((r) => setTimeout(r, 0)); }

describe('renderRoute()', () => {
  beforeEach(() => { pending.length = 0; pendingSyncCount.mockClear(); });

  it('fokussiert die Ansicht und aktualisiert den Sync-Badge auch dann, wenn das Modul selbst beginRender() aufruft', async () => {
    const viewEl = document.createElement('div');
    const focus = vi.spyOn(viewEl, 'focus');
    const done = renderRoute(viewEl, { routeId: 'dashboard', params: [] });
    pending[0].resolve();
    await done;
    expect(viewEl.textContent).toBe('view ');
    expect(focus).toHaveBeenCalledTimes(1);
    expect(pendingSyncCount).toHaveBeenCalledTimes(1);
  });

  it('ein überholter Routen-Render fokussiert nicht und zeichnet nicht über den neueren', async () => {
    const viewEl = document.createElement('div');
    const focus = vi.spyOn(viewEl, 'focus');
    const first = renderRoute(viewEl, { routeId: 'dashboard', params: ['a'] });
    const second = renderRoute(viewEl, { routeId: 'dashboard', params: ['b'] });
    pending[1].resolve();
    await second;
    pending[0].resolve();
    await first;
    await flush();
    expect(viewEl.textContent).toBe('view b');
    expect(focus).toHaveBeenCalledTimes(1);
  });
});
