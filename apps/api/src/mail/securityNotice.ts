// Zentrale Stelle für den Sicherheitshinweis an ein Konto (E-Mail-,
// Passwort- oder Zwei-Faktor-Änderung, Anmeldung mit Wiederherstellungs-
// code, neue Wiederherstellungscodes). Jeder Auslöser (auth.service.ts,
// mfa.service.ts, mfa/operatorReset.ts) ruft notifySecurityChange() auf,
// statt Versand und Fehlerbehandlung selbst nachzubauen.
//
// Der Hinweis ist best effort: ein Mailfehler darf die bereits erfolgte
// Änderung weder scheitern lassen noch verzögern. Der zurückgegebene
// Promise wird deshalb nie abgelehnt — Fehler werden protokolliert.
// Services rufen die Funktion ohne `await` auf; das CLI-Skript
// (operatorReset.ts) darf sie abwarten, um vor dem Beenden fertig zu sein.
import type { AccountSecurityChangeMailPayload, MailSender } from './mailer.js';

export type SecurityChangeType = AccountSecurityChangeMailPayload['changeType'];

// Die Empfängerin/der Empfänger. Bei einem E-Mail-Wechsel übergibt der
// Aufrufer bewusst den Datensatz VOR dem Wechsel: im Übernahme-Fall gehört
// die neue Adresse bereits der angreifenden Person, nur die bisherige
// erreicht noch die rechtmäßige.
export interface SecurityNoticeRecipient {
  email: string;
  name: string;
  locale?: string;
}

// Der Mailer wird synchron (vor jedem `await`) aufgerufen, damit der
// Versand auch ohne `await` des Aufrufers sofort angestoßen ist.
// `logTag` kennzeichnet die Herkunft im Fehlerprotokoll (z. B. "auth").
export function notifySecurityChange(
  mailer: Pick<MailSender, 'sendAccountSecurityChangeNotice'>,
  recipient: SecurityNoticeRecipient,
  changeType: SecurityChangeType,
  logTag: string,
): Promise<void> {
  return mailer
    .sendAccountSecurityChangeNotice({ to: recipient.email, recipientName: recipient.name, changeType, locale: recipient.locale })
    .catch((err: unknown) => {
      console.error(`[${logTag}] Sicherheitshinweis (${changeType}) konnte nicht versendet werden:`, err);
    });
}
