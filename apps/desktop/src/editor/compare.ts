/**
 * The editor half of "compare two files": colouring what differs.
 *
 * `lib/compare.ts` decides *which* two documents are compared and computes the
 * chunks; this module only turns a list of chunks into decorations on one side
 * of the comparison, and keeps them in place while the user types until the
 * next diff lands.
 *
 * It is part of every document's base extensions — see `editor/setup.ts` — so
 * turning a comparison on is one effect into two states rather than a
 * reconfigure of both, and a document that is not being compared carries an
 * empty decoration set and nothing else.
 *
 * Colours are the git gutter's: deleted-red on the left, added-green on the
 * right, a stronger tint on the characters that actually changed. Never pink —
 * pink is the selection, and a diff that looks like a selection is a diff that
 * gets typed over.
 */

import type { Chunk } from '@codemirror/merge';
import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
  type Text,
} from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

/** Which document of the pair: `a` on the left, `b` on the right. */
export type CompareSide = 'a' | 'b';

/** Replaces the decorations. `null` ends the comparison for this document. */
export const setDiffEffect = StateEffect.define<{
  side: CompareSide;
  chunks: readonly Chunk[];
} | null>();

const lineRemoved = Decoration.line({ class: 'cm-diff-line cm-diff-removed' });
const lineAdded = Decoration.line({ class: 'cm-diff-line cm-diff-added' });
/** A chunk that exists only on the other side: a marker where it would be. */
const gapBefore = Decoration.line({ class: 'cm-diff-gap cm-diff-gap-before' });
const gapAfter = Decoration.line({ class: 'cm-diff-gap cm-diff-gap-after' });
const charsRemoved = Decoration.mark({ class: 'cm-diff-chars cm-diff-chars-removed' });
const charsAdded = Decoration.mark({ class: 'cm-diff-chars cm-diff-chars-added' });

/**
 * The decorations for one side.
 *
 * Built in document order, as `RangeSetBuilder` requires: for each chunk the
 * line decorations first (they sit at a line's start), then the character
 * marks inside it. Line decorations and marks at the same position are both
 * allowed; the builder only insists positions never go backwards.
 */
export function diffDecorations(
  doc: Text,
  side: CompareSide,
  chunks: readonly Chunk[],
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const lineDeco = side === 'a' ? lineRemoved : lineAdded;
  const charDeco = side === 'a' ? charsRemoved : charsAdded;

  for (const chunk of chunks) {
    const from = side === 'a' ? chunk.fromA : chunk.fromB;
    const to = side === 'a' ? chunk.toA : chunk.toB;
    const end = Math.min(doc.length, side === 'a' ? chunk.endA : chunk.endB);

    if (from === to) {
      // Nothing on this side: mark the boundary so the eye can find where the
      // other side's lines would go. At the very end of the document there is
      // no line to put a border on top of, so the last line gets one below.
      if (from >= doc.length && doc.length > 0) {
        builder.add(doc.lineAt(doc.length).from, doc.lineAt(doc.length).from, gapAfter);
      } else {
        const line = doc.lineAt(Math.min(from, doc.length));
        builder.add(line.from, line.from, gapBefore);
      }
      continue;
    }

    const marks: { from: number; to: number }[] = [];
    for (const change of chunk.changes) {
      const markFrom = from + (side === 'a' ? change.fromA : change.fromB);
      const markTo = Math.min(doc.length, from + (side === 'a' ? change.toA : change.toB));
      if (markTo > markFrom) marks.push({ from: markFrom, to: markTo });
    }

    // Line by line, with each line's marks straight after its line
    // decoration, so the builder never sees a position go backwards.
    let line = doc.lineAt(from);
    let markIndex = 0;
    for (;;) {
      builder.add(line.from, line.from, lineDeco);
      while (markIndex < marks.length && marks[markIndex]!.from <= line.to) {
        const mark = marks[markIndex]!;
        const markFrom = Math.max(mark.from, line.from);
        const markTo = Math.min(mark.to, line.to);
        if (markTo > markFrom) builder.add(markFrom, markTo, charDeco);
        if (mark.to > line.to) {
          // The rest of this mark belongs to the next line; carry it over.
          marks[markIndex] = { from: line.to + 1, to: mark.to };
          break;
        }
        markIndex += 1;
      }
      if (line.to >= end || line.number >= doc.lines) break;
      line = doc.line(line.number + 1);
    }
  }
  return builder.finish();
}

const diffField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    let next = decorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setDiffEffect)) continue;
      next = effect.value
        ? diffDecorations(transaction.state.doc, effect.value.side, effect.value.chunks)
        : Decoration.none;
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Who hears about edits. `lib/compare.ts` sets it while a comparison runs, so
 * the diff follows the typing; without one, an edit costs a null check.
 */
let onDocChanged: ((view: EditorView) => void) | null = null;

export function setDiffChangeHandler(handler: ((view: EditorView) => void) | null): void {
  onDocChanged = handler;
}

/*
 * The colours. Backgrounds as a gradient rather than a `background-color`,
 * so the active-line highlight, which *is* a background colour, shows through
 * instead of one of the two winning by specificity.
 */
const diffTheme = EditorView.baseTheme({
  '.cm-diff-removed': {
    backgroundImage:
      'linear-gradient(color-mix(in srgb, var(--uwu-code-deleted) 16%, transparent), color-mix(in srgb, var(--uwu-code-deleted) 16%, transparent))',
    boxShadow: 'inset 3px 0 0 var(--uwu-code-deleted)',
  },
  '.cm-diff-added': {
    backgroundImage:
      'linear-gradient(color-mix(in srgb, var(--uwu-code-added) 16%, transparent), color-mix(in srgb, var(--uwu-code-added) 16%, transparent))',
    boxShadow: 'inset 3px 0 0 var(--uwu-code-added)',
  },
  '.cm-diff-chars-removed': {
    backgroundColor: 'color-mix(in srgb, var(--uwu-code-deleted) 38%, transparent)',
    borderRadius: '2px',
  },
  '.cm-diff-chars-added': {
    backgroundColor: 'color-mix(in srgb, var(--uwu-code-added) 38%, transparent)',
    borderRadius: '2px',
  },
  '.cm-diff-gap-before': {
    boxShadow: 'inset 0 2px 0 var(--uwu-code-modified)',
  },
  '.cm-diff-gap-after': {
    boxShadow: 'inset 0 -2px 0 var(--uwu-code-modified)',
  },
});

export const compareExtension: Extension = [
  diffField,
  diffTheme,
  EditorView.updateListener.of((update) => {
    if (update.docChanged && onDocChanged) onDocChanged(update.view);
  }),
];
