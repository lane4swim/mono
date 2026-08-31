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
  // Sprache der einladenden Person (User.locale) — die eingeladene Person
  // hat zu diesem Zeitpunkt noch kein Konto und damit keine eigene
  // Locale; die Sprache der/des Einladenden ist die einzige zu diesem
  // Zeitpunkt bekannte, plausible Wahl (Code-Review, Befund W9). Optional
  // mit Fallback auf Deutsch, analog FALLBACK_LOCALE in js/i18n.js.
  locale?: string;
}

// "Passwort vergessen"-E-Mail (Sicherheitsreview 2026-08, Befund M5) —
// eigener Payload-Typ statt Wiederverwendung von InvitationMailPayload:
// keine Rolle/kein Verein (der Reset betrifft ein bereits bestehendes
// Konto), dafür "resetUrl" statt "inviteUrl".
export interface PasswordResetMailPayload {
  to: string;
  recipientName?: string | null;
  resetUrl: string;
  expiresAt: Date;
  // Locale der EIGENEN Person (anders als bei InvitationMailPayload, wo
  // die eingeladene Person noch kein Konto hat) — auth.service.ts gibt
  // hier user.locale mit, nicht die einer einladenden dritten Person.
  locale?: string;
}

// Review 30.08.2026, Befund S4: eine Benachrichtigung an die BISHERIGE
// E-Mail-Adresse bzw. an die (unveränderte) Adresse des Kontos, wenn das
// Passwort gewechselt wird — der einzige Kanal, der einer rechtmäßigen
// Person nach einer Kontoübernahme über ein kurzzeitig entwendetes Access
// Token noch bleibt (siehe changeEmail()/changePassword() in
// auth.service.ts: beide widerrufen bereits alle ANDEREN Sitzungen, aber
// ohne diese Benachrichtigung erfährt die betroffene Person nichts davon,
// bevor sie selbst versucht, sich erneut anzumelden). Ein gemeinsamer
// Payload-/Vorlagentyp für beide Auslöser (statt zwei fast identischer
// Kopien) — der Text unterscheidet sich nur in EINEM Wort ("E-Mail-Adresse"
// vs. "Passwort"), die Struktur der Nachricht ist identisch.
export interface AccountSecurityChangeMailPayload {
  to: string;
  recipientName?: string | null;
  changeType: 'email' | 'password';
  locale?: string;
}

export interface MailSender {
  sendInvitationEmail(payload: InvitationMailPayload): Promise<void>;
  sendPasswordResetEmail(payload: PasswordResetMailPayload): Promise<void>;
  sendAccountSecurityChangeNotice(payload: AccountSecurityChangeMailPayload): Promise<void>;
}

type SupportedLocale = 'de-DE' | 'en-US';
const FALLBACK_LOCALE: SupportedLocale = 'de-DE';

function resolveLocale(locale: string | undefined): SupportedLocale {
  return locale === 'en-US' ? 'en-US' : FALLBACK_LOCALE;
}

const ROLE_LABEL: Record<SupportedLocale, Record<InvitationMailPayload['role'], string>> = {
  'de-DE': {
    admin: 'Administrator:in',
    trainer: 'Trainer:in',
    athlete: 'Athlet:in',
  },
  'en-US': {
    admin: 'administrator',
    trainer: 'coach',
    athlete: 'athlete',
  },
};

// Exportiert (wie buildHtmlBody() unten), damit die Lokalisierung
// (Code-Review, Befund W9) direkt gegen die tatsächliche Text-/Betreff-
// Ausgabe testbar ist.
export function buildSubject(payload: InvitationMailPayload): string {
  const locale = resolveLocale(payload.locale);
  return locale === 'en-US'
    ? `Invitation to ${payload.clubName} on Lane 1`
    : `Einladung zu ${payload.clubName} bei Lane 1`;
}

