// Liest und validiert Umgebungsvariablen einmalig beim Start. Ein
// fehlender/ungültiger Wert lässt den Server sofort mit einer klaren
// Fehlermeldung abbrechen, statt erst später mit einem kryptischen
// Fehler mitten im Betrieb zu scheitern.
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Bind-Adresse des Node-Prozesses. Default "127.0.0.1", weil auf jedem
  // dokumentierten Deployment (docs/deployment*.md) Nginx auf demselben Host
  // läuft: ein Bind auf allen Interfaces öffnete den Port unnötig nach außen
  // und ließe sich an Nginx' CSP/TLS-Terminierung vorbei ansprechen. Nur der
  // Container-Betrieb (docker-compose.yml) setzt HOST=0.0.0.0, wo der Zugriff
  // über Dockers Portweiterleitung statt über einen lokalen Proxy läuft.
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL ist erforderlich (siehe .env.example)'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // RS256-Schlüsselpaar für die Access-Token-Signatur. Zwei gleichwertige,
  // gegenseitig exklusive Formen je Schlüssel (Prüfung unten):
  //   - JWT_PRIVATE_KEY/JWT_PUBLIC_KEY: PEM direkt in der .env, mit \n statt
  //     echten Zeilenumbrüchen (auth/keys.ts wandelt zurück).
  //   - JWT_PRIVATE_KEY_FILE/JWT_PUBLIC_KEY_FILE: Pfad zu einer PEM-Datei.
  //     Für Produktion empfohlen, weil sich die Datei unabhängig von der .env
  //     auf das Dienstkonto beschränken lässt.
  // In Produktion ist je Schlüssel genau eine Form Pflicht; in
  // development/test erzeugt auth/keys.ts sonst ein Wegwerf-Paar.
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_PRIVATE_KEY_FILE: z.string().optional(),
  JWT_PUBLIC_KEY_FILE: z.string().optional(),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),

  // Kommagetrennte Liste der vertrauenswürdigen Reverse-Proxy-Adressen,
  // weitergereicht an Fastifys "trustProxy" (app.ts: resolveTrustProxy()).
  // Muss die Hops NAMENTLICH nennen: bei `trustProxy: true` übernimmt Fastify
  // den am weitesten links stehenden "X-Forwarded-For"-Eintrag als
  // request.ip, und den bestimmt der Client selbst, da Nginx nur anhängt
  // (`$proxy_add_x_forwarded_for`) — jedes IP-Rate-Limit wäre pro Anfrage per
  // Header umgehbar. Leer (Standard) heißt "kein Proxy vertrauenswürdig",
  // request.ip ist dann die TCP-Peer-Adresse; richtig für lokale Entwicklung
  // und docker-compose. In Produktion Pflicht (Prüfung unten), weil beide
  // denkbaren Defaults falsch wären: leer lässt die Rate-Limits auf einen
  // von Nginx geteilten Zähler kollabieren, "true" macht sie fälschbar.
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
  // Bewusst kein z.coerce.boolean(): das ist `Boolean(nichtleerer String)`
  // und macht auch den Text "false" zu `true` — für einen TLS-Schalter
  // besonders unglücklich. z.enum lässt Tippfehler stattdessen beim Start
  // scheitern.
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

  // Aufbewahrung für SyncedEvent (Idempotenz-Ledger von POST /api/sync/push)
  // und SyncTombstone (Löschmarkierungen); ohne sie wüchsen beide unbegrenzt.
  // Begründung der unterschiedlichen Fristen in
  // jobs/syncBookkeeping.repository.ts, ausgeführt mit dem DSGVO-Hard-Purge.
  SYNC_EVENT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
  SYNC_TOMBSTONE_RETENTION_DAYS: z.coerce.number().int().positive().default(180),

  // Web-Push (Phase 2, Abschnitt 1.2 — docs/Plans/phase2-plan.md), VAPID-
  // Schlüsselpaar. Einmalig erzeugt über `npx web-push generate-vapid-keys`
  // (im Ordner apps/api, das Paket ist bereits Abhängigkeit). Bleiben beide
  // leer, greift ConsolePushSender (protokolliert statt zu versenden,
  // analog zu SMTP_HOST/ConsoleMailSender) — kein Startabbruch, da Push nur
  // ein Zusatzkanal ist. VAPID_SUBJECT ist laut Spezifikation ein
  // "mailto:"- oder "https://"-Kontakt; Default nutzt SMTP_FROM_EMAIL.
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),
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
  // Je Schlüssel darf nur eine der beiden Formen gesetzt sein — sonst hinge
  // still vom Auflösungspfad in auth/keys.ts ab, welche gilt. Unabhängig von
  // NODE_ENV: eine Doppelkonfiguration ist überall ein Versehen.
  if (env.JWT_PRIVATE_KEY && env.JWT_PRIVATE_KEY_FILE) {
    throw new Error(
      'JWT_PRIVATE_KEY und JWT_PRIVATE_KEY_FILE dürfen nicht beide gesetzt sein — bitte genau eine der beiden Formen verwenden (siehe .env.example).',
    );
  }
  if (env.JWT_PUBLIC_KEY && env.JWT_PUBLIC_KEY_FILE) {
    throw new Error(
      'JWT_PUBLIC_KEY und JWT_PUBLIC_KEY_FILE dürfen nicht beide gesetzt sein — bitte genau eine der beiden Formen verwenden (siehe .env.example).',
    );
  }
  if (env.NODE_ENV === 'production' && !(env.JWT_PRIVATE_KEY || env.JWT_PRIVATE_KEY_FILE)) {
    throw new Error(
      'JWT_PRIVATE_KEY oder JWT_PRIVATE_KEY_FILE muss in Produktion gesetzt sein (siehe .env.example, Abschnitt RS256-Schlüssel).',
    );
  }
  if (env.NODE_ENV === 'production' && !(env.JWT_PUBLIC_KEY || env.JWT_PUBLIC_KEY_FILE)) {
    throw new Error(
      'JWT_PUBLIC_KEY oder JWT_PUBLIC_KEY_FILE muss in Produktion gesetzt sein (siehe .env.example, Abschnitt RS256-Schlüssel).',
    );
  }
  // CORS läuft mit credentials: true (plugins/security.ts). Browser lehnen
  // "Allow-Origin: *" in dieser Kombination zwar selbst ab, aber darauf zu
  // bauen heißt, sich auf Client-Verhalten zu verlassen — ein versehentliches
  // CORS_ORIGIN=* scheitert deshalb schon beim Start.
  if (env.NODE_ENV === 'production' && env.CORS_ORIGIN.trim() === '*') {
    throw new Error(
      'CORS_ORIGIN darf in Produktion nicht "*" sein (kombiniert mit credentials: true unsicher) — bitte die konkrete(n) Frontend-Origin(s) angeben (siehe .env.example).',
    );
  }
  // Kein stiller Default in Produktion — Begründung bei TRUSTED_PROXY_IPS oben.
  if (env.NODE_ENV === 'production' && env.TRUSTED_PROXY_IPS.trim() === '') {
    throw new Error(
      'TRUSTED_PROXY_IPS muss in Produktion gesetzt sein (siehe .env.example) — sonst sind entweder ' +
        'alle IP-basierten Rate-Limits per gefälschtem "X-Forwarded-For"-Header umgehbar, oder sie ' +
        'kollabieren auf einen einzigen, von Nginx geteilten Zähler (Sicherheitsreview 2026-08-27, Befund H1).',
    );
  }
  // Bewusst KEIN Zwang zu SMTP_HOST in Produktion: der Betrieb ohne eigenen
  // Mailserver ist dokumentiert und unterstützt (deployment-macos.md —
  // Einladungen gehen dort über den "Link kopieren"-Button). Dass
  // ConsoleMailSender dabei nichts Sensibles protokolliert, stellt
  // mail/mailer.ts sicher, nicht diese Prüfung.
  return env;
}
