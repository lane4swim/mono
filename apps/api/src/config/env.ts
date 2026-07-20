// apps/api/src/config/env.ts
//
// Liest und validiert Umgebungsvariablen einmalig beim Start. Ein
// fehlender/ungültiger Wert lässt den Server sofort mit einer klaren
// Fehlermeldung abbrechen, statt erst später mit einem kryptischen
// Fehler mitten im Betrieb zu scheitern.
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL ist erforderlich (siehe .env.example)'),
  JWT_SIGNING_KEY: z.string().min(32, 'JWT_SIGNING_KEY muss mindestens 32 Zeichen lang sein'),
  JWT_ACCESS_TTL: z.string().default('15m'),
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
  SMTP_SECURE: z.coerce.boolean().default(false),
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
  return env;
}
