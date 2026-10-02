/**
 * Quick notes that are Markdown become Markdown, so the preview, the task
 * boxes and the outline work in them straight away — and plain notes stay
 * plain.
 */

import { describe, expect, it } from 'vitest';
import { detectNoteLanguage } from './note-language';

describe('guessing Markdown in a note', () => {
  it('takes a heading on the first line', () => {
    expect(detectNoteLanguage('# Projektideen\nirgendwas')).toBe('markdown');
    expect(detectNoteLanguage('\n\n## Einkauf')).toBe('markdown');
  });

  it('takes a task line anywhere', () => {
    expect(detectNoteLanguage('Heute:\n- [ ] Milch\n')).toBe('markdown');
    expect(detectNoteLanguage('Heute:\n* [x] erledigt')).toBe('markdown');
    expect(detectNoteLanguage('1. [ ] zuerst')).toBe('markdown');
  });

  it('takes several headings, or a heading with a list', () => {
    expect(detectNoteLanguage('Notiz\n## Eins\ntext\n## Zwei')).toBe('markdown');
    expect(detectNoteLanguage('Notiz\n## Eins\n- erstens')).toBe('markdown');
  });

  it('leaves plain notes plain', () => {
    expect(detectNoteLanguage('')).toBeNull();
    expect(detectNoteLanguage('Milch\nBrot\nKatzenfutter')).toBeNull();
    // A plain list is how plain notes look too.
    expect(detectNoteLanguage('Einkauf\n- Milch\n- Brot')).toBeNull();
    // A shebang and a hashtag are not headings.
    expect(detectNoteLanguage('#!/bin/sh\necho hi')).toBeNull();
    expect(detectNoteLanguage('#nyu ist toll')).toBeNull();
  });

  it('stays Markdown while any of it is left, and goes back once none is', () => {
    // The `# ` of the first line deleted to be retyped: still a list in it.
    expect(detectNoteLanguage('Projektideen\n- eins', 'markdown')).toBe('markdown');
    expect(detectNoteLanguage('Projektideen\n- eins', null)).toBeNull();
    expect(detectNoteLanguage('ganz anderer Text', 'markdown')).toBeNull();
  });
});
