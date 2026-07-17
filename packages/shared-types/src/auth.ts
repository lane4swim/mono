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

const consentField = z
  .literal(true)
  .refine((v) => v === true, { message: 'Die Einwilligung zur Datenverarbeitung ist erforderlich.' });

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
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
    name: z.string().min(1).optional(),
    email: z.string().email().optional(),
    locale: LocaleSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Mindestens ein Feld muss angegeben werden.' });
export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;

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

export const DataDeletionRequestSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  requestedAt: z.string().datetime(),
  purgeAfter: z.string().datetime(),
  purgedAt: z.string().datetime().nullable(),
  status: z.enum(['pending', 'purged']),
});
export type DataDeletionRequest = z.infer<typeof DataDeletionRequestSchema>;
