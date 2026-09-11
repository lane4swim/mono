// Einziger Ort, an dem das Frontend HTTP-Aufrufe an apps/api macht. Kapselt:
//   - Basis-URL-Auflösung (Standard: gleicher Origin; für lokale Entwicklung
//     gegen `npm run dev:api` überschreibbar, siehe setApiBaseUrl())
//   - Access Token im Speicher (nicht localStorage — mindert das XSS-Risiko),
//     Refresh Token in localStorage, damit die Sitzung einen Seiten-Reload
//     übersteht. Eine httpOnly-Cookie-Lösung bräuchte serverseitiges Setzen
//     des Cookies, was der JSON-basierte Refresh-Endpunkt nicht tut —
//     bewusste, dokumentierte Vereinfachung.
//   - automatisches, einmaliges Refresh+Retry bei 401
//   - Single-Flight für refreshTokens() (siehe dort)
import { t } from './i18n.js';

const API_BASE_URL_KEY = 'lane1-api-base-url';
const REFRESH_TOKEN_KEY = 'lane1-refresh-token';

let accessToken = null;
let accessTokenExpiresAt = 0; // Unix-Millisekunden

// Puffer, mit dem request() das Access Token schon kurz VOR dem Ablauf
// erneuert, statt auf einen 401 zu warten. Spart reaktive Retry-Zyklen und
// entschärft das Massen-Logout-Risiko bei refreshTokens() (siehe dort): ein
// rechtzeitig erneuertes Token löst gar nicht erst parallele 401-Retries aus.
const PROACTIVE_REFRESH_MARGIN_MS = 10_000;

function isAccessTokenExpiringSoon() {
  return accessToken !== null && Date.now() >= accessTokenExpiresAt - PROACTIVE_REFRESH_MARGIN_MS;
}

// Der Basis-URL-Override bestimmt das Ziel sämtlicher Requests samt
// Authorization-Header. Käme er ungeprüft aus dem localStorage, könnte ihn
// eine XSS-Lücke auf einen fremden Host umbiegen und alle Tokens dorthin
// leiten. Er ist reines Entwicklungswerkzeug (Dev-Server auf :5173 gegen die
// API auf :3000), Produktionsinstanzen laufen laut docs/deployment*.md immer
// auf einer eigenen Domain — er wird deshalb nur gelesen UND geschrieben,
// wenn die Seite selbst von einem lokalen Origin kommt.
const LOCAL_DEV_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isLocalDevOrigin() {
  return typeof location !== 'undefined' && LOCAL_DEV_HOSTNAMES.has(location.hostname);
}

export function getApiBaseUrl() {
  if (!isLocalDevOrigin()) return '';
  return localStorage.getItem(API_BASE_URL_KEY) || '';
}
export function setApiBaseUrl(url) {
  if (!isLocalDevOrigin()) return;
  if (url) localStorage.setItem(API_BASE_URL_KEY, url);
  else localStorage.removeItem(API_BASE_URL_KEY);
}

export function getStoredRefreshToken() {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}
export function setTokens({ accessToken: at, refreshToken: rt, expiresIn }) {
  accessToken = at;
  accessTokenExpiresAt = Date.now() + (expiresIn ?? 900) * 1000;
  if (rt) localStorage.setItem(REFRESH_TOKEN_KEY, rt);
}
export function clearTokens() {
  accessToken = null;
  accessTokenExpiresAt = 0;
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}
export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `API-Fehler (${status})`);
    this.status = status;
    this.body = body;
  }
}

// Netzwerkfehler (Backend nicht erreichbar/offline) — unterscheidbar von
// einer regulären Fehlerantwort (ApiError), damit aufrufender Code z. B.
// unterschiedliche Meldungen zeigen kann ("kein Internet" vs. "falsches
// Passwort").
export class NetworkError extends Error {}

