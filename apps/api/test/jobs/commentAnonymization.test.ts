// apps/api/test/jobs/commentAnonymization.test.ts
//
// Sicherheitsreview 2026-08, Befund N5. Reine Funktionen, DB-frei
// testbar — siehe src/jobs/commentAnonymization.ts für die Begründung.
//
// Sicherheitsreview 2026-08-27, Befund M2: Der Abgleich erfolgt jetzt über
// authorId (User-ID) statt authorName — ein austauschbarer Anzeigename
// konnte die N5-Anonymisierung gezielt umgehen. Die Fixtures tragen daher
// sowohl eine authorId (Abgleichsschlüssel) als auch einen authorName
// (wird bei Treffer weiterhin überschrieben).
import { describe, it, expect } from 'vitest';
import {
  ANONYMIZED_COMMENT_AUTHOR,
  anonymizeCommentArray,
  anonymizeSetEntries,
  anonymizePlanCommentAuthors,
  anonymizeExerciseCommentAuthors,
  anonymizeTemplateCommentAuthors,
} from '../../src/jobs/commentAnonymization.js';

const MARA_ID = 'user-mara';
const JENS_ID = 'user-jens';

// Die Anonymisierung nimmt die Identität als { id, name } entgegen: "id"
// ist der exakte Abgleichswert für alles seit Befund M2 Geschriebene,
// "name" dient ausschließlich dem Altbestand ohne authorId (siehe
// commentAnonymization.ts).
const MARA = { id: MARA_ID, name: 'Mara Vogel' };

function makeComment(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 'c1', authorId: MARA_ID, authorName: 'Mara Vogel', text: 'Gute Serie!', createdAt: '2026-06-01T00:00:00.000Z', ...overrides };
}

describe('anonymizeCommentArray', () => {
  it('ersetzt authorName bei einem Treffer über authorId, lässt den Kommentartext unangetastet', () => {
    const comments = [makeComment()];
    const { changed, value } = anonymizeCommentArray(comments, MARA);
    expect(changed).toBe(true);
    const { authorId: _authorId, ...withoutAuthorId } = comments[0]!;
    expect(value).toEqual([{ ...withoutAuthorId, authorName: ANONYMIZED_COMMENT_AUTHOR }]);
  });

  // Nachreview zu M2: Bliebe authorId nach dem Art.-17-Purge stehen,
  // überlebte ein stabiler personenbezogener Schlüssel, über den sich alle
  // Kommentare derselben gelöschten Person wieder zusammenführen ließen —
  // eine Verkettbarkeit, die es VOR Einführung von authorId nicht gab.
  it('entfernt authorId vollständig, statt nur den Anzeigenamen zu überschreiben', () => {
    const { value } = anonymizeCommentArray([makeComment()], MARA);
    const anonymized = (value as Array<Record<string, unknown>>)[0]!;
    expect('authorId' in anonymized).toBe(false);
    expect(anonymized.text).toBe('Gute Serie!'); // Kommentartext bleibt erhalten
  });

  // Nachreview zu M2: Kommentare aus der Zeit VOR authorId (eingebettetes
  // JSONB, per Spalten-Migration nicht nachrüstbar) würden sonst
  // ausgerechnet als älteste Datensätze dauerhaft unanonymisiert bleiben.
  it('anonymisiert Altbestand ohne authorId weiterhin über den Anzeigenamen', () => {
    const legacy = { id: 'c-alt', authorName: 'Mara Vogel', text: 'Alter Kommentar', createdAt: '2026-01-01T00:00:00.000Z' };
    const { changed, value } = anonymizeCommentArray([legacy], MARA);
    expect(changed).toBe(true);
    expect((value as Array<{ authorName: string }>)[0]!.authorName).toBe(ANONYMIZED_COMMENT_AUTHOR);
  });

  it('lässt Altbestand einer ANDEREN Person unangetastet', () => {
    const legacy = { id: 'c-alt', authorName: 'Jens Bauer', text: 'Alter Kommentar', createdAt: '2026-01-01T00:00:00.000Z' };
    expect(anonymizeCommentArray([legacy], MARA).changed).toBe(false);
  });

  // Der Namensabgleich gilt AUSSCHLIESSLICH für Altbestand: trägt ein
  // Kommentar eine (fremde) authorId, darf ein zufällig gleicher
  // Anzeigename ihn nicht mit anonymisieren.
  it('greift NICHT über den Namen, wenn der Kommentar eine fremde authorId trägt', () => {
    const comments = [makeComment({ authorId: JENS_ID, authorName: 'Mara Vogel' })];
    expect(anonymizeCommentArray(comments, MARA).changed).toBe(false);
  });

  it('lässt Kommentare ANDERER Autor:innen unangetastet', () => {
    const comments = [makeComment({ authorId: JENS_ID, authorName: 'Jens Bauer' })];
    const { changed, value } = anonymizeCommentArray(comments, MARA);
    expect(changed).toBe(false);
    expect(value).toEqual(comments);
  });

  // Regressionstest für Befund M2: ein abweichender Anzeigename bei
  // gleicher authorId darf die Anonymisierung nicht umgehen (vormals
  // bekannte Lücke der N5-Anonymisierung über authorName).
  it('anonymisiert trotz abweichendem Anzeigenamen, solange die authorId übereinstimmt', () => {
    const comments = [makeComment({ authorName: 'Absichtlich anderer Name' })];
    const { changed, value } = anonymizeCommentArray(comments, MARA);
    expect(changed).toBe(true);
    expect((value as Array<{ authorName: string }>)[0]!.authorName).toBe(ANONYMIZED_COMMENT_AUTHOR);
  });

  it('anonymisiert nur den passenden von mehreren Kommentaren', () => {
    const mine = makeComment({ id: 'c1' });
    const foreign = makeComment({ id: 'c2', authorId: JENS_ID, authorName: 'Jens Bauer' });
    const { changed, value } = anonymizeCommentArray([mine, foreign], MARA);
    expect(changed).toBe(true);
    expect((value as Array<{ id: string; authorName: string }>).find((c) => c.id === 'c1')!.authorName).toBe(ANONYMIZED_COMMENT_AUTHOR);
    expect((value as Array<{ id: string; authorName: string }>).find((c) => c.id === 'c2')!.authorName).toBe('Jens Bauer');
  });

  it('ist tolerant gegenüber fehlendem/ungültigem Wert (kein Array)', () => {
    expect(anonymizeCommentArray(undefined, MARA)).toEqual({ changed: false, value: undefined });
    expect(anonymizeCommentArray(null, MARA)).toEqual({ changed: false, value: null });
  });

  it('leeres Array bleibt unverändert', () => {
    expect(anonymizeCommentArray([], MARA)).toEqual({ changed: false, value: [] });
  });
});

