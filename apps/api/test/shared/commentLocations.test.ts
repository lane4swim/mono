import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ENTITY_SCHEMAS, type EntityStoreName } from '@lane1/shared-types';
import { COMMENT_BEARING_STORES, collectCommentArrays, mapCommentArrays } from '../../src/modules/shared/commentLocations.js';

const C1 = { id: 'c1', authorName: 'A', text: 'eins' };
const C2 = { id: 'c2', authorName: 'B', text: 'zwei' };
const C3 = { id: 'c3', authorName: 'C', text: 'drei' };

describe('COMMENT_LOCATIONS', () => {
  // Leitet die Stores mit Kommentaren aus den Zod-Schemas selbst ab: bekommt
  // ein weiterer Store ein CommentSchema-Feld, ohne in COMMENT_LOCATIONS
  // aufgenommen zu werden, würden seine Kommentare weder bei der
  // Autor:innen-Prüfung noch beim Purge erfasst.
  it('deckt genau die Stores ab, deren Schema Kommentare einbettet', () => {
    const storesWithComments = (Object.keys(ENTITY_SCHEMAS) as EntityStoreName[]).filter((store) =>
      JSON.stringify(z.toJSONSchema(ENTITY_SCHEMAS[store], { unrepresentable: 'any' })).includes('"authorName"'),
    );
    expect(new Set(storesWithComments)).toEqual(COMMENT_BEARING_STORES);
  });
});

describe('collectCommentArrays()', () => {
  it('sammelt Plan-weite und je Satz verschachtelte Kommentare', () => {
    const plan = { comments: [C1], days: [{ sets: [{ kind: 'set', comments: [C2] }, { kind: 'block', sets: [{ kind: 'set', comments: [C3] }] }] }] };
    expect(collectCommentArrays('plans', plan)).toEqual([[C1], [C2], [C3]]);
  });

  it('zählt fehlende Arrays als leer und liefert für null nichts', () => {
    expect(collectCommentArrays('results', {})).toEqual([[]]);
    expect(collectCommentArrays('templates', null)).toEqual([]);
  });
});

describe('mapCommentArrays()', () => {
  const dropFirst = (comments: unknown) =>
    Array.isArray(comments) && comments.length > 0 ? { changed: true, value: comments.slice(1) } : { changed: false, value: comments };

  it('liefert jedes Kommentar-Feld des Stores, auch das unveränderte', () => {
    const plan = { comments: [], days: [{ sets: [{ kind: 'set', comments: [C1, C2] }] }] };
    const { changed, fields } = mapCommentArrays('plans', plan, dropFirst);
    expect(changed).toBe(true);
    expect(fields).toEqual({ comments: [], days: [{ sets: [{ kind: 'set', comments: [C2] }] }] });
  });

  it('meldet keine Änderung, wenn kein Array verändert wird', () => {
    const { changed } = mapCommentArrays('sectionTemplates', { entries: [{ kind: 'set', comments: [] }] }, dropFirst);
    expect(changed).toBe(false);
  });
});
