// ============================================================
// demoSeed.js — fixture data for demo.html.
//
// Writes only through db.js's normal put()/bulkPut() API, so it lands
// in the demo-only IndexedDB (see db.js: DB_NAME switches based on
// demoMode.js: IS_DEMO) — never anywhere near the real app's data.
// Every club-scoped record is tagged with DEMO_CLUB_ID, and Maya Vogel's
// athlete record uses the fixed DEMO_ATHLETE_ID_MAYA id so her demo
// account (see demoMode.js: DEMO_USERS) resolves to it.
//
// Loosely mirrors seed.js's fixture (same shape of data, so the app
// looks "lived in" from the first screen), but trimmed down and without
// its meta-marker/wipe machinery — that machinery exists there to keep a
// real, synced account clean if someone resets to demo data and later
// logs in for real; here that scenario can't happen at all (separate
// database), so there's nothing to guard against.
// ============================================================
import { bulkPut, wipeAll, getAll, uid } from './db.js';
import { todayISO, isoAddDays, startOfWeek, toIsoDateTime } from './dates.js';
import { DEMO_CLUB_ID, DEMO_ATHLETE_ID_MAYA } from './demoMode.js';

function id() { return uid('demo'); }

async function seedDemoClubData() {
  const groupA = { id: id(), clubId: DEMO_CLUB_ID, name: 'Leistungsgruppe', description: 'Wettkampforientierte Athlet:innen, 6–8 Einheiten/Woche' };
  const groupB = { id: id(), clubId: DEMO_CLUB_ID, name: 'Nachwuchs', description: 'Aufbaugruppe, Technik- und Grundlagenausbildung' };
  await bulkPut('groups', [groupA, groupB]);

  const athleteDefs = [
    { id: DEMO_ATHLETE_ID_MAYA, firstName: 'Maya', lastName: 'Vogel', birthdate: '2009-03-14', gender: 'w', groupId: groupA.id, joinDate: '2019-08-01', active: true, notes: '' },
    { firstName: 'Jonas', lastName: 'Brandt', birthdate: '2008-11-02', gender: 'm', groupId: groupA.id, joinDate: '2018-02-15', active: true, notes: 'Schwerpunkt Sprint' },
    { firstName: 'Elif', lastName: 'Kaya', birthdate: '2010-06-22', gender: 'w', groupId: groupA.id, joinDate: '2020-01-10', active: true, notes: '' },
    { firstName: 'Lukas', lastName: 'Weber', birthdate: '2011-09-05', gender: 'm', groupId: groupB.id, joinDate: '2021-09-01', active: true, notes: '' },
    { firstName: 'Nele', lastName: 'Schuster', birthdate: '2012-01-30', gender: 'w', groupId: groupB.id, joinDate: '2022-03-01', active: true, notes: '' },
  ];
  const athletes = athleteDefs.map(a => ({ ...a, id: a.id || id(), clubId: DEMO_CLUB_ID, birthdate: toIsoDateTime(a.birthdate), joinDate: toIsoDateTime(a.joinDate) }));
  await bulkPut('athletes', athletes);
  const [maya, jonas, elif] = athletes;

  const comp1 = { id: id(), clubId: DEMO_CLUB_ID, name: 'Bezirksmeisterschaften Kurzbahn', date: toIsoDateTime(isoAddDays(todayISO(), 21)), location: 'Hallenbad Nord', course: 'SCM', notes: 'Meldeschluss 10 Tage vorher' };
  const comp2 = { id: id(), clubId: DEMO_CLUB_ID, name: 'Vereinsvergleich Frühjahr', date: toIsoDateTime(isoAddDays(todayISO(), -18)), location: 'Freibad Ost', course: 'LCM', notes: '' };
  await bulkPut('competitions', [comp1, comp2]);

  // Sample historical + recent results to power stats/PBs, incl. Maya
  // Vogel (the demo athlete account) so her Dashboard/Zeiten views aren't
  // empty on first look.
  const resultSeed = [];
  const pastDates = [-120, -90, -60, -30, -18, -5];
  const eventsPerAthlete = { [maya.id]: ['100 Freistil', '200 Lagen'], [jonas.id]: ['50 Freistil', '100 Freistil'], [elif.id]: ['100 Brust', '200 Brust'] };
  for (const [athleteId, evts] of Object.entries(eventsPerAthlete)) {
    for (const evt of evts) {
      let base = evt.includes('50') ? 30 : evt.includes('200') ? 140 : 65;
      pastDates.forEach((offset, i) => {
        base -= (Math.random() * 0.6 + 0.2); // gradual improvement
        resultSeed.push({
          id: id(), clubId: DEMO_CLUB_ID, athleteId, event: evt, time: Math.max(base, 20),
          date: toIsoDateTime(isoAddDays(todayISO(), offset)), course: 'LCM',
          competitionId: i === pastDates.length - 1 ? comp2.id : null,
          place: Math.ceil(Math.random() * 8), isPB: i === pastDates.length - 1,
        });
      });
    }
  }
  await bulkPut('results', resultSeed);

  const exercises = [
    { name: 'Kraulbeine mit Brett', category: 'kick', stroke: 'Freistil', description: 'Beinarbeit isoliert mit Schwimmbrett, Fokus auf Hüftrotation.', defaultDistance: 200, tags: ['aufwärmen'], equipment: ['brett'] },
    { name: '6-Schlag-Drill', category: 'technik', stroke: 'Freistil', description: 'Kraul mit betonter 6-Schlag-Beinachse pro Armzug.', defaultDistance: 100, tags: ['technik'], equipment: [] },
    { name: 'Wendenserie', category: 'start-wende', stroke: 'Freistil', description: 'Kraulwenden mit Abstoß und Unterwasserphase, je 15m Anschwimmen.', defaultDistance: 25, tags: ['wende'], equipment: [] },
    { name: 'Startsprünge', category: 'start-wende', stroke: 'Freistil', description: 'Blockstarts mit Reaktionszeitmessung, 15m Ausschwimmen.', defaultDistance: 15, tags: ['start'], equipment: ['startblock'] },
    { name: 'Sprints 25m all-out', category: 'sprint', stroke: 'Freistil', description: 'Maximale Sprints mit voller Erholung dazwischen.', defaultDistance: 25, tags: ['sprint'], equipment: ['paddles', 'kurzflossen'] },
    { name: 'Fahrtspiel 400', category: 'ausdauer', stroke: 'Freistil', description: '400m im Wechsel 50 locker / 50 zügig.', defaultDistance: 400, tags: ['ausdauer'], equipment: [] },
    { name: 'Trockenkraft Rumpf', category: 'kraft', stroke: null, description: 'Zirkel: Plank, Superman, Seitstütz, je 3 Runden.', defaultDistance: null, tags: ['land'], equipment: ['medizinball'] },
  ].map(e => ({ id: id(), clubId: DEMO_CLUB_ID, ...e }));
  await bulkPut('exercises', exercises);
  const kickboardEx = exercises.find(e => e.name === 'Kraulbeine mit Brett');
  const sprintEx = exercises.find(e => e.name === 'Sprints 25m all-out');

  const template1 = {
    id: id(), clubId: DEMO_CLUB_ID, name: 'Grundlagenausdauer – Standardwoche', description: 'Klassische GA1/GA2-Einheit für die Basisperiode.',
    tags: ['ausdauer', 'basis'],
    sets: [
      { kind: 'set', id: id(), description: 'Einschwimmen gemischt', distance: 400, reps: 1, intensity: 'locker', restSec: 0 },
      { kind: 'set', id: id(), description: '8x100 Freistil', distance: 100, reps: 8, intensity: 'ga1', restSec: 20 },
      { kind: 'set', id: id(), description: '4x50 Beine', distance: 50, reps: 4, intensity: 'locker', restSec: 15, exerciseId: kickboardEx.id },
      { kind: 'set', id: id(), description: 'Ausschwimmen', distance: 200, reps: 1, intensity: 'locker', restSec: 0 },
    ],
  };
  const template2 = {
    id: id(), clubId: DEMO_CLUB_ID, name: 'Sprint & Wenden', description: 'Kurze, intensive Serien mit Fokus auf Renntempo.',
    tags: ['sprint', 'wettkampf'],
    sets: [
      { kind: 'set', id: id(), description: 'Einschwimmen', distance: 300, reps: 1, intensity: 'locker', restSec: 0 },
      {
        kind: 'block', id: id(), label: 'Hauptserie Sprint', repeatCount: 3,
        sets: [
          { kind: 'set', id: id(), description: '2x25 Sprint ab Wende', distance: 25, reps: 2, intensity: 'sprint', restSec: 30, exerciseId: sprintEx.id },
          { kind: 'set', id: id(), description: '50 locker ausschwimmen', distance: 50, reps: 1, intensity: 'locker', restSec: 20 },
        ],
      },
      { kind: 'set', id: id(), description: '4x50 Renntempo', distance: 50, reps: 4, intensity: 'renotempo', restSec: 40 },
      { kind: 'set', id: id(), description: 'Ausschwimmen locker', distance: 150, reps: 1, intensity: 'locker', restSec: 0 },
    ],
  };
  await bulkPut('templates', [template1, template2]);

  function cloneSets(sets) {
    return sets.map(s => s.kind === 'block'
      ? { ...s, id: id(), sets: (s.sets || []).map(x => ({ ...x, id: id() })) }
      : { ...s, id: id() });
  }

  const wkStart = startOfWeek(todayISO());
  const plan1 = {
    id: id(), clubId: DEMO_CLUB_ID, name: 'Trainingswoche ' + wkStart, weekStart: toIsoDateTime(wkStart), groupId: groupA.id, status: 'aktiv',
    days: [
      { date: toIsoDateTime(wkStart), sets: cloneSets(template1.sets) },
      { date: toIsoDateTime(isoAddDays(wkStart, 2)), sets: cloneSets(template2.sets) },
      { date: toIsoDateTime(isoAddDays(wkStart, 4)), sets: cloneSets(template1.sets) },
    ],
  };
  await bulkPut('plans', [plan1]);

  const session1 = {
    id: id(), clubId: DEMO_CLUB_ID, date: toIsoDateTime(wkStart), groupId: groupA.id, planId: plan1.id, trainerNote: 'Gute Energie, Fokus auf Wenden verbessert.',
    attendance: athletes.filter(a => a.groupId === groupA.id).map(a => ({ athleteId: a.id, present: true, rpe: 6 + Math.round(Math.random() * 3), note: '' })),
  };
  const session2 = {
    id: id(), clubId: DEMO_CLUB_ID, date: toIsoDateTime(isoAddDays(wkStart, -7)), groupId: groupA.id, planId: null, trainerNote: 'Eine Athletin krank gemeldet.',
    attendance: athletes.filter(a => a.groupId === groupA.id).map((a, i) => ({ athleteId: a.id, present: i !== 1, rpe: i !== 1 ? 7 : null, note: i === 1 ? 'Krankheit' : '' })),
  };
  await bulkPut('sessions', [session1, session2]);

  const actionItems = [
    { athleteId: maya.id, title: 'Wettkampf-Nervosität', description: 'Zeigt vor Wettkämpfen erhöhte Anspannung. Mentale Routine erarbeiten.', status: 'progress', category: 'mental', createdDate: isoAddDays(todayISO(), -14), dueDate: isoAddDays(todayISO(), 14) },
    { athleteId: jonas.id, title: 'Atemtechnik bei Sprints', description: 'Neigt zum Luftanhalten in den letzten 15m. Bilaterales Atmen in Drills festigen.', status: 'offen', category: 'technik', createdDate: isoAddDays(todayISO(), -5), dueDate: isoAddDays(todayISO(), 25) },
  ].map(a => ({ id: id(), clubId: DEMO_CLUB_ID, ...a, createdDate: toIsoDateTime(a.createdDate), dueDate: toIsoDateTime(a.dueDate) }));
  await bulkPut('actionItems', actionItems);
}

// Nur beim allerersten Aufruf der Demo (leere Datenbank) automatisch
// geseedet — jeder weitere Aufruf (z. B. nach einem Reload) ist ein No-op
// und lässt bereits im Verlauf der Demo vorgenommene Änderungen unberührt.
export async function ensureDemoDataSeeded() {
  const existing = await getAll('athletes');
  if (existing.length === 0) await seedDemoClubData();
}

// "Auf Demo-Daten zurücksetzen" (Einstellungen) — wirft alle während der
// Demo vorgenommenen Änderungen weg und lädt die Ausgangsdaten neu.
export async function resetDemoClubData() {
  await wipeAll();
  await seedDemoClubData();
}