export function buildTextBody(payload: InvitationMailPayload): string {
  const locale = resolveLocale(payload.locale);
  const expires = payload.expiresAt.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  const roleLabel = ROLE_LABEL[locale][payload.role];
  if (locale === 'en-US') {
    return [
      payload.recipientName ? `Hi ${payload.recipientName},` : 'Hi,',
      '',
      `You have been invited as ${roleLabel} for "${payload.clubName}" on Lane 1.`,
      '',
      'Please open the following link to activate your account:',
      payload.inviteUrl,
      '',
      `This link is valid until ${expires}.`,
      '',
      'Best regards,',
      'The Lane 1 team',
    ].join('\n');
  }
  return [
    payload.recipientName ? `Hallo ${payload.recipientName},` : 'Hallo,',
    '',
    `Sie wurden als ${roleLabel} für "${payload.clubName}" bei Lane 1 eingeladen.`,
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
  const locale = resolveLocale(payload.locale);
  const expires = payload.expiresAt.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
  const roleLabel = ROLE_LABEL[locale][payload.role];
  if (locale === 'en-US') {
    return `
      <p>${payload.recipientName ? `Hi ${escapeHtml(payload.recipientName)},` : 'Hi,'}</p>
      <p>You have been invited as <strong>${escapeHtml(roleLabel)}</strong> for
         "${escapeHtml(payload.clubName)}" on Lane 1.</p>
      <p><a href="${escapeHtml(payload.inviteUrl)}">Activate account</a></p>
      <p style="color:#5B7A85;font-size:13px">This link is valid until ${expires}.</p>
      <p>Best regards,<br>The Lane 1 team</p>
    `.trim();
  }
  return `
    <p>${payload.recipientName ? `Hallo ${escapeHtml(payload.recipientName)},` : 'Hallo,'}</p>
    <p>Sie wurden als <strong>${escapeHtml(roleLabel)}</strong> für
       „${escapeHtml(payload.clubName)}" bei Lane 1 eingeladen.</p>
    <p><a href="${escapeHtml(payload.inviteUrl)}">Konto aktivieren</a></p>
    <p style="color:#5B7A85;font-size:13px">Dieser Link ist gültig bis zum ${expires}.</p>
    <p>Sportliche Grüße,<br>Ihr Lane-1-Team</p>
  `.trim();
}

// "Passwort vergessen"-E-Mail (Sicherheitsreview 2026-08, Befund M5) —
// dieselbe Struktur (exportierte, einzeln testbare Subject/Text/HTML-
// Builder) wie bei der Einladungs-E-Mail oben, aus demselben Grund
// (Lokalisierung direkt gegen die tatsächliche Ausgabe testbar).
export function buildPasswordResetSubject(payload: PasswordResetMailPayload): string {
  const locale = resolveLocale(payload.locale);
  return locale === 'en-US' ? 'Reset your Lane 1 password' : 'Passwort bei Lane 1 zurücksetzen';
}

export function buildPasswordResetTextBody(payload: PasswordResetMailPayload): string {
  const locale = resolveLocale(payload.locale);
  const expires = payload.expiresAt.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  if (locale === 'en-US') {
    return [
      payload.recipientName ? `Hi ${payload.recipientName},` : 'Hi,',
      '',
      'We received a request to reset your Lane 1 password. Open the following link to choose a new one:',
      payload.resetUrl,
      '',
      `This link is valid until ${expires} and can only be used once.`,
      '',
      "If you didn't request this, you can safely ignore this email — your password stays unchanged.",
      '',
      'Best regards,',
      'The Lane 1 team',
    ].join('\n');
  }
  return [
    payload.recipientName ? `Hallo ${payload.recipientName},` : 'Hallo,',
    '',
    'Für Ihr Lane-1-Konto wurde eine Anfrage zum Zurücksetzen des Passworts gestellt. Öffnen Sie den folgenden Link, um ein neues Passwort zu vergeben:',
    payload.resetUrl,
    '',
    `Dieser Link ist gültig bis ${expires} und nur einmal verwendbar.`,
    '',
    'Falls Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren — Ihr Passwort bleibt unverändert.',
    '',
    'Sportliche Grüße,',
    'Ihr Lane-1-Team',
  ].join('\n');
}

export function buildPasswordResetHtmlBody(payload: PasswordResetMailPayload): string {
  const locale = resolveLocale(payload.locale);
  const expires = payload.expiresAt.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });
  if (locale === 'en-US') {
    return `
      <p>${payload.recipientName ? `Hi ${escapeHtml(payload.recipientName)},` : 'Hi,'}</p>
      <p>We received a request to reset your Lane 1 password.</p>
      <p><a href="${escapeHtml(payload.resetUrl)}">Choose a new password</a></p>
      <p style="color:#5B7A85;font-size:13px">This link is valid until ${expires} and can only be used once.</p>
      <p style="color:#5B7A85;font-size:13px">If you didn't request this, you can safely ignore this email — your password stays unchanged.</p>
      <p>Best regards,<br>The Lane 1 team</p>
    `.trim();
  }
  return `
    <p>${payload.recipientName ? `Hallo ${escapeHtml(payload.recipientName)},` : 'Hallo,'}</p>
    <p>Für Ihr Lane-1-Konto wurde eine Anfrage zum Zurücksetzen des Passworts gestellt.</p>
    <p><a href="${escapeHtml(payload.resetUrl)}">Neues Passwort vergeben</a></p>
    <p style="color:#5B7A85;font-size:13px">Dieser Link ist gültig bis ${expires} und nur einmal verwendbar.</p>
    <p style="color:#5B7A85;font-size:13px">Falls Sie das nicht angefordert haben, können Sie diese E-Mail ignorieren — Ihr Passwort bleibt unverändert.</p>
    <p>Sportliche Grüße,<br>Ihr Lane-1-Team</p>
  `.trim();
}

