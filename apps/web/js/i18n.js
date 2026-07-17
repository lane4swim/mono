// ============================================================
// i18n.js — translation engine.
//
// Design goals (see README "Mehrsprachigkeit" section for details):
//  - Adding a new language = add one file under js/i18n/<locale>.js
//    and register it in LOCALES below. No other file needs to change.
//  - Every lookup falls back gracefully: missing key in the active
//    locale -> German ("de-DE", the app's original/reference locale)
//    -> the key itself (so a missing translation never crashes the
//    UI, it just shows something readable-ish instead of blank).
//  - Reference-data labels (event names, categories, statuses, …)
//    are translated via trLabel()/trCode()/trOptions() so the
//    *stored* values in athletes/results/plans etc. never change
//    when the display language changes — only how they're shown.
// ============================================================
import de_DE from './i18n/de-DE.js';
import en_US from './i18n/en-US.js';

// Registry of available locales. To add a language: write a new
// dictionary file (copy de-DE.js as a starting point, it's the most
// complete one) and add one line here.
export const LOCALES = {
  'de-DE': { label: 'Deutsch', flag: '🇩🇪', dict: de_DE },
  'en-US': { label: 'English', flag: '🇺🇸', dict: en_US },
};
const FALLBACK_LOCALE = 'de-DE';
const STORAGE_KEY = 'lane1-locale';

let currentLocale = FALLBACK_LOCALE;
const listeners = [];

export function getAvailableLocales() {
  return Object.entries(LOCALES).map(([code, meta]) => ({ code, label: meta.label, flag: meta.flag }));
}

export function getLocale() { return currentLocale; }

export function setLocale(locale) {
  if (!LOCALES[locale]) locale = FALLBACK_LOCALE;
  currentLocale = locale;
  try { localStorage.setItem(STORAGE_KEY, locale); } catch (e) { /* ignore (private mode etc.) */ }
  listeners.forEach(fn => fn(currentLocale));
}

// Called once at boot, before a user is necessarily known: browser
// language -> previously stored choice -> German.
export function detectInitialLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && LOCALES[stored]) return stored;
  } catch (e) { /* ignore */ }
  const nav = (navigator.language || '').toLowerCase();
  if (nav.startsWith('en')) return 'en-US';
  if (nav.startsWith('de')) return 'de-DE';
  return FALLBACK_LOCALE;
}

export function onLocaleChange(fn) { listeners.push(fn); }

function lookup(dict, path) {
  return path.split('.').reduce((node, key) => (node && node[key] !== undefined ? node[key] : undefined), dict);
}

// Main translation function. `key` is a dot-path like "athletes.title".
// `vars` (optional) fills in {placeholders} inside the string, e.g.
// t('athletes.deleteConfirm', { name: 'Mara Vogel' }).
export function t(key, vars) {
  let str = lookup(LOCALES[currentLocale]?.dict, key);
  if (str === undefined) str = lookup(LOCALES[FALLBACK_LOCALE]?.dict, key);
  if (str === undefined) return key;
  if (vars) {
    Object.entries(vars).forEach(([k, v]) => { str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), v); });
  }
  return str;
}

// ---- Reference-data label helpers -----------------------------------
// `category` is a key under refdata.* in the dictionaries, e.g. "courses",
// "exerciseCategories", "events", "strokes". `list` is the original
// refdata.js array (used only as a fallback source of German labels).

export function trCode(code, category) {
  if (code === null || code === undefined || code === '') return code;
  const map = LOCALES[currentLocale]?.dict?.refdata?.[category];
  if (map && map[code] !== undefined) return map[code];
  const fallbackMap = LOCALES[FALLBACK_LOCALE]?.dict?.refdata?.[category];
  if (fallbackMap && fallbackMap[code] !== undefined) return fallbackMap[code];
  return code;
}

export function trLabel(list, value, category) {
  if (value === null || value === undefined || value === '') return value;
  const map = LOCALES[currentLocale]?.dict?.refdata?.[category];
  if (map && map[value] !== undefined) return map[value];
  const original = (list || []).find(o => o.value === value)?.label;
  return original ?? value;
}

// Builds {value,label} option lists for <select> from refdata.js
// value/label arrays, with the label translated for the active locale.
export function trOptions(list, category) {
  return (list || []).map(o => ({ value: o.value, label: trLabel(list, o.value, category) }));
}

// Same, but for flat string arrays (EVENTS, STROKES) where the string
// itself is both the stored value and the (German) fallback label.
export function trOptionsFlat(list, category) {
  return (list || []).map(code => ({ value: code, label: trCode(code, category) }));
}
