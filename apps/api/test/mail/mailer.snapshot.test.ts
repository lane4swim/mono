// Schnappschuss JEDER E-Mail, die SmtpMailSender verschickt — je Mailtyp,
// Sprache, Empfänger-Name (mit/ohne, mit HTML-Sonderzeichen) und den
// fachlichen Varianten (Rolle, Änderungsart, abgelaufen/bald ablaufend,
// bekannter/unbekannter Qualifikationstyp). Hält die tatsächlich
// versendete Ausgabe (Absender, Empfänger, Betreff, Text, HTML) Byte für
// Byte fest; jede Änderung an Vorlagen oder Versandweg fällt hier auf.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { SmtpMailSender, type AccountSecurityChangeMailPayload, type InvitationMailPayload } from '../../src/mail/mailer.js';

const sendMailMock = vi.fn().mockResolvedValue(undefined);
vi.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: sendMailMock }) }));

// Datumsangaben werden in der Zeitzone des Prozesses formatiert; fest auf
// UTC, damit der Schnappschuss überall gleich ist.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'UTC';
});
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

const mailer = new SmtpMailSender({
  host: 'smtp.example.org',
  port: 587,
  secure: false,
  fromEmail: 'noreply@example.org',
  fromName: 'Lane 1',
});

const LOCALES = [undefined, 'en-US'] as const;
const NAMES = ['Mara <Vogel> & "Co"', null] as const;
const ROLES: InvitationMailPayload['role'][] = ['admin', 'trainer', 'athlete', 'referee', 'parent'];
const CHANGE_TYPES: AccountSecurityChangeMailPayload['changeType'][] = ['email', 'password', 'mfa', 'recoveryCodeUsed', 'recoveryCodesRegenerated'];

async function lastSentMail(send: () => Promise<void>) {
  sendMailMock.mockClear();
  await send();
  expect(sendMailMock).toHaveBeenCalledTimes(1);
  return sendMailMock.mock.calls[0]![0];
}

describe('E-Mail-Schnappschüsse', () => {
  for (const locale of LOCALES) {
    for (const recipientName of NAMES) {
      const variant = `${locale ?? 'default'} / ${recipientName === null ? 'ohne Name' : 'mit Name'}`;

      for (const role of ROLES) {
        it(`Einladung — ${variant} / ${role}`, async () => {
          const mail = await lastSentMail(() =>
            mailer.sendInvitationEmail({
              to: 'neu@example.org',
              recipientName,
              role,
              clubName: 'SV "Wasser" & <Freunde>',
              inviteUrl: 'https://app.example.org/#/accept-invite/abc?x=1&y="2"',
              expiresAt: new Date('2026-08-01T12:00:00.000Z'),
              locale,
            }),
          );
          expect(mail).toMatchSnapshot();
        });
      }

      it(`Passwort zurücksetzen — ${variant}`, async () => {
        const mail = await lastSentMail(() =>
          mailer.sendPasswordResetEmail({
            to: 'mara@example.org',
            recipientName,
            resetUrl: 'https://app.example.org/#/reset-password/tok?a=1&b=2',
            expiresAt: new Date('2026-08-01T14:35:00.000Z'),
            locale,
          }),
        );
        expect(mail).toMatchSnapshot();
      });

      for (const changeType of CHANGE_TYPES) {
        it(`Sicherheitshinweis — ${variant} / ${changeType}`, async () => {
          const mail = await lastSentMail(() =>
            mailer.sendAccountSecurityChangeNotice({ to: 'mara@example.org', recipientName, changeType, locale }),
          );
          expect(mail).toMatchSnapshot();
        });
      }

      for (const isExpired of [false, true]) {
        for (const type of ['erste_hilfe', 'unbekannter_typ']) {
          it(`Qualifikations-Erinnerung — ${variant} / ${isExpired ? 'abgelaufen' : 'läuft ab'} / ${type}`, async () => {
            const mail = await lastSentMail(() =>
              mailer.sendQualificationReminderEmail({
                to: 'admin@example.org',
                recipientName,
                qualifiedPersonName: 'Tim <Sommer>',
                type,
                expiresOn: new Date('2026-09-15T12:00:00.000Z'),
                isExpired,
                locale,
              }),
            );
            expect(mail).toMatchSnapshot();
          });
        }
      }
    }
  }
});
