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
  SectionTemplateSchema,
  PlanSchema,
  PlanCycleSchema,
  TrainingSessionSchema,
  ActionItemSchema,
  AnnouncementSchema,
  CalendarEntrySchema,
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

  // docs/Plans/vereinsverwaltung-phase3-plan.md, Abschnitt 1.2.
  it('setzt trainerIds standardmäßig auf ein leeres Array', () => {
    const group = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'Leistungsgruppe', description: '', createdAt: now, updatedAt: now };
    const parsed = GroupSchema.parse(group);
    expect(parsed.trainerIds).toEqual([]);
  });
  it('akzeptiert eine Liste zuständiger Trainer:innen', () => {
    const group = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'Leistungsgruppe', description: '', trainerIds: [TRAINER_ID], createdAt: now, updatedAt: now };
    expect(GroupSchema.safeParse(group).success).toBe(true);
  });
  it('lehnt eine ungültige Trainer-ID ab', () => {
    const group = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'Leistungsgruppe', description: '', trainerIds: ['not-a-uuid'], createdAt: now, updatedAt: now };
    expect(GroupSchema.safeParse(group).success).toBe(false);
  });
  it('lehnt mehr als 50 zugeordnete Trainer:innen ab', () => {
    const trainerIds = Array.from({ length: 51 }, (_, i) => `33333333-3333-3333-3333-${String(i).padStart(12, '0')}`);
    const group = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'Leistungsgruppe', description: '', trainerIds, createdAt: now, updatedAt: now };
    expect(GroupSchema.safeParse(group).success).toBe(false);
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

  // Kein Default: sonst setzte ein Sync-Update eines feldlosen
  // Altdatensatzes ein gespeichertes "invitable" auf "managed" zurück.
  it('lässt "accountMode" ohne Angabe weg (kein Default)', () => {
    const parsed = AthleteSchema.parse(valid);
    expect('accountMode' in parsed).toBe(false);
  });
  it('akzeptiert accountMode "invitable"', () => {
    expect(AthleteSchema.parse({ ...valid, accountMode: 'invitable' }).accountMode).toBe('invitable');
  });
  it('lehnt einen unbekannten accountMode ab', () => {
    expect(AthleteSchema.safeParse({ ...valid, accountMode: 'self' }).success).toBe(false);
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
  it('akzeptiert optionale Fristen (gesetzt, null oder fehlend) und belegt sie nicht vor', () => {
    expect(CompetitionSchema.safeParse({ ...valid, entryDeadline: now, selectionDeadline: now }).success).toBe(true);
    expect(CompetitionSchema.safeParse({ ...valid, entryDeadline: null, selectionDeadline: null }).success).toBe(true);
    const parsed = CompetitionSchema.parse(valid);
    expect('entryDeadline' in parsed).toBe(false);
    expect('selectionDeadline' in parsed).toBe(false);
  });
  it('lehnt eine Frist ohne gültigen Zeitstempel ab', () => {
    expect(CompetitionSchema.safeParse({ ...valid, entryDeadline: '2026-11-01' }).success).toBe(false);
  });
  it('akzeptiert eine optionale Anzahl zu stellender Kampfrichter:innen und belegt sie nicht vor', () => {
    expect(CompetitionSchema.safeParse({ ...valid, refereesRequired: 3 }).success).toBe(true);
    expect(CompetitionSchema.safeParse({ ...valid, refereesRequired: 0 }).success).toBe(true);
    expect(CompetitionSchema.safeParse({ ...valid, refereesRequired: null }).success).toBe(true);
    expect('refereesRequired' in CompetitionSchema.parse(valid)).toBe(false);
  });
  it('lehnt eine negative, gebrochene oder zu große Kampfrichter-Anzahl ab', () => {
    for (const refereesRequired of [-1, 1.5, 100, '2']) {
      expect(CompetitionSchema.safeParse({ ...valid, refereesRequired }).success).toBe(false);
    }
  });
  it('akzeptiert Disziplinen aus einer Wettkampfdefinition und belegt sie nicht vor', () => {
    const discipline = { number: '1', round: 'V', session: 1, distanceM: 100, stroke: 'F', style: 'GL', relaySize: 1, gender: 'W', event: '100 Freistil' };
    expect(CompetitionSchema.safeParse({ ...valid, disciplines: [discipline, { ...discipline, number: '2', stroke: 'X', event: null }] }).success).toBe(true);
    expect('disciplines' in CompetitionSchema.parse(valid)).toBe(false);
    expect(CompetitionSchema.safeParse({ ...valid, disciplines: [{ ...discipline, distanceM: 0 }] }).success).toBe(false);
    expect(CompetitionSchema.safeParse({ ...valid, disciplines: [{ ...discipline, extra: 1 }] }).success).toBe(false);
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

describe('CommentSchema (Store "comments", Issue #141)', () => {
  const PLAN_ID = '99999999-6666-6666-6666-666666666661';
  const valid = {
    id: '99999999-5555-5555-5555-555555555551', clubId: CLUB_ID, targetStore: 'plans', targetId: PLAN_ID, entryId: null,
    authorId: TRAINER_ID, authorName: 'Sabine Reuter', text: 'Bitte auf die Wende achten.', editedAt: null, createdAt: now, updatedAt: now,
  };
  it('akzeptiert einen gültigen Kommentar', () => {
    expect(CommentSchema.safeParse(valid).success).toBe(true);
  });
  it('lehnt einen leeren oder nur aus Leerzeichen bestehenden Text ab', () => {
    expect(CommentSchema.safeParse({ ...valid, text: '' }).success).toBe(false);
    expect(CommentSchema.safeParse({ ...valid, text: '   ' }).success).toBe(false);
  });
  it('lehnt einen leeren Autorennamen ab', () => {
    expect(CommentSchema.safeParse({ ...valid, authorName: '' }).success).toBe(false);
  });
  it('lässt authorId null zu (Altbestand ohne Zuordnung, anonymisiert)', () => {
    expect(CommentSchema.safeParse({ ...valid, authorId: null }).success).toBe(true);
  });
  it('lehnt eine ungültige authorId ab', () => {
    expect(CommentSchema.safeParse({ ...valid, authorId: 'not-a-uuid' }).success).toBe(false);
  });
  it('akzeptiert nur kommentierbare Ziele', () => {
    for (const targetStore of ['plans', 'exercises', 'templates', 'sectionTemplates', 'results']) {
      expect(CommentSchema.safeParse({ ...valid, targetStore }).success).toBe(true);
    }
    expect(CommentSchema.safeParse({ ...valid, targetStore: 'sessions' }).success).toBe(false);
  });
  it('erlaubt eine entryId nur bei Zielen mit Sätzen', () => {
    expect(CommentSchema.safeParse({ ...valid, entryId: 'set-1' }).success).toBe(true);
    expect(CommentSchema.safeParse({ ...valid, targetStore: 'templates', entryId: 'set-1' }).success).toBe(true);
    expect(CommentSchema.safeParse({ ...valid, targetStore: 'exercises', entryId: 'set-1' }).success).toBe(false);
    expect(CommentSchema.safeParse({ ...valid, targetStore: 'results', entryId: 'set-1' }).success).toBe(false);
  });
  it('setzt fehlende entryId/editedAt auf null', () => {
    const { entryId: _e, editedAt: _d, ...minimal } = valid;
    const parsed = CommentSchema.safeParse(minimal);
    expect(parsed.success && parsed.data.entryId === null && parsed.data.editedAt === null).toBe(true);
  });
  it('lehnt unbekannte Zusatzfelder ab (.strict())', () => {
    expect(CommentSchema.safeParse({ ...valid, authorUserId: '123' }).success).toBe(false);
  });
});

describe('ExerciseSchema', () => {
  const valid = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'Kraulbeine mit Brett', category: 'kick', stroke: 'Freistil', description: '', defaultDistance: 200, tags: ['aufwärmen'], equipment: ['brett'], createdAt: now, updatedAt: now };
  it('akzeptiert eine vollständige Übung', () => {
    expect(ExerciseSchema.safeParse(valid).success).toBe(true);
  });
  it('akzeptiert stroke: null (schwimmlagen-unabhängig, z. B. Trockentraining)', () => {
    expect(ExerciseSchema.safeParse({ ...valid, stroke: null }).success).toBe(true);
  });
  it('lehnt eingebettete Kommentare ab — sie liegen im Store "comments"', () => {
    expect(ExerciseSchema.safeParse({ ...valid, comments: [] }).success).toBe(false);
  });

  // Regressionstest für Befund S7 (Code-Review).
  it('lehnt mehr als 50 Tags/Ausrüstungsgegenstände ab', () => {
    expect(ExerciseSchema.safeParse({ ...valid, tags: Array(51).fill('x') }).success).toBe(false);
    expect(ExerciseSchema.safeParse({ ...valid, equipment: Array(51).fill('x') }).success).toBe(false);
  });
  it('fehlt "defaultDurationSec" ganz, wird null angenommen (Rückwärtskompatibilität mit älteren Datensätzen)', () => {
    const parsed = ExerciseSchema.safeParse(valid);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.defaultDurationSec).toBeNull();
  });
  it('akzeptiert eine zeitbasierte Übung (z. B. Trockentraining) mit defaultDurationSec statt defaultDistance', () => {
    expect(ExerciseSchema.safeParse({ ...valid, defaultDistance: null, defaultDurationSec: 45 }).success).toBe(true);
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
  it('fehlt "durationSec" ganz, wird null angenommen (Rückwärtskompatibilität mit älteren Datensätzen)', () => {
    const set = { kind: 'set', id: 's1', description: '8x100 Freistil', distance: 100, reps: 8, intensity: 'ga1', restSec: 20 };
    const parsed = SetEntrySchema.safeParse(set);
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.kind === 'set') expect(parsed.data.durationSec).toBeNull();
  });
  it('akzeptiert einen rein zeitbasierten Satz ohne Distanz sowie einen mit Distanz UND Zeit', () => {
    const timeOnly = { kind: 'set', id: 's1', description: 'Unterarmstütz', distance: null, durationSec: 45, reps: 3, intensity: 'ga1', restSec: 15 };
    expect(SetEntrySchema.safeParse(timeOnly).success).toBe(true);
    const both = { kind: 'set', id: 's2', description: '100 Freistil mit Zielzeit', distance: 100, durationSec: 90, reps: 4, intensity: 'schwelle', restSec: 20 };
    expect(SetEntrySchema.safeParse(both).success).toBe(true);
  });
  // Regressionstest für Befund S7 (Code-Review).
  it('lehnt mehr als 50 Sätze in einem Block ab', () => {
    const oneSet = { kind: 'set', id: 's1', description: 'X', distance: 100, reps: 1, intensity: 'ga1', restSec: 0 };
    const blockWithTooManySets = { kind: 'block', id: 'b1', label: 'X', repeatCount: 1, sets: Array(51).fill(oneSet) };
    expect(SetEntrySchema.safeParse(blockWithTooManySets).success).toBe(false);
  });
});

describe('SetEntrySchema — Abschnitte (section)', () => {
  it('akzeptiert einen Abschnitt mit gemischten Sätzen/Blöcken', () => {
    const section = {
      kind: 'section', id: 'sec1', heading: 'Hauptteil',
      entries: [
        { kind: 'set', id: 's1', description: 'Einschwimmen', distance: 400, reps: 1, intensity: 'locker', restSec: 0 },
        { kind: 'block', id: 'b1', label: 'Serie', repeatCount: 3, sets: [] },
      ],
    };
    expect(SetEntrySchema.safeParse(section).success).toBe(true);
  });
  it('akzeptiert einen Abschnitt ohne Überschrift und ohne Einträge (Default-Werte)', () => {
    expect(SetEntrySchema.safeParse({ kind: 'section', id: 'sec1', entries: [] }).success).toBe(true);
  });
  it('lehnt einen Abschnitt ab, der selbst wieder einen Abschnitt enthält (keine Verschachtelung erlaubt)', () => {
    const invalidSection = {
      kind: 'section', id: 'sec1', heading: 'X',
      entries: [{ kind: 'section', id: 'sec2', heading: 'Y', entries: [] }],
    };
    expect(SetEntrySchema.safeParse(invalidSection).success).toBe(false);
  });
  it('lehnt einen Block ab, der einen Abschnitt enthält (keine Verschachtelung erlaubt)', () => {
    const invalidBlock = {
      kind: 'block', id: 'b1', label: 'X', repeatCount: 2,
      sets: [{ kind: 'section', id: 'sec1', heading: 'Y', entries: [] }],
    };
    expect(SetEntrySchema.safeParse(invalidBlock).success).toBe(false);
  });
  it('lehnt eine Überschrift über 200 Zeichen sowie mehr als 200 Einträge ab', () => {
    expect(SetEntrySchema.safeParse({ kind: 'section', id: 'sec1', heading: 'x'.repeat(201), entries: [] }).success).toBe(false);
    const oneSet = { kind: 'set', id: 's1', description: 'X', distance: 100, reps: 1, intensity: 'ga1', restSec: 0 };
    expect(SetEntrySchema.safeParse({ kind: 'section', id: 'sec1', heading: 'X', entries: Array(201).fill(oneSet) }).success).toBe(false);
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

  it('akzeptiert eine Vorlage mit einem Abschnitt', () => {
    const template = {
      id: ATHLETE_ID, clubId: CLUB_ID, name: 'Grundlagenausdauer', description: '', tags: [],
      sets: [
        { kind: 'section', id: 'sec1', heading: 'Hauptteil', entries: [{ kind: 'set', id: 's1', description: '', distance: 400, reps: 1, intensity: 'locker', restSec: 0 }] },
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

  // Issue #72 (docs/Plans/beckenlaenge-regeneration-plan.md).
  it('akzeptiert poolLength LCM/SCM, setzt bei fehlendem Feld null (Alt-Vorlagen bleiben gültig)', () => {
    const base = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'X', description: '', tags: [], sets: [], createdAt: now, updatedAt: now };
    expect(TemplateSchema.safeParse({ ...base, poolLength: 'LCM' }).success).toBe(true);
    expect(TemplateSchema.safeParse({ ...base, poolLength: 'SCM' }).success).toBe(true);
    expect(TemplateSchema.safeParse({ ...base, poolLength: null }).success).toBe(true);
    const parsed = TemplateSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.poolLength).toBeNull();
  });

  it('lehnt einen ungültigen poolLength-Wert ab', () => {
    const base = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'X', description: '', tags: [], sets: [], createdAt: now, updatedAt: now };
    expect(TemplateSchema.safeParse({ ...base, poolLength: '25yd' }).success).toBe(false);
  });
});

describe('SectionTemplateSchema', () => {
  it('akzeptiert eine Abschnitts-Vorlage mit gemischten Sätzen/Blöcken', () => {
    const sectionTemplate = {
      id: ATHLETE_ID, clubId: CLUB_ID, name: 'Einschwimmen', description: '', tags: ['einschwimmen'],
      entries: [
        { kind: 'set', id: 's1', description: 'Kraul locker', distance: 400, reps: 1, intensity: 'locker', restSec: 0 },
        { kind: 'block', id: 'b1', label: 'Beine', repeatCount: 3, sets: [] },
      ],
      createdAt: now, updatedAt: now,
    };
    expect(SectionTemplateSchema.safeParse(sectionTemplate).success).toBe(true);
  });

  it('lehnt eine Abschnitts-Vorlage ab, deren entries selbst wieder einen Abschnitt enthalten (keine Verschachtelung erlaubt)', () => {
    const sectionTemplate = {
      id: ATHLETE_ID, clubId: CLUB_ID, name: 'Einschwimmen', description: '', tags: [],
      entries: [{ kind: 'section', id: 'sec1', heading: 'X', entries: [] }],
      createdAt: now, updatedAt: now,
    };
    expect(SectionTemplateSchema.safeParse(sectionTemplate).success).toBe(false);
  });

  it('lehnt mehr als 50 Tags sowie mehr als 200 Einträge ab', () => {
    const base = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'X', description: '', createdAt: now, updatedAt: now };
    expect(SectionTemplateSchema.safeParse({ ...base, tags: Array(51).fill('x'), entries: [] }).success).toBe(false);
    const oneSet = { kind: 'set', id: 's1', description: 'X', distance: 100, reps: 1, intensity: 'ga1', restSec: 0 };
    expect(SectionTemplateSchema.safeParse({ ...base, tags: [], entries: Array(201).fill(oneSet) }).success).toBe(false);
  });
});

describe('PlanSchema', () => {
  it('akzeptiert einen Trainingsplan mit mehreren Tagen', () => {
    const plan = {
      id: ATHLETE_ID, clubId: CLUB_ID, name: 'Trainingswoche', weekStart: now, groupId: null, status: 'aktiv',
      days: [{ date: now, sets: [] }],
      createdAt: now, updatedAt: now,
    };
    expect(PlanSchema.safeParse(plan).success).toBe(true);
  });
  it('lehnt einen ungültigen Status ab', () => {
    const plan = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'X', weekStart: now, groupId: null, status: 'gelöscht', days: [], createdAt: now, updatedAt: now };
    expect(PlanSchema.safeParse(plan).success).toBe(false);
  });
  // Regressionstest für Befund S7 (Code-Review): "days" trägt trotz des
  // Feldnamens "weekStart" bewusst ein großzügigeres Limit als 7 — die
  // Oberfläche begrenzt die Anzahl der Tage selbst nicht hart (siehe
  // apps/web/js/modules/plans.js), ein mehrwöchiger Plan bleibt also gültig.
  it('lehnt mehr als 60 Tage ab', () => {
    const base = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'X', weekStart: now, groupId: null, status: 'aktiv', createdAt: now, updatedAt: now };
    const oneDay = { date: now, sets: [] };
    expect(PlanSchema.safeParse({ ...base, days: Array(61).fill(oneDay) }).success).toBe(false);
    expect(PlanSchema.safeParse({ ...base, days: Array(60).fill(oneDay) }).success).toBe(true);
  });

  // Issue #72 (docs/Plans/beckenlaenge-regeneration-plan.md): Beckenlänge
  // je Trainingstag, unabhängig zwischen Tagen desselben Plans wählbar.
  it('akzeptiert je Trainingstag eine eigene poolLength, Alt-Tage ohne Feld bleiben gültig', () => {
    const base = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'X', weekStart: now, groupId: null, status: 'aktiv', createdAt: now, updatedAt: now };
    const plan = {
      ...base,
      days: [
        { date: now, poolLength: 'LCM', sets: [] },
        { date: now, poolLength: 'SCM', sets: [] },
        { date: now, sets: [] },
      ],
    };
    const parsed = PlanSchema.safeParse(plan);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.days[0].poolLength).toBe('LCM');
      expect(parsed.data.days[1].poolLength).toBe('SCM');
      expect(parsed.data.days[2].poolLength).toBeNull();
    }
  });

  it('lehnt einen ungültigen poolLength-Wert bei einem Trainingstag ab', () => {
    const base = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'X', weekStart: now, groupId: null, status: 'aktiv', createdAt: now, updatedAt: now };
    expect(PlanSchema.safeParse({ ...base, days: [{ date: now, poolLength: '25yd', sets: [] }] }).success).toBe(false);
  });
});