describe('anonymizeSetEntries — verschachtelte Sets/Blöcke (Plan.days[].sets bzw. Template.sets)', () => {
  it('anonymisiert die Kommentare eines einzelnen "set"-Eintrags', () => {
    const entries = [{ kind: 'set', id: 's1', comments: [makeComment()] }];
    const { changed, value } = anonymizeSetEntries(entries, MARA);
    expect(changed).toBe(true);
    expect((value as Array<{ comments: Array<{ authorName: string }> }>)[0]!.comments[0]!.authorName).toBe(ANONYMIZED_COMMENT_AUTHOR);
  });

  // Ein "block" (RepeatBlockSchema) hat KEIN eigenes comments-Feld,
  // sondern verschachtelt weitere "set"-Einträge (keine verschachtelten
  // Blöcke laut Schema) — die Rekursion muss dort hineinsehen.
  it('anonymisiert Kommentare INNERHALB eines "block"-Eintrags (rekursiv verschachtelte Sets)', () => {
    const entries = [
      {
        kind: 'block',
        id: 'b1',
        repeatCount: 4,
        sets: [
          { kind: 'set', id: 's1', comments: [makeComment({ id: 'c1' })] },
          { kind: 'set', id: 's2', comments: [makeComment({ id: 'c2', authorId: JENS_ID, authorName: 'Jens Bauer' })] },
        ],
      },
    ];
    const { changed, value } = anonymizeSetEntries(entries, MARA);
    expect(changed).toBe(true);
    const block = (value as Array<{ sets: Array<{ id: string; comments: Array<{ authorName: string }> }> }>)[0]!;
    expect(block.sets.find((s) => s.id === 's1')!.comments[0]!.authorName).toBe(ANONYMIZED_COMMENT_AUTHOR);
    expect(block.sets.find((s) => s.id === 's2')!.comments[0]!.authorName).toBe('Jens Bauer');
  });

  it('lässt Einträge ohne Treffer strukturell unverändert (keine unnötige Kopie)', () => {
    const entries = [{ kind: 'set', id: 's1', comments: [makeComment({ authorId: JENS_ID, authorName: 'Jens Bauer' })] }];
    const { changed, value } = anonymizeSetEntries(entries, MARA);
    expect(changed).toBe(false);
    expect(value).toEqual(entries);
  });
});

describe('anonymizePlanCommentAuthors', () => {
  it('anonymisiert sowohl Plan-weite Kommentare als auch verschachtelte Set-Kommentare in EINEM Aufruf', () => {
    const plan = {
      comments: [makeComment({ id: 'plan-comment' })],
      days: [
        {
          date: '2026-06-01T00:00:00.000Z',
          sets: [{ kind: 'set', id: 's1', comments: [makeComment({ id: 'set-comment' })] }],
        },
      ],
    };
    const result = anonymizePlanCommentAuthors(plan, MARA);
    expect(result.changed).toBe(true);
    expect((result.comments as Array<{ authorName: string }>)[0]!.authorName).toBe(ANONYMIZED_COMMENT_AUTHOR);
    const days = result.days as Array<{ sets: Array<{ comments: Array<{ authorName: string }> }> }>;
    expect(days[0]!.sets[0]!.comments[0]!.authorName).toBe(ANONYMIZED_COMMENT_AUTHOR);
  });

  it('changed bleibt false, wenn nirgends ein Treffer vorliegt', () => {
    const plan = { comments: [makeComment({ authorId: JENS_ID, authorName: 'Jens Bauer' })], days: [] };
    const result = anonymizePlanCommentAuthors(plan, MARA);
    expect(result.changed).toBe(false);
  });
});

describe('anonymizeExerciseCommentAuthors', () => {
  it('anonymisiert Kommentare im Übungskatalog', () => {
    const result = anonymizeExerciseCommentAuthors({ comments: [makeComment()] }, MARA);
    expect(result.changed).toBe(true);
    expect((result.comments as Array<{ authorName: string }>)[0]!.authorName).toBe(ANONYMIZED_COMMENT_AUTHOR);
  });
});

describe('anonymizeTemplateCommentAuthors', () => {
  it('anonymisiert Kommentare in Template.sets (identische Struktur wie Plan.days[].sets)', () => {
    const template = { sets: [{ kind: 'set', id: 's1', comments: [makeComment()] }] };
    const result = anonymizeTemplateCommentAuthors(template, MARA);
    expect(result.changed).toBe(true);
    expect((result.sets as Array<{ comments: Array<{ authorName: string }> }>)[0]!.comments[0]!.authorName).toBe(ANONYMIZED_COMMENT_AUTHOR);
  });
});
