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
import { wipeAll, setClubIdProvider, get, put, clearStore, countAll, CLUB_SCOPED_STORES } from './db.js';
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
    // Sicherheitsreview 2026-08-29, Befund H1 — auch hier, nicht nur bei
    // login(): dasselbe Gerät kann ein Refresh Token einer ANDEREN Person
    // tragen als die zuletzt lokal gespeicherten Daten (z. B. wenn zwei
    // Personen sich abwechselnd anmelden und eine davon den Tab nur
    // geschlossen, nicht abgemeldet hat).
    await ensureLocalStoreBelongsTo(result.user.id);
    await applyEnabledModules(result.enabledModules);
    current = { ...result.user, enabledModules: result.enabledModules, clubNationalID: result.clubNationalID, clubNationalIDType: result.clubNationalIDType };
    setLocale(current?.locale || detectInitialLocale());
    return current;
  } catch (err) {
    // Review 30.08.2026, Befund U4: ein Ratenlimit-Treffer (429) auf
    // /auth/refresh (siehe Befund S2) bedeutet nicht, dass die Sitzung
    // ungültig ist — nur, dass DIESER Wiederherstellungsversuch gerade
    // nicht möglich war (z. B. beim gleichzeitigen Neustart mehrerer
    // Geräte hinter derselben NAT nach einem Netzwerkausfall). Die
    // gespeicherten Tokens bleiben in diesem Fall erhalten, damit ein
    // späterer restoreSession()-Aufruf (erneutes Laden der Seite) die
    // Sitzung noch wiederherstellen kann — nur ein echter Auth-Fehler
    // (Refresh Token ungültig/abgelaufen/widerrufen) räumt sie ab.
    if (!(err instanceof api.ApiError && err.status === 429)) {
      api.clearTokens();
    }
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
// Fällt bei fehlender Sitzung auf ein leeres Array zurück, NICHT auf eine
// konkrete Rolle (vormals 'trainer') — ein Default-Wert sollte im Zweifel
// zusperren, nicht öffnen. 'trainer' hätte defensiv aufgerufenen
// Rollenprüfungen (isTrainerOrAdmin(), visibleModules(roles) in router.js)
// stillschweigend Zugriff auf trainer-restringierte Module gewährt, statt
// ihn korrekt zu verweigern. `visibleModules([])` zeigt weiterhin alle
// Kern-Module OHNE Rollenbeschränkung (siehe router.js) — nur die
// rollenbeschränkten werden nun korrekt ausgeblendet statt fälschlich
// gezeigt.
//
// docs/kampfrichter-modul-plan.md, Abschnitt 1: ein Konto kann mehrere
// Rollen gleichzeitig haben — getRoles() ersetzt das frühere getRole().
export function getRoles() { return current?.roles ?? []; }
export function hasRole(role) { return getRoles().includes(role); }
export function isLoggedIn() { return !!current; }
// Fällt ohne Sitzung auf ein leeres Array zurück (zusperren statt öffnen,
// siehe getRoles()-Kommentar oben) — router.js: visibleModules() blendet
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

// Sicherheitsreview 2026-08-29, Befund H1: Schlüssel im 'meta'-Store, unter
// dem die User-ID hinterlegt wird, zu der der aktuelle Inhalt der lokalen
// IndexedDB gehört.
//
// Vorgeschichte: logout() unten räumt die lokale Ablage per wipeAll() auf
// — genau dafür wurde es eingeführt. Es gibt aber mehrere Wege, auf denen
// eine Sitzung endet, OHNE dass logout() je läuft:
//   - restoreSession() schlägt fehl, weil das Refresh Token abgelaufen
//     ist oder serverseitig widerrufen wurde (Passwort-/E-Mail-Wechsel auf
//     einem anderen Gerät, Reuse-Detection in auth.service.ts: refresh(),
//     Kontolöschung) — die Funktion räumt dann nur die Tokens weg und
//     zeigt den Login-Bildschirm,
//   - der Browser/das Gerät wird schlicht geschlossen und später von einer
//     anderen Person geöffnet.
// In beiden Fällen blieb der VOLLSTÄNDIGE gesynchte Vereinsbestand der
// vorherigen Person in der IndexedDB liegen, und login() räumte ihn nicht
// auf. Da alle Module ihre Daten über getAll(<store>) lesen — ohne jeden
// clubId-/Rollenfilter, siehe db.js — bekam die NÄCHSTE angemeldete
// Person diesen Altbestand vollständig angezeigt. Zwei Ausprägungen:
//   - vereinsübergreifend: auf einem geteilten Gerät (Vereinsheim-Tablet,
//     Poolrand-Gerät, ein die Vereine wechselnder Trainer) sah Verein B
//     die Athlet:innen, Notizen, Pläne und Anwesenheiten von Verein A;
//   - rollenübergreifend und praktisch näherliegend: meldet sich auf dem
//     Tablet einer Trainerin anschließend eine Athlet:in an, sieht sie
//     genau die Felder, die der Server für ihre Rolle gezielt redigiert
//     (athletes.notes, sessions.trainerNote, fremde attendance-Zeilen,
//     birthdate/gender/joinDate fremder Personen — siehe
//     sync.athleteScope.ts). Die serverseitige Redaktion war damit lokal
//     vollständig ausgehebelt.
//
// Fix: die lokale Ablage ist ab jetzt an GENAU EINE Identität gebunden.
// Wechselt sie, wird vorher vollständig aufgeräumt. Bewusst an der
// User-ID festgemacht, nicht an der clubId: auch ein Rollenwechsel
// INNERHALB eines Vereins (Trainerin -> Athlet:in auf demselben Gerät)
// ist genau der Fall, den die zweite Ausprägung oben beschreibt.
const LOCAL_STORE_OWNER_META_KEY = 'localStoreOwner';

// Liegen überhaupt fachliche (vereinsgebundene) Daten lokal? Wird nur für
// den Sonderfall "kein Eigentümer vermerkt" unten gebraucht.
async function hasLocalClubScopedData() {
  // Ineffizienz-Korrektur: die zehn count()-Abfragen liefen zuvor streng
  // NACHEINANDER, jede mit einer eigenen IndexedDB-Transaktion. Sie sind
  // voneinander unabhängig, laufen also parallel — und im Normalfall
  // (frisches Gerät, alle Stores leer) wurden ohnehin alle zehn gebraucht,
  // der frühe Abbruch sparte dort nichts. countAll() liest keine
  // Datensätze, nur deren Anzahl (siehe db.js), der Aufruf ist also auch
  // bei vollem Bestand billig.
  const counts = await Promise.all([...CLUB_SCOPED_STORES].map(countAll));
  return counts.some((count) => count > 0);
}

// Stellt sicher, dass die lokale Ablage zur übergebenen Person gehört —
// andernfalls wird sie vollständig geleert. Muss VOR
// applyEnabledModules() laufen (das schreibt selbst in 'meta', was
// wipeAll() sonst gleich wieder verwerfen würde) und wird deshalb von
// allen vier Stellen aufgerufen, an denen eine Identität NEU gesetzt
// wird: restoreSession(), login(), acceptInvitation() und
// resetPassword(). changePassword()/changeEmail() unten brauchen es
// bewusst NICHT — dort ist die Person bereits angemeldet, die Identität
// (user.id) ändert sich nicht, nur ihre Zugangsdaten.
//
// Kein vermerkter Eigentümer bedeutet "Herkunft unbekannt" — das trifft
// sowohl ein fabrikneues Gerät (nichts zu verlieren) als auch eine
// Installation aus der Zeit VOR dieser Korrektur (deren Bestand genau der
// oben beschriebene, ungeklärte Altbestand ist). Deshalb wird auch dann
// geleert, aber nur, wenn tatsächlich fachliche Daten vorliegen — der
// Normalfall (frisches Gerät, leere Ablage) verliert dadurch nichts.
//
// Der Preis ist in beiden Fällen derselbe wie bei logout(): noch nicht
// hochgeladene Offline-Änderungen der VORHERIGEN Person gehen verloren.
// Das ist bewusst so gewählt — die Alternative wäre, fremde
// personenbezogene Daten sichtbar zu lassen, und die Sync-Warteschlange
// der vorherigen Person ist ohnehin nur mit deren Zugangsdaten
// hochladbar (der Server weist jedes Event mit fremder clubId zurück,
// siehe sync.service.ts: requireOwnClub).
async function ensureLocalStoreBelongsTo(userId) {
  const stored = await get('meta', LOCAL_STORE_OWNER_META_KEY);
  const owner = stored?.userId ?? null;
  if (owner === userId) return;

  // wipeAll() leert ALLE Stores, 'meta' eingeschlossen (siehe STORES in
  // db.js) — der Sync-Cursor verschwindet damit automatisch mit, ein
  // zusätzlicher resetCursor() wäre wirkungslose Doppelung. Der nächste
  // pull() startet dadurch ohne Cursor, zieht also den vollständigen
  // Bestand des NEUEN Vereins — genau das Gewünschte.
  if (owner !== null || (await hasLocalClubScopedData())) {
    await wipeAll();
  }
  await put('meta', { id: LOCAL_STORE_OWNER_META_KEY, userId });
}

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
  // Review 30.08.2026, Befund S1: die Version, der zugestimmt wird, kommt
  // von hier — derselben Konstante, die authScreens.js im Einwilligungstext
  // anzeigt (t('auth.consentLabel', { version: CURRENT_CONSENT_VERSION })).
  // Der Server (LoginRequestSchema) lässt nur seine eigene, tagesaktuelle
  // Fassung durch; driften beide Konstanten auseinander, scheitert der
  // Login hier sichtbar, statt den Nachweis stillschweigend falsch zu
  // protokollieren.
  const user = await api.login({ email, password, consent, consentVersion: CURRENT_CONSENT_VERSION });
  // Sicherheitsreview 2026-08-29, Befund H1 — siehe
  // ensureLocalStoreBelongsTo(): räumt die lokale Ablage auf, falls sie
  // noch einer anderen Person gehört.
  await ensureLocalStoreBelongsTo(user.id);
  await applyEnabledModules(user.enabledModules);
  current = user;
  setLocale(user.locale || detectInitialLocale());
  emit();
  return user;
}

