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
// ============================================================

const API_BASE_URL_KEY = 'lane1-api-base-url';
const REFRESH_TOKEN_KEY = 'lane1-refresh-token';

let accessToken = null;
let accessTokenExpiresAt = 0; // Unix-Millisekunden

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
export function hasAccessToken() {
  return !!accessToken;
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
async function request(path, options = {}, { allowRefreshRetry = true } = {}) {
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
export async function login({ email, password, consent }) {
  const result = await postJson('/auth/login', { email, password, consent }, { allowRefreshRetry: false });
  setTokens(result);
  return result.user;
}

export async function acceptInvitation({ token, name, password, consent }) {
  const result = await postJson('/auth/register', { token, name, password, consent }, { allowRefreshRetry: false });
  setTokens(result);
  return result.user;
}

export async function refreshTokens() {
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
export function createClub({ name, adminEmail, adminName }) {
  return postJson('/api/clubs', { name, adminEmail, adminName });
}
export function listClubs() {
  return request('/api/clubs');
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

// ---- Sync (Push/Pull) --------------------------------------------------
export function syncPush(events) {
  return postJson('/api/sync/push', { events });
}
export function syncPull(cursor) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return request(`/api/sync/pull${query}`);
}
