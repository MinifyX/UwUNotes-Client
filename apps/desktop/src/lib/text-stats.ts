/**
 * Counting words, characters and paragraphs, for the status bar.
 *
 * Pure functions over strings, so they can be tested without an editor and
 * called from wherever the text happens to be. The status bar decides *when*
 * to count (debounced, never on the keystroke itself); this module decides
 * *how*, and how much work a count is allowed to be.
 *
 * ## What a word is
 *
 * `Intl.Segmenter` with word granularity, where the webview has it — which is
 * every one this app ships on today. It knows that `geht's` is one word, that
 * `ß` and `ü` are letters, and that Japanese has no spaces and still has
 * words. Two things are adjusted on top of what it reports:
 *
 * - **Hyphenated compounds are one word.** ICU breaks `E-Mail-Adresse` into
 *   three, but every word processor counts it as one, and so does anybody
 *   checking an essay against a word limit.
 * - **Only word-like segments count.** Punctuation and whitespace are
 *   segments too; an operator in code is not a word.
 *
 * Where there is no segmenter, a regular expression stands in: runs of
 * letters, digits and joiners, with each CJK ideograph or kana counted on its
 * own — the same rule Word applies to East Asian text.
 *
 * ## Huge files
 *
 * Segmenting runs at a few tens of megabytes a second. A 50 MB log would cost
 * a visible pause every time typing stopped, so above {@link EXACT_LIMIT} the
 * words, paragraphs and non-space characters are *estimated* from the first
 * {@link SAMPLE_SIZE} characters and the result says so. Line counts stay
 * exact: CodeMirror already knows them.
 */

/** Above this many UTF-16 units, counts are extrapolated from a sample. */
export const EXACT_LIMIT = 1_000_000;

/** How much of a huge text the estimate actually reads. */
export const SAMPLE_SIZE = 200_000;

/** Words per minute: silent reading and reading aloud, for adult German prose. */
export const READING_WPM = 230;
export const SPEAKING_WPM = 130;

export type TextStats = {
  lines: number;
  words: number;
  /** Code points, without line breaks: what "characters with spaces" means everywhere. */
  characters: number;
  charactersNoSpaces: number;
  /** Runs of non-blank lines, separated by at least one blank line. */
  paragraphs: number;
  /** Extrapolated from a sample, because the text was too large to count. */
  approximate: boolean;
};

export const EMPTY_STATS: TextStats = {
  lines: 0,
  words: 0,
  characters: 0,
  charactersNoSpaces: 0,
  paragraphs: 0,
  approximate: false,
};

/** The hyphens that glue a compound together: ASCII, U+2010 and the non-breaking one. */
const HYPHENS = new Set(['-', '‐', '‑']);

/** Narrowed to what this module calls, so a test can hand in `null` for "none". */
export type WordSegmenter = Pick<Intl.Segmenter, 'segment'>;

let cachedSegmenter: WordSegmenter | null | undefined;

/**
 * One segmenter for the whole app. Building one loads ICU's break rules, which
 * is far more expensive than using one, and the locale makes no difference to
 * word boundaries in the languages this app is written in.
 */
export function defaultSegmenter(): WordSegmenter | null {
  if (cachedSegmenter !== undefined) return cachedSegmenter;
  try {
    cachedSegmenter =
      typeof Intl !== 'undefined' && 'Segmenter' in Intl
        ? new Intl.Segmenter(undefined, { granularity: 'word' })
        : null;
  } catch {
    cachedSegmenter = null;
  }
  return cachedSegmenter;
}

/** Words in `text`. `segmenter` is for tests; `null` forces the fallback. */
export function countWords(
  text: string,
  segmenter: WordSegmenter | null = defaultSegmenter(),
): number {
  if (!text) return 0;
  return segmenter ? countWithSegmenter(text, segmenter) : countWithRegex(text);
}