// Review 30.08.2026, Befund S4 — dieselbe Struktur (exportierte, einzeln
// testbare Subject/Text/HTML-Builder) wie bei den beiden E-Mail-Typen
// oben. Bewusst OHNE Link/Aktion: es gibt (noch) keinen
// Rückabwicklungsmechanismus (siehe dortiger Kommentar in
// auth.service.ts) — die Nachricht ist rein informativ und verweist auf
// den einzigen heute verfügbaren Weg, tatsächlich etwas zu tun (die
// eigene Vereinsleitung kontaktieren).
const CHANGE_TYPE_LABEL: Record<SupportedLocale, Record<AccountSecurityChangeMailPayload['changeType'], string>> = {
  'de-DE': { email: 'E-Mail-Adresse', password: 'Passwort' },
  'en-US': { email: 'email address', password: 'password' },
};

export function buildAccountSecurityChangeSubject(payload: AccountSecurityChangeMailPayload): string {
  const locale = resolveLocale(payload.locale);
  return locale === 'en-US' ? 'Your Lane 1 account was changed' : 'Ihr Lane-1-Konto wurde geändert';
}

export function buildAccountSecurityChangeTextBody(payload: AccountSecurityChangeMailPayload): string {
  const locale = resolveLocale(payload.locale);
  const changed = CHANGE_TYPE_LABEL[locale][payload.changeType];
  if (locale === 'en-US') {
    return [
      payload.recipientName ? `Hi ${payload.recipientName},` : 'Hi,',
      '',
      `The ${changed} for your Lane 1 account was just changed. This message went to your PREVIOUS address on file, independent of the change itself.`,
      '',
      "If you made this change yourself, you can ignore this email — nothing further to do.",
      '',
      "If you did NOT make this change, your account may be compromised: please contact your club's administrator immediately.",
      '',
      'Best regards,',
      'The Lane 1 team',
    ].join('\n');
  }
  return [
    payload.recipientName ? `Hallo ${payload.recipientName},` : 'Hallo,',
    '',
    `Das ${changed} Ihres Lane-1-Kontos wurde soeben geändert. Diese Nachricht ging an Ihre BISHERIGE hinterlegte Adresse, unabhängig von der Änderung selbst.`,
    '',
    'Wenn Sie diese Änderung selbst vorgenommen haben, können Sie diese E-Mail ignorieren — es ist nichts weiter zu tun.',
    '',
    'Falls Sie diese Änderung NICHT vorgenommen haben, könnte Ihr Konto kompromittiert sein: Bitte wenden Sie sich umgehend an Ihre Vereinsleitung.',
    '',
    'Sportliche Grüße,',
    'Ihr Lane-1-Team',
  ].join('\n');
}

