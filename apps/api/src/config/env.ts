// apps/api/src/config/env.ts
//
// Liest und validiert Umgebungsvariablen einmalig beim Start. Ein
// fehlender/ungültiger Wert lässt den Server sofort mit einer klaren
// Fehlermeldung abbrechen, statt erst später mit einem kryptischen
// Fehler mitten im Betrieb zu scheitern.
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Bind-Adresse des Node-Prozesses (Sicherheitsreview 2026-08-27, Befund
  // N7): stand zuvor fest auf "0.0.0.0" verdrahtet in src/index.ts. Auf
  // jedem dokumentierten Deployment (siehe docs/deployment*.md) läuft
  // Nginx auf demselben Host und spricht die API ausschließlich über
  // 127.0.0.1 an — ein Bind auf ALLEN Interfaces öffnete den Port
  // zusätzlich und unnötig nach außen (Bypass von Nginx' CSP/
  // TLS-Terminierung, falls die vorgelagerte Firewall je eine Lücke
  // hätte). Default jetzt "127.0.0.1"; NUR der Container-Betrieb (siehe
  // docker-compose.yml/Dockerfile) setzt HOST=0.0.0.0 explizit, wo das
  // tatsächlich richtig ist (der Host-Zugriff läuft dort über Dockers
  // Portweiterleitung, nicht über einen im selben Netzwerk-Namespace
  // laufenden Reverse Proxy).
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL ist erforderlich (siehe .env.example)'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // RS256-Schlüsselpaar für die Access-Token-Signatur (Abschnitt 5.2 des
  // Backend-Entwicklungsplans). PEM-Inhalte mit \n statt echten Zeilenumbrüchen
  // in der .env — wird beim Einlesen zurückkonvertiert (siehe auth/keys.ts).
  // In Produktion Pflicht; in development/test wird andernfalls automatisch
  // ein Wegwerf-Schlüsselpaar erzeugt (siehe auth/keys.ts), damit lokale
  // Entwicklung/Tests ohne manuellen Schlüsselerzeugungsschritt funktionieren.
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),

  // Kommagetrennte Liste der tatsächlich vertrauenswürdigen Reverse-Proxy-
  // Adressen (Sicherheitsreview 2026-08-27, Befund H1) — an app.ts:
  // resolveTrustProxy() weitergereicht (Fastifys "trustProxy"-Option).
  // Vorgeschichte: ohne trustProxy ignorierte Fastify den von Nginx
  // gesetzten "X-Forwarded-For"-Header komplett (Sicherheitsreview
  // 2026-08, Befund H2) — request.ip war dann für JEDE Anfrage die
  // Nginx-Adresse, alle IP-basierten Rate-Limits kollabierten auf einen
  // einzigen geteilten Zähler. Der damalige Fix (trustProxy: true) behob
  // das, vertraute dabei aber JEDER Adresse in der Kette — Fastify
  // übernimmt dann den am weitesten LINKS stehenden XFF-Eintrag als
  // request.ip, und genau den bestimmt der Client selbst, da Nginx nur
  // ANHÄNGT (`$proxy_add_x_forwarded_for`), statt zu ersetzen: jedes
  // IP-basierte Rate-Limit war dadurch mit einem frei wählbaren
  // Header-Wert pro Anfrage umgehbar (Befund H1). Diese Variable benennt
  // stattdessen NUR die tatsächlich vertrauenswürdigen Hops (bei jedem
  // dokumentierten Deployment: "127.0.0.1", da Nginx auf demselben Host
  // läuft) — jede andere Herkunft wird ignoriert. Leer (Standard)
  // bedeutet "kein Proxy vertrauenswürdig" (Fastifys eigener sicherer
  // Default, request.ip = tatsächliche TCP-Peer-Adresse) — korrekt für
  // lokale Entwicklung und den docker-compose-Aufbau ohne vorgeschalteten
  // Proxy. In Produktion PFLICHT (siehe Prüfung unten): ein leerer Wert
  // dort reproduzierte entweder Befund H1 (fiele man auf "true" zurück)
  // oder den ursprünglichen Befund H2 (Rate-Limits kollabieren wieder) —
  // ein expliziter Wert erzwingt eine bewusste Entscheidung statt eines
  // der beiden stillschweigend falschen Defaults.
  TRUSTED_PROXY_IPS: z.string().default(''),

  // Basis-URL des Frontends — wird für den Einladungslink in der
  // Versand-E-Mail gebraucht (Annahme-Seite liegt dort unter
  // "#/accept-invite/<token>", siehe modules/invitations/invitations.service.ts).
  FRONTEND_BASE_URL: z.string().min(1).default('http://localhost:5173'),

  // SMTP-Konfiguration für den echten Einladungs-E-Mail-Versand. Bleibt
  // SMTP_HOST leer, greift ConsoleMailSender als Ausweichlösung (protokolliert
  // die Einladung statt sie zu versenden) — praktisch für lokale
  // Entwicklung/Demo ohne eigenen Mailserver.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  // Bewusst NICHT z.coerce.boolean(): dessen Umwandlung ist
  // `Boolean(irgendein-nichtleerer-String)`, macht also z. B. auch den
  // Text "false" fälschlich zu `true` (bekannte JS-Eigenheit, siehe
  // .env.example) — ein für einen sicherheitsrelevanten TLS-Schalter
  // besonders unglücklicher Bug, der sich lokal leicht unbemerkt einschleicht.
  // z.enum(['true','false']) akzeptiert nur die beiden erwarteten
  // Zeichenketten und lässt jeden anderen Wert (inkl. Tippfehlern) beim
  // Start mit einer klaren Fehlermeldung scheitern, statt ihn stillschweigend
  // als "true" zu interpretieren.
  SMTP_SECURE: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM_EMAIL: z.string().email().default('noreply@lane1.example.org'),
  SMTP_FROM_NAME: z.string().default('Lane 1'),

  // DSGVO (Art. 17): Anzahl Tage zwischen einer Löschanfrage (sofortiger
  // Soft-Delete) und dem endgültigen, unwiderruflichen Hard-Purge durch
  // scripts/purgeDeletedData.ts. 30 Tage ist gängige Praxis ("ohne
  // unangemessene Verzögerung", aber mit kurzer Frist z. B. für
  // versehentliche Löschungen oder laufende Backup-Zyklen).
  DATA_ERASURE_RETENTION_DAYS: z.coerce.number().int().positive().default(30),

  // Aufräumarbeit (Code-Review): SyncedEvent (Idempotenz-Ledger für
  // POST /api/sync/push) und SyncTombstone (Löschmarkierungen, siehe
  // jobs/erasure.repository.ts) wuchsen bislang unbegrenzt — siehe
  // jobs/syncBookkeeping.repository.ts für die Begründung der beiden
  // unterschiedlichen Fristen. Ausgeführt zusammen mit dem DSGVO-Hard-Purge
  // (scripts/purgeDeletedData.ts).
  SYNC_EVENT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  SYNC_TOMBSTONE_RETENTION_DAYS: z.coerce.number().int().positive().default(180),
});

