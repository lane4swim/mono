// apps/web/test/consentVersion.test.js
//
// Review 30.08.2026, Befund S1, Empfehlung 4: „Die Konstante einmalig
// führen … Solange das nicht geschieht, mindestens ein Test, der beide
// Werte vergleicht." Der S1-Fix setzte Empfehlung 1 und 2 um, ersetzte
// Empfehlung 4 aber durch Schema-Tests, die die Divergenz-Gefahr gar
// nicht berühren — beide Konstanten werden weiterhin von Hand gepflegt,
// und KEIN Test verglich sie (jeder bestehende Test benutzt jeweils nur
// eine der beiden). Dieser Test schließt genau diese Lücke.
//
// Warum das seit dem S1-Fix WICHTIGER ist als davor: vorher stempelte der
// Server bei Divergenz still seine eigene Version (der ursprüngliche
// S1-Befund — ein falscher Einwilligungsnachweis, aber die Anmeldung
// funktionierte). Seit LoginRequestSchema `consentVersion` als
// z.literal(CURRENT_CONSENT_VERSION) erzwingt, scheitert bei Divergenz
// JEDE Anmeldung mit einer 400 — ein vollständiger Anmelde-Ausfall für
// alle Nutzer:innen. Der Fix-Abschnitt zu S1 nennt das „einen lauten,
// sofort bemerkten Login-Fehler"; laut ist er allerdings erst in
// PRODUKTION, solange ihn nichts in CI bemerkt.
//
// Dieselbe Technik und derselbe Anlass wie beim bestehenden
// CLUB_SCOPED_STORES-Test in db.test.js: apps/web ist bewusst build-frei
// und kann packages/shared-types zur LAUFZEIT nicht importieren — ein
// TEST darf es aber laden (nur die ausgelieferte App nicht).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CURRENT_CONSENT_VERSION } from '../../../packages/shared-types/src/auth.js';

// state.js wird bewusst als TEXT gelesen statt importiert: ein Import
// zöge die halbe Anwendung (apiClient.js, db.js, i18n.js) samt deren
// Seiteneffekten herein und bräuchte dafür mehrere vi.mock()-Attrappen
// (siehe state.restoreSession.test.js) — eine Attrappe zu viel, und der
// Test bestünde aus dem falschen Grund. Der reguläre Ausdruck liest exakt
// die Zeile, die auch tatsächlich ausgeliefert wird.
const STATE_SOURCE = readFileSync(fileURLToPath(new URL('../js/state.js', import.meta.url)), 'utf8');

describe('CURRENT_CONSENT_VERSION (Review 30.08.2026, Befund S1, Empfehlung 4)', () => {
  it('ist in apps/web/js/state.js und packages/shared-types identisch', () => {
    const match = STATE_SOURCE.match(/export const CURRENT_CONSENT_VERSION = '([^']*)'/);
    expect(match, 'CURRENT_CONSENT_VERSION nicht in apps/web/js/state.js gefunden').not.toBeNull();
    expect(match[1]).toBe(CURRENT_CONSENT_VERSION);
  });
});
