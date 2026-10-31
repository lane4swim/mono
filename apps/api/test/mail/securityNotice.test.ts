import { describe, it, expect, vi, afterEach } from 'vitest';
import { notifySecurityChange } from '../../src/mail/securityNotice.js';
import { InMemoryMailSender } from '../../src/mail/mailer.memory.js';

const RECIPIENT = { email: 'mara@example.org', name: 'Mara Vogel', locale: 'en-US' };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('notifySecurityChange()', () => {
  it('stößt den Versand sofort an, auch ohne await des Aufrufers', () => {
    const mailer = new InMemoryMailSender();
    void notifySecurityChange(mailer, RECIPIENT, 'password', 'test');
    expect(mailer.sentAccountSecurityChangeEmails).toEqual([
      { to: 'mara@example.org', recipientName: 'Mara Vogel', changeType: 'password', locale: 'en-US' },
    ]);
  });

  it('wird bei einem Mailfehler nie abgelehnt, sondern protokolliert ihn', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('SMTP nicht erreichbar');
    const mailer = { sendAccountSecurityChangeNotice: vi.fn().mockRejectedValue(failure) };

    await expect(notifySecurityChange(mailer, RECIPIENT, 'mfa', 'test')).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledWith('[test] Sicherheitshinweis (mfa) konnte nicht versendet werden:', failure);
  });
});
