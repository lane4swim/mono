// packages/shared-types/test/invitation.test.ts
import { describe, it, expect } from 'vitest';
import {
  CreateClubRequestSchema,
  CreateInvitationRequestSchema,
  AcceptInvitationRequestSchema,
  InvitationPreviewSchema,
  InvitationSummarySchema,
  ClubWithCountsSchema,
} from '../src/invitation.js';

describe('ClubWithCountsSchema', () => {
  it('akzeptiert einen Verein mit Mitgliederzahlen', () => {
    const club = {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'SV Wasserfreunde',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      memberCounts: { admin: 2, trainer: 5, athlete: 42 },
    };
    expect(ClubWithCountsSchema.safeParse(club).success).toBe(true);
  });
  it('lehnt negative Mitgliederzahlen ab', () => {
    const club = {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'X', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      memberCounts: { admin: -1, trainer: 0, athlete: 0 },
    };
    expect(ClubWithCountsSchema.safeParse(club).success).toBe(false);
  });
});

describe('CreateClubRequestSchema', () => {
  it('akzeptiert einen gültigen Verein inkl. Admin-Einladung', () => {
    const req = { name: 'SV Wasserfreunde', adminEmail: 'admin@sv-wasserfreunde.de', adminName: 'Petra Klein' };
    expect(CreateClubRequestSchema.safeParse(req).success).toBe(true);
  });
  it('lehnt einen leeren Vereinsnamen ab', () => {
    expect(CreateClubRequestSchema.safeParse({ name: '', adminEmail: 'a@b.de', adminName: 'X' }).success).toBe(false);
  });
});

describe('CreateInvitationRequestSchema', () => {
  it('akzeptiert eine Einladung ohne clubId (wird serverseitig für admin-Requester ergänzt)', () => {
    expect(CreateInvitationRequestSchema.safeParse({ email: 'trainer@example.org', role: 'trainer' }).success).toBe(true);
  });
  it('lehnt die Rolle "superadmin" ab (nicht per Einladung vergebbar)', () => {
    expect(CreateInvitationRequestSchema.safeParse({ email: 'x@y.de', role: 'superadmin' }).success).toBe(false);
  });
  it('akzeptiert eine athlete-Einladung mit athleteId', () => {
    const req = { email: 'mara@example.org', role: 'athlete', athleteId: '11111111-1111-1111-1111-111111111111' };
    expect(CreateInvitationRequestSchema.safeParse(req).success).toBe(true);
  });
});

describe('AcceptInvitationRequestSchema', () => {
  it('akzeptiert Token + Name + gültiges Passwort + Einwilligung', () => {
    const req = { token: 'abc123', name: 'Neue Person', password: 'ein-sicheres-passwort', consent: true };
    expect(AcceptInvitationRequestSchema.safeParse(req).success).toBe(true);
  });
  it('lehnt die Registrierung ohne Einwilligung ab (DSGVO)', () => {
    const req = { token: 'abc123', name: 'Neue Person', password: 'ein-sicheres-passwort' };
    expect(AcceptInvitationRequestSchema.safeParse(req).success).toBe(false);
  });
  it('lehnt ein zu kurzes Passwort ab', () => {
    expect(AcceptInvitationRequestSchema.safeParse({ token: 'abc', name: 'X', password: 'kurz', consent: true }).success).toBe(false);
  });
  it('lehnt ein leeres Token ab', () => {
    expect(AcceptInvitationRequestSchema.safeParse({ token: '', name: 'X', password: 'lang-genug', consent: true }).success).toBe(false);
  });
  it('erfordert weder clubId noch role/email vom Client (kommen aus der Einladung selbst)', () => {
    const req = { token: 'abc123', name: 'X', password: 'lang-genug-passwort', consent: true };
    const parsed = AcceptInvitationRequestSchema.safeParse(req);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect('role' in parsed.data).toBe(false);
      expect('clubId' in parsed.data).toBe(false);
    }
  });
});

describe('InvitationPreviewSchema', () => {
  it('akzeptiert eine Vorschau ohne Vereinsnamen (z. B. Admin-Einladung, Verein wird gleichzeitig erstellt)', () => {
    const preview = { email: 'a@b.de', role: 'admin', clubName: null, expiresAt: new Date().toISOString() };
    expect(InvitationPreviewSchema.safeParse(preview).success).toBe(true);
  });
});

describe('InvitationSummarySchema', () => {
  it('akzeptiert eine vollständige Zusammenfassung ohne Token-Feld', () => {
    const summary = {
      id: '11111111-1111-1111-1111-111111111111',
      email: 'a@b.de',
      role: 'trainer',
      clubId: '22222222-2222-2222-2222-222222222222',
      invitedById: '33333333-3333-3333-3333-333333333333',
      expiresAt: new Date().toISOString(),
      usedAt: null,
      revokedAt: null,
      createdAt: new Date().toISOString(),
    };
    expect(InvitationSummarySchema.safeParse(summary).success).toBe(true);
    expect('token' in summary).toBe(false);
  });
});
