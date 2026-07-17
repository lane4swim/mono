// packages/sync-protocol/test/conflictResolution.test.ts
import { describe, it, expect } from 'vitest';
import { resolveConflict, strategyForStore } from '../src/conflictResolution.js';

const OLDER = '2026-07-10T08:00:00.000Z';
const NEWER = '2026-07-10T09:00:00.000Z';

describe('strategyForStore', () => {
  it('weist "results" die Strategie never-overwrite zu', () => {
    expect(strategyForStore('results')).toBe('never-overwrite');
  });
  it('weist Stammdaten-Stores last-write-wins zu', () => {
    expect(strategyForStore('athletes')).toBe('last-write-wins');
    expect(strategyForStore('groups')).toBe('last-write-wins');
  });
  it('weist verschachtelten Dokument-Stores last-write-wins-document zu', () => {
    expect(strategyForStore('plans')).toBe('last-write-wins-document');
    expect(strategyForStore('templates')).toBe('last-write-wins-document');
  });
});

describe('resolveConflict', () => {
  it('wendet das Event ohne Weiteres an, wenn noch kein Server-Datensatz existiert', () => {
    const decision = resolveConflict('athletes', { clientUpdatedAt: OLDER }, null);
    expect(decision.outcome).toBe('apply');
  });

  it('wendet das Event an, wenn der Client-Stand mindestens so aktuell ist wie der Server', () => {
    const decision = resolveConflict('athletes', { clientUpdatedAt: NEWER }, { updatedAt: OLDER });
    expect(decision.outcome).toBe('apply');
  });

  it('verwirft ein veraltetes Event bei last-write-wins-Stores, wenn der Server neuer ist', () => {
    const decision = resolveConflict('athletes', { clientUpdatedAt: OLDER }, { updatedAt: NEWER });
    expect(decision.outcome).toBe('conflict-server-wins');
  });

  it('legt bei "results" einen neuen Datensatz an, statt zu überschreiben, wenn der Server neuer ist', () => {
    const decision = resolveConflict('results', { clientUpdatedAt: OLDER }, { updatedAt: NEWER });
    expect(decision.outcome).toBe('insert-as-new');
  });

  it('behandelt exakt gleiche Zeitstempel als "kein Konflikt" (Client gewinnt per Definition)', () => {
    const decision = resolveConflict('athletes', { clientUpdatedAt: OLDER }, { updatedAt: OLDER });
    expect(decision.outcome).toBe('apply');
  });

  it('verwirft ein veraltetes Event bei last-write-wins-document-Stores (z. B. Trainingspläne)', () => {
    const decision = resolveConflict('plans', { clientUpdatedAt: OLDER }, { updatedAt: NEWER });
    expect(decision.outcome).toBe('conflict-server-wins');
  });
});
