/**
 * What an untitled note is written in, guessed from what it says.
 *
 * A note has no file name to go by, so it stayed plain text even when it was
 * plainly Markdown — and with it the preview (Ctrl+Shift+V), the task boxes
 * and the outline stayed out of reach in exactly the quick notes that use
 * them most. Only Markdown is guessed: it is what people type into a scratch
 * buffer, and being wrong about it costs a little colour, not a broken file.
 *
 * Pure on purpose, like `lib/note-title.ts`: `lib/notebook.ts` decides when to
 * ask, `lib/documents.ts` keeps the answer on the document, and
 * `editor/languages.ts` uses it only for a document with no path and no
 * language picked by hand.
 */

/** Only the start of a note is looked at; a guess must stay cheap. */
const SCAN_CHARS = 8_000;

const HEADING = /^#{1,6}\s+\S/;
const TASK = /^\s*(?:[-*+]|\d{1,9}[.)])\s+\[[ xX]\](?:\s|$)/;
const LIST = /^\s*(?:[-*+]|\d{1,9}[.)])\s+\S/;
const FENCE = /^\s*(?:```|~~~)/;

/**
 * `'markdown'` when the text looks like Markdown, `null` otherwise.
 *
 * Getting there takes a clear sign: a first line that is a heading, a task
 * line, two headings, or a heading with a list. A shopping list of `- ` lines
 * alone is not enough — that is how plain notes look too.
 *
 * `current` is the guess so far. Once a note is Markdown it stays so while
 * any Markdown is left in it — a heading, a list line, a fence — so deleting
 * the `# ` of the first line to retype it does not flip the language back and
 * forth under the cursor. Only text with none of that left goes back.
 */
export function detectNoteLanguage(text: string, current: string | null = null): string | null {
  let headings = 0;
  let lists = 0;
  let fences = 0;
  let first = true;
  for (const line of text.slice(0, SCAN_CHARS).split('\n')) {
    if (line.trim() === '') continue;
    const heading = HEADING.test(line);
    if (first && heading) return 'markdown';
    first = false;
    if (TASK.test(line)) return 'markdown';
    if (heading) headings += 1;
    else if (LIST.test(line)) lists += 1;
    else if (FENCE.test(line)) fences += 1;
    if (headings >= 2 || (headings >= 1 && lists >= 1)) return 'markdown';
  }
  if (current === 'markdown' && headings + lists + fences > 0) return 'markdown';
  return null;
}
