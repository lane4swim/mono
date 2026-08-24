// apps/api/test/mail/mailer.test.ts
import { describe, it, expect } from 'vitest';
import { InMemoryMailSender } from '../../src/mail/mailer.memory.js';
import { buildHtmlBody } from '../../src/mail/mailer.js';

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

describe('buildHtmlBody() — HTML-Escaping', () => {
  it('escaped recipientName, clubName und Rollen-Label', () => {
    const html = buildHtmlBody({
      to: 'x@example.org',
      recipientName: '<script>alert(1)</script>',
      role: 'trainer',
      clubName: 'SV "Wasserfreunde" & <Freunde>',
      inviteUrl: 'https://app.example.org/#/accept-invite/abc123',
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('SV "Wasserfreunde" & <Freunde>');
  });

  // Regressionstest für die Code-Review-Korrektur: inviteUrl war die
  // einzige interpolierte Stelle in buildHtmlBody(), die NICHT durch
  // escapeHtml() lief — bei einem Wert mit HTML-Sonderzeichen (z. B. über
  // eine kompromittierte/fehlkonfigurierte FRONTEND_BASE_URL) hätte das
  // href-Attribut aufgebrochen werden können.
  it('escaped inviteUrl (vormals die einzige Ausnahme von der sonst konsequenten Regel)', () => {
    const html = buildHtmlBody({
      to: 'x@example.org',
      role: 'trainer',
      clubName: 'SV Wasserfreunde',
      inviteUrl: 'https://boese.example.org/"><script>alert(1)</script>',
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(html).not.toContain('"><script>alert(1)</script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('behält einen normalen inviteUrl unverändert nutzbar als href', () => {
    const html = buildHtmlBody({
      to: 'x@example.org',
      role: 'trainer',
      clubName: 'SV Wasserfreunde',
      inviteUrl: 'https://app.example.org/#/accept-invite/abc123',
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(html).toContain('href="https://app.example.org/#/accept-invite/abc123"');
  });

  // Regressionstest für Befund S8 (Code-Review): escapeHtml() escapte
  // bislang keine einfachen Anführungszeichen. Heute folgenlos (jedes
  // Attribut in buildHtmlBody() ist doppelt gequotet), aber die Funktion
  // heißt allgemein "escapeHtml" und sollte als solche vollständig
  // escapen, unabhängig von der aktuellen Verwendung durch ihre Aufrufer.
  it('escaped einfache Anführungszeichen in clubName/recipientName', () => {
    const html = buildHtmlBody({
      to: 'x@example.org',
      recipientName: "O'Brien",
      role: 'trainer',
      clubName: "Verein 'X'",
      inviteUrl: 'https://app.example.org/#/accept-invite/abc123',
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(html).not.toContain("O'Brien");
    expect(html).not.toContain("Verein 'X'");
    expect(html).toContain('O&#39;Brien');
    expect(html).toContain('Verein &#39;X&#39;');
  });
});
