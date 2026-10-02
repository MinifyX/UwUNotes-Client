/** The notebook view's search, preview line and relative dates. */

import { describe, expect, it } from 'vitest';
import { matchesQuery, PREVIEW_CHARS, previewLine, relativeAge } from './notebook-list';

describe('matchesQuery', () => {
  const note = { name: 'Einkauf', text: 'Brot\nMilch\nKatzenfutter' };

  it('matches every word anywhere in title or text, ignoring case', () => {
    expect(matchesQuery(note, 'einkauf milch')).toBe(true);
    expect(matchesQuery(note, 'KATZEN')).toBe(true);
    expect(matchesQuery(note, 'einkauf käse')).toBe(false);
  });

  it('matches everything for an empty query', () => {
    expect(matchesQuery(note, '   ')).toBe(true);
  });
});

describe('previewLine', () => {
  it('shows what comes after the first line, flattened', () => {
    expect(previewLine('Titel\n\nerste Zeile\n  zweite  Zeile')).toBe('erste Zeile zweite Zeile');
  });

  it('falls back to the first line when there is nothing else', () => {
    expect(previewLine('\n  nur eine Zeile  \n')).toBe('nur eine Zeile');
  });

  it('is empty for an empty text and clipped for a long one', () => {
    expect(previewLine('')).toBe('');
    const long = previewLine(`T\n${'x'.repeat(500)}`);
    expect([...long].length).toBe(PREVIEW_CHARS);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('relativeAge', () => {
  const now = 1_790_000_000_000;

  it('picks the largest unit that fits', () => {
    expect(relativeAge(now - 30_000, now)).toEqual({ value: 0, unit: 'minute' });
    expect(relativeAge(now - 5 * 60_000, now)).toEqual({ value: -5, unit: 'minute' });
    expect(relativeAge(now - 3 * 3_600_000, now)).toEqual({ value: -3, unit: 'hour' });
    expect(relativeAge(now - 2 * 86_400_000, now)).toEqual({ value: -2, unit: 'day' });
  });

  it('never reads a clock skew as the future', () => {
    expect(relativeAge(now + 60_000, now)).toEqual({ value: 0, unit: 'minute' });
  });
});
