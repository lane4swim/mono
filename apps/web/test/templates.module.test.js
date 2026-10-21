// @vitest-environment jsdom
//
// UI der Trainingsplan-Vorlagen (js/modules/templates.js): Umschalten
// zwischen Karten- und Listenansicht, gemerkte Wahl in localStorage.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../js/demoMode.js', () => ({ IS_DEMO: false }));
vi.mock('../js/state.js', () => ({ getCurrentUser: () => ({ id: 'u-trainer', clubId: 'club' }), isTrainerOrAdmin: () => true }));

const stores = vi.hoisted(() => ({}));
vi.mock('../js/db.js', () => ({ getAll: vi.fn(async (name) => stores[name] || []), put: vi.fn(), remove: vi.fn() }));
vi.mock('../js/modules/libraryTransfer.js', () => ({ libraryTransferButtons: () => document.createElement('span') }));

const { templatesModule } = await import('../js/modules/templates.js');
const { t } = await import('../js/i18n.js');

async function render() {
  const c = document.createElement('div');
  await templatesModule.render(c);
  return c;
}

beforeEach(() => {
  localStorage.clear();
  Object.assign(stores, {
    templates: [
      { id: 't1', name: 'Grundlagenausdauer', description: 'GA1', poolLength: null, tags: [], sets: [{ kind: 'set', id: 's1', description: 'Kraul', distance: 400, reps: 2, restSec: 0 }] },
      { id: 't2', name: 'Sprint', description: '', poolLength: null, tags: [], sets: [] },
    ],
    exercises: [],
    sectionTemplates: [],
  });
});

describe('templatesModule', () => {
  it('zeigt keine Eyebrow-Zeile über der Hauptüberschrift', async () => {
    const c = await render();
    expect(c.querySelector('.page-eyebrow')).toBeNull();
    expect(c.querySelector('h1').textContent).toBe(t('templates.title'));
  });

  it('startet in der Kartenansicht und wechselt auf die Listenansicht', async () => {
    const c = await render();
    expect(c.querySelectorAll('.card h3')).toHaveLength(2);
    expect(c.querySelector('table')).toBeNull();

    c.querySelector(`button[aria-label="${t('templates.viewList')}"]`).click();
    const rows = c.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('strong').textContent).toBe('Grundlagenausdauer');
    expect(rows[0].textContent).toContain('800 m');
    expect(localStorage.getItem('lane1-templates-view')).toBe('list');
  });

  it('merkt sich die Listenansicht beim nächsten Öffnen', async () => {
    localStorage.setItem('lane1-templates-view', 'list');
    const c = await render();
    expect(c.querySelector('table')).not.toBeNull();
    expect(c.querySelector(`button[aria-label="${t('templates.viewList')}"]`).getAttribute('aria-pressed')).toBe('true');
  });
});
