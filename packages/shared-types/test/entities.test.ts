// packages/shared-types/test/entities.test.ts
import { describe, it, expect } from 'vitest';
import {
  GroupSchema,
  AthleteSchema,
  CompetitionSchema,
  StartlistEntrySchema,
  ResultSchema,
  ExerciseSchema,
  SetEntrySchema,
  TemplateSchema,
  PlanSchema,
  TrainingSessionSchema,
  ActionItemSchema,
  CommentSchema,
  ENTITY_SCHEMAS,
} from '../src/entities.js';
import { SyncStoreSchema } from '../src/syncEvent.js';

const CLUB_ID = '11111111-1111-1111-1111-111111111111';
const ATHLETE_ID = '22222222-2222-2222-2222-222222222222';
const TRAINER_ID = '33333333-3333-3333-3333-333333333331';
const now = new Date().toISOString();

describe('GroupSchema', () => {
  it('akzeptiert eine gültige Gruppe', () => {
    const group = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'Leistungsgruppe', description: '', createdAt: now, updatedAt: now };
    expect(GroupSchema.safeParse(group).success).toBe(true);
  });
  it('lehnt einen leeren Namen ab', () => {
    const group = { id: ATHLETE_ID, clubId: CLUB_ID, name: '', description: '', createdAt: now, updatedAt: now };
    expect(GroupSchema.safeParse(group).success).toBe(false);
  });

  // Regressionstest für die Code-Review-Korrektur: freie Textfelder waren
  // vormals unbegrenzt lang.
  it('lehnt einen Namen über 200 Zeichen ab', () => {
    const group = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'x'.repeat(201), description: '', createdAt: now, updatedAt: now };
    expect(GroupSchema.safeParse(group).success).toBe(false);
  });
  it('akzeptiert einen Namen mit genau 200 Zeichen', () => {
    const group = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'x'.repeat(200), description: '', createdAt: now, updatedAt: now };
    expect(GroupSchema.safeParse(group).success).toBe(true);
  });
});

describe('AthleteSchema', () => {
  const valid = {
    id: ATHLETE_ID, clubId: CLUB_ID, firstName: 'Mara', lastName: 'Vogel',
    birthdate: '2009-03-14T00:00:00.000Z', gender: 'w', groupId: null,
    joinDate: '2019-08-01T00:00:00.000Z', active: true, notes: '',
    createdAt: now, updatedAt: now,
  };
  it('akzeptiert ein vollständiges Athletenprofil', () => {
    expect(AthleteSchema.safeParse(valid).success).toBe(true);
  });
  it('akzeptiert birthdate/groupId: null', () => {
    expect(AthleteSchema.safeParse({ ...valid, birthdate: null, groupId: null }).success).toBe(true);
  });
  it('lehnt ein ungültiges Geschlecht ab', () => {
    expect(AthleteSchema.safeParse({ ...valid, gender: 'x' }).success).toBe(false);
  });
  it('lehnt einen leeren Nachnamen ab', () => {
    expect(AthleteSchema.safeParse({ ...valid, lastName: '' }).success).toBe(false);
  });

  // Regressionstest für die Code-Review-Korrektur: "notes" ist das Feld
  // mit dem größten dokumentierten Bedarf (laufende Trainer:innen-Notizen
  // über die gesamte Karriere) und trägt deshalb ein deutlich höheres
  // Limit als die übrigen Freitextfelder — aber eben nicht "unbegrenzt".
  it('lehnt "notes" über 10000 Zeichen ab', () => {
    expect(AthleteSchema.safeParse({ ...valid, notes: 'x'.repeat(10001) }).success).toBe(false);
  });
  it('akzeptiert "notes" mit genau 10000 Zeichen', () => {
    expect(AthleteSchema.safeParse({ ...valid, notes: 'x'.repeat(10000) }).success).toBe(true);
  });
});

describe('CompetitionSchema', () => {
  const valid = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'Bezirksmeisterschaften', date: now, location: 'Hallenbad Nord', course: 'SCM', notes: '', createdAt: now, updatedAt: now };
  it('akzeptiert einen gültigen Wettkampf', () => {
    expect(CompetitionSchema.safeParse(valid).success).toBe(true);
  });
  it('lehnt eine ungültige Bahnlänge ab', () => {
    expect(CompetitionSchema.safeParse({ ...valid, course: '25m' }).success).toBe(false);
  });
});

