/**
 * The arithmetic behind the notebook view: what a search matches, what the
 * preview line under a trashed note says, and how old an entry reads.
 *
 * Pure, so it is tested without a window; `components/sidebar/NotebookView.tsx`
 * does the drawing.
 */

/** What the search looks at for one row: its title, and as much text as is at hand. */
export type Searchable = { name: string; text: string };

/**
 * Case-insensitive, every word somewhere in title or text. `einkauf milch`
 * finds the note called "Einkauf" that mentions milk on line five.
 */
export function matchesQuery(item: Searchable, query: string): boolean {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${item.name}\n${item.text}`.toLocaleLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** One line of preview, short enough for a sidebar row. */
export const PREVIEW_CHARS = 90;

/**
 * The line under a note's title: what comes after the first line, flattened.
 *
 * The first line is skipped because for an untitled note it *is* the title,
 * and repeating it underneath tells nobody anything. When there is nothing
 * after it, the first line is the preview after all — a file's name and its
 * first line are not the same thing.
 */
export function previewLine(text: string): string {
  const lines = text.split('\n');
  const first = lines.findIndex((line) => line.trim() !== '');
  if (first < 0) return '';
  const rest = lines
    .slice(first + 1)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const line = rest || (lines[first] ?? '').trim();
  const chars = [...line];
  return chars.length > PREVIEW_CHARS ? `${chars.slice(0, PREVIEW_CHARS - 1).join('')}…` : line;
}

/**
 * The best unit for "how long ago": the largest one that fits at least once.
 * Returns a value and unit for `Intl.RelativeTimeFormat`, negative for the past.
 */
export function relativeAge(
  then: number,
  now: number,
): { value: number; unit: Intl.RelativeTimeFormatUnit } {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (seconds >= size) return { value: -Math.floor(seconds / size), unit };
  }
  return { value: 0, unit: 'minute' };
}
