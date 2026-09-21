/**
 * Comparing two files side by side: which two, how they differ, and keeping
 * their scroll positions together.
 *
 * A comparison is between two *panes*, not two documents: whatever tab is
 * showing in the left one against whatever is showing in the right one. Switch
 * a tab and the comparison follows, which is how you walk through "this file
 * against each of those three" without starting over every time.
 *
 * The diff is `@codemirror/merge`'s — line chunks with the changed characters
 * inside them — computed on a timer after typing stops rather than on every
 * keystroke, and with a time budget, so two very different large files degrade
 * to a coarser diff instead of a frozen window. The decorations themselves are
 * `editor/compare.ts`.
 *
 * Scroll sync maps through the chunks, not through line numbers: scrolling past
 * a block of forty added lines on the right holds the left still at the gap
 * where they would go, and both sides meet again at the next line they share.
 */

import { Chunk } from '@codemirror/merge';
import type { StateEffect, Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { useSyncExternalStore } from 'react';
import { setDiffChangeHandler, setDiffEffect, type CompareSide } from '../editor/compare';
import { getDoc, getMeta, setDocState, subscribeDocuments, type DocId } from './documents';
import { t } from './i18n';
import { paneIds, type PaneId } from './layout';
import { toast } from './toast';
import { viewFor } from './views';
import { arrangeColumns, getWorkspace, subscribeWorkspace } from './workspace';

export type CompareState = {
  readonly active: boolean;
  readonly left: PaneId | null;
  readonly right: PaneId | null;
  /** How many differing blocks there are; `null` until both sides have a file. */
  readonly differences: number | null;
  /** Whether the two panes scroll together. On by default, as asked for. */
  readonly syncScroll: boolean;
  /** The diff gave up on detail somewhere, because the files were too different. */
  readonly coarse: boolean;
};

const IDLE: CompareState = {
  active: false,
  left: null,
  right: null,
  differences: null,
  syncScroll: true,
  coarse: false,
};

/** After the last keystroke, before the diff is worked out again. */
const DEBOUNCE_MS = 250;
/** How long one diff may search for the best answer before settling. */
const DIFF_BUDGET_MS = 400;

let state: CompareState = IDLE;
let chunks: readonly Chunk[] = [];
/** Which document holds which side's decorations right now, to clear them later. */
const decorated = new Map<DocId, CompareSide>();
let pending: ReturnType<typeof setTimeout> | null = null;
/** What the current chunks were computed from. */
let last: { a: Text | null; b: Text | null; left: DocId | null; right: DocId | null } = {
  a: null,
  b: null,
  left: null,
  right: null,
};
let stopWatching: (() => void) | null = null;
const listeners = new Set<() => void>();

function commit(next: CompareState) {
  state = next;
  for (const listener of listeners) listener();
}

export function getCompare(): CompareState {
  return state;
}

export function subscribeCompare(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useCompare(): CompareState {
  return useSyncExternalStore(subscribeCompare, getCompare);
}

/* ── Which two ─────────────────────────────────────────── */

/**
 * The pane to compare against the active one: the next one to the right, or
 * the one before it when the active pane is already the last.
 */
export function comparePair(): [PaneId, PaneId] | null {
  const { layout, activePane } = getWorkspace();
  const ids = paneIds(layout);
  if (ids.length < 2) return null;
  const at = Math.max(0, ids.indexOf(activePane));
  return at < ids.length - 1 ? [ids[at]!, ids[at + 1]!] : [ids[at - 1]!, ids[at]!];
}

function docIn(pane: PaneId | null): DocId | null {
  if (!pane) return null;
  return getWorkspace().panes[pane]?.active ?? null;
}

/* ── On and off ────────────────────────────────────────── */

/**
 * Starts comparing.
 *
 * One pane becomes two first. When there is only one file open, the right
 * side stays empty and the user is told to put something there; the
 * comparison is already running and colours in the moment they do.
 */
export function startCompare(): void {
  if (paneIds(getWorkspace().layout).length < 2) arrangeColumns(2);
  const pair = comparePair();
  if (!pair) return;
  const [left, right] = pair;
  commit({ ...state, active: true, left, right, differences: null, coarse: false });
  if (!docIn(left) || !docIn(right)) {
    toast('info', t('Öffne im zweiten Bereich die Datei, mit der verglichen werden soll.'));
  }
  watch();
  schedule(0);
}

export function stopCompare(): void {
  if (!state.active) return;
  if (pending) clearTimeout(pending);
  pending = null;
  stopWatching?.();
  stopWatching = null;
  clearAll();
  chunks = [];
  last = { a: null, b: null, left: null, right: null };
  commit({ ...IDLE, syncScroll: state.syncScroll });
}

export function toggleCompare(): void {
  if (state.active) stopCompare();
  else startCompare();
}

export function setSyncScroll(on: boolean): void {
  if (state.syncScroll !== on) commit({ ...state, syncScroll: on });
}

/* ── Keeping it current ────────────────────────────────── */

function watch() {
  stopWatching?.();
  const stopWorkspace = subscribeWorkspace(() => {
    if (!state.active) return;
    const ids = paneIds(getWorkspace().layout);
    // A pane of the pair went away: closing it is how people end a comparison.
    if (!state.left || !state.right || !ids.includes(state.left) || !ids.includes(state.right)) {
      stopCompare();
      return;
    }
    schedule(0);
  });
  // A reload from disk replaces a state wholesale, and says so here.
  const stopDocuments = subscribeDocuments(() => schedule(DEBOUNCE_MS));
  setDiffChangeHandler((view) => {
    if (view === viewFor(state.left ?? '') || view === viewFor(state.right ?? '')) {
      schedule(DEBOUNCE_MS);
    }
  });
  const stopScroll = startScrollSync();
  stopWatching = () => {
    stopWorkspace();
    stopDocuments();
    setDiffChangeHandler(null);
    stopScroll();
  };
}

/**
 * Always through a timer, never inline: the triggers include CodeMirror's own
 * update listener, and dispatching into a view from inside its update throws.
 */
function schedule(delay: number) {
  if (!state.active) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    recompute();
  }, delay);
}