describe('StartlistEntrySchema', () => {
  const valid = {
    id: ATHLETE_ID, clubId: CLUB_ID, competitionId: CLUB_ID, athleteId: ATHLETE_ID,
    event: '100 Freistil', eventNumber: '12', heat: 3, lane: 4, seedTime: 62.35,
    createdAt: now, updatedAt: now,
  };
  it('akzeptiert einen vollständigen Startlisteneintrag', () => {
    expect(StartlistEntrySchema.safeParse(valid).success).toBe(true);
  });
  it('akzeptiert heat/lane/seedTime: null (noch nicht zugewiesen)', () => {
    expect(StartlistEntrySchema.safeParse({ ...valid, heat: null, lane: null, seedTime: null }).success).toBe(true);
  });
});

describe('ResultSchema', () => {
  const valid = {
    id: ATHLETE_ID, clubId: CLUB_ID, athleteId: ATHLETE_ID, event: '100 Freistil',
    time: 62.35, date: now, course: 'LCM', competitionId: null, place: 1, isPB: true,
    createdAt: now, updatedAt: now,
  };
  it('akzeptiert ein gültiges Ergebnis ohne Rundenzeiten', () => {
    expect(ResultSchema.safeParse(valid).success).toBe(true);
  });
  it('akzeptiert Rundenzeiten (laps)', () => {
    expect(ResultSchema.safeParse({ ...valid, laps: [28.45, 59.8, 62.35] }).success).toBe(true);
  });
  it('lehnt eine negative/Null-Zeit ab', () => {
    expect(ResultSchema.safeParse({ ...valid, time: 0 }).success).toBe(false);
    expect(ResultSchema.safeParse({ ...valid, time: -5 }).success).toBe(false);
  });

  // Regressionstest für Befund S7 (Code-Review): Array-Felder waren
  // bislang unbegrenzt lang, obwohl jedes freie Textfeld längst ein
  // `.max(...)` trägt (siehe Dateikopf).
  it('lehnt mehr als 500 Rundenzeiten ab', () => {
    expect(ResultSchema.safeParse({ ...valid, laps: Array(501).fill(1) }).success).toBe(false);
  });
  it('akzeptiert genau 500 Rundenzeiten', () => {
    expect(ResultSchema.safeParse({ ...valid, laps: Array(500).fill(1) }).success).toBe(true);
  });
});

describe('CommentSchema', () => {
  const valid = { id: 'c1', authorName: 'Sabine Reuter', text: 'Bitte auf die Wende achten.', createdAt: now };
  it('akzeptiert einen gültigen Kommentar', () => {
    expect(CommentSchema.safeParse(valid).success).toBe(true);
  });
  it('lehnt einen leeren Text ab', () => {
    expect(CommentSchema.safeParse({ ...valid, text: '' }).success).toBe(false);
  });
  it('lehnt einen leeren Autorennamen ab', () => {
    expect(CommentSchema.safeParse({ ...valid, authorName: '' }).success).toBe(false);
  });
  it('lehnt unbekannte Zusatzfelder ab (.strict())', () => {
    expect(CommentSchema.safeParse({ ...valid, authorUserId: '123' }).success).toBe(false);
  });
});

