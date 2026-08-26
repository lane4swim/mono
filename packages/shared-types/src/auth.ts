// packages/shared-types/src/auth.ts
//
// Vertrag für die Authentifizierung (Backend-Entwicklungsplan, Abschnitt 5),
// jetzt einladungsbasiert: eine offene Selbstregistrierung existiert nicht
// mehr — siehe invitation.ts (AcceptInvitationRequestSchema übernimmt die
// Rolle der früheren RegisterRequestSchema).
//
// DSGVO-Einwilligung: Sowohl Login als auch Einladungs-Annahme verlangen
// ein explizites `consent: true` — ohne bestätigte Einwilligung zur
// Datenverarbeitung kein Zugriff. `CURRENT_CONSENT_VERSION` wird bei jeder
// Bestätigung mitgespeichert (User.consentVersion), damit künftig eine
// geänderte Datenschutzerklärung erkennbar eine erneute Zustimmung
// erfordern kann.
import { z } from 'zod';
import { RoleSchema, LocaleSchema, UserSchema } from './user.js';

export const CURRENT_CONSENT_VERSION = '2026-07-15';

// Code-Review, Befund R4: `.refine((v) => v === true, { message })` konnte
// hier NIE fehlschlagen — z.literal(true) lässt bereits ausschließlich
// `true` durch (jeder andere Wert scheitert schon am literal-Check selbst,
// mit Zods generischer "Invalid literal value"-Meldung), das nachgestellte
// `.refine()` sieht also immer nur noch `v === true` und die deutsche
// Meldung erschien nie. Die Meldung gehört als `message`-Parameter direkt
// an `z.literal()`.
const consentField = z.literal(true, { message: 'Die Einwilligung zur Datenverarbeitung ist erforderlich.' });

// `.max(200)` (Sicherheitsreview 2026-08, Befund N7): argon2id verarbeitet
// beliebig lange Eingaben — verifyPassword() hasht das übermittelte
// Passwort bei JEDEM Login-Versuch gegen den gespeicherten Hash, ein
// unbegrenzt langes Feld wäre bei 64 MiB Speicherkosten pro Versuch ein
// unnötiger DoS-Verstärker. 200 Zeichen liegt weit über jeder realistischen
// Passphrase (siehe auth.passwordHint im Frontend).
export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
  consent: consentField,
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const RefreshRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshRequest = z.infer<typeof RefreshRequestSchema>;

export const LogoutRequestSchema = z.object({
  refreshToken: z.string().min(1),
});
export type LogoutRequest = z.infer<typeof LogoutRequestSchema>;

// Öffentliche Nutzerdarstellung (niemals den Passwort-Hash mitsenden).
export const PublicUserSchema = UserSchema;
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const AuthTokensResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int().positive(), // Sekunden bis Ablauf des Access Tokens
  user: PublicUserSchema,
});
export type AuthTokensResponse = z.infer<typeof AuthTokensResponseSchema>;

export const UpdateMeRequestSchema = z
  .object({
    // `.max(200)` (Sicherheitsreview 2026-08, Befund N2) — siehe Begründung
    // bei CreateClubRequestSchema (invitation.ts).
    name: z.string().min(1).max(200).optional(),
    email: z.string().email().optional(),
    locale: LocaleSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Mindestens ein Feld muss angegeben werden.' });
export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;

// ---- "Passwort vergessen" / Passwortwechsel (Sicherheitsreview 2026-08,
// Befund M5) ----------------------------------------------------------
//
// Dieselbe Mindest-/Höchstlänge wie AcceptInvitationRequestSchema.password
// (packages/shared-types/src/invitation.ts) — bewusst hier erneut
// definiert statt importiert: unterschiedliche Datei/Domäne (Einladung
// vs. Auth), die Konstante ist eine einzige Zeile, ein Import würde hier
// mehr Kopplung stiften als die Duplikation vermeidet. `.max(200)`
// (Sicherheitsreview 2026-08, Befund N7) — siehe Begründung bei
// LoginRequestSchema.password oben.
const newPasswordField = z.string().min(8, 'Passwort muss mindestens 8 Zeichen lang sein').max(200);

// POST /auth/forgot-password — öffentlich (kein Login nötig). Liefert
// IMMER dieselbe generische Antwort, unabhängig davon, ob ein Konto mit
// dieser E-Mail-Adresse existiert (verhindert User-Enumeration, siehe
// auth.service.ts: requestPasswordReset()).
export const ForgotPasswordRequestSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

// POST /auth/reset-password — öffentlich, aber nur mit einem gültigen,
// per E-Mail zugestellten Token nutzbar (siehe auth/tokens.ts:
// generatePasswordResetToken()).
export const ResetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  newPassword: newPasswordField,
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

// POST /api/me/password — authentifiziert, verlangt zusätzlich das
// aktuelle Passwort (verhindert, dass ein kurzzeitig entwendeter Access
// Token allein zur dauerhaften Kontoübernahme per Passwortwechsel reicht).
export const ChangePasswordRequestSchema = z.object({
  // `.max(200)` (Sicherheitsreview 2026-08, Befund N7) — siehe Begründung
  // bei LoginRequestSchema.password oben; gilt hier ebenso, da
  // changePassword() das aktuelle Passwort ebenfalls per verifyPassword()
  // gegen den gespeicherten Hash prüft.
  currentPassword: z.string().min(1).max(200),
  newPassword: newPasswordField,
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

// Claims im Access Token (siehe Abschnitt 5.3 des Backend-Entwicklungsplans).
export const AccessTokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  role: RoleSchema,
  clubId: z.string().uuid().nullable(),
  athleteId: z.string().uuid().nullable(),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaimsSchema>;

// ---- Auskunft & Löschung (Art. 15 + 17 DSGVO) -----------------------------

// Lose typisiert (z.record statt eines starren Schemas) — der Export bündelt
// Daten aus mehreren fachlichen Tabellen (Athlete, Result, StartlistEntry,
// ActionItem, Anwesenheits-Einträge), deren detaillierte Schemas bereits in
// entities.ts existieren; hier zählt vor allem die Envelope-Struktur.
export const MyDataExportSchema = z.object({
  exportedAt: z.string().datetime(),
  format: z.literal('lane1-user-data-export-v1'),
  user: PublicUserSchema,
  athlete: z.record(z.unknown()).nullable(),
  results: z.array(z.record(z.unknown())),
  entries: z.array(z.record(z.unknown())),
  actionItems: z.array(z.record(z.unknown())),
  attendance: z.array(z.record(z.unknown())),
});
export type MyDataExport = z.infer<typeof MyDataExportSchema>;

// Code-Review, Befund R8: `purgedAt`/`status` gestrichen — der Zustand
// "purged" war strukturell unerreichbar (siehe schema.prisma:
// DataDeletionRequest für die Begründung).
export const DataDeletionRequestSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  requestedAt: z.string().datetime(),
  purgeAfter: z.string().datetime(),
});
export type DataDeletionRequest = z.infer<typeof DataDeletionRequestSchema>;