// Übersetzt den stabilen, sprachunabhängigen `body.error`-Code einer
// ApiError (siehe apps/api/src/plugins/httpErrorHandler.ts:
// HTTP_ERROR_REGISTRY) über common.apiErrors.<code> in beiden
// Sprachdateien. `err.message` trägt dagegen IMMER den deutschen
// Originaltext aus der jeweiligen Fehlerklasse im Backend (die API selbst
// lokalisiert nicht, siehe dortiger Kommentar) — als Anzeigetext daher nur
// für deutschsprachige Nutzer:innen brauchbar. Ein unbekannter/neuer Code
// ohne passenden Eintrag in apiErrors fällt auf t('common.errorUnknown')
// zurück statt auf err.message, damit nie unübersetzter deutscher Text
// durchrutscht, nur weil eine neue Backend-Fehlerklasse noch keinen
// Wörterbucheintrag hat (auf Kosten von Detailinformation im Einzelfall —
// bewusster Kompromiss, siehe README "Mehrsprachigkeit").
export function apiErrorMessage(err) {
  const code = err.body?.error;
  if (!code) return t('common.errorUnknown');
  const key = `common.apiErrors.${code}`;
  const translated = t(key);
  // t() gibt den Schlüssel selbst zurück, wenn er in keiner Sprachdatei
  // existiert (siehe i18n.js) — genau das Signal für "kein Eintrag".
  return translated === key ? t('common.errorUnknown') : translated;
}

// Übersetzt einen ApiError/NetworkError in eine anzeigbare Meldung — vormals
// dreimal wortgleich (bis auf drei parallele Schlüsselpaare in beiden
// Sprachdateien) in profile.js, userManagement.js und admin/admin.js
// dupliziert. `on401Message`, wenn gesetzt, überschreibt `err.message` für
// einen 401 (admin.js: zeigt dort bewusst
// t('auth.errorInvalidCredentials') statt der rohen Serverantwort — die
// einzige tatsächliche Abweichung zwischen den drei ursprünglichen
// Kopien, alles andere war bereits identisch).
export function describeError(err, { on401Message } = {}) {
  if (err instanceof NetworkError) return t('common.errorNetwork');
  if (err instanceof ApiError) {
    if (err.status === 401 && on401Message) return on401Message;
    // Review 30.08.2026, Befund U4: ohne diesen Zweig zeigte ein 429
    // (Ratenlimit-Treffer, siehe Befund S2) dieselbe generische
    // Server-Fehlermeldung wie jeder andere Fehler — nicht unterscheidbar
    // von einem echten Problem, obwohl ein erneuter Versuch nach kurzer
    // Zeit genügt.
    if (err.status === 429) return t('common.errorRateLimited');
    return apiErrorMessage(err);
  }
  return t('common.errorUnknown');
}

