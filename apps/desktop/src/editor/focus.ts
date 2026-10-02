/**
 * The editor half of zen mode: typewriter scrolling and focus dimming.
 *
 * Both are built into `settingsExtensions()` in `editor/setup.ts`, which
 * already rebuilds per setting through its compartment; zen mode switching on
 * or off is treated the same as a setting changing. The layout half — the
 * centred column, the hidden chrome — is CSS in `styles/focus.css`, because
 * none of it changes what CodeMirror needs to know about the text.
 */

import {
  EditorState,
  RangeSetBuilder,
  Transaction,
  type Extension,
  type Text,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  scrollPastEnd,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { Settings } from '../lib/settings';

/**
 * What zen mode and the typewriter setting add to a document's extensions.
 * Nothing at all outside zen unless typewriter scrolling is on everywhere.
 */
export function focusExtensions(settings: Settings, zen: boolean): Extension {
  const extensions: Extension[] = [];
  // A centred column with lines running off its right edge is not a column,
  // so zen wraps whatever the wrap setting says. Leaving zen gives the
  // setting back, because this extension is gone again.
  if (zen) extensions.push(EditorView.lineWrapping);
  if (settings.typewriterScrolling || (zen && settings.zenTypewriter)) extensions.push(typewriter);
  if (zen && settings.zenFocusDim) extensions.push(focusDim);
  return extensions;
}

/* ── Typewriter scrolling ──────────────────────────────── */

/**
 * Keeps the caret line in the middle of the screen.
 *
 * A transaction extender rather than a view plugin that scrolls after the
 * fact: the centring effect rides along in the same transaction as the edit,
 * so CodeMirror scrolls once, to the right place, instead of scrolling to
 * "nearest" for the keystroke and then jumping again a frame later. The view
 * applies `scrollIntoView` effects after a transaction's own scroll flag, so
 * this one wins.
 *
 * Only for what the user did with the keyboard. A click already put the caret
 * where the user is looking — yanking that line to the centre under the
 * pointer would move the text they just aimed at. Programmatic transactions
 * (a reload, a reconfigure, a restored caret) carry no user event and are left
 * alone too.
 */
const centreCaret = EditorState.transactionExtender.of((tr) => {
  if (!tr.selection && !tr.docChanged) return null;
  const event = tr.annotation(Transaction.userEvent);
  if (!event || event.startsWith('select.pointer')) return null;
  return { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: 'center' }) };
});

/**
 * Centres the caret once when typewriter scrolling arrives in a view — on
 * entering zen, or on switching to a tab — so the first keystroke does not
 * make the text jump. A frame later, because a plugin may not dispatch while
 * the view is still applying the update that created it.
 */
const centreOnArrival = ViewPlugin.fromClass(
  class {
    private frame: number;

    constructor(view: EditorView) {
      this.frame = requestAnimationFrame(() => {
        view.dispatch({
          effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }),
        });
      });
    }

    destroy() {
      cancelAnimationFrame(this.frame);
    }
  },
);

/** `scrollPastEnd` so the last line, too, can come up to the middle. */
const typewriter: Extension = [centreCaret, centreOnArrival, scrollPastEnd()];

/* ── Focus dimming ─────────────────────────────────────── */

/**
 * How far the block search walks in each direction. A minified file is one
 * enormous "paragraph"; past this it is simply not dimmed, which is cheaper
 * and no less useful than finding its edges.
 */
const BLOCK_SCAN_LIMIT = 400;

/**
 * The lines around `lineNumber` that belong together: the run of non-blank
 * lines it sits in, the same rule for prose and code. For prose that is the
 * paragraph; for code it is the block between two blank lines, which is how
 * code is paragraphed too. A blank caret line is a block of one.
 *
 * Returns 1-based line numbers, inclusive.
 */
export function focusBlock(doc: Text, lineNumber: number): { from: number; to: number } {
  const blank = (n: number) => doc.line(n).text.trim() === '';
  if (blank(lineNumber)) return { from: lineNumber, to: lineNumber };
  let from = lineNumber;
  let to = lineNumber;
  const floor = Math.max(1, lineNumber - BLOCK_SCAN_LIMIT);
  const ceiling = Math.min(doc.lines, lineNumber + BLOCK_SCAN_LIMIT);
  while (from > floor && !blank(from - 1)) from -= 1;
  while (to < ceiling && !blank(to + 1)) to += 1;
  return { from, to };
}

const dimmed = Decoration.line({ class: 'cm-uwuDimmed' });

/**
 * Viewport-only, like every decoration in `editor/decorations.ts`: the lines
 * outside the caret's block that are actually on screen get a class, and the
 * opacity and its fade are the stylesheet's business.
 */
function buildDimming(view: EditorView): DecorationSet {
  const { state } = view;
  const caretLine = state.doc.lineAt(state.selection.main.head).number;
  const block = focusBlock(state.doc, caretLine);
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      if (line.number < block.from || line.number > block.to) {
        builder.add(line.from, line.from, dimmed);
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const focusDim: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDimming(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDimming(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