describe('ExerciseSchema', () => {
  const valid = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'Kraulbeine mit Brett', category: 'kick', stroke: 'Freistil', description: '', defaultDistance: 200, tags: ['aufwärmen'], equipment: ['brett'], comments: [], createdAt: now, updatedAt: now };
  it('akzeptiert eine vollständige Übung', () => {
    expect(ExerciseSchema.safeParse(valid).success).toBe(true);
  });
  it('akzeptiert stroke: null (schwimmlagen-unabhängig, z. B. Trockentraining)', () => {
    expect(ExerciseSchema.safeParse({ ...valid, stroke: null }).success).toBe(true);
  });
  it('fehlt "comments" ganz, wird ein leeres Array angenommen (Rückwärtskompatibilität mit älteren Datensätzen)', () => {
    const { comments: _comments, ...withoutComments } = valid;
    const parsed = ExerciseSchema.safeParse(withoutComments);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.comments).toEqual([]);
  });
  it('akzeptiert Kommentare im Übungskatalog', () => {
    const withComment = { ...valid, comments: [{ id: 'c1', authorName: 'Jonas Beck', text: 'Auf Handstellung achten.', createdAt: now }] };
    expect(ExerciseSchema.safeParse(withComment).success).toBe(true);
  });
  it('lehnt einen fehlerhaften Kommentar ab (leerer Text)', () => {
    const withBadComment = { ...valid, comments: [{ id: 'c1', authorName: 'Jonas Beck', text: '', createdAt: now }] };
    expect(ExerciseSchema.safeParse(withBadComment).success).toBe(false);
  });

  // Regressionstest für Befund S7 (Code-Review).
  it('lehnt mehr als 50 Tags/Ausrüstungsgegenstände sowie mehr als 500 Kommentare ab', () => {
    expect(ExerciseSchema.safeParse({ ...valid, tags: Array(51).fill('x') }).success).toBe(false);
    expect(ExerciseSchema.safeParse({ ...valid, equipment: Array(51).fill('x') }).success).toBe(false);
    const manyComments = Array.from({ length: 501 }, (_, i) => ({ id: `c${i}`, authorName: 'X', text: 'x', createdAt: now }));
    expect(ExerciseSchema.safeParse({ ...valid, comments: manyComments }).success).toBe(false);
  });
});

describe('SetEntrySchema (Sätze & Wiederholungsblöcke)', () => {
  it('akzeptiert einen einzelnen Satz', () => {
    const set = { kind: 'set', id: 's1', description: '8x100 Freistil', distance: 100, reps: 8, intensity: 'ga1', restSec: 20 };
    expect(SetEntrySchema.safeParse(set).success).toBe(true);
  });
  it('akzeptiert einen Wiederholungsblock mit verschachtelten Sätzen', () => {
    const block = {
      kind: 'block', id: 'b1', label: 'Hauptserie', repeatCount: 3,
      sets: [{ kind: 'set', id: 's1', description: 'Sprint', distance: 25, reps: 2, intensity: 'sprint', restSec: 30 }],
    };
    expect(SetEntrySchema.safeParse(block).success).toBe(true);
  });
  it('lehnt einen Block ab, der selbst wieder Blöcke enthält (keine Verschachtelung erlaubt)', () => {
    const invalidBlock = {
      kind: 'block', id: 'b1', label: 'X', repeatCount: 2,
      sets: [{ kind: 'block', id: 'b2', label: 'Y', repeatCount: 2, sets: [] }],
    };
    expect(SetEntrySchema.safeParse(invalidBlock).success).toBe(false);
  });
  it('lehnt einen unbekannten "kind"-Wert ab', () => {
    expect(SetEntrySchema.safeParse({ kind: 'unknown' }).success).toBe(false);
  });
  it('akzeptiert Kommentare an einem einzelnen Satz (auch innerhalb eines Blocks)', () => {
    const set = { kind: 'set', id: 's1', description: '8x100 Freistil', distance: 100, reps: 8, intensity: 'ga1', restSec: 20, comments: [{ id: 'c1', authorName: 'Mara Vogel', text: 'War heute sehr anstrengend.', createdAt: now }] };
    expect(SetEntrySchema.safeParse(set).success).toBe(true);
    const block = {
      kind: 'block', id: 'b1', label: 'Hauptserie', repeatCount: 3,
      sets: [{ kind: 'set', id: 's1', description: 'Sprint', distance: 25, reps: 2, intensity: 'sprint', restSec: 30, comments: [{ id: 'c2', authorName: 'Trainer X', text: 'Guter Antritt.', createdAt: now }] }],
    };
    expect(SetEntrySchema.safeParse(block).success).toBe(true);
  });

  // Regressionstest für Befund S7 (Code-Review).
  it('lehnt mehr als 200 Kommentare an einem Satz sowie mehr als 50 Sätze in einem Block ab', () => {
    const manyComments = Array.from({ length: 201 }, (_, i) => ({ id: `c${i}`, authorName: 'X', text: 'x', createdAt: now }));
    const setWithTooManyComments = { kind: 'set', id: 's1', description: 'X', distance: 100, reps: 1, intensity: 'ga1', restSec: 0, comments: manyComments };
    expect(SetEntrySchema.safeParse(setWithTooManyComments).success).toBe(false);

    const oneSet = { kind: 'set', id: 's1', description: 'X', distance: 100, reps: 1, intensity: 'ga1', restSec: 0 };
    const blockWithTooManySets = { kind: 'block', id: 'b1', label: 'X', repeatCount: 1, sets: Array(51).fill(oneSet) };
    expect(SetEntrySchema.safeParse(blockWithTooManySets).success).toBe(false);
  });
});

