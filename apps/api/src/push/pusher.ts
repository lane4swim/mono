// Versand-Abstraktion für Web-Push (Phase 2, Abschnitt 1.2/1.4 —
// docs/Plans/phase2-plan.md), strukturgleich zu mail/mailer.ts:
// MailSender — ein Interface, gegen das die Jobs/Routen arbeiten, plus
// austauschbare Implementierungen (pusher.webpush.ts fürs echte
// Versenden, pusher.memory.ts für Tests, pusher.console.ts als
// Ausweichlösung ohne VAPID-Schlüssel).
export interface PushPayload {
  title: string;
  body: string;
  // Relative Route fürs Frontend, z. B. "#/announcements/<id>" — der
  // notificationclick-Handler im Service Worker (apps/web/sw.js) öffnet/
  // fokussiert einen Tab und navigiert dorthin.
  url?: string;
}

export interface PushSubscriptionTarget {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSendResult {
  // IDs der Abos, deren Versand mit einem dauerhaften Fehler (HTTP 404/410
  // vom Push-Dienst — der Browser-Endpoint ist clientseitig nicht mehr
  // gültig) scheiterte. Der Aufrufer löscht diese Zeilen (siehe
  // push.repository.ts) — Aufräumen bei Gelegenheit statt eines
  // separaten Cron-Jobs.
  expiredSubscriptionIds: string[];
}

export interface PushSender {
  // Verschickt an ALLE übergebenen Abos einer Person (mehrere Geräte).
  // Ein einzelner fehlgeschlagener Versand (falsches/abgelaufenes Gerät)
  // darf die übrigen nicht verhindern — die Implementierung sammelt
  // Fehler je Abo, statt beim ersten zu werfen.
  send(subscriptions: readonly PushSubscriptionTarget[], payload: PushPayload): Promise<PushSendResult>;
}
