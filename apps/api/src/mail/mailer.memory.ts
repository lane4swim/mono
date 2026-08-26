// apps/api/src/mail/mailer.memory.ts
import type { MailSender, InvitationMailPayload, PasswordResetMailPayload } from './mailer.js';

export class InMemoryMailSender implements MailSender {
  sentEmails: InvitationMailPayload[] = [];
  sentPasswordResetEmails: PasswordResetMailPayload[] = [];

  async sendInvitationEmail(payload: InvitationMailPayload): Promise<void> {
    this.sentEmails.push(payload);
  }

  async sendPasswordResetEmail(payload: PasswordResetMailPayload): Promise<void> {
    this.sentPasswordResetEmails.push(payload);
  }
}
