// ============================================================
// apiClient.js — Phase 4 (Frontend-Integration): einziger Ort, an dem das
// Frontend HTTP-Aufrufe an apps/api macht. Kapselt:
//   - Basis-URL-Auflösung (Standard: gleicher Origin, z. B. hinter dem in
//     der Hetzner-Anleitung beschriebenen Nginx-Reverse-Proxy; für lokale
//     Entwicklung gegen `npm run dev:api` überschreibbar über
//     localStorage, siehe setApiBaseUrl())
//   - Access-Token im Speicher (NICHT localStorage — mindert XSS-Risiko,
//     siehe Backend-Entwicklungsplan Abschnitt 5.2), Refresh-Token in
//     localStorage (nötig, um die Sitzung über einen Seiten-Reload hinweg
//     wiederherzustellen; eine echte httpOnly-Cookie-Lösung würde
//     serverseitiges Setzen des Cookies erfordern, was der aktuelle
//     JSON-basierte Refresh-Endpunkt nicht tut — bewusste, dokumentierte
//     Vereinfachung gegenüber der ursprünglichen Planungsskizze)
//   - automatisches, einmaliges Refresh+Retry bei 401
//   - Single-Flight für refreshTokens() (siehe dort) — bündelt mehrere
//     GLEICHZEITIGE Refresh-Auslöser (z. B. runSync()'s push()+pull() oder
//     mehrere parallele Promise.all()-Requests, deren Access Token
//     zeitgleich abläuft) auf GENAU einen tatsächlichen
//     POST /auth/refresh-Aufruf.
// ============================================================
import { t } from './i18n.js';

const API_BASE_URL_KEY = 'lane1-api-base-url';
const REFRESH_TOKEN_KEY = 'lane1-refresh-token';

let accessToken = null;
let accessTokenExpiresAt = 0; // Unix-Millisekunden

// Code-Review, Befund R6: accessTokenExpiresAt wurde bislang nur
// GESCHRIEBEN (in setTokens()/clearTokens()), nirgends gelesen — eine
// angefangene, nie fertiggestellte proaktive Refresh-Logik. Der Puffer
// hier lässt request() unten das Access Token bereits kurz VOR dem
// tatsächlichen Ablauf erneuern, statt ausschließlich auf einen
// tatsächlichen 401 zu warten (siehe dortiger Kommentar) — verringert die
// Zahl der reaktiven 401-Retry-Zyklen im Normalbetrieb und entschärft
// damit Befund S4 (Massen-Logout-Risiko bei gleichzeitigen abgelaufenen
// Requests) zusätzlich, da ein rechtzeitig proaktiv erneuertes Token gar
// nicht erst mehrere parallele 401-Retries auslösen kann.
const PROACTIVE_REFRESH_MARGIN_MS = 10_000;

function isAccessTokenExpiringSoon() {
  return accessToken !== null && Date.now() >= accessTokenExpiresAt - PROACTIVE_REFRESH_MARGIN_MS;
}

export function getApiBaseUrl() {
  return localStorage.getItem(API_BASE_URL_KEY) || '';
}
export function setApiBaseUrl(url) {
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
    return err.message;
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
// Zusätzlich (Befund R6): PROAKTIVER Refresh, wenn das aktuelle Access
// Token laut accessTokenExpiresAt in Kürze abläuft — bewusst VOR dem
// eigentlichen Request, nicht erst nach einem 401. `allowRefreshRetry`
// steuert auch diesen Zweig (nicht nur den reaktiven unten): Aufrufer, die
// bewusst OHNE Refresh-Verhalten arbeiten wollen (z. B. login() — vor dem
// ersten erfolgreichen Login existiert noch gar kein Access Token, die
// Prüfung wäre dort ohnehin ein No-op, aber die Absicht bleibt so an
// einer Stelle konsistent), lösen dadurch auch keinen proaktiven Refresh
// aus. Schlägt der proaktive Versuch fehl (z. B. offline), fängt der
// bestehende reaktive 401-Pfad unten den Fall unverändert ab.
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
      } catch {
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
export async function login({ email, password, consent }) {
  const result = await postJson('/auth/login', { email, password, consent }, { allowRefreshRetry: false });
  setTokens(result);
  return { ...result.user, enabledModules: result.enabledModules };
}

export async function acceptInvitation({ token, name, password, consent }) {
  const result = await postJson('/auth/register', { token, name, password, consent }, { allowRefreshRetry: false });
  setTokens(result);
  return { ...result.user, enabledModules: result.enabledModules };
}

// Code-Review, Befund S4: refreshTokens() bündelt gleichzeitige Aufrufer
// auf GENAU einen In-Flight-Versuch. Ohne dieses Bündeln lösten mehrere
// parallel abgesetzte Requests (typischerweise runSync()'s push()+pull(),
// oder ein modulweites Promise.all() wie in userManagement.js), deren
// Access Token zwischenzeitlich abgelaufen war, jeweils EIGENSTÄNDIG einen
// 401-Retry über request() aus (siehe unten) — jeder rief refreshTokens()
// auf. Serverseitig rotiert der ERSTE dieser Aufrufe das Refresh Token
// (auth.service.ts: refresh()); jeder weitere schickte danach ein bereits
// rotiertes Token und scheiterte, wodurch clearTokens() griff und die
// gesamte — eigentlich noch gültige — Sitzung verworfen wurde, obwohl kein
// echter Auth-Fehler vorlag.
//
// Seit der Reuse-Detection auf dem Server (auth.service.ts: refresh(),
// Befund S2) ist dieses Bündeln nicht mehr nur "lästig", sondern
// SICHERHEITSRELEVANT: ein serverseitig als Wiederverwendung erkanntes,
// bereits rotiertes Token widerruft dort inzwischen ALLE Sitzungen des
// Kontos — ohne dieses Bündeln hätte der zweite, rein durch das eigene
// parallele Anfrageverhalten der App ausgelöste Refresh-Versuch also nicht
// nur die eigene Anfrage scheitern lassen, sondern serverseitig einen
// Massen-Logout ausgelöst, obwohl niemand tatsächlich ein Token gestohlen
// hat.
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

export function getInvitationPreview(token) {
  return request(`/api/invitations/preview/${encodeURIComponent(token)}`, {}, { allowRefreshRetry: false });
}

// ---- Eigenes Profil ----------------------------------------------------
export function getMe() {
  return request('/api/me');
}
export function updateMe(patch) {
  return request('/api/me', { method: 'PATCH', body: JSON.stringify(patch) });
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

// ---- Sync (Push/Pull) --------------------------------------------------
export function syncPush(events) {
  return postJson('/api/sync/push', { events });
}
export function syncPull(cursor) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return request(`/api/sync/pull${query}`);
}