async function rawRequest(path, options = {}) {
  const url = `${getApiBaseUrl()}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch {
    throw new NetworkError('Server nicht erreichbar. Bitte Internetverbindung prüfen.');
  }

  if (response.status === 204) return null;
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body);
  return body;
}

// Führt eine Anfrage aus; bei 401 wird EINMAL versucht, das Access Token
// per Refresh Token zu erneuern und die Anfrage zu wiederholen — deckt den
// häufigsten Fall ab (Access Token zwischenzeitlich abgelaufen), ohne bei
// echten Auth-Fehlern (falsches Passwort etc.) in eine Schleife zu geraten,
// da refreshTokens() selbst kein 401-Retry auslöst.
//
// Davor zusätzlich ein PROAKTIVER Refresh, wenn das Token laut
// accessTokenExpiresAt bald abläuft. `allowRefreshRetry` steuert auch diesen
// Zweig, damit Aufrufer ohne Refresh-Verhalten (z. B. login()) konsistent
// beide Pfade abschalten. Schlägt der proaktive Versuch fehl (offline), fängt
// der reaktive 401-Pfad den Fall unverändert ab.
async function request(path, options = {}, { allowRefreshRetry = true } = {}) {
  if (allowRefreshRetry && isAccessTokenExpiringSoon() && getStoredRefreshToken()) {
    try { await refreshTokens(); } catch { /* reaktiver 401-Pfad unten übernimmt bei Bedarf */ }
  }
  try {
    return await rawRequest(path, options);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401 && allowRefreshRetry && getStoredRefreshToken()) {
      try {
        await refreshTokens();
      } catch (refreshErr) {
        // Ein Ratenlimit-Treffer (429) auf /auth/refresh sagt nichts über die
        // Gültigkeit der Sitzung aus — nur, dass dieser Versuch gerade nicht
        // ging (mehrere Geräte hinter derselben NAT erneuern regelmäßig
        // gleichzeitig). Tokens bleiben erhalten und der 429 wird statt des
        // 401 durchgereicht, damit describeError() eine passende Meldung
        // zeigt, statt eine gültige Sitzung zu beenden.
        if (refreshErr instanceof ApiError && refreshErr.status === 429) {
          throw refreshErr;
        }
        clearTokens();
        throw err;
      }
      return rawRequest(path, options);
    }
    throw err;
  }
}

function postJson(path, body, opts) {
  return request(path, { method: 'POST', body: JSON.stringify(body) }, opts);
}

// ---- Auth ------------------------------------------------------------
// Gibt user + enabledModules zusammen zurück (nicht nur result.user) —
// state.js legt daraus die vollständige `current`-Sitzung an, inklusive
// der gebuchten Module des Vereins (siehe router.js: visibleModules()).
export async function login({ email, password, consent, consentVersion }) {
  const result = await postJson('/auth/login', { email, password, consent, consentVersion }, { allowRefreshRetry: false });
  setTokens(result);
  return { ...result.user, enabledModules: result.enabledModules, clubNationalID: result.clubNationalID, clubNationalIDType: result.clubNationalIDType };
}

export async function acceptInvitation({ token, name, password, consent }) {
  const result = await postJson('/auth/register', { token, name, password, consent }, { allowRefreshRetry: false });
  setTokens(result);
  return { ...result.user, enabledModules: result.enabledModules, clubNationalID: result.clubNationalID, clubNationalIDType: result.clubNationalIDType };
}

// "Passwort vergessen" (Sicherheitsreview 2026-08, Befund M5). Liefert
// serverseitig IMMER dieselbe generische Antwort (siehe
// auth.service.ts: requestPasswordReset()) — verrät nicht, ob die
// E-Mail-Adresse zu einem Konto gehört. allowRefreshRetry: false wie bei
// login()/acceptInvitation() — vor einer Sitzung gibt es kein Access
// Token, das per 401-Retry erneuert werden könnte.
export function forgotPassword(email) {
  return postJson('/auth/forgot-password', { email }, { allowRefreshRetry: false });
}

// Löst das per E-Mail zugestellte Reset-Token ein — meldet bei Erfolg
// direkt an, analog zu login()/acceptInvitation() oben (der serverseitige
// Endpunkt liefert bereits ein volles Token-Paar, siehe
// auth.service.ts: resetPassword()).
export async function resetPassword({ token, newPassword }) {
  const result = await postJson('/auth/reset-password', { token, newPassword }, { allowRefreshRetry: false });
  setTokens(result);
  return { ...result.user, enabledModules: result.enabledModules, clubNationalID: result.clubNationalID, clubNationalIDType: result.clubNationalIDType };
}

// Bündelt gleichzeitige Aufrufer auf GENAU einen In-Flight-Versuch. Ohne das
// lösen parallele Requests mit abgelaufenem Access Token (runSync()'s
// push()+pull(), ein modulweites Promise.all()) jeweils eigenständig einen
// 401-Retry aus. Der erste rotiert serverseitig das Refresh Token
// (auth.service.ts: refresh()), jeder weitere schickt danach ein bereits
// rotiertes — und die Reuse-Detection dort widerruft daraufhin ALLE
// Sitzungen des Kontos. Das Bündeln ist deshalb sicherheitsrelevant, nicht
// nur eine Optimierung: sonst löste das eigene parallele Anfrageverhalten der
// App einen Massen-Logout aus, ohne dass ein Token gestohlen wurde.
let refreshInFlight = null;

export function refreshTokens() {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

async function performRefresh() {
  const rt = getStoredRefreshToken();
  if (!rt) throw new Error('Kein Refresh Token vorhanden.');
  const result = await rawRequest('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: rt }) });
  setTokens(result);
  return result;
}

export async function logoutRemote() {
  const rt = getStoredRefreshToken();
  if (!rt) return;
  try { await rawRequest('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: rt }) }); }
  catch { /* best effort — lokales Aufräumen erfolgt in jedem Fall */ }
}

// POST statt GET mit Token als URL-Pfadparameter (Sicherheitsreview
// 2026-08, Befund M3) — verhindert, dass das Token über Server-seitiges
// Zugriffs-/Anwendungslogging (req.url) im Klartext landet. Der geteilte
// Einladungslink selbst (#/accept-invite/<token>, per "Link kopieren" in
// modules/userManagement.js z. B. für den Versand per WhatsApp) bleibt
// unverändert — das Token steht dort im URL-Fragment, das der Browser nie
// an einen Server sendet; erst dieser Aufruf hier (nachdem der Client es
// bereits aus dem Fragment gelesen hat) schickt es weiter, jetzt im Body.
export function getInvitationPreview(token) {
  return postJson('/api/invitations/preview', { token }, { allowRefreshRetry: false });
}

// ---- Eigenes Profil ----------------------------------------------------
export function getMe() {
  return request('/api/me');
}
export function updateMe(patch) {
  return request('/api/me', { method: 'PATCH', body: JSON.stringify(patch) });
}
// Passwortwechsel für die eigene, eingeloggte Person (Sicherheitsreview
// 2026-08, Befund M5). Liefert wie login() ein frisches Token-Paar —
// die aktuelle Sitzung bleibt dadurch nahtlos angemeldet, während der
// Server alle ANDEREN Sitzungen widerruft (siehe auth.service.ts:
// changePassword()).
export async function changePassword({ currentPassword, newPassword }) {
  const result = await request('/api/me/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
  setTokens(result);
  return { ...result.user, enabledModules: result.enabledModules, clubNationalID: result.clubNationalID, clubNationalIDType: result.clubNationalIDType };
}
// E-Mail-Wechsel für die eigene, eingeloggte Person (Sicherheitsreview
// 2026-08-27, Befund H2) — verlangt wie changePassword() das aktuelle
// Passwort. `email` ist deshalb bewusst NICHT mehr Teil von updateMe()/
// PATCH /api/me (siehe dortiger Kommentar). Liefert wie changePassword()
// ein frisches Token-Paar — die aktuelle Sitzung bleibt dadurch nahtlos
// angemeldet, während der Server alle ANDEREN Sitzungen widerruft (siehe
// auth.service.ts: changeEmail()).
export async function changeEmail({ currentPassword, newEmail }) {
  const result = await request('/api/me/email', { method: 'POST', body: JSON.stringify({ currentPassword, newEmail }) });
  setTokens(result);
  return { ...result.user, enabledModules: result.enabledModules, clubNationalID: result.clubNationalID, clubNationalIDType: result.clubNationalIDType };
}
// Art. 15 DSGVO — Recht auf Auskunft: bündelt alle zum eigenen Konto
// gespeicherten Daten.
export function exportMyData() {
  return request('/api/me/export');
}
// Art. 17 DSGVO — Recht auf Löschung: sofortiger Soft-Delete, endgültiger
// Hard-Purge folgt serverseitig zeitversetzt (siehe Backend-README). Liefert
// { message, purgeAfter }.
export function deleteMyAccount() {
  return request('/api/me', { method: 'DELETE' });
}

// ---- Vereine & Einladungen (Nutzerverwaltung) --------------------------
export function createClub({ name, adminEmail, adminName, enabledModules }) {
  return postJson('/api/clubs', { name, adminEmail, adminName, enabledModules });
}
export function listClubs() {
  return request('/api/clubs');
}
// Ändert nachträglich, welche Modul-Pakete ein bestehender Verein gebucht
// hat (Superadmin-Bearbeiten-Ansicht, siehe admin.js). Antwort: { club }.
export function updateClub(clubId, { enabledModules }) {
  return request(`/api/clubs/${encodeURIComponent(clubId)}`, { method: 'PATCH', body: JSON.stringify({ enabledModules }) });
}
// Eigener Endpunkt statt updateClub() oben — Admins dürfen die
// Vereinskennung des eigenen Vereins pflegen, ohne die Superadmin-only-
// Modulverwaltung mitzubenötigen (siehe invitations.route.ts:
// PATCH /api/clubs/:id/identity und docs/Plans/dsv7-lenex-import-plan.md
// Abschnitt 3.1).
export function updateClubIdentity(clubId, { nationalID, nationalIDType }) {
  return request(`/api/clubs/${encodeURIComponent(clubId)}/identity`, { method: 'PATCH', body: JSON.stringify({ nationalID, nationalIDType }) });
}
export function createInvitation({ email, role, clubId, athleteId }) {
  return postJson('/api/invitations', { email, role, clubId, athleteId });
}
export function listInvitations() {
  return request('/api/invitations');
}
export function revokeInvitation(id) {
  return request(`/api/invitations/${id}`, { method: 'DELETE' });
}
// Nutzerverwaltung: bestehende Vereinsmitglieder, sortiert nach Rolle
// (admin -> trainer -> athlete) und danach nach Namen. Für admin genügt
// der Aufruf ohne clubId (Server nutzt den eigenen Verein); superadmin
// muss clubId explizit angeben.
export function listClubMembers(clubId) {
  const query = clubId ? `?clubId=${encodeURIComponent(clubId)}` : '';
  return request(`/api/users${query}`);
}
// Trainer:innen + Admins des eigenen Vereins, als mögliche Zuständige für
// ein Handlungsfeld (siehe modules/actionItems.js: openItemModal). Anders
// als listClubMembers() auch für die Rolle "trainer" erreichbar.
export function listAssignableTrainers() {
  return request('/api/users/trainers');
}
// Ersetzt die vollständige Rollenmenge einer Person im eigenen Verein
// (admin, docs/Plans/kampfrichter-modul-plan.md, Abschnitt 1.4) — kein
// Add/Remove-Diff, der Aufrufer schickt immer die Zielmenge. Antwort:
// der aktualisierte öffentliche Nutzer-Datensatz.
export function updateUserRoles(userId, roles) {
  return request(`/api/users/${encodeURIComponent(userId)}/roles`, { method: 'PATCH', body: JSON.stringify({ roles }) });
}

// ---- Qualifikationsmanagement (docs/Plans/nutzer-qualifikationen-plan.md) ---
// Läuft NICHT über die generische Sync-API (siehe dortiger Abschnitt 1.1)
// — eigene REST-Endpunkte, analog Einladungen/Vereinen oben. Antwort:
// { qualifications }.
export function listMyQualifications() {
  return request('/api/me/qualifications');
}
export function listMemberQualifications(userId) {
  return request(`/api/users/${encodeURIComponent(userId)}/qualifications`);
}
export function createQualification(userId, { type, note, acquiredOn, expiresOn, renewalCourseOrganizedOn }) {
  return request(`/api/users/${encodeURIComponent(userId)}/qualifications`, {
    method: 'POST',
    body: JSON.stringify({ type, note, acquiredOn, expiresOn, renewalCourseOrganizedOn }),
  });
}
export function updateQualification(userId, id, patch) {
  return request(`/api/users/${encodeURIComponent(userId)}/qualifications/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
export function deleteQualification(userId, id) {
  return request(`/api/users/${encodeURIComponent(userId)}/qualifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
// Erinnerungs-Schwellen des eigenen Vereins (Plan, Abschnitt 2.4/4.4).
// Antwort: { settings, defaultThresholdsDays }.
export function listQualificationSettings() {
  return request('/api/qualification-settings');
}
export function setQualificationSetting(type, thresholdsDays) {
  return request(`/api/qualification-settings/${encodeURIComponent(type)}`, {
    method: 'PUT',
    body: JSON.stringify({ thresholdsDays }),
  });
}

// ---- Kampfrichter-Modul: Wettkampfeinsätze (docs/kampfrichter-modul-
// plan.md, Abschnitt 5) ---------------------------------------------------
// Läuft NICHT über die generische Sync-API (siehe dortiger Abschnitt 5.1)
// — eigene REST-Endpunkte, analog Qualifikationsmanagement oben. Antwort:
// { assignments }.
export function listMyRefereeAssignments() {
  return request('/api/me/referee-assignments');
}
export function createMyRefereeAssignment({ competitionName, competitionPlace, competitionId, date, function: fn, note }) {
  return request('/api/me/referee-assignments', {
    method: 'POST',
    body: JSON.stringify({ competitionName, competitionPlace, competitionId, date, function: fn, note }),
  });
}
export function updateMyRefereeAssignment(id, patch) {
  return request(`/api/me/referee-assignments/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
}
export function deleteMyRefereeAssignment(id) {
  return request(`/api/me/referee-assignments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
// admin: Verwaltung "im Namen von" einer Kampfrichter:in (Plan Abschnitt 5.5).
export function listMemberRefereeAssignments(userId) {
  return request(`/api/users/${encodeURIComponent(userId)}/referee-assignments`);
}
export function createMemberRefereeAssignment(userId, { competitionName, competitionPlace, competitionId, date, function: fn, note }) {
  return request(`/api/users/${encodeURIComponent(userId)}/referee-assignments`, {
    method: 'POST',
    body: JSON.stringify({ competitionName, competitionPlace, competitionId, date, function: fn, note }),
  });
}
export function updateMemberRefereeAssignment(userId, id, patch) {
  return request(`/api/users/${encodeURIComponent(userId)}/referee-assignments/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
export function deleteMemberRefereeAssignment(userId, id) {
  return request(`/api/users/${encodeURIComponent(userId)}/referee-assignments/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// ---- Sync (Push/Pull) --------------------------------------------------
export function syncPush(events) {
  return postJson('/api/sync/push', { events });
}
export function syncPull(cursor) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return request(`/api/sync/pull${query}`);
}

// ---- Web-Push-Benachrichtigungen (Phase 2, Abschnitt 1.2 —
// docs/Plans/phase2-plan.md) — nicht zu verwechseln mit syncPush() oben
// (Offline-Sync), hier geht es um Browser-Benachrichtigungen.
export function getPushPublicKey() {
  return request('/api/push/public-key');
}
export function subscribePush({ endpoint, keys }) {
  return request('/api/push/subscriptions', { method: 'POST', body: JSON.stringify({ endpoint, keys }) });
}
export function unsubscribePush(endpoint) {
  return request('/api/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint }) });
}

// ---- Eltern-/Erziehungsberechtigten-Zugang (Phase 2, Abschnitt 4.2 —
// docs/Plans/phase2-plan.md) — eigene, stark eingeschränkte REST-Sicht,
// KEIN Sync-Store.
export function getParentOverview() {
  return request('/api/parents/overview');
}
// Admin-Verwaltung der Eltern-Kind-Verknüpfungen.
export function listParentLinks(userId) {
  return request(`/api/parents/${encodeURIComponent(userId)}/links`);
}
export function addParentLink(userId, athleteId) {
  return request(`/api/parents/${encodeURIComponent(userId)}/links`, { method: 'POST', body: JSON.stringify({ athleteId }) });
}
export function removeParentLink(userId, athleteId) {
  return request(`/api/parents/${encodeURIComponent(userId)}/links/${encodeURIComponent(athleteId)}`, { method: 'DELETE' });
}
