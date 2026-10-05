import { ICONS } from '@uwusuite/design';
import { describe, expect, it } from 'vitest';
import { APP_ICONS, NOTES_ICONS } from './icons';

describe('icon vocabulary', () => {
  it('never gives a suite glyph a second meaning', () => {
    const suite = new Set<unknown>(Object.values(ICONS));
    for (const [meaning, glyph] of Object.entries(NOTES_ICONS)) {
      expect(suite.has(glyph), meaning).toBe(false);
    }
  });

  it('uses each glyph for one meaning only', () => {
    const glyphs = Object.values(NOTES_ICONS);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  it('does not redefine a suite meaning', () => {
    for (const meaning of Object.keys(NOTES_ICONS)) {
      expect(meaning in ICONS, meaning).toBe(false);
    }
    expect(Object.keys(APP_ICONS).length).toBe(
      Object.keys(ICONS).length + Object.keys(NOTES_ICONS).length,
    );
  });
});