function recompute() {
  if (!state.active) return;
  const leftDoc = docIn(state.left);
  const rightDoc = docIn(state.right);
  const a = leftDoc ? getDoc(leftDoc)?.state.doc : undefined;
  const b = rightDoc ? getDoc(rightDoc)?.state.doc : undefined;

  // Documents that are no longer one of the two lose their colours.
  for (const [doc] of decorated) {
    if (doc !== leftDoc && doc !== rightDoc) clearDoc(doc);
  }

  if (!leftDoc || !rightDoc || !a || !b || leftDoc === rightDoc) {
    chunks = [];
    last = { a: null, b: null, left: null, right: null };
    if (leftDoc) clearDoc(leftDoc);
    if (rightDoc) clearDoc(rightDoc);
    if (state.differences !== null) commit({ ...state, differences: null, coarse: false });
    return;
  }

  // Metadata announcements (a dirty dot, a git letter) land here too, and
  // most of them leave both texts exactly as they were. `Text` is immutable,
  // so identity is the whole comparison.
  if (last.a === a && last.b === b && last.left === leftDoc && last.right === rightDoc) return;
  last = { a, b, left: leftDoc, right: rightDoc };

  chunks = Chunk.build(a, b, { scanLimit: 2000, timeout: DIFF_BUDGET_MS });
  decorate(leftDoc, 'a');
  decorate(rightDoc, 'b');
  const coarse = chunks.some((chunk) => !chunk.precise);
  if (state.differences !== chunks.length || state.coarse !== coarse) {
    commit({ ...state, differences: chunks.length, coarse });
  }
}

/** Where a document's state lives right now: its view if one shows it, the store if not. */
function dispatchTo(doc: DocId, effects: StateEffect<unknown>[]) {
  const { panes } = getWorkspace();
  for (const [pane, entry] of Object.entries(panes)) {
    if (entry.active !== doc) continue;
    const view = viewFor(pane);
    if (view) {
      view.dispatch({ effects });
      return;
    }
  }
  const stored = getDoc(doc);
  if (stored) setDocState(doc, stored.state.update({ effects }).state);
}

function decorate(doc: DocId, side: CompareSide) {
  dispatchTo(doc, [setDiffEffect.of({ side, chunks })]);
  decorated.set(doc, side);
}

function clearDoc(doc: DocId) {
  if (!decorated.has(doc)) return;
  decorated.delete(doc);
  if (getDoc(doc)) dispatchTo(doc, [setDiffEffect.of(null)]);
}

function clearAll() {
  for (const doc of [...decorated.keys()]) clearDoc(doc);
}

/* ── Mapping one side onto the other ───────────────────── */

/**
 * The line in the other document that corresponds to `line` (1-based) in this
 * one.
 *
 * Between chunks the two documents are identical, so a line there has an exact
 * partner, offset by whatever the chunks before it added or removed. Inside a
 * chunk there is no partner, so the position is shared out proportionally —
 * the fourth of eight changed lines lands halfway down the other side's block.
 */
