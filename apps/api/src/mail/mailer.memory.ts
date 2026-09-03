// apps/api/src/mail/mailer.memory.ts
import type { MailSender, InvitationMailPayload, PasswordResetMailPayload, AccountSecurityChangeMailPayload, QualificationReminderMailPayload } from './mailer.js';

export class InMemoryMailSender implements MailSender {
  sentEmails: InvitationMailPayload[] = [];
  sentPasswordResetEmails: PasswordResetMailPayload[] = [];
  sentAccountSecurityChangeEmails: AccountSecurityChangeMailPayload[] = [];
  sentQualificationReminderEmails: QualificationReminderMailPayload[] = [];

  async sendInvitationEmail(payload: InvitationMailPayload): Promise<void> {
    this.sentEmails.push(payload);
  }

  async sendPasswordResetEmail(payload: PasswordResetMailPayload): Promise<void> {
    this.sentPasswordResetEmails.push(payload);
  }

  async sendAccountSecurityChangeNotice(payload: AccountSecurityChangeMailPayload): Promise<void> {
    this.sentAccountSecurityChangeEmails.push(payload);
  }

  async sendQualificationReminderEmail(payload: QualificationReminderMailPayload): Promise<void> {
    this.sentQualificationReminderEmails.push(payload);
  }
}
