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
import { IS_DEMO } from './demoMode.js';
import { wipeAll, setClubIdProvider, get, put, clearStore } from './db.js';
import { resetCursor } from './syncClient.js';

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
    await applyEnabledModules(result.enabledModules);
    current = { ...result.user, enabledModules: result.enabledModules };
    setLocale(current?.locale || detectInitialLocale());
    return current;
  } catch {
    api.clearTokens();
    current = null;
    return null;
  }
}

export function getCurrentUser() { return current; }

// db.js kennt state.js bewusst nicht (siehe dortiger Kommentar zum
// Import-Zyklus) — put() dort braucht für neu angelegte, vereins-
// gescopte Datensätze trotzdem die clubId der aktuell eingeloggten
// Person. Diese Registrierung liefert sie ihm, ohne dass db.js selbst
// von state.js abhängen muss.
setClubIdProvider(() => getCurrentUser()?.clubId);
// Fällt bei fehlender Sitzung auf `null` zurück, NICHT auf eine konkrete
// Rolle (vormals 'trainer') — ein Default-Wert sollte im Zweifel
// zusperren, nicht öffnen. 'trainer' hätte defensiv aufgerufenen
// Rollenprüfungen (isTrainerOrAdmin(), visibleModules(role) in router.js)
// stillschweigend Zugriff auf trainer-restringierte Module gewährt, statt
// ihn korrekt zu verweigern. `visibleModules(null)` zeigt weiterhin alle
// Module OHNE Rollenbeschränkung (siehe router.js) — nur die
// rollenbeschränkten werden nun korrekt ausgeblendet statt fälschlich
// gezeigt.
export function getRole() { return current?.role ?? null; }
export function isLoggedIn() { return !!current; }
// Fällt ohne Sitzung auf ein leeres Array zurück (zusperren statt öffnen,
// siehe getRole()-Kommentar oben) — router.js: visibleModules() blendet
// dadurch alle Fach-Module aus, bis eine Sitzung mit enabledModules
// geladen ist.
export function getEnabledModules() { return current?.enabledModules ?? []; }

// Sicherheitsreview 2026-08-27, Befund N5: Paket-Key -> IndexedDB-Store-
// Namen, deren lokal bereits synchronisierte Daten beim Abbestellen des
// Pakets entfernt werden müssen (siehe applyEnabledModules() unten). MUSS
// inhaltlich mit packages/shared-types/src/modules.ts:
// MODULE_PACKAGES[*].stores übereinstimmen — wie ROUTE_TO_PACKAGE in
// router.js kann apps/web dieses Backend-Paket nicht importieren (siehe
// dortiger Kommentar: kein Build-Schritt, direktes Laden als
// Browser-ES-Module).
const MODULE_STORES = {
  athletes: ['athletes', 'groups'],
  competitions: ['competitions', 'entries'],
  times: [],
  plans: ['plans'],
  templates: ['templates'],
  catalog: ['exercises'],
  sessions: ['sessions'],
  actionitems: ['actionItems'],
  stats: [],
};

const ENABLED_MODULES_META_KEY = 'enabledModules';

// Sicherheitsreview 2026-08-27, Befund N5: enabledModules kommt bei jeder
// hier unten aufgerufenen Stelle (Login, Sitzungswiederherstellung,
// Passwort-/E-Mail-Wechsel, Profil-Aktualisierung — überall dort liefert
// das Backend ohnehin den aktuellen Stand mit) frisch vom Server. Der
// letzte lokal bekannte Stand wird dauerhaft in IndexedDB gehalten (nicht
// nur im Speicher, siehe `current` oben) — ein Seiten-Reload NACH einer
// Abbestellung durchläuft `current = null -> neu gesetzt` und würde einen
// rein speicherbasierten Vergleich sonst immer als "erste Sitzung"
// missverstehen, obwohl auf dem Gerät noch der volle Altbestand des
// abbestellten Pakets in der IndexedDB liegt.
//
// Für jedes Paket, das im neuen Stand fehlt, aber im letzten bekannten
// Stand noch enthalten war, werden die zugehörigen Stores geleert und der
// globale Sync-Cursor zurückgesetzt (siehe syncClient.js: resetCursor()
// für die Begründung, warum das nötig ist). Ohne verknüpften bekannten
// Stand (allererste Sitzung auf diesem Gerät nach einem wipeAll(), siehe
// logout()) gibt es nichts zu bereinigen.
async function applyEnabledModules(nextModules) {
  const modules = nextModules ?? [];
  const stored = await get('meta', ENABLED_MODULES_META_KEY);
  const previousModules = stored?.modules ?? null;
  await put('meta', { id: ENABLED_MODULES_META_KEY, modules });
  if (!previousModules) return;

  const removed = previousModules.filter((key) => !modules.includes(key));
  if (removed.length === 0) return;

  for (const key of removed) {
    for (const store of MODULE_STORES[key] ?? []) {
      await clearStore(store);
    }
  }
  await resetCursor();
}

export async function login(email, password, consent) {
  const user = await api.login({ email, password, consent });
  await applyEnabledModules(user.enabledModules);
  current = user;
  setLocale(user.locale || detectInitialLocale());
  emit();
  return user;
}

export async function acceptInvitation(token, name, password, consent) {
  const user = await api.acceptInvitation({ token, name, password, consent });
  await applyEnabledModules(user.enabledModules);
  current = user;
  setLocale(user.locale || detectInitialLocale());
  emit();
  return user;
}