export function mapLine(
  line: number,
  from: Text,
  to: Text,
  diff: readonly Chunk[],
  side: CompareSide,
): number {
  const own = (chunk: Chunk) =>
    side === 'a' ? [chunk.fromA, chunk.toA] : [chunk.fromB, chunk.toB];
  const other = (chunk: Chunk) =>
    side === 'a' ? [chunk.fromB, chunk.toB] : [chunk.fromA, chunk.toA];
  const lineOf = (doc: Text, pos: number) => doc.lineAt(Math.min(pos, doc.length)).number;
  // Past the end of the document means "the line after the last one".
  const lineAfter = (doc: Text, pos: number) =>
    pos > doc.length ? doc.lines + 1 : lineOf(doc, pos);

  let shift = 0;
  for (const chunk of diff) {
    const [ownFrom, ownTo] = own(chunk);
    const [otherFrom, otherTo] = other(chunk);
    const startOwn = lineOf(from, ownFrom!);
    const endOwn = ownTo === ownFrom ? startOwn : lineAfter(from, ownTo!);
    const startOther = lineOf(to, otherFrom!);
    const endOther = otherTo === otherFrom ? startOther : lineAfter(to, otherTo!);
    if (line < startOwn) break;
    if (line < endOwn) {
      const share = (line - startOwn) / Math.max(1, endOwn - startOwn);
      return clampLine(startOther + Math.floor(share * (endOther - startOther)), to);
    }
    shift = endOther - endOwn;
  }
  return clampLine(line + shift, to);
}

function clampLine(line: number, doc: Text): number {
  return Math.max(1, Math.min(doc.lines, line));
}

/* ── Scroll sync ───────────────────────────────────────── */

/**
 * Scroll one side, and the other follows.
 *
 * The scroll events are caught at the window in the capture phase — a pane's
 * scroller does not bubble — which also means a view that is replaced while
 * the comparison runs (a pane closed and reopened) needs no re-wiring.
 *
 * A follower's own scroll event would bounce straight back, so the side that
 * was moved programmatically is ignored until the next frame.
 */
function startScrollSync(): () => void {
  let following: HTMLElement | null = null;
  let released = 0;

  const onScroll = (event: Event) => {
    if (!state.active || !state.syncScroll) return;
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains('cm-scroller')) return;
    if (target === following) return;

    const left = viewFor(state.left ?? '');
    const right = viewFor(state.right ?? '');
    if (!left || !right) return;
    const source = left.scrollDOM === target ? left : right.scrollDOM === target ? right : null;
    if (!source) return;
    const follower = source === left ? right : left;
    const side: CompareSide = source === left ? 'a' : 'b';

    const top = source.scrollDOM.scrollTop;
    const block = source.lineBlockAtHeight(top);
    const within = block.height > 0 ? (top - block.top) / block.height : 0;
    const line = source.state.doc.lineAt(block.from).number;
    const partner = mapLine(line, source.state.doc, follower.state.doc, chunks, side);
    const targetBlock = follower.lineBlockAt(follower.state.doc.line(partner).from);

    following = follower.scrollDOM;
    follower.scrollDOM.scrollTop = targetBlock.top + within * targetBlock.height;
    follower.scrollDOM.scrollLeft = source.scrollDOM.scrollLeft;
    cancelAnimationFrame(released);
    released = requestAnimationFrame(() => {
      following = null;
    });
  };

  window.addEventListener('scroll', onScroll, true);
  return () => {
    window.removeEventListener('scroll', onScroll, true);
    cancelAnimationFrame(released);
  };
}

/* ── Walking the differences ───────────────────────────── */

/**
 * Moves the caret in the active side to the next (or previous) difference and
 * scrolls it into the middle; the other side follows through the scroll sync.
 */
export function gotoDifference(back = false): void {
  if (!state.active || chunks.length === 0) return;
  const { activePane } = getWorkspace();
  const side: CompareSide = activePane === state.right ? 'b' : 'a';
  const view = viewFor(side === 'a' ? (state.left ?? '') : (state.right ?? ''));
  if (!view) return;
  const caret = view.state.selection.main.head;
  const caretLine = view.state.doc.lineAt(caret).number;
  const starts = chunks.map((chunk) =>
    Math.min(view.state.doc.length, side === 'a' ? chunk.fromA : chunk.fromB),
  );
  const lines = starts.map((pos) => view.state.doc.lineAt(pos).number);
  let index = back
    ? lines
        .map((line, i) => (line < caretLine ? i : -1))
        .filter((i) => i >= 0)
        .pop()
    : lines.findIndex((line) => line > caretLine);
  // Wrap around, the way find does.
  if (index === undefined || index < 0) index = back ? lines.length - 1 : 0;
  const pos = starts[index]!;
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'center' }),
  });
  view.focus();
}

/** For the compare bar: `left.txt ↔ right.txt`. */
export function compareNames(): { left: string | null; right: string | null } {
  const left = docIn(state.left);
  const right = docIn(state.right);
  return {
    left: left ? (getMeta(left)?.name ?? null) : null,
    right: right ? (getMeta(right)?.name ?? null) : null,
  };
}