function countWithSegmenter(text: string, segmenter: WordSegmenter): number {
  let count = 0;
  // Where the last word ended, and where a word would have to start to be the
  // second half of a hyphenated compound. -1 means "no compound in progress".
  let lastWordEnd = -1;
  let joinAt = -1;
  for (const part of segmenter.segment(text)) {
    if (part.isWordLike) {
      if (part.index !== joinAt) count += 1;
      lastWordEnd = part.index + part.segment.length;
      joinAt = -1;
    } else if (HYPHENS.has(part.segment) && part.index === lastWordEnd) {
      joinAt = part.index + part.segment.length;
    } else {
      joinAt = -1;
    }
  }
  return count;
}

/**
 * The fallback. A CJK character is a word by itself, and the lookahead keeps
 * the second alternative from swallowing one into a Latin run beside it.
 */
const WORD_PATTERN =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]|(?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[\p{L}\p{N}\p{M}_])+(?:['’\-‐‑](?:(?![\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])[\p{L}\p{N}\p{M}_])+)*/gu;

function countWithRegex(text: string): number {
  let count = 0;
  WORD_PATTERN.lastIndex = 0;
  while (WORD_PATTERN.exec(text)) count += 1;
  return count;
}

/** Spaces of every width, the BOM and the control range — none of them ink. */
function isSpace(code: number): boolean {
  return (
    code <= 32 ||
    code === 0x7f ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200b) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000 ||
    code === 0xfeff
  );
}

/**
 * Everything but the words, in one pass over the char codes.
 *
 * A loop over `charCodeAt` rather than `for…of` or a handful of regular
 * expressions: it allocates nothing, and a megabyte of text is a couple of
 * milliseconds. A low surrogate is the second half of a code point that was
 * already counted, so it is skipped rather than counted twice.
 */
function countShape(text: string): Omit<TextStats, 'words' | 'approximate'> {
  if (!text) return { lines: 0, characters: 0, charactersNoSpaces: 0, paragraphs: 0 };
  let lines = 1;
  let characters = 0;
  let charactersNoSpaces = 0;
  let paragraphs = 0;
  let lineHasInk = false;
  let inParagraph = false;

  const endLine = () => {
    if (lineHasInk) {
      if (!inParagraph) paragraphs += 1;
      inParagraph = true;
    } else {
      inParagraph = false;
    }
    lineHasInk = false;
  };

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 10) {
      lines += 1;
      endLine();
      continue;
    }
    if (code === 13) continue;
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    characters += 1;
    if (!isSpace(code)) {
      charactersNoSpaces += 1;
      lineHasInk = true;
    }
  }
  endLine();
  return { lines, characters, charactersNoSpaces, paragraphs };
}

/** Exact counts for a string. Callers keep it under {@link EXACT_LIMIT}. */
export function textStats(
  text: string,
  segmenter: WordSegmenter | null = defaultSegmenter(),
): TextStats {
  return { ...countShape(text), words: countWords(text, segmenter), approximate: false };
}

/**
 * Counts for a text too large to read, from its beginning.
 *
 * `length` and `lines` are the real totals, which the caller has for free from
 * CodeMirror's `Text`. Everything else is the sample's density scaled up to
 * the full length — wrong for a file whose first 200 000 characters look
 * nothing like the rest, and still the right order of magnitude, which is all
 * a status bar promises with a `≈` in front of it.
 */
export function estimateStats(
  sample: string,
  length: number,
  lines: number,
  segmenter: WordSegmenter | null = defaultSegmenter(),
): TextStats {
  const measured = textStats(sample, segmenter);
  const scale = sample.length > 0 ? length / sample.length : 0;
  return {
    lines,
    words: Math.round(measured.words * scale),
    // Line breaks are one unit each and not characters; surrogate pairs are
    // too rare in a log to correct for here.
    characters: Math.max(0, length - Math.max(0, lines - 1)),
    charactersNoSpaces: Math.round(measured.charactersNoSpaces * scale),
    paragraphs: Math.round(measured.paragraphs * scale),
    approximate: true,
  };
}

/**
 * Minutes to read `words` at `wpm`, rounded to a whole minute. Anything at all
 * takes at least one: "0 minutes" for a paragraph reads like a bug.
 */
export function minutesFor(words: number, wpm: number): number {
  if (words <= 0 || wpm <= 0) return 0;
  return Math.max(1, Math.round(words / wpm));
}
