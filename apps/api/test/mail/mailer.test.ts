// apps/api/test/mail/mailer.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryMailSender } from '../../src/mail/mailer.memory.js';

describe('InMemoryMailSender', () => {
  it('zeichnet eine gesendete Einladungs-E-Mail mit allen Feldern auf', async () => {
    const mailer = new InMemoryMailSender();
    const expiresAt = new Date('2026-08-01T00:00:00.000Z');
    await mailer.sendInvitationEmail({
      to: 'trainer@example.org',
      recipientName: 'Sabine Reuter',
      role: 'trainer',
      clubName: 'SV Wasserfreunde',
      inviteUrl: 'https://app.example.org/#/accept-invite/abc123',
      expiresAt,
    });
    expect(mailer.sentEmails).toHaveLength(1);
    expect(mailer.sentEmails[0]).toMatchObject({
      to: 'trainer@example.org',
      role: 'trainer',
      clubName: 'SV Wasserfreunde',
      inviteUrl: 'https://app.example.org/#/accept-invite/abc123',
    });
  });

  it('zeichnet mehrere E-Mails in Reihenfolge auf', async () => {
    const mailer = new InMemoryMailSender();
    await mailer.sendInvitationEmail({ to: 'a@x.de', role: 'admin', clubName: 'A', inviteUrl: 'u1', expiresAt: new Date() });
    await mailer.sendInvitationEmail({ to: 'b@x.de', role: 'athlete', clubName: 'B', inviteUrl: 'u2', expiresAt: new Date() });
    expect(mailer.sentEmails.map((m) => m.to)).toEqual(['a@x.de', 'b@x.de']);
  });
});
