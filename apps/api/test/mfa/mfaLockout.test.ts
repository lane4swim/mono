// Issue #109: reine Sperrlogik ohne Repository.
import { describe, it, expect } from 'vitest';
import {
  CLEARED_MFA_FAILURE_STATE,
  MFA_FAILURE_WINDOW_MS,
  MFA_LOCK_BASE_MS,
  MFA_LOCK_MAX_MS,
  MFA_LOCK_THRESHOLD,
  isMfaLocked,
  lockDurationMs,
  nextMfaFailureState,
  type MfaFailureState,
} from '../../src/modules/mfa/mfaLockout.js';

const T0 = new Date('2026-11-19T12:00:00.000Z');
const after = (ms: number) => new Date(T0.getTime() + ms);

function fail(times: number, start: MfaFailureState = CLEARED_MFA_FAILURE_STATE, at: Date = T0) {
  let state = start;
  let newlyLocked = false;
  for (let i = 0; i < times; i++) ({ state, newlyLocked } = nextMfaFailureState(state, at));
  return { state, newlyLocked };
}

describe('nextMfaFailureState', () => {
  it(`sperrt erst beim ${MFA_LOCK_THRESHOLD}. Fehlversuch im Zeitfenster`, () => {
    expect(fail(MFA_LOCK_THRESHOLD - 1)).toMatchObject({ newlyLocked: false, state: { mfaFailedCount: MFA_LOCK_THRESHOLD - 1, mfaLockedUntil: null } });
    const { state, newlyLocked } = fail(MFA_LOCK_THRESHOLD);
    expect(newlyLocked).toBe(true);
    expect(state).toMatchObject({ mfaFailedCount: 0, mfaLockoutCount: 1, mfaLockedUntil: after(MFA_LOCK_BASE_MS) });
    expect(isMfaLocked(state, after(MFA_LOCK_BASE_MS - 1))).toBe(true);
    expect(isMfaLocked(state, after(MFA_LOCK_BASE_MS))).toBe(false);
  });

  it('beginnt nach Ablauf des Zeitfensters neu zu zählen', () => {
    const { state } = fail(MFA_LOCK_THRESHOLD - 1);
    const next = nextMfaFailureState(state, after(MFA_FAILURE_WINDOW_MS));
    expect(next).toMatchObject({ newlyLocked: false, state: { mfaFailedCount: 1, mfaFailedWindowStart: after(MFA_FAILURE_WINDOW_MS) } });
  });

  it('zählt während einer Sperre nicht weiter', () => {
    const locked = fail(MFA_LOCK_THRESHOLD).state;
    expect(nextMfaFailureState(locked, after(1000))).toEqual({ state: locked, newlyLocked: false });
  });

  it('verdoppelt die Sperrdauer bei jeder weiteren Sperre', () => {
    const first = fail(MFA_LOCK_THRESHOLD).state;
    const secondAt = after(MFA_LOCK_BASE_MS);
    const second = fail(MFA_LOCK_THRESHOLD, first, secondAt).state;
    expect(second.mfaLockoutCount).toBe(2);
    expect(second.mfaLockedUntil!.getTime() - secondAt.getTime()).toBe(2 * MFA_LOCK_BASE_MS);
  });
});

describe('lockDurationMs', () => {
  it('beginnt bei 15 Minuten und ist bei 24 Stunden gedeckelt', () => {
    expect(lockDurationMs(0)).toBe(MFA_LOCK_BASE_MS);
    expect(lockDurationMs(1)).toBe(2 * MFA_LOCK_BASE_MS);
    expect(lockDurationMs(6)).toBe(64 * MFA_LOCK_BASE_MS); // 16 h
    expect(lockDurationMs(7)).toBe(MFA_LOCK_MAX_MS);
    expect(lockDurationMs(1000)).toBe(MFA_LOCK_MAX_MS);
  });
});
