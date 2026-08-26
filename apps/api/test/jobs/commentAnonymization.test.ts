// apps/api/test/jobs/commentAnonymization.test.ts
//
// Sicherheitsreview 2026-08, Befund N5. Reine Funktionen, DB-frei
// testbar — siehe src/jobs/commentAnonymization.ts für die Begründung.
import { describe, it, expect } from 'vitest';
import {
  ANONYMIZED_COMMENT_AUTHOR,
  anonymizeCommentArray,
  anonymizeSetEntries,
  anonymizePlanCommentAuthors,
  anonymizeExerciseCommentAuthors,
  anonymizeTemplateCommentAuthors,
} from '../../src/jobs/commentAnonymization.js';

function makeComment(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 'c1', authorName: 'Mara Vogel', text: 'Gute Serie!', createdAt: '2026-06-01T00:00:00.000Z', ...overrides };
}

describe('anonymizeCommentArray', () => {
  it('ersetzt authorName bei einem Treffer, lässt den Kommentartext unangetastet', () => {
    const comments = [makeComment()];
    const { changed, value } = anonymizeCommentArray(comments, 'Mara Vogel');
    expect(changed).toBe(true);
    expect(value).toEqual([{ ...comments[0], authorName: ANONYMIZED_COMMENT_AUTHOR }]);
  });

  it('lässt Kommentare ANDERER Autor:innen unangetastet', () => {
    const comments = [makeComment({ authorName: 'Jens Bauer' })];
    const { changed, value } = anonymizeCommentArray(comments, 'Mara Vogel');
    expect(changed).toBe(false);
    expect(value).toEqual(comments);
  });

  it('anonymisiert nur den passenden von mehreren Kommentaren', () => {
    const mine = makeComment({ id: 'c1' });
    const foreign = makeComment({ id: 'c2', authorName: 'Jens Bauer' });
    const { changed, value } = anonymizeCommentArray([mine, foreign], 'Mara Vogel');
    expect(changed).toBe(true);
    expect((value as Array<{ id: string; authorName: string }>).find((c) => c.id === 'c1')!.authorName).toBe(ANONYMIZED_COMMENT_AUTHOR);
    expect((value as Array<{ id: string; authorName: string }>).find((c) => c.id === 'c2')!.authorName).toBe('Jens Bauer');
  });

  it('ist tolerant gegenüber fehlendem/ungültigem Wert (kein Array)', () => {
    expect(anonymizeCommentArray(undefined, 'Mara Vogel')).toEqual({ changed: false, value: undefined });
    expect(anonymizeCommentArray(null, 'Mara Vogel')).toEqual({ changed: false, value: null });
  });

  it('leeres Array bleibt unverändert', () => {
    expect(anonymizeCommentArray([], 'Mara Vogel')).toEqual({ changed: false, value: [] });
  });
});

describe('anonymizeSetEntries — verschachtelte Sets/Blöcke (Plan.days[].sets bzw. Template.sets)', () => {
  it('anonymisiert die Kommentare eines einzelnen "set"-Eintrags', () => {
    const entries = [{ kind: 'set', id: 's1', comments: [makeComment()] }];
    const { changed, value } = anonymizeSetEntries(entries, 'Mara Vogel');
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
          { kind: 'set', id: 's2', comments: [makeComment({ id: 'c2', authorName: 'Jens Bauer' })] },
        ],
      },
    ];
    const { changed, value } = anonymizeSetEntries(entries, 'Mara Vogel');
    expect(changed).toBe(true);
    const block = (value as Array<{ sets: Array<{ id: string; comments: Array<{ authorName: string }> }> }>)[0]!;
    expect(block.sets.find((s) => s.id === 's1')!.comments[0]!.authorName).toBe(ANONYMIZED_COMMENT_AUTHOR);
    expect(block.sets.find((s) => s.id === 's2')!.comments[0]!.authorName).toBe('Jens Bauer');
  });

  it('lässt Einträge ohne Treffer strukturell unverändert (keine unnötige Kopie)', () => {
    const entries = [{ kind: 'set', id: 's1', comments: [makeComment({ authorName: 'Jens Bauer' })] }];
    const { changed, value } = anonymizeSetEntries(entries, 'Mara Vogel');
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
    const result = anonymizePlanCommentAuthors(plan, 'Mara Vogel');
    expect(result.changed).toBe(true);
    expect((result.comments as Array<{ authorName: string }>)[0]!.authorName).toBe(ANONYMIZED_COMMENT_AUTHOR);
    const days = result.days as Array<{ sets: Array<{ comments: Array<{ authorName: string }> }> }>;
    expect(days[0]!.sets[0]!.comments[0]!.authorName).toBe(ANONYMIZED_COMMENT_AUTHOR);
  });

  it('changed bleibt false, wenn nirgends ein Treffer vorliegt', () => {
    const plan = { comments: [makeComment({ authorName: 'Jens Bauer' })], days: [] };
    const result = anonymizePlanCommentAuthors(plan, 'Mara Vogel');
    expect(result.changed).toBe(false);
  });
});

describe('anonymizeExerciseCommentAuthors', () => {
  it('anonymisiert Kommentare im Übungskatalog', () => {
    const result = anonymizeExerciseCommentAuthors({ comments: [makeComment()] }, 'Mara Vogel');
    expect(result.changed).toBe(true);
    expect((result.comments as Array<{ authorName: string }>)[0]!.authorName).toBe(ANONYMIZED_COMMENT_AUTHOR);
  });
});

describe('anonymizeTemplateCommentAuthors', () => {
  it('anonymisiert Kommentare in Template.sets (identische Struktur wie Plan.days[].sets)', () => {
    const template = { sets: [{ kind: 'set', id: 's1', comments: [makeComment()] }] };
    const result = anonymizeTemplateCommentAuthors(template, 'Mara Vogel');
    expect(result.changed).toBe(true);
    expect((result.sets as Array<{ comments: Array<{ authorName: string }> }>)[0]!.comments[0]!.authorName).toBe(ANONYMIZED_COMMENT_AUTHOR);
  });
});
