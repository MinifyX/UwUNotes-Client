/**
 * Find and replace inside the file the user is looking at.
 *
 * The matching itself is `@codemirror/search`'s: a {@link SearchQuery} already
 * knows what "whole word" means next to a combining accent and what a regular
 * expression does across a line break, and a hand-written matcher would be
 * wrong in exactly those places. What lives here is everything around it — the
 * toggles, the running count, where the caret goes next, and the promise that
 * "replace all" is one undo step.
 *
 * It deliberately does NOT render anything and does not use the search
 * package's own panel: the bar is `components/FindBar.tsx`, because the UI has
 * to look like the rest of the app.
 *
 * The match count is polled rather than pushed. `lib/documents.ts` announces
 * metadata changes only — it stays quiet while the user types, which is the
 * whole reason typing does not re-render the window — and an editor extension
 * that reported every transaction would have to be a plugin, which the user
 * could switch off. So while the bar is open this module compares the active
 * document's `EditorState` by identity a few times a second; states are
 * immutable, so an unchanged document costs one map lookup and nothing else.
 */

import { useSyncExternalStore } from 'react';
import { SearchQuery } from '@codemirror/search';
import type { ChangeSpec, EditorState, TransactionSpec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { SearchOptions } from './api';
import { closeDialog, getUiState, openDialog } from './commands';
import { getDoc, setDocState, type DocId } from './documents';
import { t } from './i18n';
import { toast } from './toast';
import { activeView } from './views';
import { activeDocId } from './workspace';

/**
 * How many matches the readout is willing to count.
 *
 * A regular expression like `\s*` on a large file has a match at practically
 * every offset, and counting all of them would hold the main thread for as long
 * as it takes — with the window frozen and the user's finger still on the key.
 * The count stops here and says so; see {@link FindState.capped}.
 */
export const MATCH_CAP = 5_000;

/** How often the open bar checks whether the document moved underneath it. */
const POLL_MS = 120;

export type FindState = {
  open: boolean;
  /** The replace field is shown. Ctrl+H opens the bar this way, Ctrl+F does not. */
  replace: boolean;
  query: string;
  replacement: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Search only the range that was selected when this was switched on. */
  inSelection: boolean;
  /** Matches in range, never more than {@link MATCH_CAP}. */
  matches: number;
  /** 1-based index of the match the selection sits on; 0 when it sits on none. */
  current: number;
  /** The count stopped at {@link MATCH_CAP}: there are more than `matches`. */
  capped: boolean;
  /** The last {@link findNext} ran off an end and continued from the other one. */
  wrapped: boolean;
  /** An unusable search expression, in words. Never thrown. */
  error: string | null;
};

const EMPTY: FindState = {
  open: false,
  replace: false,
  query: '',
  replacement: '',
  regex: false,
  caseSensitive: false,
  wholeWord: false,
  inSelection: false,
  matches: 0,
  current: 0,
  capped: false,
  wrapped: false,
  error: null,
};

/** What {@link updateFind} is allowed to change: the inputs, never the results. */
export type FindPatch = Partial<
  Pick<
    FindState,
    'replace' | 'query' | 'replacement' | 'regex' | 'caseSensitive' | 'wholeWord' | 'inSelection'
  >
>;

let current: FindState = EMPTY;
const listeners = new Set<() => void>();

function commit(next: FindState) {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getFind(): FindState {
  return current;
}

export function useFind(): FindState {
  return useSyncExternalStore(subscribe, getFind);
}

/* ── The document being searched ───────────────────────── */

type Target = {
  id: DocId;
  state: EditorState;
  /** The editor showing this document, when one is mounted and up to date. */
  view: EditorView | undefined;
};

/**
 * The active document, and the editor showing it if there is one.
 *
 * Same rule as `applySaveFixups` in `lib/files.ts`: a mounted view owns the
 * authoritative state, but only while it is exactly the state the store holds.
 * Dispatching into a view that has moved on would undo whatever it moved on to.
 */
function target(): Target | null {
  const id = activeDocId();
  if (!id) return null;
  const doc = getDoc(id);
  if (!doc) return null;
  const view = activeView();
  const mounted = view && view.state === doc.state ? view : undefined;
  return { id, state: mounted?.state ?? doc.state, view: mounted };
}

function dispatch(spot: Target, spec: TransactionSpec): void {
  if (spot.view) {
    spot.view.dispatch(spec);
    setDocState(spot.id, spot.view.state);
    return;
  }
  setDocState(spot.id, spot.state.update(spec).state);
}

/* ── The query ─────────────────────────────────────────── */

/** A match, plus the groups when the query was a regular expression. */
type Hit = { from: number; to: number; match?: RegExpExecArray };

/**
 * The four options as CodeMirror wants them, or why they cannot be used.
 *
 * `literal` is on: a plain search finds the characters that were typed, so
 * looking for `\n` finds a backslash and an n. Turning `\n` into a line break
 * is what the regex toggle is for, and guessing between the two in the same
 * field is how a search quietly stops finding things.
 *
 * Exported because `lib/project-search.ts` searches unsaved buffers with the
 * same four flags and must agree with this one about what they mean.
 */
export function compileSearch(options: SearchOptions): {
  query: SearchQuery | null;
  error: string | null;
} {
  if (!options.query) return { query: null, error: null };
  if (options.regex) {
    try {
      new RegExp(options.query);
    } catch (problem) {
      return {
        query: null,
        error: t('Kein gültiger regulärer Ausdruck: {message}', {
          message: problem instanceof Error ? problem.message : String(problem),
        }),
      };
    }
  }
  const query = new SearchQuery({
    search: options.query,
    caseSensitive: options.caseSensitive,
    regexp: options.regex,
    wholeWord: options.wholeWord,
    literal: true,
  });
  if (!query.valid)
    return { query: null, error: t('Der Suchausdruck lässt sich nicht verwenden.') };
  return { query, error: null };
}

function compileCurrent() {
  return compileSearch({
    query: current.query,
    regex: current.regex,
    caseSensitive: current.caseSensitive,
    wholeWord: current.wholeWord,
  });
}

/**
 * `getCursor` is declared as yielding bare offsets, but the cursor behind a
 * regular-expression query is a `RegExpCursor` and hands out its `RegExpExecArray`
 * too — which is the only way `$1` in the replace field can mean anything.
 */
function cursorIn(state: EditorState, query: SearchQuery, from: number, to: number): Iterator<Hit> {
  return query.getCursor(state, from, to);
}

function firstMatchIn(
  state: EditorState,
  query: SearchQuery,
  from: number,
  to: number,
): Hit | null {
  if (from >= to) return null;
  const step = cursorIn(state, query, from, to).next();
  return step.done ? null : step.value;
}

/**
 * The last match in a range, which is how "find previous" is done: the cursors
 * only ever walk forwards, so going back means walking the range in front of
 * the caret and keeping whatever fell out of it last.
 */
function lastMatchIn(state: EditorState, query: SearchQuery, from: number, to: number): Hit | null {
  if (from >= to) return null;
  const cursor = cursorIn(state, query, from, to);
  let found: Hit | null = null;
  for (;;) {
    const step = cursor.next();
    if (step.done) return found;
    found = step.value;
  }
}

/* ── "Only in the selection" ───────────────────────────── */

/**
 * The range the toggle locked onto, and the document it belongs to.
 *
 * Kept here rather than in the state because it is not a thing the UI shows: it
 * is taken once, when the toggle goes on, and it has to survive the very next
 * thing that happens, which is the selection moving to the first match.
 *
 * Our own replacements shift its end; edits the user makes by hand do not, so
 * the range drifts if they type inside it. Switching the toggle off and on
 * again takes it afresh, which is the whole repair.
 */
let scope: { doc: DocId; from: number; to: number } | null = null;

function searchRange(spot: Target): { from: number; to: number } {
  const length = spot.state.doc.length;
  if (!current.inSelection || !scope || scope.doc !== spot.id) return { from: 0, to: length };
  return { from: Math.min(scope.from, length), to: Math.min(scope.to, length) };
}

/* ── Counting ──────────────────────────────────────────── */

/** The last state the count was taken from, so the poll can skip an idle window. */
let counted: EditorState | null = null;
let poll = 0;

function startPolling() {
  if (poll) return;
  poll = window.setInterval(() => {
    const spot = target();
    if ((spot?.state ?? null) === counted) return;
    recount();
  }, POLL_MS);
}

function stopPolling() {
  window.clearInterval(poll);
  poll = 0;
  counted = null;
}

type Tally = Pick<FindState, 'matches' | 'current' | 'capped' | 'error' | 'wrapped'>;

function applyTally(tally: Tally) {
  if (
    tally.matches === current.matches &&
    tally.current === current.current &&
    tally.capped === current.capped &&
    tally.error === current.error &&
    tally.wrapped === current.wrapped
  ) {
    return;
  }
  commit({ ...current, ...tally });
}

function recount(wrapped = current.wrapped): void {
  const spot = target();
  counted = spot?.state ?? null;
  const { query, error } = compileCurrent();
  if (!spot || !query) {
    applyTally({ matches: 0, current: 0, capped: false, error, wrapped });
    return;
  }

  const range = searchRange(spot);
  const selection = spot.state.selection.main;
  const cursor = cursorIn(spot.state, query, range.from, range.to);
  let matches = 0;
  let at = 0;
  let capped = false;
  for (;;) {
    const step = cursor.next();
    if (step.done) break;
    matches += 1;
    if (step.value.from === selection.from && step.value.to === selection.to) at = matches;
    if (matches >= MATCH_CAP) {
      capped = true;
      break;
    }
  }
  applyTally({ matches, current: at, capped, error, wrapped });
}

/* ── Opening and closing ───────────────────────────────── */

/** The selected text, when it is short enough and on one line, else nothing. */
function selectionAsQuery(state: EditorState): string {
  const selection = state.selection.main;
  if (selection.empty || selection.to - selection.from > 200) return '';
  const text = state.sliceDoc(selection.from, selection.to);
  return text.includes('\n') ? '' : text;
}

/**
 * Opens the bar, in find or in replace mode.
 *
 * A selection becomes the query, because selecting a word and reaching for
 * Ctrl+F is one gesture that means one thing. An empty selection leaves the
 * previous query alone: the second Ctrl+F of the day should still be looking
 * for what the first one was.
 */
export function openFind(replace = false): void {
  const spot = target();
  const picked = spot ? selectionAsQuery(spot.state) : '';
  commit({
    ...current,
    open: true,
    replace,
    query: picked || current.query,
    wrapped: false,
  });
  openDialog(replace ? 'replace' : 'find');
  startPolling();
  recount(false);
}

/**
 * Closes the bar and gives up the dialog slot — but only if the slot is still
 * ours. By the time this runs, something else (the command palette, say) may
 * already have taken it, and closing that would be closing the wrong thing.
 */
export function closeFind(): void {
  scope = null;
  stopPolling();
  if (current.open) commit({ ...current, open: false, wrapped: false });
  const dialog = getUiState().dialog;
  if (dialog === 'find' || dialog === 'replace') closeDialog();
}

/* ── Changing the query ────────────────────────────────── */

export function updateFind(patch: FindPatch): void {
  let next: FindState = { ...current, ...patch, wrapped: false };

  if (patch.inSelection === true && !current.inSelection) {
    const spot = target();
    const selection = spot?.state.selection.main;
    if (!spot || !selection || selection.empty) {
      // Nothing to scope to. Switching the toggle on anyway would search an
      // empty range and report zero matches, which reads like a broken search.
      toast('info', t('Für „nur in Auswahl“ zuerst Text markieren.'));
      next = { ...next, inSelection: false };
    } else {
      scope = { doc: spot.id, from: selection.from, to: selection.to };
    }
  }
  if (patch.inSelection === false) scope = null;

  commit(next);
  recount(false);
}

/* ── Moving ────────────────────────────────────────────── */

/**
 * Selects the next match and scrolls it into view, continuing from the other
 * end of the range when it runs out.
 *
 * Focus stays wherever it is: this is nearly always called from the bar's own
 * field or from Enter inside it, and yanking the caret into the document would
 * end the search after one match.
 */
export function findNext(back = false): void {
  const spot = target();
  const { query } = compileCurrent();
  if (!spot || !query) {
    recount(false);
    return;
  }

  const range = searchRange(spot);
  const selection = spot.state.selection.main;
  const from = Math.max(range.from, Math.min(selection.from, range.to));
  const to = Math.max(range.from, Math.min(selection.to, range.to));

  const ahead = back
    ? lastMatchIn(spot.state, query, range.from, from)
    : firstMatchIn(spot.state, query, to, range.to);
  const around = back
    ? lastMatchIn(spot.state, query, to, range.to)
    : firstMatchIn(spot.state, query, range.from, to);
  const hit = ahead ?? around;
  if (!hit) {
    recount(false);
    return;
  }

  select(spot, hit.from, hit.to);
  recount(ahead === null);
}

function select(spot: Target, from: number, to: number): void {
  dispatch(spot, {
    selection: { anchor: from, head: to },
    effects: EditorView.scrollIntoView(from, { y: 'center' }),
    scrollIntoView: true,
  });
}

/* ── Replacing ─────────────────────────────────────────── */

/**
 * `$&`, `$1`…`$9` and `$$` in the replace field, the way every editor means
 * them. A group that did not take part becomes nothing, and a `$7` with no
 * seventh group stays as it was typed rather than vanishing — a replacement
 * that silently eats characters is worse than one that looks odd.
 */
function replacementFor(hit: Hit): string {
  if (!hit.match) return current.replacement;
  const match = hit.match;
  return current.replacement.replace(/\$([$&\d])/g, (whole: string, token: string) => {
    if (token === '$') return '$';
    if (token === '&') return match[0];
    const index = Number(token);
    if (index < 1 || index >= match.length) return whole;
    return match[index] ?? '';
  });
}

/**
 * Replaces the match the selection is sitting on, then moves to the next one.
 *
 * With the selection somewhere else this only moves — the same behaviour as
 * every other editor, and the reason holding the Replace button walks through
 * a file instead of overwriting whatever happens to be selected.
 */
export function replaceCurrent(): void {
  const spot = target();
  const { query } = compileCurrent();
  if (!spot || !query) return;
  if (spot.state.readOnly) return;

  const range = searchRange(spot);
  const selection = spot.state.selection.main;
  const hit = firstMatchIn(spot.state, query, Math.max(range.from, selection.from), range.to);
  if (!hit || hit.from !== selection.from || hit.to !== selection.to) {
    findNext();
    return;
  }

  const insert = replacementFor(hit);
  dispatch(spot, {
    changes: { from: hit.from, to: hit.to, insert },
    selection: { anchor: hit.from + insert.length },
    userEvent: 'input.replace',
  });
  if (scope && scope.doc === spot.id) {
    scope = { ...scope, to: scope.to + insert.length - (hit.to - hit.from) };
  }
  findNext();
}

/**
 * Replaces everything in range in a single transaction.
 *
 * One transaction and not a loop of them: CodeMirror's history makes an undo
 * step per transaction, so replacing six hundred occurrences one at a time
 * would bury the state before the replacement under six hundred Ctrl+Z. This
 * is the part of find-and-replace people find out about at the worst moment.
 */
export function replaceAll(): void {
  const spot = target();
  const { query } = compileCurrent();
  if (!spot || !query) return;
  if (spot.state.readOnly) return;

  const range = searchRange(spot);
  const cursor = cursorIn(spot.state, query, range.from, range.to);
  const changes: ChangeSpec[] = [];
  let delta = 0;
  for (;;) {
    const step = cursor.next();
    if (step.done) break;
    const insert = replacementFor(step.value);
    changes.push({ from: step.value.from, to: step.value.to, insert });
    delta += insert.length - (step.value.to - step.value.from);
  }

  if (changes.length === 0) {
    toast('info', t('Nichts zu ersetzen.'));
    return;
  }

  dispatch(spot, { changes, userEvent: 'input.replace.all' });
  if (scope && scope.doc === spot.id) scope = { ...scope, to: scope.to + delta };
  toast('success', t('{count} Ersetzungen.', { count: changes.length }));
  recount(false);
}