describe('TemplateSchema', () => {
  it('akzeptiert eine Vorlage mit gemischten Sätzen/Blöcken', () => {
    const template = {
      id: ATHLETE_ID, clubId: CLUB_ID, name: 'Grundlagenausdauer', description: '', tags: ['ausdauer'],
      sets: [
        { kind: 'set', id: 's1', description: 'Einschwimmen', distance: 400, reps: 1, intensity: 'locker', restSec: 0 },
        { kind: 'block', id: 'b1', label: 'Hauptserie', repeatCount: 3, sets: [] },
      ],
      createdAt: now, updatedAt: now,
    };
    expect(TemplateSchema.safeParse(template).success).toBe(true);
  });

  // Regressionstest für Befund S7 (Code-Review).
  it('lehnt mehr als 50 Tags sowie mehr als 200 Sätze/Blöcke ab', () => {
    const base = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'X', description: '', createdAt: now, updatedAt: now };
    expect(TemplateSchema.safeParse({ ...base, tags: Array(51).fill('x'), sets: [] }).success).toBe(false);
    const oneSet = { kind: 'set', id: 's1', description: 'X', distance: 100, reps: 1, intensity: 'ga1', restSec: 0 };
    expect(TemplateSchema.safeParse({ ...base, tags: [], sets: Array(201).fill(oneSet) }).success).toBe(false);
  });
});

describe('PlanSchema', () => {
  it('akzeptiert einen Trainingsplan mit mehreren Tagen', () => {
    const plan = {
      id: ATHLETE_ID, clubId: CLUB_ID, name: 'Trainingswoche', weekStart: now, groupId: null, status: 'aktiv',
      days: [{ date: now, sets: [] }], comments: [],
      createdAt: now, updatedAt: now,
    };
    expect(PlanSchema.safeParse(plan).success).toBe(true);
  });
  it('lehnt einen ungültigen Status ab', () => {
    const plan = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'X', weekStart: now, groupId: null, status: 'gelöscht', days: [], comments: [], createdAt: now, updatedAt: now };
    expect(PlanSchema.safeParse(plan).success).toBe(false);
  });
  it('akzeptiert Kommentare auf Planebene', () => {
    const plan = {
      id: ATHLETE_ID, clubId: CLUB_ID, name: 'Trainingswoche', weekStart: now, groupId: null, status: 'aktiv',
      days: [], comments: [{ id: 'c1', authorName: 'Trainer X', text: 'Guter Wochenaufbau.', createdAt: now }],
      createdAt: now, updatedAt: now,
    };
    expect(PlanSchema.safeParse(plan).success).toBe(true);
  });

  // Regressionstest für Befund S7 (Code-Review): "days" trägt trotz des
  // Feldnamens "weekStart" bewusst ein großzügigeres Limit als 7 — die
  // Oberfläche begrenzt die Anzahl der Tage selbst nicht hart (siehe
  // apps/web/js/modules/plans.js), ein mehrwöchiger Plan bleibt also gültig.
  it('lehnt mehr als 60 Tage sowie mehr als 500 Kommentare ab', () => {
    const base = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'X', weekStart: now, groupId: null, status: 'aktiv', createdAt: now, updatedAt: now };
    const oneDay = { date: now, sets: [] };
    expect(PlanSchema.safeParse({ ...base, days: Array(61).fill(oneDay), comments: [] }).success).toBe(false);
    expect(PlanSchema.safeParse({ ...base, days: Array(60).fill(oneDay), comments: [] }).success).toBe(true);
    const manyComments = Array.from({ length: 501 }, (_, i) => ({ id: `c${i}`, authorName: 'X', text: 'x', createdAt: now }));
    expect(PlanSchema.safeParse({ ...base, days: [], comments: manyComments }).success).toBe(false);
  });
});

