// apps/api/src/mail/mailer.ts
//
// Versand der Einladungs-E-Mail (Nutzerverwaltung → Superadmin-Oberfläche
// "/admin"). Repository-Pattern wie überall sonst im Backend: ein
// Interface, gegen das invitations.service.ts arbeitet, plus austauschbare
// Implementierungen — dadurch bleibt der E-Mail-Versand ohne echten
// SMTP-Server testbar (siehe mailer.memory.ts).
export interface InvitationMailPayload {
  to: string;
  recipientName?: string | null;
  role: 'admin' | 'trainer' | 'athlete';
  clubName: string;
  inviteUrl: string;
  expiresAt: Date;
}

export interface MailSender {
  sendInvitationEmail(payload: InvitationMailPayload): Promise<void>;
}

const ROLE_LABEL_DE: Record<InvitationMailPayload['role'], string> = {
  admin: 'Administrator:in',
  trainer: 'Trainer:in',
  athlete: 'Athlet:in',
};

function buildSubject(payload: InvitationMailPayload): string {
  return `Einladung zu ${payload.clubName} bei Lane 1`;
}

function buildTextBody(payload: InvitationMailPayload): string {
  const expires = payload.expiresAt.toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' });
  return [
    payload.recipientName ? `Hallo ${payload.recipientName},` : 'Hallo,',
    '',
    `Sie wurden als ${ROLE_LABEL_DE[payload.role]} für "${payload.clubName}" bei Lane 1 eingeladen.`,
    '',
    `Bitte öffnen Sie den folgenden Link, um Ihr Konto zu aktivieren:`,
    payload.inviteUrl,
    '',
    `Dieser Link ist gültig bis zum ${expires}.`,
    '',
    'Sportliche Grüße,',
    'Ihr Lane-1-Team',
  ].join('\n');
}

// Exportiert (statt modul-intern), damit escapeHtml()-Regressionen (siehe
// mailer.test.ts) direkt gegen die tatsächliche HTML-Ausgabe testbar sind,
// ohne einen echten SMTP-Versand nachzustellen.
export function buildHtmlBody(payload: InvitationMailPayload): string {
  const expires = payload.expiresAt.toLocaleDateString('de-DE', { year: 'numeric', month: 'long', day: 'numeric' });
  return `
    <p>${payload.recipientName ? `Hallo ${escapeHtml(payload.recipientName)},` : 'Hallo,'}</p>
    <p>Sie wurden als <strong>${escapeHtml(ROLE_LABEL_DE[payload.role])}</strong> für
       „${escapeHtml(payload.clubName)}" bei Lane 1 eingeladen.</p>
    <p><a href="${escapeHtml(payload.inviteUrl)}">Konto aktivieren</a></p>
    <p style="color:#5B7A85;font-size:13px">Dieser Link ist gültig bis zum ${expires}.</p>
    <p>Sportliche Grüße,<br>Ihr Lane-1-Team</p>
  `.trim();
}

// Sicherheitskorrektur (Code-Review, Befund S8): escapte bislang keine
// einfachen Anführungszeichen. Heute folgenlos, da jedes Attribut in
// buildHtmlBody() doppelt gequotet ist (ein `'` bricht ein `"`-delimitiertes
// Attribut nicht auf) — aber das ist eine Eigenschaft der heutigen
// Aufrufer, nicht dieser Funktion: als benannte, allgemein wirkende
// "escapeHtml"-Hilfsfunktion sollte sie unabhängig davon, wie sie gerade
// verwendet wird, vollständig escapen, damit ein künftiger Aufrufer (z. B.
// ein einfach gequotetes Attribut) nicht stillschweigend eine Lücke erbt.
// `&#39;` statt `&apos;`: Erstere ist auch in älteren/eingeschränkten
// HTML-Renderern (u. a. manche E-Mail-Clients) zuverlässig unterstützt,
// `&apos;` erst seit HTML5 offiziell Teil des HTML-Standards (war zuvor
// nur in XHTML gültig).
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  fromEmail: string;
  fromName: string;
}

// Echter Versand via SMTP (nodemailer). Wird nur instanziiert, wenn ein
// SMTP-Host konfiguriert ist (siehe app.ts) — sonst greift
// ConsoleMailSender als Ausweichlösung für lokale Entwicklung/Demo.
export class SmtpMailSender implements MailSender {
  // Code-Review, Befund P4: nodemailer.createTransport() lief zuvor bei
  // JEDER Einladung erneut (samt dynamischem Import) — jede E-Mail baute
  // eine eigene SMTP-Verbindung auf, die anschließend offen im
  // Verbindungspool des Prozesses verblieb (nie geschlossen). Der
  // Transport ist zustandslos konfiguriert und gehört daher nur einmal
  // angelegt, lazy (behält den schlanken Kaltstart) und mit `pool: true`
  // für Verbindungs-Wiederverwendung über mehrere Sendevorgänge hinweg.
  private transportPromise: Promise<import('nodemailer').Transporter> | null = null;

  constructor(private readonly config: SmtpConfig) {}

  private getTransport(): Promise<import('nodemailer').Transporter> {
    if (!this.transportPromise) {
      this.transportPromise = import('nodemailer').then((nodemailer) =>
        nodemailer.createTransport({
          host: this.config.host,
          port: this.config.port,
          secure: this.config.secure,
          auth: this.config.user ? { user: this.config.user, pass: this.config.password } : undefined,
          pool: true,
        }),
      );
    }
    return this.transportPromise;
  }

  async sendInvitationEmail(payload: InvitationMailPayload): Promise<void> {
    const transport = await this.getTransport();
    await transport.sendMail({
      from: `"${this.config.fromName}" <${this.config.fromEmail}>`,
      to: payload.to,
      subject: buildSubject(payload),
      text: buildTextBody(payload),
      html: buildHtmlBody(payload),
    });
  }
}

// Ausweichlösung, wenn kein SMTP konfiguriert ist (z. B. lokale
// Entwicklung ohne eigenen Mailserver): protokolliert die Einladung statt
// sie zu versenden, damit der Ablauf trotzdem end-to-end funktioniert und
// der Einladungslink zumindest im Server-Log sichtbar ist.
export class ConsoleMailSender implements MailSender {
  async sendInvitationEmail(payload: InvitationMailPayload): Promise<void> {
    console.warn(
      `[mail] Kein SMTP konfiguriert — Einladung wird nur protokolliert:\n` +
        `  An: ${payload.to}\n  Verein: ${payload.clubName}\n  Rolle: ${payload.role}\n  Link: ${payload.inviteUrl}`,
    );
  }
}