export type Env = z.infer<typeof EnvSchema>;

// `source` ist injizierbar, damit Tests ohne echte process.env-Manipulation
// unterschiedliche Konfigurationen durchspielen können (siehe env.test.ts).
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Ungültige Umgebungskonfiguration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && (!env.JWT_PRIVATE_KEY || !env.JWT_PUBLIC_KEY)) {
    throw new Error(
      'JWT_PRIVATE_KEY und JWT_PUBLIC_KEY müssen in Produktion gesetzt sein (siehe .env.example, Abschnitt RS256-Schlüssel).',
    );
  }
  // Sicherheitshärtung (siehe Sicherheitsreview, Punkt 4): CORS wird mit
  // credentials: true betrieben (siehe plugins/security.ts) — Browser
  // lehnen die Kombination "Access-Control-Allow-Origin: *" +
  // "Access-Control-Allow-Credentials: true" zwar ohnehin ab, aber sich
  // allein darauf zu verlassen ist fragil (abhängig vom jeweiligen
  // Client/Browser-Verhalten, nicht serverseitig erzwungen). Ein
  // versehentliches CORS_ORIGIN=* in Produktion wird daher explizit und
  // frühzeitig beim Start abgelehnt, statt sich stillschweigend auf
  // Browser-Verhalten zu verlassen.
  if (env.NODE_ENV === 'production' && env.CORS_ORIGIN.trim() === '*') {
    throw new Error(
      'CORS_ORIGIN darf in Produktion nicht "*" sein (kombiniert mit credentials: true unsicher) — bitte die konkrete(n) Frontend-Origin(s) angeben (siehe .env.example).',
    );
  }
  // Sicherheitsreview 2026-08-27, Befund H1 — siehe ausführlichen
  // Kommentar bei TRUSTED_PROXY_IPS oben. Analog zum JWT-Schlüsselpaar
  // oben: kein stiller Default in Produktion, sondern ein Abbruch mit
  // klarer Fehlermeldung, da BEIDE denkbaren Defaults (leer -> kein
  // Proxy vertrauenswürdig -> Befund H2 des Sicherheitsreviews 2026-08;
  // "*"/"true" -> jede Adresse vertrauenswürdig -> Befund H1) hier
  // sicherheitsrelevant falsch wären.
  if (env.NODE_ENV === 'production' && env.TRUSTED_PROXY_IPS.trim() === '') {
    throw new Error(
      'TRUSTED_PROXY_IPS muss in Produktion gesetzt sein (siehe .env.example) — sonst sind entweder ' +
        'alle IP-basierten Rate-Limits per gefälschtem "X-Forwarded-For"-Header umgehbar, oder sie ' +
        'kollabieren auf einen einzigen, von Nginx geteilten Zähler (Sicherheitsreview 2026-08-27, Befund H1).',
    );
  }
  // Sicherheitsreview 2026-08, Befund M3 — bewusst KEIN Zwang zu SMTP_HOST
  // in Produktion: das würde den dokumentierten und unterstützten Betrieb
  // ohne eigenen Mailserver brechen (siehe deployment-github-codespaces.md/
  // deployment-macos.md — Einladungen werden dort bewusst NICHT per E-Mail,
  // sondern über den "Link kopieren"-Button versendet, z. B. per WhatsApp).
  // Die eigentliche Sicherheitslücke — ConsoleMailSender protokollierte den
  // Klartext-Link inkl. Token — ist stattdessen direkt in mail/mailer.ts
  // behoben (kein Token mehr im Log, unabhängig von NODE_ENV).
  return env;
}
