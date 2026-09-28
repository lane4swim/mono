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

// Die Meldung steht direkt an z.literal(): ein nachgestelltes .refine()
// käme nie zum Zug, weil z.literal(true) jeden anderen Wert schon vorher
// (mit Zods generischer Meldung) ablehnt.
const consentField = z.literal(true, { message: 'Die Einwilligung zur Datenverarbeitung ist erforderlich.' });

// `consent: true` allein sagt nicht, WELCHER Fassung zugestimmt wurde. Der
// Client benennt die Fassung deshalb ausdrücklich, und nur die aktuelle wird
// angenommen: sonst würde der nächste Routine-Login nach einer geänderten
// Datenschutzerklärung deren neue Version protokollieren, ohne dass die
// Person sie je gesehen hat. Laufen Frontend und Backend bei der Version
// auseinander, scheitert der Login hier sichtbar, statt eine falsche Fassung
// zu speichern.
const consentVersionField = z.literal(CURRENT_CONSENT_VERSION, {
  message: 'Die Einwilligung bezieht sich nicht auf die aktuelle Fassung der Datenschutzerklärung.',
});

// `.max(200)` für Passwörter: verifyPassword() hasht die Eingabe bei jedem
// Login-Versuch mit argon2id (64 MiB pro Versuch), ein unbegrenztes Feld
// wäre ein unnötiger DoS-Verstärker. 200 Zeichen liegen weit über jeder
// realistischen Passphrase (siehe auth.passwordHint im Frontend).
export const LoginRequestSchema = z.object({
  // Normalisiert, siehe NormalizedEmailSchema in user.ts.
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
  // Anzeigename des eigenen Vereins — null für "superadmin". Siehe
  // docs/Plans/club-legal-info-plan.md.
  clubName: z.string().nullable(),
  // Externe Vereinskennung für den Ergebnisimport (DSV7/Lenex) — null für
  // "superadmin" oder wenn der Verein keine hinterlegt hat. Siehe
  // docs/Plans/dsv7-lenex-import-plan.md Abschnitt 3.1 und
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
  clubName: z.string().nullable(),
  clubNationalID: z.string().nullable(),
  clubNationalIDType: z.string().nullable(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

// Bewusst ohne `email`: ein Adresswechsel öffnet dieselbe Übernahmefläche
// wie ein Passwortwechsel (mit einem entwendeten Access Token die Adresse
// umbiegen, dann per "Passwort vergessen" einen Reset-Link an sich selbst
// schicken). Er läuft deshalb über einen eigenen, per aktuellem Passwort
// abgesicherten Endpunkt, siehe ChangeEmailRequestSchema unten.
export const UpdateMeRequestSchema = z
  .object({
    // `.max(200)`: siehe Begründung bei CreateClubRequestSchema (invitation.ts).
    name: z.string().min(1).max(200).optional(),
    locale: LocaleSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Mindestens ein Feld muss angegeben werden.' });
export type UpdateMeRequest = z.infer<typeof UpdateMeRequestSchema>;

// ---- "Passwort vergessen" / Passwortwechsel -------------------------------
//
// Dieselbe Mindest-/Höchstlänge wie AcceptInvitationRequestSchema.password
// (packages/shared-types/src/invitation.ts) — bewusst hier erneut
// definiert statt importiert: unterschiedliche Datei/Domäne (Einladung
// vs. Auth), die Konstante ist eine einzige Zeile, ein Import würde hier
// mehr Kopplung stiften als die Duplikation vermeidet. `.max(200)`: siehe
// LoginRequestSchema oben. Die strengeren Regeln für Admin-Konten und die
// Prüfung gegen geleakte Passwörter prüft der Server (auth/passwordPolicy.ts),
// weil nur er die Rolle kennt.
const newPasswordField = z.string().min(8, 'Passwort muss mindestens 8 Zeichen lang sein').max(200);

// POST /auth/forgot-password — öffentlich (kein Login nötig). Liefert
// IMMER dieselbe generische Antwort, unabhängig davon, ob ein Konto mit
// dieser E-Mail-Adresse existiert (verhindert User-Enumeration, siehe
// auth.service.ts: requestPasswordReset()).
export const ForgotPasswordRequestSchema = z.object({
  // Normalisiert, hier besonders wichtig: wegen der generischen Antwort
  // wäre eine bloß anders geschriebene Adresse nicht von „Konto existiert
  // nicht" zu unterscheiden (siehe NormalizedEmailSchema in user.ts, Punkt 2).
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
  // `.max(200)` wie bei LoginRequestSchema oben: changePassword() prüft das
  // aktuelle Passwort ebenfalls per verifyPassword().
  currentPassword: z.string().min(1).max(200),
  newPassword: newPasswordField,
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

// POST /api/me/email — authentifiziert, verlangt wie
// ChangePasswordRequestSchema zusätzlich das aktuelle Passwort (Begründung
// bei UpdateMeRequestSchema oben).
export const ChangeEmailRequestSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  // Normalisiert, damit die Duplikat-Prüfung in changeEmail() nicht per
  // abweichender Groß-/Kleinschreibung umgangen werden kann (siehe
  // NormalizedEmailSchema in user.ts, Punkt 3).
  newEmail: NormalizedEmailSchema,
});
export type ChangeEmailRequest = z.infer<typeof ChangeEmailRequestSchema>;

// Claims im Access Token (siehe Abschnitt 5.3 des Backend-Entwicklungsplans).
// docs/Plans/kampfrichter-modul-plan.md, Abschnitt 1.4: "roles" statt "role" —
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
  // An userId gehängt, nicht athleteId — gilt für jede Person mit Konto
  // (docs/Plans/nutzer-qualifikationen-plan.md, Abschnitt 6). Nachträglich hier
  // ergänzt (dieses Schema war bislang unabhängig von der tatsächlichen
  // Export-Antwort auseinandergelaufen, siehe profile.repository.ts:
  // PersonalDataExport, das dieses Feld schon lange liefert).
  qualifications: z.array(z.record(z.unknown())),
  // docs/Plans/kampfrichter-modul-plan.md, Abschnitt 5.7 — ebenfalls an userId
  // gehängt: gilt für jede Person mit Konto und der Rolle "referee",
  // unabhängig von einer Athletenverknüpfung.
  refereeAssignments: z.array(z.record(z.unknown())),
});
export type MyDataExport = z.infer<typeof MyDataExportSchema>;

// Ohne `status`/`purgedAt`: nach dem Purge existiert der Antrag nicht mehr,
// ein Zustand "purged" wäre unerreichbar (siehe schema.prisma:
// DataDeletionRequest).
export const DataDeletionRequestSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  requestedAt: z.string().datetime(),
  purgeAfter: z.string().datetime(),
});
export type DataDeletionRequest = z.infer<typeof DataDeletionRequestSchema>;