describe('TrainingSessionSchema', () => {
  it('akzeptiert eine Einheit mit Anwesenheitsliste', () => {
    const session = {
      id: ATHLETE_ID, clubId: CLUB_ID, date: now, groupId: null, planId: null, trainerNote: '',
      attendance: [{ athleteId: ATHLETE_ID, present: true, rpe: 7, note: '' }],
      createdAt: now, updatedAt: now,
    };
    expect(TrainingSessionSchema.safeParse(session).success).toBe(true);
  });
  it('lehnt einen RPE-Wert außerhalb von 1–10 ab', () => {
    const session = {
      id: ATHLETE_ID, clubId: CLUB_ID, date: now, groupId: null, planId: null, trainerNote: '',
      attendance: [{ athleteId: ATHLETE_ID, present: true, rpe: 11, note: '' }],
      createdAt: now, updatedAt: now,
    };
    expect(TrainingSessionSchema.safeParse(session).success).toBe(false);
  });

  // Regressionstest für Befund S7 (Code-Review).
  it('lehnt mehr als 500 Anwesenheits-Einträge ab', () => {
    const base = { id: ATHLETE_ID, clubId: CLUB_ID, date: now, groupId: null, planId: null, trainerNote: '', createdAt: now, updatedAt: now };
    const entry = { athleteId: ATHLETE_ID, present: true, rpe: null, note: '' };
    expect(TrainingSessionSchema.safeParse({ ...base, attendance: Array(501).fill(entry) }).success).toBe(false);
    expect(TrainingSessionSchema.safeParse({ ...base, attendance: Array(500).fill(entry) }).success).toBe(true);
  });
});

describe('ActionItemSchema', () => {
  const valid = { id: ATHLETE_ID, clubId: CLUB_ID, athleteId: ATHLETE_ID, title: 'Atemtechnik', description: '', category: 'technik', status: 'offen', assignedTrainerId: TRAINER_ID, createdDate: now, dueDate: null, createdAt: now, updatedAt: now };
  it('akzeptiert ein vollständiges Handlungsfeld', () => {
    expect(ActionItemSchema.safeParse(valid).success).toBe(true);
  });
  it('lehnt einen ungültigen Status ab', () => {
    expect(ActionItemSchema.safeParse({ ...valid, status: 'fertig' }).success).toBe(false);
  });
  it('akzeptiert assignedTrainerId=null (z. B. nach Löschung des zuständigen Kontos)', () => {
    expect(ActionItemSchema.safeParse({ ...valid, assignedTrainerId: null }).success).toBe(true);
  });
  it('lehnt eine ungültige assignedTrainerId ab', () => {
    expect(ActionItemSchema.safeParse({ ...valid, assignedTrainerId: 'nicht-uuid' }).success).toBe(false);
  });
});

describe('ENTITY_SCHEMAS registry', () => {
  it('enthält einen Eintrag für jeden fachlichen SyncStore (alle außer "users")', () => {
    const fachlicheStores = SyncStoreSchema.options.filter((s) => s !== 'users');
    fachlicheStores.forEach((store) => {
      expect(ENTITY_SCHEMAS).toHaveProperty(store);
    });
  });

  it('jedes registrierte Schema validiert korrekt gegen einen minimalen, gültigen Datensatz', () => {
    // Stellt sicher, dass die Registry tatsächlich funktionsfähige Zod-Schemas
    // enthält (nicht nur Platzhalter) — exemplarisch anhand von "groups".
    const result = ENTITY_SCHEMAS.groups.safeParse({
      id: ATHLETE_ID, clubId: CLUB_ID, name: 'X', description: '', createdAt: now, updatedAt: now,
    });
    expect(result.success).toBe(true);
  });
});