export async function acceptInvitation(token, name, password, consent) {
  const user = await api.acceptInvitation({ token, name, password, consent });
  // Sicherheitsreview 2026-08-29, Befund H1 — siehe
  // ensureLocalStoreBelongsTo(): räumt die lokale Ablage auf, falls sie
  // noch einer anderen Person gehört.
  await ensureLocalStoreBelongsTo(user.id);
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
  // Sicherheitsreview 2026-08-29, Befund H1 — siehe
  // ensureLocalStoreBelongsTo(): räumt die lokale Ablage auf, falls sie
  // noch einer anderen Person gehört.
  await ensureLocalStoreBelongsTo(user.id);
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

// Aktualisiert NUR den lokalen Session-Cache (current) nach einem
// erfolgreichen api.updateClubIdentity()-Aufruf (siehe modules/
// userManagement.js) — die eigentliche Persistierung ist zu diesem
// Zeitpunkt bereits über PATCH /api/clubs/:id/identity erfolgt, hier geht
// es nur darum, dass ein sofort danach gestarteter Ergebnisimport
// (modules/resultsImportUI.js: matchOwnClub()) die neue Vereinskennung
// ohne Neuanmeldung sieht.
export function setClubIdentity(nationalID, nationalIDType) {
  if (!current) return null;
  current = { ...current, clubNationalID: nationalID, clubNationalIDType: nationalIDType };
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
  return getRoles().some((r) => ['trainer', 'admin', 'superadmin'].includes(r));
}
export function isAdmin() { return hasRole('admin'); }
export function isSuperAdmin() { return hasRole('superadmin'); }
export function isAdminOrSuperAdmin() { return getRoles().some((r) => ['admin', 'superadmin'].includes(r)); }

// Analog zu isAthleteScoped() im Backend (sync.permissions.ts): die
// eigene, schreibgeschützte "nur meine Daten"-Ansicht (sessions.js,
// dashboard.js, actionItems.js) gilt nur, wenn die Person die Rolle
// "athlete" hat UND KEINE Staff-Rolle ("trainer"/"admin") — sonst würde
// z. B. ein Konto mit roles: ['trainer','athlete'] fälschlich auf die
// eingeschränkte Athlet:innen-Ansicht verwiesen, obwohl die Trainer-Rolle
// vollen Zugriff verleiht (docs/kampfrichter-modul-plan.md, Abschnitt 1.5).
export function isAthleteScoped() {
  return hasRole('athlete') && !isTrainerOrAdmin();
}
