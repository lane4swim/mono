// apps/api/test/mail/mailer.test.ts
import { describe, it, expect, vi } from 'vitest';
import { InMemoryMailSender } from '../../src/mail/mailer.memory.js';
import {
  buildHtmlBody,
  buildTextBody,
  buildSubject,
  buildPasswordResetSubject,
  buildPasswordResetTextBody,
  buildPasswordResetHtmlBody,
  buildAccountSecurityChangeSubject,
  buildAccountSecurityChangeTextBody,
  buildAccountSecurityChangeHtmlBody,
  SmtpMailSender,
  ConsoleMailSender,
} from '../../src/mail/mailer.js';

// Fake statt echtem SMTP-Handshake: sendMail() als Spy, createTransport()
// ebenfalls, damit die Tests zu Befund P4 unten prüfen können, WIE OFT der
// Transport tatsächlich neu aufgebaut wird.
const sendMailMock = vi.fn().mockResolvedValue(undefined);
const createTransportMock = vi.fn((..._args: unknown[]) => ({ sendMail: sendMailMock }));
vi.mock('nodemailer', () => ({ createTransport: (...args: unknown[]) => createTransportMock(...args) }));

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

// Sicherheitsregression (Sicherheitsreview 2026-08, Befund M3):
// ConsoleMailSender protokollierte zuvor den vollständigen Einladungslink
// inklusive Klartext-Token — jede Einladung landete dadurch dauerhaft im
// Server-Log. Das Token ist genauso sicherheitskritisch wie ein Passwort
// (siehe auth/tokens.ts: Refresh-/Einladungs-Tokens werden serverseitig
// nur gehasht gespeichert) und darf daher nicht im Klartext protokolliert
// werden — der "Link kopieren"-Button in der Nutzerverwaltungs-Oberfläche
// bleibt der vorgesehene Weg, den Link ohne SMTP zu teilen.
describe('ConsoleMailSender — kein Token/Link im Server-Log (Sicherheitsregression)', () => {
  it('protokolliert Empfänger/Verein/Rolle, aber NICHT die inviteUrl', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const mailer = new ConsoleMailSender();
      await mailer.sendInvitationEmail({
        to: 'trainer@example.org',
        role: 'trainer',
        clubName: 'SV Wasserfreunde',
        inviteUrl: 'https://app.example.org/#/accept-invite/GEHEIMES-TOKEN-abc123',
        expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logged = warnSpy.mock.calls[0]!.join(' ');
      expect(logged).toContain('trainer@example.org');
      expect(logged).toContain('SV Wasserfreunde');
      expect(logged).not.toContain('GEHEIMES-TOKEN-abc123');
      expect(logged).not.toContain('accept-invite');
    } finally {
      warnSpy.mockRestore();
    }
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

// Regressionstests für Befund W9 (Code-Review): mailer.ts formatierte
// Einladungs-E-Mails bislang unabhängig von payload.locale IMMER auf
// Deutsch (Datum via .toLocaleDateString('de-DE') fest verdrahtet, nur ein
// deutsches Rollen-Label).
describe('Lokalisierung (Befund W9)', () => {
  const basePayload = {
    to: 'x@example.org',
    role: 'trainer' as const,
    clubName: 'SV Wasserfreunde',
    inviteUrl: 'https://app.example.org/#/accept-invite/abc123',
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
  };

  it('baut Betreff/Text/HTML auf Deutsch, wenn locale fehlt (Fallback)', () => {
    expect(buildSubject(basePayload)).toContain('Einladung zu');
    expect(buildTextBody(basePayload)).toContain('Trainer:in');
    expect(buildHtmlBody(basePayload)).toContain('Trainer:in');
  });

  it('baut Betreff/Text/HTML auf Deutsch für eine unbekannte Locale (Fallback)', () => {
    const payload = { ...basePayload, locale: 'fr-FR' };
    expect(buildSubject(payload)).toContain('Einladung zu');
    expect(buildTextBody(payload)).toContain('Trainer:in');
  });

  it('baut Betreff/Text/HTML auf Englisch für locale "en-US"', () => {
    const payload = { ...basePayload, locale: 'en-US' };
    expect(buildSubject(payload)).toBe('Invitation to SV Wasserfreunde on Lane 1');
    const text = buildTextBody(payload);
    expect(text).toContain('coach');
    expect(text).not.toContain('Trainer:in');
    const html = buildHtmlBody(payload);
    expect(html).toContain('coach');
    expect(html).not.toContain('Trainer:in');
  });

  it('formatiert das Ablaufdatum passend zur Locale', () => {
    const de = buildTextBody(basePayload);
    const en = buildTextBody({ ...basePayload, locale: 'en-US' });
    expect(de).toContain('1. August 2026');
    expect(en).toContain('August 1, 2026');
  });
});

// Sicherheitsreview 2026-08, Befund M5 ("Passwort vergessen").
describe('ConsoleMailSender — Passwort-Reset-E-Mail: kein Token/Link im Server-Log', () => {
  it('protokolliert die Empfänger-Adresse, aber NICHT die resetUrl', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const mailer = new ConsoleMailSender();
      await mailer.sendPasswordResetEmail({
        to: 'trainer@example.org',
        resetUrl: 'https://app.example.org/#/reset-password/GEHEIMES-TOKEN-abc123',
        expiresAt: new Date('2026-08-01T00:00:00.000Z'),
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logged = warnSpy.mock.calls[0]!.join(' ');
      expect(logged).toContain('trainer@example.org');
      expect(logged).not.toContain('GEHEIMES-TOKEN-abc123');
      expect(logged).not.toContain('reset-password');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('buildPasswordResetHtmlBody() — HTML-Escaping', () => {
  it('escaped recipientName', () => {
    const html = buildPasswordResetHtmlBody({
      to: 'x@example.org',
      recipientName: '<script>alert(1)</script>',
      resetUrl: 'https://app.example.org/#/reset-password/abc123',
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escaped resetUrl (analog zur inviteUrl-Korrektur oben)', () => {
    const html = buildPasswordResetHtmlBody({
      to: 'x@example.org',
      resetUrl: 'https://boese.example.org/"><script>alert(1)</script>',
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(html).not.toContain('"><script>alert(1)</script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });

  it('behält eine normale resetUrl unverändert nutzbar als href', () => {
    const html = buildPasswordResetHtmlBody({
      to: 'x@example.org',
      resetUrl: 'https://app.example.org/#/reset-password/abc123',
      expiresAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    expect(html).toContain('href="https://app.example.org/#/reset-password/abc123"');
  });
});

describe('Passwort-Reset-E-Mail — Lokalisierung', () => {
  const basePayload = {
    to: 'x@example.org',
    resetUrl: 'https://app.example.org/#/reset-password/abc123',
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
  };

  it('baut Betreff/Text auf Deutsch, wenn locale fehlt (Fallback)', () => {
    expect(buildPasswordResetSubject(basePayload)).toBe('Passwort bei Lane 1 zurücksetzen');
    expect(buildPasswordResetTextBody(basePayload)).toContain('Zurücksetzen des Passworts');
  });

  it('baut Betreff/Text auf Englisch für locale "en-US"', () => {
    const payload = { ...basePayload, locale: 'en-US' };
    expect(buildPasswordResetSubject(payload)).toBe('Reset your Lane 1 password');
    const text = buildPasswordResetTextBody(payload);
    expect(text).toContain('reset your Lane 1 password');
    expect(text).not.toContain('Passwort');
  });

  it('enthält den Hinweis, dass eine nicht angeforderte Mail ignoriert werden kann (beide Sprachen)', () => {
    expect(buildPasswordResetTextBody(basePayload)).toContain('nicht angefordert');
    expect(buildPasswordResetTextBody({ ...basePayload, locale: 'en-US' })).toContain("didn't request this");
  });
});

// Review 30.08.2026, Befund S4: Benachrichtigung an die BISHERIGE Adresse
// (E-Mail-Wechsel) bzw. an die unveränderte Adresse (Passwortwechsel) —
// der einzige Kanal, der einer rechtmäßigen Person nach einer
// Kontoübernahme über ein entwendetes Access Token noch bleibt.
describe('InMemoryMailSender — Sicherheitshinweis nach Konto-Änderung (Befund S4)', () => {
  it('zeichnet einen gesendeten Sicherheitshinweis auf', async () => {
    const mailer = new InMemoryMailSender();
    await mailer.sendAccountSecurityChangeNotice({ to: 'alt@example.org', recipientName: 'Sabine Reuter', changeType: 'email' });
    expect(mailer.sentAccountSecurityChangeEmails).toHaveLength(1);
    expect(mailer.sentAccountSecurityChangeEmails[0]).toMatchObject({ to: 'alt@example.org', changeType: 'email' });
  });
});

describe('ConsoleMailSender — Sicherheitshinweis: kein Fehlschlag, sichtbares Log', () => {
  it('protokolliert Empfänger und Änderungsart', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const mailer = new ConsoleMailSender();
      await mailer.sendAccountSecurityChangeNotice({ to: 'trainer@example.org', changeType: 'password' });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const logged = warnSpy.mock.calls[0]!.join(' ');
      expect(logged).toContain('trainer@example.org');
      expect(logged).toContain('password');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe('buildAccountSecurityChangeHtmlBody() — HTML-Escaping', () => {
  it('escaped recipientName', () => {
    const html = buildAccountSecurityChangeHtmlBody({
      to: 'x@example.org',
      recipientName: '<script>alert(1)</script>',
      changeType: 'email',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('Sicherheitshinweis nach Konto-Änderung — Lokalisierung (Befund S4)', () => {
  const basePayload = { to: 'x@example.org', changeType: 'email' as const };

  it('baut Betreff/Text auf Deutsch, wenn locale fehlt (Fallback), und nennt "E-Mail-Adresse"', () => {
    expect(buildAccountSecurityChangeSubject(basePayload)).toBe('Ihr Lane-1-Konto wurde geändert');
    expect(buildAccountSecurityChangeTextBody(basePayload)).toContain('E-Mail-Adresse');
  });

  it('baut Betreff/Text auf Englisch für locale "en-US"', () => {
    const payload = { ...basePayload, locale: 'en-US' };
    expect(buildAccountSecurityChangeSubject(payload)).toBe('Your Lane 1 account was changed');
    expect(buildAccountSecurityChangeTextBody(payload)).toContain('email address');
  });

  it('unterscheidet im Text zwischen "E-Mail-Adresse" und "Passwort" je nach changeType', () => {
    expect(buildAccountSecurityChangeTextBody({ to: 'x@example.org', changeType: 'email' })).toContain('E-Mail-Adresse');
    expect(buildAccountSecurityChangeTextBody({ to: 'x@example.org', changeType: 'password' })).toContain('Passwort');
  });

  it('weist in beiden Sprachen darauf hin, sich bei einer nicht selbst veranlassten Änderung an die Vereinsleitung zu wenden', () => {
    expect(buildAccountSecurityChangeTextBody(basePayload)).toContain('Vereinsleitung');
    expect(buildAccountSecurityChangeTextBody({ ...basePayload, locale: 'en-US' })).toContain("administrator");
  });
});

// Regressionstests für Befund P4 (Code-Review): nodemailer.createTransport()
// lief zuvor bei JEDER Einladung erneut, statt den (zustandslos
// konfigurierten) Transport einmal anzulegen und wiederzuverwenden.
describe('SmtpMailSender — Transport-Wiederverwendung (Befund P4)', () => {
  const config = {
    host: 'smtp.example.org',
    port: 587,
    secure: false,
    user: 'apikey',
    password: 'geheim',
    fromEmail: 'noreply@example.org',
    fromName: 'Lane 1',
  };
  const payload = {
    to: 'trainer@example.org',
    role: 'trainer' as const,
    clubName: 'SV Wasserfreunde',
    inviteUrl: 'https://app.example.org/#/accept-invite/abc123',
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
  };

  it('baut den Transport nur einmal für mehrere sendInvitationEmail()-Aufrufe derselben Instanz auf', async () => {
    createTransportMock.mockClear();
    sendMailMock.mockClear();
    const mailer = new SmtpMailSender(config);

    await mailer.sendInvitationEmail(payload);
    await mailer.sendInvitationEmail(payload);
    await mailer.sendInvitationEmail(payload);

    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledTimes(3);
  });

  it('konfiguriert den Transport mit pool: true (Verbindungs-Wiederverwendung)', async () => {
    createTransportMock.mockClear();
    const mailer = new SmtpMailSender(config);

    await mailer.sendInvitationEmail(payload);

    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({ pool: true }));
  });

  it('baut für eine neue SmtpMailSender-Instanz (z. B. andere Konfiguration) einen eigenen Transport auf', async () => {
    createTransportMock.mockClear();
    const mailerA = new SmtpMailSender(config);
    const mailerB = new SmtpMailSender(config);

    await mailerA.sendInvitationEmail(payload);
    await mailerB.sendInvitationEmail(payload);

    expect(createTransportMock).toHaveBeenCalledTimes(2);
  });

  it('bündelt gleichzeitige (parallele) Aufrufe derselben Instanz ebenfalls auf einen einzigen Transport-Aufbau', async () => {
    createTransportMock.mockClear();
    sendMailMock.mockClear();
    const mailer = new SmtpMailSender(config);

    await Promise.all([
      mailer.sendInvitationEmail(payload),
      mailer.sendInvitationEmail(payload),
      mailer.sendInvitationEmail(payload),
    ]);

    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledTimes(3);
  });
});

// Sicherheitsregression (Sicherheitsreview 2026-08, Befund M4): ohne
// requireTLS behandelt nodemailer STARTTLS (secure: false, der
// dokumentierte Standardfall auf Port 587) opportunistisch — bietet der
// Server es nicht an, wird klaglos unverschlüsselt gesendet. requireTLS:
// true erzwingt STARTTLS.
describe('SmtpMailSender — requireTLS (Befund M4)', () => {
  const payload = {
    to: 'trainer@example.org',
    role: 'trainer' as const,
    clubName: 'SV Wasserfreunde',
    inviteUrl: 'https://app.example.org/#/accept-invite/abc123',
    expiresAt: new Date('2026-08-01T00:00:00.000Z'),
  };

  it('erzwingt requireTLS: true, wenn secure: false konfiguriert ist (Port 587/STARTTLS)', async () => {
    createTransportMock.mockClear();
    const mailer = new SmtpMailSender({
      host: 'smtp.example.org', port: 587, secure: false,
      fromEmail: 'noreply@example.org', fromName: 'Lane 1',
    });
    await mailer.sendInvitationEmail(payload);
    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({ secure: false, requireTLS: true }));
  });

  it('setzt requireTLS NICHT, wenn secure: true konfiguriert ist (Port 465/implizites TLS)', async () => {
    createTransportMock.mockClear();
    const mailer = new SmtpMailSender({
      host: 'smtp.example.org', port: 465, secure: true,
      fromEmail: 'noreply@example.org', fromName: 'Lane 1',
    });
    await mailer.sendInvitationEmail(payload);
    expect(createTransportMock).toHaveBeenCalledWith(expect.objectContaining({ secure: true, requireTLS: false }));
  });
});
