// apps/api/src/mail/mailer.memory.ts
import type { MailSender, InvitationMailPayload } from './mailer.js';

export class InMemoryMailSender implements MailSender {
  sentEmails: InvitationMailPayload[] = [];

  async sendInvitationEmail(payload: InvitationMailPayload): Promise<void> {
    this.sentEmails.push(payload);
  }
}
