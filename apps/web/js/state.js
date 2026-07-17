// ============================================================
// state.js — Phase 4: echte Sitzungsverwaltung über apps/api statt
// des früheren, rein lokalen Profil-Umschalters. Die aktuelle
// Nutzer-Identität kommt jetzt vom Backend (Login/Refresh/`/api/me`),
// nicht mehr aus dem lokalen `users`-Store — dieser dient weiterhin als
// Offline-Cache für fachliche Daten (siehe syncClient.js), aber nicht
// mehr als Quelle für "wer bin ich".
//
// DSGVO-Einwilligung: wird jetzt direkt als Teil des Login-/
// Registrierungsformulars abgefragt (siehe modules/authScreens.js) —
// nicht mehr als nachträgliches Modal wie in der vorherigen,
// rein lokalen Version. `login()`/`acceptInvitation()` unten geben die
// Einwilligung 1:1 an das Backend weiter, das sie serverseitig erzwingt
// (siehe packages/shared-types/src/auth.ts: consent-Pflichtfeld).
// ============================================================
import * as api from './apiClient.js';
import { setLocale, detectInitialLocale } from './i18n.js';

// Muss inhaltlich mit CURRENT_CONSENT_VERSION im Backend
// (packages/shared-types/src/auth.ts) übereinstimmen — nur zur Anzeige
// auf dem Login-/Registrierungsformular (die eigentliche Durchsetzung
// erfolgt serverseitig).
export const CURRENT_CONSENT_VERSION = '2026-07-15';

let current = null;
const listeners = [];

export function onUserChange(fn) { listeners.push(fn); }
function emit() { for (const fn of listeners) fn(current); }

// Versucht, eine bestehende Sitzung wiederherzustellen (z. B. nach einem
// Seiten-Reload) — über das in localStorage gespeicherte Refresh Token.
// Liefert den Nutzer zurück, wenn erfolgreich, sonst null (dann zeigt
// app.js den Login-Bildschirm).
export async function restoreSession() {
  if (!api.getStoredRefreshToken()) return null;
  try {
    const result = await api.refreshTokens();
    current = result.user;
    setLocale(current?.locale || detectInitialLocale());
    return current;
  } catch {
    api.clearTokens();
    current = null;
    return null;
  }
}

export function getCurrentUser() { return current; }
export function getRole() { return current?.role || 'trainer'; }
export function isLoggedIn() { return !!current; }

export async function login(email, password, consent) {
  const user = await api.login({ email, password, consent });
  current = user;
  setLocale(user.locale || detectInitialLocale());
  emit();
  return user;
}

export async function acceptInvitation(token, name, password, consent) {
  const user = await api.acceptInvitation({ token, name, password, consent });
  current = user;
  setLocale(user.locale || detectInitialLocale());
  emit();
  return user;
}

export async function logout() {
  await api.logoutRemote();
  api.clearTokens();
  current = null;
  emit();
}

// Changes and persists the *current* user's preferred display language.
// Note: this intentionally does NOT call emit() (onUserChange) — only
// setLocale() (onLocaleChange), to avoid a double-render (see app.js's
// onLocaleChange handler, which already refreshes everything that
// depends on the active user).
export async function setUserLocale(locale) {
  if (!current) { setLocale(locale); return null; }
  current = await api.updateMe({ locale });
  setLocale(locale);
  return current;
}

// Updates the *current* user's own personal data (e.g. name, email) —
// used by the "Mein Profil" / "My Profile" module.
export async function updateProfile(patch) {
  if (!current) return null;
  current = await api.updateMe(patch);
  emit();
  return current;
}

export function isTrainerOrAdmin() {
  return ['trainer', 'admin', 'superadmin'].includes(getRole());
}
export function isAdmin() { return getRole() === 'admin'; }
export function isSuperAdmin() { return getRole() === 'superadmin'; }
export function isAdminOrSuperAdmin() { return ['admin', 'superadmin'].includes(getRole()); }
