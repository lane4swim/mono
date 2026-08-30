// @vitest-environment jsdom
//
// apps/web/test/i18n.documentLang.test.js
//
// Regressionstest für Review 30.08.2026, Befund U3: setLocale() wechselte
// bislang das Wörterbuch, ohne <html lang> je anzufassen — auf Englisch
// blieb das Dokument als "de" deklariert (Screenreader-Fehlaussprache,
// Browser-Übersetzungsangebot für eine bereits übersetzte Seite).
//
// Eigene Datei statt einer Ergänzung in i18n.test.js: dieser Test braucht
// eine DOM-Umgebung (jsdom), die übrigen i18n-Tests laufen bewusst in der
// schnelleren reinen Node-Umgebung (siehe vitest.config.js).
import { describe, it, expect, afterEach } from 'vitest';
import { setLocale, getLocale } from '../js/i18n.js';

describe('setLocale() — document.documentElement.lang (Befund U3)', () => {
  afterEach(() => { setLocale('de-DE'); });

  it('setzt <html lang> auf die gewählte Locale', () => {
    setLocale('en-US');
    expect(getLocale()).toBe('en-US');
    expect(document.documentElement.lang).toBe('en-US');
  });

  it('aktualisiert <html lang> bei einem erneuten Wechsel zurück', () => {
    setLocale('en-US');
    setLocale('de-DE');
    expect(document.documentElement.lang).toBe('de-DE');
  });

  it('fällt bei einer unbekannten Locale auf Deutsch zurück, auch in <html lang>', () => {
    setLocale('fr-FR');
    expect(getLocale()).toBe('de-DE');
    expect(document.documentElement.lang).toBe('de-DE');
  });
});
