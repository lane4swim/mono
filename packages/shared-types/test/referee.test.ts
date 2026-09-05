// packages/shared-types/test/referee.test.ts
import { describe, it, expect } from 'vitest';
import {
  RefereeFunctionSchema,
  REFEREE_FUNCTIONS,
  RefereeAssignmentSchema,
  CreateRefereeAssignmentRequestSchema,
  UpdateRefereeAssignmentRequestSchema,
  RefereeAssignmentListResponseSchema,
} from '../src/referee.js';

const validAssignment = {
  id: '11111111-1111-1111-1111-111111111111',
  userId: '22222222-2222-2222-2222-222222222222',
  competitionName: 'Kreismeisterschaft',
  competitionPlace: 'Musterstadt',
  competitionId: null,
  date: '2026-03-01T00:00:00.000Z',
  function: 'kampfrichter',
  note: '',
  createdByAdminId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('RefereeFunctionSchema', () => {
  it('akzeptiert alle sieben dokumentierten Funktionen', () => {
    const functions = ['kampfrichter', 'schiedsrichter', 'startrichter', 'zeitnehmer', 'bahnrichter', 'wettkampfsekretaer', 'sonstige'];
    for (const fn of functions) expect(RefereeFunctionSchema.safeParse(fn).success).toBe(true);
  });
  it('lehnt einen unbekannten Wert ab', () => {
    expect(RefereeFunctionSchema.safeParse('irgendwas').success).toBe(false);
  });
  it('REFEREE_FUNCTIONS spiegelt exakt die Enum-Werte', () => {
    expect([...REFEREE_FUNCTIONS].sort()).toEqual(
      ['bahnrichter', 'kampfrichter', 'schiedsrichter', 'sonstige', 'startrichter', 'wettkampfsekretaer', 'zeitnehmer'].sort(),
    );
  });
});

describe('RefereeAssignmentSchema', () => {
  it('akzeptiert einen gültigen Einsatz', () => {
    expect(RefereeAssignmentSchema.safeParse(validAssignment).success).toBe(true);
  });
  it('akzeptiert einen Einsatz mit verknüpftem Competition-Datensatz', () => {
    expect(RefereeAssignmentSchema.safeParse({ ...validAssignment, competitionId: '33333333-3333-3333-3333-333333333333' }).success).toBe(true);
  });
  it('akzeptiert einen Einsatz, dessen Eintrag von einer admin-Person erfasst wurde', () => {
    expect(RefereeAssignmentSchema.safeParse({ ...validAssignment, createdByAdminId: '44444444-4444-4444-4444-444444444444' }).success).toBe(true);
  });
  it('lehnt eine leere competitionName ab', () => {
    expect(RefereeAssignmentSchema.safeParse({ ...validAssignment, competitionName: '' }).success).toBe(false);
  });
  it('lehnt eine unbekannte function ab', () => {
    expect(RefereeAssignmentSchema.safeParse({ ...validAssignment, function: 'irgendwas' }).success).toBe(false);
  });
  it('lehnt unbekannte Zusatzfelder ab (.strict())', () => {
    expect(RefereeAssignmentSchema.safeParse({ ...validAssignment, unknownField: 'x' }).success).toBe(false);
  });
});

describe('CreateRefereeAssignmentRequestSchema', () => {
  it('akzeptiert eine minimale Anfrage (nur Pflichtfelder)', () => {
    const req = { competitionName: 'Kreismeisterschaft', date: '2026-03-01T00:00:00.000Z', function: 'zeitnehmer' };
    const parsed = CreateRefereeAssignmentRequestSchema.safeParse(req);
    expect(parsed.success).toBe(true);
    // note/competitionPlace tragen Defaults ('') — auch bei einer
    // minimalen Anfrage im Ergebnis reguläre Strings, kein `undefined`
    // (Regressionsschutz für die parseInput()-Inferenz, siehe
    // qualification.test.ts für dasselbe Muster).
    if (parsed.success) {
      expect(parsed.data.note).toBe('');
      expect(parsed.data.competitionPlace).toBe('');
    }
  });
  it('lehnt eine Anfrage ohne date ab', () => {
    expect(CreateRefereeAssignmentRequestSchema.safeParse({ competitionName: 'X', function: 'zeitnehmer' }).success).toBe(false);
  });
  it('lehnt eine Anfrage ohne competitionName ab', () => {
    expect(CreateRefereeAssignmentRequestSchema.safeParse({ date: '2026-03-01T00:00:00.000Z', function: 'zeitnehmer' }).success).toBe(false);
  });
});

describe('UpdateRefereeAssignmentRequestSchema', () => {
  it('akzeptiert ein leeres Patch (keine Felder geändert)', () => {
    expect(UpdateRefereeAssignmentRequestSchema.safeParse({}).success).toBe(true);
  });
  it('akzeptiert ein Patch, das nur die function ändert', () => {
    expect(UpdateRefereeAssignmentRequestSchema.safeParse({ function: 'bahnrichter' }).success).toBe(true);
  });
  it('akzeptiert explizites null für competitionId (Verknüpfung entfernen)', () => {
    expect(UpdateRefereeAssignmentRequestSchema.safeParse({ competitionId: null }).success).toBe(true);
  });
});

describe('RefereeAssignmentListResponseSchema', () => {
  it('akzeptiert eine leere Liste', () => {
    expect(RefereeAssignmentListResponseSchema.safeParse({ assignments: [] }).success).toBe(true);
  });
  it('akzeptiert eine Liste gültiger Einsätze', () => {
    expect(RefereeAssignmentListResponseSchema.safeParse({ assignments: [validAssignment] }).success).toBe(true);
  });
});