export function buildAccountSecurityChangeHtmlBody(payload: AccountSecurityChangeMailPayload): string {
  const locale = resolveLocale(payload.locale);
  const changed = CHANGE_TYPE_LABEL[locale][payload.changeType];
  if (locale === 'en-US') {
    return `
      <p>${payload.recipientName ? `Hi ${escapeHtml(payload.recipientName)},` : 'Hi,'}</p>
      <p>The <strong>${escapeHtml(changed)}</strong> for your Lane 1 account was just changed. This message went to your
         previous address on file, independent of the change itself.</p>
      <p>If you made this change yourself, you can ignore this email.</p>
      <p style="color:#B3261E;font-weight:bold">If you did NOT make this change, your account may be compromised:
         please contact your club's administrator immediately.</p>
      <p>Best regards,<br>The Lane 1 team</p>
    `.trim();
  }
  return `
    <p>${payload.recipientName ? `Hallo ${escapeHtml(payload.recipientName)},` : 'Hallo,'}</p>
    <p>Das <strong>${escapeHtml(changed)}</strong> Ihres Lane-1-Kontos wurde soeben geändert. Diese Nachricht ging an
       Ihre bisherige hinterlegte Adresse, unabhängig von der Änderung selbst.</p>
    <p>Wenn Sie diese Änderung selbst vorgenommen haben, können Sie diese E-Mail ignorieren.</p>
    <p style="color:#B3261E;font-weight:bold">Falls Sie diese Änderung NICHT vorgenommen haben, könnte Ihr Konto
       kompromittiert sein: Bitte wenden Sie sich umgehend an Ihre Vereinsleitung.</p>
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
          // Sicherheitskorrektur (Sicherheitsreview 2026-08, Befund M4):
          // ohne secure (Port 587/STARTTLS, der dokumentierte Standardfall
          // — siehe .env.example) behandelt nodemailer STARTTLS bislang
          // OPPORTUNISTISCH: bietet der Server es nicht an (Fehlkonfiguration
          // oder ein aktiver STARTTLS-Stripping-Angreifer, der die
          // Server-Capabilities aus der Antwort entfernt), sendet
          // nodemailer klaglos unverschlüsselt weiter — inklusive der
          // SMTP-Zugangsdaten (SMTP_USER/SMTP_PASSWORD) und des
          // Einladungslinks samt Token. requireTLS: true erzwingt STARTTLS
          // — fehlt es, schlägt der Versand mit einem Fehler fehl, statt
          // still auf Klartext zurückzufallen. Bei secure: true (Port 465,
          // implizites TLS von Verbindungsaufbau an) ist die Option
          // wirkungslos/nicht anwendbar, daher nur im STARTTLS-Fall gesetzt.
          requireTLS: !this.config.secure,
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

  async sendPasswordResetEmail(payload: PasswordResetMailPayload): Promise<void> {
    const transport = await this.getTransport();
    await transport.sendMail({
      from: `"${this.config.fromName}" <${this.config.fromEmail}>`,
      to: payload.to,
      subject: buildPasswordResetSubject(payload),
      text: buildPasswordResetTextBody(payload),
      html: buildPasswordResetHtmlBody(payload),
    });
  }

  async sendAccountSecurityChangeNotice(payload: AccountSecurityChangeMailPayload): Promise<void> {
    const transport = await this.getTransport();
    await transport.sendMail({
      from: `"${this.config.fromName}" <${this.config.fromEmail}>`,
      to: payload.to,
      subject: buildAccountSecurityChangeSubject(payload),
      text: buildAccountSecurityChangeTextBody(payload),
      html: buildAccountSecurityChangeHtmlBody(payload),
    });
  }
}

// Ausweichlösung, wenn kein SMTP konfiguriert ist (z. B. lokale
// Entwicklung ohne eigenen Mailserver, oder ein bewusst mailserver-loser
// Betrieb — siehe deployment-github-codespaces.md/deployment-macos.md):
// protokolliert, DASS eine Einladung ansteht, ohne sie tatsächlich zu
// versenden, damit der Ablauf trotzdem end-to-end funktioniert.
//
// Sicherheitskorrektur (Sicherheitsreview 2026-08, Befund M3): protokollierte
// zuvor den VOLLSTÄNDIGEN Einladungslink inklusive Klartext-Token — jede
// Einladung (Admin-Konten eingeschlossen) landete dadurch dauerhaft im
// Server-Log, unabhängig von NODE_ENV. Das Token wird jetzt bewusst NICHT
// mehr geloggt: der Einladungslink ist über den "Link kopieren"-Button in
// der Nutzerverwaltungs-Oberfläche (apps/web/js/modules/userManagement.js:
// showInviteLinkModal()) ohnehin bereits verfügbar — genau der dafür
// vorgesehene Weg, eine Einladung z. B. per WhatsApp statt per E-Mail zu
// teilen, bleibt davon unberührt.
export class ConsoleMailSender implements MailSender {
  async sendInvitationEmail(payload: InvitationMailPayload): Promise<void> {
    console.warn(
      `[mail] Kein SMTP konfiguriert — Einladung wird nicht per E-Mail versendet:\n` +
        `  An: ${payload.to}\n  Verein: ${payload.clubName}\n  Rolle: ${payload.role}\n` +
        `  Der Einladungslink lässt sich über "Link kopieren" in der Nutzerverwaltung abrufen und z. B. manuell teilen.`,
    );
  }

  // Anders als bei sendInvitationEmail() oben gibt es hier BEWUSST KEINEN
  // Ausweg über eine UI (kein "Link kopieren"-Äquivalent): ein Passwort-
  // Reset-Link autorisiert direkt einen Kontoübernahme-fähigen Login für
  // eine BELIEBIGE dritte Person, die ihn erhält — anders als ein
  // Einladungslink (den ein Admin bewusst an eine bekannte Zielperson
  // weiterreicht) gibt es hier keinen legitimen "manuell teilen"-Anwendungsfall.
  // Ohne SMTP-Konfiguration bleibt "Passwort vergessen" daher schlicht nicht
  // nutzbar — das Token wird NICHT geloggt (Sicherheitsreview 2026-08,
  // Befund M5, analog zur M3-Korrektur bei Einladungen).
  async sendPasswordResetEmail(payload: PasswordResetMailPayload): Promise<void> {
    console.warn(
      `[mail] Kein SMTP konfiguriert — Passwort-Zurücksetzen-E-Mail an ${payload.to} konnte nicht versendet werden. ` +
        `Ohne SMTP-Konfiguration ist "Passwort vergessen" nicht nutzbar (kein alternativer Zustellweg für einen derart sicherheitskritischen Link).`,
    );
  }

  // Trägt kein Geheimnis/Token (anders als die beiden Methoden oben) —
  // unbedenklich zu loggen, dient hier ausschließlich als sichtbarer
  // Hinweis, dass die betroffene Person diese Benachrichtigung ohne
  // SMTP-Konfiguration nicht erreicht.
  async sendAccountSecurityChangeNotice(payload: AccountSecurityChangeMailPayload): Promise<void> {
    console.warn(
      `[mail] Kein SMTP konfiguriert — Sicherheitshinweis (${payload.changeType}) an ${payload.to} konnte nicht versendet werden.`,
    );
  }
}
