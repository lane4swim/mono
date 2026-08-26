// ============================================================
// demoMode.js — shared "am I running as demo.html?" signal plus the
// fixed demo fixtures (two accounts, one clubId). Every other infra
// module that needs to behave differently in the demo (db.js: separate
// IndexedDB so demo data can never mix with a real, synced account;
// state.js: local-only "login"; syncClient.js's only caller,
// modules/syncQueue.js: no real network sync) branches on IS_DEMO
// instead of each re-implementing its own detection.
//
// IS_DEMO is derived once, synchronously, from the URL — this file
// (like every other js/*.js file) is only ever loaded from either
// index.html or demo.html, never both in the same page load, so a
// simple pathname check is enough and needs no runtime toggle.
// ============================================================

import { MODULE_KEYS } from './router.js';

export const IS_DEMO = location.pathname.endsWith('/demo.html') || location.pathname === '/demo.html';

// Fester Wert, unter dem alle geseedeten Demo-Datensätze abgelegt werden
// (siehe db.js: put() trägt ihn automatisch bei jedem neu angelegten
// fachlichen Datensatz ein). Bewusst ein String statt der Zahl 0: db.js
// prüft den aktuellen clubId-Wert mit `if (clubId)`, unter dem die Zahl
// 0 (falsy) durchfallen würde und neu angelegte Demo-Datensätze ohne
// clubId zurückließe — als String bleibt "0" wahr und identifiziert die
// Demo-Daten trotzdem eindeutig als "Verein 0".
export const DEMO_CLUB_ID = '0';

// Fixe id, unter der Maya Vogels Athletenprofil im Store 'athletes'
// angelegt wird (siehe demoSeed.js) — muss mit DEMO_USERS[*].athleteId
// unten übereinstimmen, damit die athletenbezogenen Ansichten (Dashboard,
// Einheiten, Handlungsfelder, …) für ihr Konto die richtigen Daten finden.
export const DEMO_ATHLETE_ID_MAYA = 'demo-athlete-maya';

// Die beiden Demo-Konten, zwischen denen im Dropdown neben der
// Sprachauswahl umgeschaltet werden kann. Kein Passwort, keine
// Backend-Anbindung — state.js: loginDemo() übernimmt eines dieser
// Objekte 1:1 als "aktuellen Nutzer", genau wie ein echtes Login das vom
// Server gelieferte Nutzerobjekt übernimmt.
// Beide Demo-Konten haben ALLE Module aktiv (MODULE_KEYS) — die Demo soll
// den vollen Funktionsumfang zeigen, inkl. des Wettkampfmoduls, auch wenn
// echte Vereine künftig einzelne Module abgewählt haben könnten (siehe
// router.js: visibleModules()).
export const DEMO_USERS = [
  {
    id: 'demo-user-sabine',
    name: 'Sabine Reuter',
    email: 'sabine.reuter@demo.lane1.app',
    role: 'trainer',
    clubId: DEMO_CLUB_ID,
    athleteId: null,
    locale: null,
    enabledModules: MODULE_KEYS,
  },
  {
    id: 'demo-user-maya',
    name: 'Maya Vogel',
    email: 'maya.vogel@demo.lane1.app',
    role: 'athlete',
    clubId: DEMO_CLUB_ID,
    athleteId: DEMO_ATHLETE_ID_MAYA,
    locale: null,
    enabledModules: MODULE_KEYS,
  },
];
