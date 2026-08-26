// apps/web/test/i18n.test.js
//
// Testet js/i18n.js::t() — bislang ungetestet. Deckt Befund C6
// (Code-Review) ab.
import { describe, it, expect } from 'vitest';
import { t, LOCALES } from '../js/i18n.js';

// Flacht ein verschachteltes Wörterbuch (wie de-DE.js/en-US.js) zu einer
// Liste von Punkt-Pfaden ab, z. B. { athletes: { title: 'X' } } ->
// ['athletes.title']. Arrays (z. B. help.gdprDataList) gelten dabei als
// EIN Blattwert, nicht als weitere Verschachtelungsebene — dieselbe
// Unterscheidung, die lookup() in i18n.js selbst trifft.
function flattenKeys(dict, prefix = '') {
  const keys = [];
  for (const [key, value] of Object.entries(dict)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...flattenKeys(value, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

describe('t() — Platzhalter-Ersetzung', () => {
  it('setzt einen einfachen Wert für {name} ein', () => {
    expect(t('athletes.deleteConfirm', { name: 'Mara Vogel' })).toBe(
      'Mara Vogel wirklich löschen? Zugehörige Zeiten/Notizen bleiben erhalten, verweisen aber ins Leere.',
    );
  });

  // Regressionstest für Befund C6 (Code-Review): String.prototype.replace()
  // interpretiert bei einem STRING als Ersetzung Sonderzeichen wie "$&"
  // (steht für "der gesamte Treffer") — ein Name mit "$&" wäre bislang
  // fälschlich verdoppelt worden, statt den Platzhalter einfach zu
  // ersetzen. Der Fix nutzt eine Ersetzungs-Funktion, für die "$&" nur
  // gewöhnlicher Text ist.
  it('behandelt "$&" im eingesetzten Wert als gewöhnlichen Text (nicht als Sonderzeichen)', () => {
    expect(t('athletes.deleteConfirm', { name: 'Mara $& Vogel' })).toBe(
      'Mara $& Vogel wirklich löschen? Zugehörige Zeiten/Notizen bleiben erhalten, verweisen aber ins Leere.',
    );
  });

  it('fällt bei unbekanntem Key auf den Key selbst zurück', () => {
    expect(t('does.not.exist')).toBe('does.not.exist');
  });

  // Regressionstest für Befund P8 (Code-Review): die Umstellung auf einen
  // einzigen Durchlauf mit fester RegExp (statt einer neuen RegExp pro
  // Variable) darf das Verhalten bei mehreren Platzhaltern in einem
  // String nicht verändern — alle drei müssen weiterhin korrekt und
  // unabhängig voneinander ersetzt werden.
  it('ersetzt mehrere verschiedene Platzhalter in einem String korrekt', () => {
    expect(t('auth.acceptInviteIntro', { role: 'Trainer:in', club: 'SV Wasserfreunde', email: 'a@b.de' })).toBe(
      'Du wurdest als Trainer:in für "SV Wasserfreunde" eingeladen (a@b.de). Bitte lege ein Passwort fest, um dein Konto zu aktivieren.',
    );
  });

  it('lässt einen Platzhalter unverändert stehen, für den `vars` keinen eigenen Schlüssel enthält', () => {
    expect(t('auth.acceptInviteIntro', { role: 'Trainer:in', club: 'SV Wasserfreunde' })).toBe(
      'Du wurdest als Trainer:in für "SV Wasserfreunde" eingeladen ({email}). Bitte lege ein Passwort fest, um dein Konto zu aktivieren.',
    );
  });
});

// t() fällt bei einem in der aktiven Locale fehlenden Schlüssel still auf
// Deutsch zurück (siehe i18n.js: lookup()) — ein in de-DE.js ergänzter,
// in en-US.js vergessener Schlüssel fiele dadurch NIRGENDS als Fehler
// auf, sondern erschiene der englischen Oberfläche einfach als
// deutscher Text. Dieser Test schließt genau diese Lücke: er prüft für
// JEDE registrierte Locale (nicht nur für en-US — automatisch auch für
// eine künftige dritte Sprache), dass ihr Wörterbuch exakt dieselben
// Schlüssel trägt wie 'de-DE', das app-eigene Referenz-/Fallback-Gebietsschema.
describe('Vollständigkeit der Sprachdateien', () => {
  const referenceLocale = 'de-DE';
  const referenceKeys = flattenKeys(LOCALES[referenceLocale].dict).sort();

  for (const locale of Object.keys(LOCALES)) {
    if (locale === referenceLocale) continue;

    it(`${locale} hat exakt dieselben Schlüssel wie ${referenceLocale}`, () => {
      const keys = flattenKeys(LOCALES[locale].dict).sort();
      expect(keys).toEqual(referenceKeys);
    });
  }
});
