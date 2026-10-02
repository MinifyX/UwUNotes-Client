/**
 * Bookmarks, Notepad++'s blue dots — here a pink one, because a bookmark is
 * "this line", and pink means "this one".
 *
 * A bookmark is a point at the start of its line in a `RangeSet`, kept in a
 * `StateField` of the document's own state. That is what makes it move with
 * the text: every transaction maps the set through its changes, so typing ten
 * lines above a bookmark carries it ten lines down, and switching tabs, moving
 * the tab to another pane or undoing all leave it where it belongs without
 * anyone keeping a second list in step.
 *
 * Three decisions about how a mark moves:
 *
 * - **Text inserted at the very start of the line pushes the mark along with
 *   it** (`startSide` 1). Pressing Enter at the start of a bookmarked line
 *   moves the line down, and the bookmark is on the line, not on the gap.
 * - **A mark is only lost when the deletion spans it** (`TrackDel`). Deleting
 *   the line above, newline and all, joins nothing to the bookmarked line and
 *   must not take its mark.
 * - **A whole-document replacement keeps the line numbers.** Reloading a file
 *   from disk replaces every character at once, and mapping through that would
 *   drop every mark in the file; Notepad++ keeps them by line, and so does
 *   this.
 *
 * Bookmarks are not part of the undo history. Toggling one is not an edit, and
 * Ctrl+Z taking back a bookmark instead of the last thing typed would surprise
 * everyone. Deleting the bookmarked *lines* is an edit, and is undoable.
 */

import {
  EditorSelection,
  MapMode,
  RangeSet,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Transaction,
} from '@codemirror/state';
import { EditorView, gutter, GutterMarker } from '@codemirror/view';
import { emitNyu } from '../lib/nyu-events';

class BookmarkMarker extends GutterMarker {
  override eq(other: GutterMarker): boolean {
    return other instanceof BookmarkMarker;
  }

  override toDOM(): Node {
    const dot = document.createElement('span');
    dot.className = 'cm-bookmark-marker';
    return dot;
  }
}
BookmarkMarker.prototype.mapMode = MapMode.TrackDel;
BookmarkMarker.prototype.startSide = BookmarkMarker.prototype.endSide = 1;

const marker = new BookmarkMarker();

/** Flips the bookmark on the line containing this position. */
export const toggleBookmarkEffect = StateEffect.define<number>({
  map: (position, mapping) => mapping.mapPos(position),
});

/** Replaces all bookmarks with these 1-based line numbers — the session restore. */
export const setBookmarksEffect = StateEffect.define<readonly number[]>();

function fromLines(state: EditorState, lines: readonly number[]): RangeSet<GutterMarker> {
  const wanted = [...new Set(lines)]
    .filter((line) => Number.isInteger(line) && line >= 1 && line <= state.doc.lines)
    .sort((a, b) => a - b);
  const builder = new RangeSetBuilder<GutterMarker>();
  for (const line of wanted) {
    const from = state.doc.line(line).from;
    builder.add(from, from, marker);
  }
  return builder.finish();
}

function linesOf(set: RangeSet<GutterMarker>, state: EditorState): number[] {
  const lines: number[] = [];
  const cursor = set.iter();
  while (cursor.value) {
    const line = state.doc.lineAt(Math.min(cursor.from, state.doc.length)).number;
    if (lines[lines.length - 1] !== line) lines.push(line);
    cursor.next();
  }
  return lines;
}

/** Did this transaction replace the entire document in one go? */
function replacedEverything(tr: Transaction): boolean {
  const length = tr.startState.doc.length;
  if (length === 0) return false;
  let whole = false;
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (fromA === 0 && toA === length) whole = true;
  });
  return whole;
}

function mapThrough(set: RangeSet<GutterMarker>, tr: Transaction): RangeSet<GutterMarker> {
  if (set.size === 0) return set;
  if (replacedEverything(tr)) return fromLines(tr.state, linesOf(set, tr.startState));
  const mapped = set.map(tr.changes);
  // Two marks can end up on one line — the lines between them were deleted —
  // and a line has one bookmark or none. Rebuilding by line folds them.
  return mapped.size > 1 ? fromLines(tr.state, linesOf(mapped, tr.state)) : mapped;
}

export const bookmarkField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    let next = tr.docChanged ? mapThrough(set, tr) : set;
    for (const effect of tr.effects) {
      if (effect.is(setBookmarksEffect)) {
        next = fromLines(tr.state, effect.value);
      } else if (effect.is(toggleBookmarkEffect)) {
        const line = tr.state.doc.lineAt(Math.min(effect.value, tr.state.doc.length));
        let had = false;
        next.between(line.from, line.to, () => {
          had = true;
          return false;
        });
        next = had
          ? next.update({ filter: (from) => from < line.from || from > line.to })
          : next.update({ add: [marker.range(line.from)] });
      }
    }
    return next;
  },
});