// Phase 1, Abschnitt 3.1 (docs/Plans/trainingsplanung-phase1-plan.md).
describe('PlanCycleSchema', () => {
  it('akzeptiert einen Zyklus mit mehreren Wochen', () => {
    const cycle = {
      id: ATHLETE_ID, clubId: CLUB_ID, name: 'Aufbauzyklus', description: '',
      weeks: [{ weekOffset: 0, label: 'Woche 1', days: [{ dayOfWeek: 0, templateId: TRAINER_ID }] }],
      createdAt: now, updatedAt: now,
    };
    expect(PlanCycleSchema.safeParse(cycle).success).toBe(true);
  });
  it('akzeptiert eine leere Wochen-/Tagesliste', () => {
    const cycle = { id: ATHLETE_ID, clubId: CLUB_ID, name: 'Leer', description: '', weeks: [], createdAt: now, updatedAt: now };
    expect(PlanCycleSchema.safeParse(cycle).success).toBe(true);
  });
  it('lehnt einen dayOfWeek außerhalb von 0–6 ab', () => {
    const cycle = {
      id: ATHLETE_ID, clubId: CLUB_ID, name: 'X', description: '',
      weeks: [{ weekOffset: 0, label: '', days: [{ dayOfWeek: 7, templateId: TRAINER_ID }] }],
      createdAt: now, updatedAt: now,
    };
    expect(PlanCycleSchema.safeParse(cycle).success).toBe(false);
  });
  it('lehnt einen leeren Namen ab', () => {
    const cycle = { id: ATHLETE_ID, clubId: CLUB_ID, name: '', description: '', weeks: [], createdAt: now, updatedAt: now };
    expect(PlanCycleSchema.safeParse(cycle).success).toBe(false);
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

  it('coachIds ist optional und defaultet auf [] (Altbestand ohne dieses Feld)', () => {
    const session = { id: ATHLETE_ID, clubId: CLUB_ID, date: now, groupId: null, planId: null, trainerNote: '', attendance: [], createdAt: now, updatedAt: now };
    const parsed = TrainingSessionSchema.safeParse(session);
    expect(parsed.success && parsed.data.coachIds).toEqual([]);
  });
  it('coachIds akzeptiert nur UUIDs', () => {
    const base = { id: ATHLETE_ID, clubId: CLUB_ID, date: now, groupId: null, planId: null, trainerNote: '', attendance: [], createdAt: now, updatedAt: now };
    expect(TrainingSessionSchema.safeParse({ ...base, coachIds: [CLUB_ID] }).success).toBe(true);
    expect(TrainingSessionSchema.safeParse({ ...base, coachIds: ['kein-uuid'] }).success).toBe(false);
  });

  // Phase 1, Abschnitt 3.2 (docs/Plans/trainingsplanung-phase1-plan.md).
  it('actualDistance ist optional und defaultet auf null (Altbestand ohne dieses Feld)', () => {
    const session = { id: ATHLETE_ID, clubId: CLUB_ID, date: now, groupId: null, planId: null, trainerNote: '', attendance: [], createdAt: now, updatedAt: now };
    const parsed = TrainingSessionSchema.safeParse(session);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.actualDistance).toBeNull();
  });
  it('akzeptiert eine gesetzte actualDistance', () => {
    const session = { id: ATHLETE_ID, clubId: CLUB_ID, date: now, groupId: null, planId: null, trainerNote: '', attendance: [], actualDistance: 3200, createdAt: now, updatedAt: now };
    expect(TrainingSessionSchema.safeParse(session).success).toBe(true);
  });
  it('lehnt eine negative actualDistance ab', () => {
    const session = { id: ATHLETE_ID, clubId: CLUB_ID, date: now, groupId: null, planId: null, trainerNote: '', attendance: [], actualDistance: -1, createdAt: now, updatedAt: now };
    expect(TrainingSessionSchema.safeParse(session).success).toBe(false);
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

describe('AnnouncementSchema', () => {
  const valid = { id: ATHLETE_ID, clubId: CLUB_ID, groupId: null, authorId: TRAINER_ID, title: 'Training fällt aus', body: 'Mittwoch fällt das Training aus.', createdAt: now, updatedAt: now };
  it('akzeptiert eine vollständige, vereinsweite Ankündigung', () => {
    expect(AnnouncementSchema.safeParse(valid).success).toBe(true);
  });
  it('akzeptiert eine gruppenspezifische Ankündigung', () => {
    expect(AnnouncementSchema.safeParse({ ...valid, groupId: ATHLETE_ID }).success).toBe(true);
  });
  it('akzeptiert authorId=null (z. B. nach Löschung des verfassenden Kontos)', () => {
    expect(AnnouncementSchema.safeParse({ ...valid, authorId: null }).success).toBe(true);
  });
  it('lehnt einen leeren title ab', () => {
    expect(AnnouncementSchema.safeParse({ ...valid, title: '' }).success).toBe(false);
  });
  it('lehnt einen leeren body ab', () => {
    expect(AnnouncementSchema.safeParse({ ...valid, body: '' }).success).toBe(false);
  });
  it('lehnt zusätzliche, nicht im Schema vorgesehene Felder ab (.strict())', () => {
    expect(AnnouncementSchema.safeParse({ ...valid, extra: 'x' }).success).toBe(false);
  });
});

describe('CalendarEntrySchema', () => {
  const day = (d: string) => `${d}T00:00:00.000Z`;
  const holiday = { id: ATHLETE_ID, clubId: CLUB_ID, kind: 'schoolHoliday', title: 'Herbstferien', startDate: day('2026-10-26'), endDate: day('2026-11-06'), createdAt: now, updatedAt: now };
  const slot = {
    id: ATHLETE_ID, clubId: CLUB_ID, kind: 'trainingSlot', title: 'Abendtraining', startDate: day('2026-09-01'), endDate: day('2027-06-30'),
    groupId: TRAINER_ID, weekdays: [0, 2], startTime: '17:30', endTime: '19:00', pauseDuring: ['publicHoliday', 'poolClosure'], poolLength: 'SCM',
    createdAt: now, updatedAt: now,
  };
  it('akzeptiert vereinsweite Ferien mit Standardwerten für die übrigen Felder', () => {
    const parsed = CalendarEntrySchema.safeParse(holiday);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.groupId).toBe(null);
  });
  it('akzeptiert eine wöchentliche Trainingszeit einer Gruppe', () => {
    expect(CalendarEntrySchema.safeParse(slot).success).toBe(true);
  });
  it('lehnt eine Trainingszeit ohne Wochentag ab', () => {
    expect(CalendarEntrySchema.safeParse({ ...slot, weekdays: [] }).success).toBe(false);
  });
  it('lehnt ungültige Uhrzeiten und Wochentage ab', () => {
    expect(CalendarEntrySchema.safeParse({ ...slot, startTime: '24:00' }).success).toBe(false);
    expect(CalendarEntrySchema.safeParse({ ...slot, weekdays: [7] }).success).toBe(false);
  });
  it('lehnt ein Ende vor dem Beginn ab', () => {
    expect(CalendarEntrySchema.safeParse({ ...holiday, endDate: day('2026-10-25') }).success).toBe(false);
  });
  it('lehnt gruppenbezogene Ferien/Feiertage/Schließungen ab (gelten immer vereinsweit)', () => {
    expect(CalendarEntrySchema.safeParse({ ...holiday, groupId: TRAINER_ID }).success).toBe(false);
    expect(CalendarEntrySchema.safeParse({ ...holiday, kind: 'trainingCamp', groupId: TRAINER_ID }).success).toBe(true);
  });
  it('lehnt "trainingSlot" als Pausengrund und unbekannte Felder ab', () => {
    expect(CalendarEntrySchema.safeParse({ ...slot, pauseDuring: ['trainingSlot'] }).success).toBe(false);
    expect(CalendarEntrySchema.safeParse({ ...holiday, extra: 'x' }).success).toBe(false);
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
