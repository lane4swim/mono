// Web-Push-Abo-Verwaltung (Phase 2, Abschnitt 1.6 —
// docs/Plans/phase2-plan.md). Reine Funktionen, kein Modul-Registrierung
// — wird von profile.js eingebunden (Umschalter "Push-Benachrichtigungen
// aktivieren").
import * as api from './apiClient.js';

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// VAPID-Schlüssel kommen vom Server Base64url-kodiert (Web-Push-
// Konvention) — der Browser braucht sie als Uint8Array für
// `applicationServerKey`.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function getExistingPushSubscription() {
  if (!isPushSupported()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

// Fragt Berechtigung an (falls nicht bereits erteilt/verweigert), meldet
// das Abo an den Server. Wirft bei Ablehnung/Fehler — der Aufrufer
// (profile.js) fängt das ab und zeigt einen Hinweis, statt den
// Umschalter stillschweigend wirkungslos zu lassen.
export async function subscribeToPush() {
  if (!isPushSupported()) throw new Error('Push-Benachrichtigungen werden von diesem Browser nicht unterstützt.');

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Berechtigung für Benachrichtigungen wurde nicht erteilt.');

  const { publicKey } = await api.getPushPublicKey();
  if (!publicKey) throw new Error('Der Server ist nicht für Push-Benachrichtigungen konfiguriert.');

  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));

  const json = subscription.toJSON();
  await api.subscribePush({ endpoint: json.endpoint, keys: json.keys });
  return subscription;
}

export async function unsubscribeFromPush() {
  const subscription = await getExistingPushSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await api.unsubscribePush(endpoint);
}
