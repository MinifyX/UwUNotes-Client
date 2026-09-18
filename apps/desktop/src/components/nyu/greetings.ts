/**
 * The handful of lines Nyu is allowed to say.
 *
 * Three occasions only, all of them harmless: the session being restored, a
 * pane with nothing in it, and a file that saved. Nothing here ever decorates
 * an error, a conflict or a "your changes will be lost" question — a joke next
 * to a warning reads as the app not taking it seriously, and the user would be
 * right.
 *
 * `pickGreeting()` checks `tone` itself rather than leaving it to the caller:
 * there are a dozen call sites and only one of them has to forget.
 */

import { N_, t } from '../../lib/i18n';
import { getSettings } from '../../lib/settings';

export type GreetingKind = 'startup' | 'empty' | 'saved';

/** Shown while the last session is coming back. */
export const STARTUP_GREETINGS: readonly string[] = [
  N_('Nyu~ wärmt den Editor auf …'),
  N_('Nyu sucht deine Tabs zusammen.'),
  N_('Nyu legt die Dateien zurück auf den Tisch.'),
  N_('Nyu spitzt schon mal den Cursor.'),
  N_('Nyu~ sortiert die Zeilen der Reihe nach.'),
];

/** Shown in a pane with no document in it. */
export const EMPTY_GREETINGS: readonly string[] = [
  N_('Nichts offen. Nyu hält Zeile 1 frei.'),
  N_('Leere Seite. Nyu findet das ehrlich gesagt entspannend.'),
  N_('Nyu döst auf dem Notizblock.'),
  N_('Kein Dokument. Nyu wartet mit einem leeren Blatt.'),
];

/** Shown after a file went to disk without complaint. */
export const SAVED_GREETINGS: readonly string[] = [
  N_('Gespeichert. Nyu nickt kurz.'),
  N_('Gespeichert. Nyu legt das Blatt auf den Stapel.'),
  N_('Auf der Platte. Nyu~ ist zufrieden.'),
  N_('Gespeichert. Nyu streicht einen Punkt von der Liste.'),
];

const GREETINGS: Record<GreetingKind, readonly string[]> = {
  startup: STARTUP_GREETINGS,
  empty: EMPTY_GREETINGS,
  saved: SAVED_GREETINGS,
};

/**
 * These two are drawn inside components that repaint on every keystroke around
 * them, so their line is drawn once per run and then kept. A save toast is
 * built once and read once, so it may have a fresh line each time.
 */
const KEPT_FOR_THE_RUN: ReadonlySet<GreetingKind> = new Set<GreetingKind>(['startup', 'empty']);

const chosen = new Map<GreetingKind, number>();

function indexFor(kind: GreetingKind, count: number): number {
  if (!KEPT_FOR_THE_RUN.has(kind)) return Math.floor(Math.random() * count);
  const kept = chosen.get(kind);
  if (kept !== undefined) return kept;
  const fresh = Math.floor(Math.random() * count);
  chosen.set(kind, fresh);
  return fresh;
}

/**
 * One of Nyu's lines for this occasion, in the current language — or an empty
 * string when the tone is `neutral`, which callers render as nothing at all.
 * The index is kept, not the translated line, so switching language mid-run
 * changes the words and not the joke.
 */
export function pickGreeting(kind: GreetingKind): string {
  if (getSettings().tone === 'neutral') return '';
  const lines = GREETINGS[kind];
  const line = lines[indexFor(kind, lines.length)];
  return line === undefined ? '' : t(line);
}
