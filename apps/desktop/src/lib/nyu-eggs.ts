/**
 * The easter eggs' ears: words Nyu answers to, and the Konami code.
 *
 * Both detectors are fed one key at a time by `lib/nyu.ts` and know nothing
 * about the DOM, so they are plain objects with a `push()` and tested without
 * an editor. Neither looks at the document: the egg fires on what was just
 * typed, not on what is in the file, so opening a README full of "uwu" does
 * not set off a party.
 */

export type EggWord = 'uwu' | 'owo' | 'nyu' | 'meow';

/** Spelling → the reaction. `miau` is the German cat; both get the same answer. */
const WORDS: readonly (readonly [string, EggWord])[] = [
  ['uwu', 'uwu'],
  ['owo', 'owo'],
  ['nyu', 'nyu'],
  ['miau', 'meow'],
  ['meow', 'meow'],
];

const LONGEST = Math.max(...WORDS.map(([spelling]) => spelling.length));

/** A letter of any script, so "äuwu" is not a word boundary but "(uwu" is. */
const LETTER = /\p{L}/u;

/**
 * Spots one of the words the moment its last letter is typed — as a word of its
 * own, so "Kuwu" or "ownowo" do not count, and only once per typing: "uwuwu"
 * fires for the first "uwu" and not again for the overlapping one.
 */
export class EggDetector {
  private buffer = '';

  /** Feeds one typed character; returns the word it completed, if any. */
  push(character: string): EggWord | null {
    if (character.length !== 1 && [...character].length !== 1) {
      // Pasted text, an IME commit: not typing, and not a reason to keep the tail.
      this.buffer = '';
      return null;
    }
    this.buffer = (this.buffer + character.toLowerCase()).slice(-(LONGEST + 1));
    for (const [spelling, word] of WORDS) {
      if (!this.buffer.endsWith(spelling)) continue;
      const before = this.buffer.slice(0, -spelling.length).slice(-1);
      if (before && LETTER.test(before)) continue;
      // Forget what made the match, so the overlap does not fire again.
      this.buffer = '';
      return word;
    }
    return null;
  }

  /** The caret jumped, a dialog opened: what was typed before is not one word with what follows. */
  reset(): void {
    this.buffer = '';
  }
}

/** ↑ ↑ ↓ ↓ ← → ← → B A, as `KeyboardEvent.key` spells it (letters compared lower-case). */
export const KONAMI: readonly string[] = [
  'ArrowUp',
  'ArrowUp',
  'ArrowDown',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowLeft',
  'ArrowRight',
  'b',
  'a',
];

/** Watches the key sequence for the Konami code. */
export class KonamiDetector {
  private position = 0;

  /** Feeds one `KeyboardEvent.key`; returns true when it completed the code. */
  push(key: string): boolean {
    const normal = key.length === 1 ? key.toLowerCase() : key;
    if (normal === KONAMI[this.position]) {
      this.position += 1;
      if (this.position === KONAMI.length) {
        this.position = 0;
        return true;
      }
      return false;
    }
    // A wrong key may still be the start of a new attempt (↑ ↑ ↑ ↓ ↓ …).
    this.position = normal === KONAMI[0] ? (this.position === 2 ? 2 : 1) : 0;
    return false;
  }
}
