/**
 * The easter-egg ears: words typed as words, and the Konami code.
 */

import { describe, expect, it } from 'vitest';
import { EggDetector, KONAMI, KonamiDetector } from './nyu-eggs';

function typeInto(detector: EggDetector, text: string): (string | null)[] {
  return [...text].map((character) => detector.push(character));
}

describe('magic words', () => {
  it('answers each word on its last letter, in any case', () => {
    expect(typeInto(new EggDetector(), 'uwu')).toEqual([null, null, 'uwu']);
    expect(typeInto(new EggDetector(), 'OwO').at(-1)).toBe('owo');
    expect(typeInto(new EggDetector(), 'nyu').at(-1)).toBe('nyu');
    expect(typeInto(new EggDetector(), 'miau').at(-1)).toBe('meow');
    expect(typeInto(new EggDetector(), 'meow').at(-1)).toBe('meow');
  });

  it('wants a word of its own, not the end of a longer one', () => {
    expect(typeInto(new EggDetector(), 'kuwu')).not.toContain('uwu');
    expect(typeInto(new EggDetector(), 'ännyu')).not.toContain('nyu');
    expect(typeInto(new EggDetector(), '(uwu')).toContain('uwu');
    expect(typeInto(new EggDetector(), 'hi nyu')).toContain('nyu');
  });

  it('does not fire again for an overlapping second match', () => {
    const fired = typeInto(new EggDetector(), 'uwuwu').filter(Boolean);
    expect(fired).toEqual(['uwu']);
  });

  it('forgets what came before a reset', () => {
    const detector = new EggDetector();
    typeInto(detector, 'uw');
    detector.reset();
    expect(detector.push('u')).toBeNull();
  });
});

describe('the Konami code', () => {
  it('completes on the final A, and only then', () => {
    const detector = new KonamiDetector();
    const results = KONAMI.map((key) => detector.push(key));
    expect(results.slice(0, -1).every((result) => !result)).toBe(true);
    expect(results.at(-1)).toBe(true);
  });

  it('accepts a capital B and A, and survives an extra ↑ at the start', () => {
    const detector = new KonamiDetector();
    const keys = ['ArrowUp', ...KONAMI.slice(0, 8), 'B', 'A'];
    expect(keys.map((key) => detector.push(key)).at(-1)).toBe(true);
  });

  it('starts over after a wrong key', () => {
    const detector = new KonamiDetector();
    for (const key of KONAMI.slice(0, 5)) detector.push(key);
    detector.push('x');
    expect(
      KONAMI.slice(5)
        .map((key) => detector.push(key))
        .at(-1),
    ).toBe(false);
    expect(KONAMI.map((key) => detector.push(key)).at(-1)).toBe(true);
  });
});
