// ============================================================
// seed.js — one-time demo data so the app isn't empty on first
// launch. Safe to call repeatedly: it checks isDbEmpty() first.
// Also exposes resetDemoData() for the settings panel.
// ============================================================
import { getAll, put, bulkPut, uid, isDbEmpty, wipeAll } from './db.js';
import { todayISO, isoAddDays, startOfWeek } from './utils.js';
import { EVENTS } from './refdata.js';

function id(){ return uid('seed'); }

export async function seedIfEmpty() {
  if (!(await isDbEmpty())) return false;
  await seedDemoData();
  return true;
}

export async function resetDemoData() {
  await wipeAll();
  await seedDemoData();
}

async function seedDemoData() {
  const groupA = { id: id(), name: 'Leistungsgruppe', description: 'Wettkampforientierte Athlet:innen, 6–8 Einheiten/Woche' };
  const groupB = { id: id(), name: 'Nachwuchs', description: 'Aufbaugruppe, Technik- und Grundlagenausbildung' };
  await bulkPut('groups', [groupA, groupB]);

  const athletes = [
    { firstName: 'Mara', lastName: 'Vogel', birthdate: '2009-03-14', gender: 'w', groupId: groupA.id, joinDate: '2019-08-01', active: true, notes: '' },
    { firstName: 'Jonas', lastName: 'Brandt', birthdate: '2008-11-02', gender: 'm', groupId: groupA.id, joinDate: '2018-02-15', active: true, notes: 'Schwerpunkt Sprint' },
    { firstName: 'Elif', lastName: 'Kaya', birthdate: '2010-06-22', gender: 'w', groupId: groupA.id, joinDate: '2020-01-10', active: true, notes: '' },
    { firstName: 'Lukas', lastName: 'Weber', birthdate: '2011-09-05', gender: 'm', groupId: groupB.id, joinDate: '2021-09-01', active: true, notes: '' },
    { firstName: 'Nele', lastName: 'Schuster', birthdate: '2012-01-30', gender: 'w', groupId: groupB.id, joinDate: '2022-03-01', active: true, notes: '' },
    { firstName: 'Finn', lastName: 'Hartmann', birthdate: '2011-04-18', gender: 'm', groupId: groupB.id, joinDate: '2021-05-20', active: true, notes: 'Rückenschwimmen ausbauen' },
  ].map(a => ({ id: id(), ...a }));
  await bulkPut('athletes', athletes);

  // Phase 4: lokale Fake-Konten (users/clubs/invitations) werden NICHT mehr
  // geseedet — Login erfolgt jetzt über das echte Backend (apps/api).
  // Um die App auszuprobieren, ein echtes Konto per
  // `npm run create-superadmin` (siehe apps/api) sowie Vereins-/Team-
  // Einladungen über die Nutzerverwaltung anlegen. Die hier weiterhin
  // geseedeten fachlichen Demo-Daten (Athlet:innen, Wettkämpfe, Übungen,
  // Trainingspläne, …) dienen als Offline-Cache-Inhalt, sobald ein echtes
  // Konto verbunden ist.

  const comp1 = { id: id(), name: 'Bezirksmeisterschaften Kurzbahn', date: isoAddDays(todayISO(), 21), location: 'Hallenbad Nord', course: 'SCM', notes: 'Meldeschluss 10 Tage vorher' };
  const comp2 = { id: id(), name: 'Vereinsvergleich Frühjahr', date: isoAddDays(todayISO(), -18), location: 'Freibad Ost', course: 'LCM', notes: '' };
  await bulkPut('competitions', [comp1, comp2]);

  // Sample historical + recent results to power stats/PBs
  const resultSeed = [];
  const pastDates = [-120, -90, -60, -30, -18, -5];
  const eventsPerAthlete = { [athletes[0].id]: ['100 Freistil', '200 Lagen'], [athletes[1].id]: ['50 Freistil', '100 Freistil'], [athletes[2].id]: ['100 Brust', '200 Brust'] };
  for (const [athleteId, evts] of Object.entries(eventsPerAthlete)) {
    for (const evt of evts) {
      let base = evt.includes('50') ? 30 : evt.includes('200') ? 140 : 65;
      pastDates.forEach((offset, i) => {
        base -= (Math.random() * 0.6 + 0.2); // gradual improvement
        resultSeed.push({
          id: id(), athleteId, event: evt, time: Math.max(base, 20),
          date: isoAddDays(todayISO(), offset), course: 'LCM',
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
    { name: 'Brustbeinarbeit am Brett', category: 'kick', stroke: 'Brust', description: 'Isolierte Brustbeinarbeit, Fokus auf Peitschenbewegung.', defaultDistance: 200, tags: [], equipment: ['brett'] },
    { name: 'Fahrtspiel 400', category: 'ausdauer', stroke: 'Freistil', description: '400m im Wechsel 50 locker / 50 zügig.', defaultDistance: 400, tags: ['ausdauer'], equipment: [] },
    { name: 'Sprints 25m all-out', category: 'sprint', stroke: 'Freistil', description: 'Maximale Sprints mit voller Erholung dazwischen.', defaultDistance: 25, tags: ['sprint'], equipment: ['paddles', 'kurzflossen'] },
    { name: 'Lagenwechsel-Drill', category: 'koordination', stroke: 'Lagen', description: '4x25 je Lage mit Fokus auf Übergänge.', defaultDistance: 100, tags: [], equipment: [] },
    { name: 'Bilaterales Atmen', category: 'atmung', stroke: 'Freistil', description: 'Kraul mit Atmung alle 3 Züge zur Symmetrieschulung.', defaultDistance: 200, tags: ['technik'], equipment: ['schnorchel'] },
    { name: 'Trockenkraft Rumpf', category: 'kraft', stroke: null, description: 'Zirkel: Plank, Superman, Seitstütz, je 3 Runden.', defaultDistance: null, tags: ['land'], equipment: ['medizinball'] },
  ].map(e => ({ id: id(), ...e }));
  await bulkPut('exercises', exercises);
  const kickboardEx = exercises.find(e => e.name === 'Kraulbeine mit Brett');
  const sprintEx = exercises.find(e => e.name === 'Sprints 25m all-out');

  const template1 = {
    id: id(), name: 'Grundlagenausdauer – Standardwoche', description: 'Klassische GA1/GA2-Einheit für die Basisperiode.',
    tags: ['ausdauer', 'basis'],
    sets: [
      { kind: 'set', id: id(), description: 'Einschwimmen gemischt', distance: 400, reps: 1, intensity: 'locker', restSec: 0 },
      { kind: 'set', id: id(), description: '8x100 Freistil', distance: 100, reps: 8, intensity: 'ga1', restSec: 20 },
      { kind: 'set', id: id(), description: '4x50 Beine', distance: 50, reps: 4, intensity: 'locker', restSec: 15, exerciseId: kickboardEx.id },
      { kind: 'set', id: id(), description: 'Ausschwimmen', distance: 200, reps: 1, intensity: 'locker', restSec: 0 },
    ],
  };
  const template2 = {
    id: id(), name: 'Sprint & Wenden', description: 'Kurze, intensive Serien mit Fokus auf Renntempo.',
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

  // cloneSets() deliberately preserves exerciseId when copying a set (only
  // ids of the set/block wrapper itself are refreshed) — this mirrors
  // cloneItems() in setEditor.js and keeps the catalog link (and therefore
  // the equipment display) intact when a template is applied to a plan day.
  function cloneSets(sets) {
    return sets.map(s => s.kind === 'block'
      ? { ...s, id: id(), sets: (s.sets || []).map(x => ({ ...x, id: id() })) }
      : { ...s, id: id() });
  }

  const wkStart = startOfWeek(todayISO());
  const plan1 = {
    id: id(), name: 'Trainingswoche ' + wkStart, weekStart: wkStart, groupId: groupA.id, status: 'aktiv',
    days: [
      { date: wkStart, sets: cloneSets(template1.sets) },
      { date: isoAddDays(wkStart, 2), sets: cloneSets(template2.sets) },
      { date: isoAddDays(wkStart, 4), sets: cloneSets(template1.sets) },
    ],
  };
  await bulkPut('plans', [plan1]);

  const session1 = {
    id: id(), date: wkStart, groupId: groupA.id, planId: plan1.id, trainerNote: 'Gute Energie, Fokus auf Wenden verbessert.',
    attendance: athletes.filter(a => a.groupId === groupA.id).map(a => ({ athleteId: a.id, present: true, rpe: 6 + Math.round(Math.random() * 3), note: '' })),
  };
  const session2 = {
    id: id(), date: isoAddDays(wkStart, -7), groupId: groupA.id, planId: null, trainerNote: 'Eine Athletin krank gemeldet.',
    attendance: athletes.filter(a => a.groupId === groupA.id).map((a, i) => ({ athleteId: a.id, present: i !== 2, rpe: i !== 2 ? 7 : null, note: i === 2 ? 'Krankheit' : '' })),
  };
  await bulkPut('sessions', [session1, session2]);

  const actionItems = [
    { athleteId: athletes[1].id, title: 'Atemtechnik bei Sprints', description: 'Neigt zum Luftanhalten in den letzten 15m. Bilaterales Atmen in Drills festigen.', status: 'progress', category: 'technik', createdDate: isoAddDays(todayISO(), -14), dueDate: isoAddDays(todayISO(), 14) },
    { athleteId: athletes[5].id, title: 'Rückenlage stabilisieren', description: 'Hüfte sinkt bei längeren Rückenserien ab. Rumpfkraft priorisieren.', status: 'offen', category: 'technik', createdDate: isoAddDays(todayISO(), -5), dueDate: isoAddDays(todayISO(), 25) },
    { athleteId: athletes[0].id, title: 'Wettkampf-Nervosität', description: 'Zeigt vor Wettkämpfen erhöhte Anspannung. Mentale Routine erarbeiten.', status: 'offen', category: 'mental', createdDate: isoAddDays(todayISO(), -3), dueDate: isoAddDays(todayISO(), 20) },
  ].map(a => ({ id: id(), ...a }));
  await bulkPut('actionItems', actionItems);
}
