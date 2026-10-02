/**
 * What an untitled note calls itself, and what "Save as" offers for it.
 *
 * Both end up somewhere the user reads all day — the tab, the save dialog —
 * so the cases are the ones people actually type: a markdown heading, a
 * shopping list, a line far too long for a tab.
 */

import { describe, expect, it } from 'vitest';
import { MAX_TITLE_CHARS, noteTitle, suggestedFileName } from './note-title';

describe('noteTitle', () => {
  it('takes the first line that has words in it', () => {
    expect(noteTitle('\n\n   \nEinkaufsliste\nMilch')).toBe('Einkaufsliste');
  });

  it('strips markdown headings, quotes, list markers and task boxes', () => {
    expect(noteTitle('# Projektideen')).toBe('Projektideen');
    expect(noteTitle('### Ideen ###')).toBe('Ideen');
    expect(noteTitle('> - [ ] Milch kaufen')).toBe('Milch kaufen');
    expect(noteTitle('1. Erstens')).toBe('Erstens');
    expect(noteTitle('* [x] erledigt')).toBe('erledigt');
  });

  it('skips lines that are only decoration', () => {
    expect(noteTitle('---\n# \n```\nEchter Titel')).toBe('Echter Titel');
  });

  it('is null for a note with nothing to be called by', () => {
    expect(noteTitle('')).toBeNull();
    expect(noteTitle('  \n\t\n')).toBeNull();
    expect(noteTitle('#\n-\n')).toBeNull();
  });

  it('collapses inner whitespace', () => {
    expect(noteTitle('  viel    Platz\there  ')).toBe('viel Platz here');
  });

  it('clips long lines at a word, with an ellipsis', () => {
    const title = noteTitle(
      'Das ist eine ziemlich lange erste Zeile, die niemals auf einen Tab passt',
    );
    expect(title).not.toBeNull();
    expect([...(title ?? '')].length).toBeLessThanOrEqual(MAX_TITLE_CHARS);
    expect(title?.endsWith('…')).toBe(true);
    expect(title?.startsWith('Das ist eine ziemlich lange')).toBe(true);
  });

  it('does not split a character made of two code units', () => {
    const title = noteTitle('😺'.repeat(60)) ?? '';
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe('suggestedFileName', () => {
  it('adds .txt, or .md for markdown', () => {
    expect(suggestedFileName('Einkaufsliste', null, 'Neu 1')).toBe('Einkaufsliste.txt');
    expect(suggestedFileName('Projektideen', 'markdown', 'Neu 1')).toBe('Projektideen.md');
  });

  it('replaces characters no file name may hold', () => {
    expect(suggestedFileName('a/b: c?*', null, 'Neu 1')).toBe('a b c.txt');
  });

  it('drops a clipping ellipsis and edge dots', () => {
    expect(suggestedFileName('.versteckt…', null, 'Neu 1')).toBe('versteckt.txt');
  });

  it('falls back when nothing usable is left', () => {
    expect(suggestedFileName('???', null, 'Neu 4')).toBe('Neu 4.txt');
    expect(suggestedFileName('CON', null, 'Neu 4')).toBe('Neu 4.txt');
  });
});
