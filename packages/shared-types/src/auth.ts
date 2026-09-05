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
import { UserRolesSchema, LocaleSchema, UserSchema, NormalizedEmailSchema } from './user.js';
import { ModuleKeySchema } from './modules.js';

export const CURRENT_CONSENT_VERSION = '2026-07-15';

// Code-Review, Befund R4: `.refine((v) => v === true, { message })` konnte
// hier NIE fehlschlagen — z.literal(true) lässt bereits ausschließlich
// `true` durch (jeder andere Wert scheitert schon am literal-Check selbst,
// mit Zods generischer "Invalid literal value"-Meldung), das nachgestellte
// `.refine()` sieht also immer nur noch `v === true` und die deutsche
// Meldung erschien nie. Die Meldung gehört als `message`-Parameter direkt
// an `z.literal()`.
const consentField = z.literal(true, { message: 'Die Einwilligung zur Datenverarbeitung ist erforderlich.' });

// Review 30.08.2026, Befund S1: `consent: true` allein sagt nur "irgendeine
// Einwilligung wurde bestätigt" — WELCHER Fassung, geht daraus nicht
// hervor. auth.service.ts: login() stempelte bislang bedingungslos die
// server-eigene CURRENT_CONSENT_VERSION auf jeden Login, unabhängig davon,
// ob die angemeldete Person diese Fassung je gesehen hat — bei einer
// angehobenen Datenschutzerklärung schrieb der nächste Routine-Login die
// neue Version, ohne dass irgendjemand ihr zugestimmt hätte. Der Client
// muss die Version jetzt explizit benennen; z.literal() (wie bei
// consentField oben) lässt ausschließlich die tagesaktuelle Fassung durch
// — driftet CURRENT_CONSENT_VERSION zwischen Backend und Frontend
// auseinander (siehe die bislang doppelt gepflegte Konstante in
// apps/web/js/state.js), scheitert der Login jetzt sichtbar an dieser
// Stelle, statt eine falsche Fassung stillschweigend zu protokollieren.
const consentVersionField = z.literal(CURRENT_CONSENT_VERSION, {
  message: 'Die Einwilligung bezieht sich nicht auf die aktuelle Fassung der Datenschutzerklärung.',
});

// `.max(200)` (Sicherheitsreview 2026-08, Befund N7): argon2id verarbeitet
// beliebig lange Eingaben — verifyPassword() hasht das übermittelte
// Passwort bei JEDEM Login-Versuch gegen den gespeicherten Hash, ein
// unbegrenzt langes Feld wäre bei 64 MiB Speicherkosten pro Versuch ein
// unnötiger DoS-Verstärker. 200 Zeichen liegt weit über jeder realistischen
// Passphrase (siehe auth.passwordHint im Frontend).
export const LoginRequestSchema = z.object({
  // Sicherheitsreview 2026-08-29, Befund M2 — siehe NormalizedEmailSchema
  // (packages/shared-types/src/user.ts) für die vollständige Begründung.
  email: NormalizedEmailSchema,
  password: z.string().min(1).max(200),
  consent: consentField,
  consentVersion: consentVersionField,
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
  // Modul-Pakete des Vereins der eingeloggten Person (siehe modules.ts:
  // MODULE_PACKAGES) — leer für "superadmin", der zu keinem Verein gehört.
  // Steuert die Sichtbarkeit der Fach-Module in der Navigation
  // (apps/web/js/router.js: visibleModules()).
  enabledModules: z.array(ModuleKeySchema),
  // Externe Vereinskennung für den Ergebnisimport (DSV7/Lenex) — null für
  // "superadmin" oder wenn der Verein keine hinterlegt hat. Siehe
  // docs/dsv7-lenex-import-plan.md Abschnitt 3.1 und
  // apps/web/js/modules/resultsImportUI.js (automatische Vereinserkennung).
  clubNationalID: z.string().nullable(),
  clubNationalIDType: z.string().nullable(),
});
export type AuthTokensResponse = z.infer<typeof AuthTokensResponseSchema>;

// GET /api/me: derselbe Nutzer wie in AuthTokensResponse.user, ergänzt um
// dasselbe enabledModules-Feld — separates Schema statt UserSchema selbst
// zu erweitern, damit z. B. ClubMembersResponseSchema (Liste FREMDER
// Vereinsmitglieder, siehe user.ts) dieses rein session-bezogene Feld
// nicht unnötig mitführt.
export const MeResponseSchema = PublicUserSchema.extend({
  enabledModules: z.array(ModuleKeySchema),
  clubNationalID: z.string().nullable(),
  clubNationalIDType: z.string().nullable(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

// Sicherheitsreview 2026-08-27, Befund H2: `email` stand hier bislang mit
// drin — ein Wechsel der hinterlegten E-Mail-Adresse verlangte dadurch
// KEIN aktuelles Passwort, obwohl er dieselbe Kontoübernahme-Fläche
// eröffnet wie ein Passwortwechsel: mit einem kurzzeitig entwendeten,
// noch gültigen Access Token (z. B. Refresh Token im localStorage, siehe
// Sicherheitsreview 2026-08, Befund N3) hätte ein Angreifer die Adresse
// auf eine eigene umbiegen und danach über POST /auth/forgot-password
// einen Reset-Link an sich selbst zustellen können — die rechtmäßige
// Person wäre dabei sowohl aus- als auch fortan ausgesperrt gewesen.
// `email` ist deshalb kein Teil dieses Schemas mehr, sondern ein eigener,
// per aktuellem Passwort abgesicherter Endpunkt — siehe
// ChangeEmailRequestSchema unten (analog zu ChangePasswordRequestSchema).
export const UpdateMeRequestSchema = z
  .object({
    // `.max(200)` (Sicherheitsreview 2026-08, Befund N2) — siehe Begründung
    // bei CreateClubRequestSchema (invitation.ts).
    name: z.string().min(1).max(200).optional(),
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
  // Sicherheitsreview 2026-08-29, Befund M2 — hier besonders wichtig: die
  // generische Antwort dieses Endpunkts macht eine bloße Schreibweisen-
  // Abweichung von „Konto existiert nicht" ununterscheidbar (siehe
  // NormalizedEmailSchema in user.ts, Punkt 2).
  email: NormalizedEmailSchema,
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

// POST /api/me/email (Sicherheitsreview 2026-08-27, Befund H2) —
// authentifiziert, verlangt wie ChangePasswordRequestSchema oben
// zusätzlich das aktuelle Passwort (siehe dortiger Kommentar bzw.
// UpdateMeRequestSchema oben für die vollständige Begründung: verhindert,
// dass ein kurzzeitig entwendeter Access Token allein — kombiniert mit
// "Passwort vergessen" — zur dauerhaften Kontoübernahme reicht).
export const ChangeEmailRequestSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  // Sicherheitsreview 2026-08-29, Befund M2 — ohne Normalisierung ließ
  // sich hier die Duplikat-Prüfung in changeEmail() über eine abweichende
  // Groß-/Kleinschreibung umgehen (siehe NormalizedEmailSchema in
  // user.ts, Punkt 3).
  newEmail: NormalizedEmailSchema,
});
export type ChangeEmailRequest = z.infer<typeof ChangeEmailRequestSchema>;

// Claims im Access Token (siehe Abschnitt 5.3 des Backend-Entwicklungsplans).
// docs/kampfrichter-modul-plan.md, Abschnitt 1.4: "roles" statt "role" —
// ein Konto kann mehrere Rollen gleichzeitig haben.
export const AccessTokenClaimsSchema = z.object({
  sub: z.string().uuid(),
  roles: UserRolesSchema,
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
