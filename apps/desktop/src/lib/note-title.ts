/**
 * What an untitled note is called: its first line.
 *
 * A notebook full of `Neu 1`, `Neu 7`, `Neu 12` is a notebook nobody can find
 * anything in, and asking for a name before writing is exactly the friction a
 * scratch buffer exists to avoid. So the note names itself after whatever it
 * starts with, the way a paper note is known by its first line.
 *
 * Pure on purpose: `lib/notebook.ts` decides when to ask, `lib/documents.ts`
 * owns the name, and this only answers "what would the title be".
 */

/** Long enough to tell notes apart on a tab, short enough to fit on one. */
export const MAX_TITLE_CHARS = 40;

/**
 * Only the start of a note is looked at. A buffer that opens with ten thousand
 * blank lines is not worth walking for a tab label.
 */
const SCAN_CHARS = 4_000;

/**
 * Markdown and list decoration in front of the words: `# `, `> `, `- `, `* `,
 * `+ `, `1. `, `2) `, and a task box after any of them. Stripped repeatedly,
 * so `> - [ ] Milch` comes out as `Milch`.
 */
const LEADING_MARKS = /^(?:#{1,6}(?=\s|$)|>|[-*+](?=\s)|\d{1,9}[.)](?=\s)|\[[ xX]\](?=\s|$))\s*/;

/**
 * The title for a note, or `null` when it has nothing to be called by — empty,
 * blank, or nothing but decoration — and should stay `Neu n`.
 */
export function noteTitle(text: string): string | null {
  for (const raw of text.slice(0, SCAN_CHARS).split('\n')) {
    let line = raw.trim();
    for (let guard = 0; guard < 8; guard += 1) {
      const next = line.replace(LEADING_MARKS, '');
      if (next === line) break;
      line = next;
    }
    // Closing hashes of an ATX heading (`## Title ##`) and runs of whitespace.
    line = line
      .replace(/\s+#+\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    // A line of nothing but rule or fence characters is decoration too.
    if (!line || /^[-=_*~`#>]+$/.test(line)) continue;
    return clip(line);
  }
  return null;
}

/** Cuts at a word boundary where there is one close enough, with an ellipsis. */
function clip(line: string): string {
  const chars = [...line];
  if (chars.length <= MAX_TITLE_CHARS) return line;
  const cut = chars.slice(0, MAX_TITLE_CHARS - 1).join('');
  const space = cut.lastIndexOf(' ');
  const base = space >= MAX_TITLE_CHARS / 2 ? cut.slice(0, space) : cut;
  return `${base.trimEnd()}…`;
}

/**
 * Characters no file name may hold on at least one of the systems this runs
 * on — the same set `isPlainFileName` in `lib/files.ts` refuses.
 */
const BAD_FILE_CHARS = /[\\/:*?"<>|\p{Cc}]/gu;

/** Device names Windows will not let a file be called, with any extension. */
const RESERVED = /^(?:con|prn|aux|nul|com\d|lpt\d)$/i;

/**
 * A file name to suggest in "Save as" for a note with this title.
 *
 * `language` is the note's hand-picked language: markdown gets `.md`, every
 * other note `.txt`, since a note without a path has no extension of its own.
 * `fallback` stands in when nothing usable is left of the title — a note
 * called `???`, or `CON`.
 */
export function suggestedFileName(
  title: string,
  language: string | null,
  fallback: string,
): string {
  const extension = language === 'markdown' ? 'md' : 'txt';
  let base = title
    .replace(/…$/, '')
    .replace(BAD_FILE_CHARS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // Windows drops trailing dots and spaces silently; a leading dot hides the
    // file everywhere else.
    .replace(/^[.\s]+|[.\s]+$/g, '');
  base = [...base].slice(0, 60).join('').trim();
  if (!base || RESERVED.test(base)) base = fallback;
  return `${base}.${extension}`;
}