/** The bookmarked lines, 1-based, ascending, each once. */
export function bookmarkLines(state: EditorState): number[] {
  const set = state.field(bookmarkField, false);
  return set ? linesOf(set, state) : [];
}

/* ── Acting on a view ──────────────────────────────────── */

export function toggleBookmark(view: EditorView, position = view.state.selection.main.head): void {
  const before = bookmarkLines(view.state).length;
  view.dispatch({ effects: toggleBookmarkEffect.of(position) });
  if (bookmarkLines(view.state).length > before) emitNyu('bookmark-added');
}

export function clearBookmarks(view: EditorView): void {
  view.dispatch({ effects: setBookmarksEffect.of([]) });
}

/**
 * Moves the caret to the next bookmark after the caret's line — or the
 * previous one before it — wrapping around the end of the file the way F2
 * does in Notepad++. Returns `false` when there are none.
 */
export function gotoBookmark(view: EditorView, backwards = false): boolean {
  const lines = bookmarkLines(view.state);
  if (lines.length === 0) return false;
  const current = view.state.doc.lineAt(view.state.selection.main.head).number;
  const target = backwards
    ? ([...lines].reverse().find((line) => line < current) ?? lines[lines.length - 1])
    : (lines.find((line) => line > current) ?? lines[0]);
  if (target === undefined) return false;
  gotoLine(view, target);
  return true;
}

/** Caret to the start of a line, centred — used by F2 and by the sidebar list. */
export function gotoLine(view: EditorView, line: number): void {
  const clamped = Math.max(1, Math.min(line, view.state.doc.lines));
  const from = view.state.doc.line(clamped).from;
  view.dispatch({
    selection: EditorSelection.cursor(from),
    effects: EditorView.scrollIntoView(from, { y: 'center' }),
  });
}

/** The text of every bookmarked line, joined with newlines — "copy bookmarked lines". */
export function bookmarkedText(state: EditorState): string {
  return bookmarkLines(state)
    .map((line) => state.doc.line(line).text)
    .join('\n');
}

/**
 * Deletes every bookmarked line, newline included, as one undoable edit.
 * Returns how many lines went.
 *
 * Neighbouring lines produce touching ranges, which are merged so the change
 * set never contains two that overlap.
 */
export function deleteBookmarkedLines(view: EditorView): number {
  const { state } = view;
  const lines = bookmarkLines(state);
  if (lines.length === 0) return 0;

  const ranges: { from: number; to: number }[] = [];
  for (const number of lines) {
    const line = state.doc.line(number);
    const to = number < state.doc.lines ? line.to + 1 : line.to;
    const last = ranges[ranges.length - 1];
    if (last && line.from <= last.to) last.to = Math.max(last.to, to);
    else ranges.push({ from: line.from, to });
  }
  // A run that reaches the end of the file has no newline after it to take,
  // so it takes the one before it — or the line above would be left with a
  // dangling empty line where the deleted ones were.
  const tail = ranges[ranges.length - 1];
  if (tail && tail.to === state.doc.length && tail.from > 0) tail.from -= 1;

  view.dispatch({
    changes: ranges,
    userEvent: 'delete.bookmarked',
    scrollIntoView: true,
  });
  return lines.length;
}

/* ── The extension ─────────────────────────────────────── */

/**
 * The field and its gutter column. Part of every document's base extensions,
 * not a plugin: bookmarks are written into the session, and a switch that made
 * them vanish from documents that have them would be a switch that loses data.
 *
 * The column is always there, empty or not, because it is also where a click
 * sets the first bookmark.
 */
export const bookmarks: Extension = [
  bookmarkField,
  gutter({
    class: 'cm-bookmarks',
    markers: (view) => view.state.field(bookmarkField),
    initialSpacer: () => marker,
    domEventHandlers: {
      mousedown(view, block, event) {
        if (!(event instanceof MouseEvent) || event.button !== 0) return false;
        view.dispatch({ effects: toggleBookmarkEffect.of(block.from) });
        // Keep the click from moving the caret or starting a selection.
        event.preventDefault();
        return true;
      },
    },
  }),
  EditorView.baseTheme({
    '.cm-bookmarks': {
      cursor: 'pointer',
    },
    '.cm-bookmarks .cm-gutterElement': {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '14px',
      padding: '0 1px 0 3px',
    },
    '.cm-bookmark-marker': {
      display: 'block',
      width: '8px',
      height: '8px',
      borderRadius: '999px',
      background: 'var(--uwu-pink)',
      boxShadow: '0 0 0 2px color-mix(in srgb, var(--uwu-pink) 25%, transparent)',
    },
  }),
];