// "Passwort vergessen" (Sicherheitsreview 2026-08, Befund M5) — meldet die
// Person bei Erfolg direkt an, analog zu login()/acceptInvitation() oben
// (der Server liefert bereits ein volles Token-Paar, siehe
// apiClient.js: resetPassword()).
export async function resetPassword(token, newPassword) {
  const user = await api.resetPassword({ token, newPassword });
  await applyEnabledModules(user.enabledModules);
  current = user;
  setLocale(user.locale || detectInitialLocale());
  emit();
  return user;
}

// demo.html: übernimmt eines der beiden festen Konten aus demoMode.js als
// "aktuellen Nutzer" — ohne Backend-Aufruf, analog zu login()/
// acceptInvitation() oben, nur ohne den Netzwerk-Umweg. Kopiert das
// Fixture-Objekt (statt es direkt zu referenzieren), damit spätere lokale
// Änderungen (z. B. über "Mein Profil", siehe updateProfile() unten) nicht
// die gemeinsam genutzte DEMO_USERS-Konstante selbst verändern — sonst
// würde ein bearbeiteter Name/E-Mail beim nächsten Umschalten auf dasselbe
// Konto "kleben bleiben", obwohl ein Seiten-Reload die Demo eigentlich neu
// starten soll.
export function loginDemo(user) {
  if (!IS_DEMO) throw new Error('loginDemo() ist nur im Demo-Modus verfügbar.');
  current = { ...user };
  setLocale(current.locale || detectInitialLocale());
  emit();
  return current;
}

// Widerruft die Sitzung beim Backend und räumt danach ALLE lokal
// zwischengespeicherten Daten auf (IndexedDB) — nicht nur die Tokens.
// Ohne wipeAll() blieben zuvor synchronisierte fachliche Daten (Athleten,
// Notizen, Sessions ...) nach dem Logout unverändert in der Browser-DB
// liegen und wären auf einem geteilten Gerät ohne erneuten Login über
// DevTools auslesbar.
export async function logout() {
  if (IS_DEMO) { current = null; emit(); return; }
  await api.logoutRemote();
  api.clearTokens();
  await wipeAll();
  current = null;
  emit();
}

// Ändert und speichert die bevorzugte Anzeigesprache der/des AKTUELL
// eingeloggten Person. Ruft bewusst NICHT emit() (onUserChange) auf,
// sondern nur setLocale() (onLocaleChange) — sonst würde doppelt neu
// gerendert (siehe app.js' onLocaleChange-Handler, der bereits alles
// aktualisiert, was von der aktiven Person abhängt).
export async function setUserLocale(locale) {
  if (!current) { setLocale(locale); return null; }
  if (IS_DEMO) { current = { ...current, locale }; setLocale(locale); return current; }
  const updated = await api.updateMe({ locale });
  await applyEnabledModules(updated.enabledModules);
  current = updated;
  setLocale(locale);
  return current;
}

// Aktualisiert die eigenen persönlichen Daten der/des AKTUELL eingeloggten
// Person (z. B. Name) — genutzt vom "Mein Profil"-Modul. `email` ist
// bewusst NICHT Teil dieses Patches (siehe changeEmail() unten,
// Sicherheitsreview 2026-08-27, Befund H2). Im Demo-Modus gibt es kein
// Backend, gegen das gespeichert werden könnte — die Änderung wird daher
// nur auf die Im-Speicher-Demo-Person angewendet (siehe loginDemo() oben
// zur Begründung, warum das eine Kopie ist).
export async function updateProfile(patch) {
  if (!current) return null;
  if (IS_DEMO) { current = { ...current, ...patch }; emit(); return current; }
  const updated = await api.updateMe(patch);
  await applyEnabledModules(updated.enabledModules);
  current = updated;
  emit();
  return current;
}

// Passwortwechsel für die AKTUELL eingeloggte Person (Sicherheitsreview
// 2026-08, Befund M5) — genutzt vom "Mein Profil"-Modul. Anders als
// updateProfile() oben KEIN emit(): kein angezeigtes Feld ändert sich
// (Name/E-Mail/Rolle bleiben gleich, nur der Passwort-Hash), ein erneutes
// Rendern der abhängigen UI wäre unnötig — analog zur Begründung bei
// setUserLocale() oben.
export async function changePassword(currentPassword, newPassword) {
  if (!current) return null;
  const updated = await api.changePassword({ currentPassword, newPassword });
  await applyEnabledModules(updated.enabledModules);
  current = updated;
  return current;
}

// E-Mail-Wechsel für die AKTUELL eingeloggte Person (Sicherheitsreview
// 2026-08-27, Befund H2) — genutzt vom "Mein Profil"-Modul. Anders als
// changePassword() MIT emit(): die E-Mail-Adresse ist (anders als der
// Passwort-Hash) ein tatsächlich angezeigtes Feld (Kontodaten-Karte in
// profile.js) — emit() löst über onUserChange() (siehe app.js) das
// automatische Neu-Rendern der aktuellen Ansicht aus, das den neuen Wert
// dort zeigt, analog zu updateProfile() oben.
export async function changeEmail(currentPassword, newEmail) {
  if (!current) return null;
  const updated = await api.changeEmail({ currentPassword, newEmail });
  await applyEnabledModules(updated.enabledModules);
  current = updated;
  emit();
  return current;
}

export function isTrainerOrAdmin() {
  return ['trainer', 'admin', 'superadmin'].includes(getRole());
}
export function isAdmin() { return getRole() === 'admin'; }
export function isSuperAdmin() { return getRole() === 'superadmin'; }
export function isAdminOrSuperAdmin() { return ['admin', 'superadmin'].includes(getRole()); }
