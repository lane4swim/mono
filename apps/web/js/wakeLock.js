// Screen Wake Lock (Issue #78): verhindert, dass der Bildschirm während des
// Wettkampf-/Trainingsmodus in den Schlafmodus wechselt — beide Modi sind
// für den Einsatz am Beckenrand gedacht, wo niemand zwischen zwei Läufen/
// Sätzen Zeit hat, den Bildschirm manuell wieder einzuschalten.
//
// Zentral hier statt je einmal in competitionLive.js/planLive.js: die
// Screen Wake Lock API released den Sentinel automatisch, sobald der Tab
// unsichtbar wird (Bildschirm gesperrt, App gewechselt) — `wanted` merkt
// sich unabhängig vom (dann bereits null gewordenen) `sentinel`, dass ein
// Lock weiterhin gewünscht ist, damit visibilitychange ihn beim
// Zurückkehren automatisch erneuert, statt dass der Bildschirm beim
// nächsten Sperren dauerhaft ungeschützt bliebe.
let sentinel = null;
let wanted = false;

function isSupported() {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

async function requestSentinel() {
  if (!isSupported() || typeof document === 'undefined' || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => { sentinel = null; });
  } catch {
    // Ablehnung (kein sichtbares Dokument, Browser-Richtlinie o. Ä.) ist
    // kein Fehlerfall, der den Wettkampf-/Trainingsmodus stören sollte —
    // der Bildschirm schläft dann ggf. trotzdem ein, aber die App bleibt
    // benutzbar.
    sentinel = null;
  }
}

// Von renderLiveMode() in competitionLive.js/planLive.js beim Betreten
// aufgerufen. Nicht await-pflichtig für den Aufrufer — ein Fehlschlagen
// darf das Rendern der Ansicht nicht blockieren.
export async function acquireWakeLock() {
  wanted = true;
  await requestSentinel();
}

// Zentral von shell.js: renderRoute() bei JEDEM Routenwechsel aufgerufen
// (nicht nur beim Verlassen von Wettkampf-/Trainingsmodus), sodass ein
// gehaltener Lock nie über das Verlassen der Live-Ansicht hinaus bestehen
// bleibt — ein danach aufgerufenes Modul, das selbst keinen Lock will,
// muss davon nichts wissen.
export function releaseWakeLock() {
  wanted = false;
  const current = sentinel;
  sentinel = null;
  if (current && !current.released) current.release().catch(() => {});
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (wanted && document.visibilityState === 'visible' && !sentinel) requestSentinel();
  });
}
