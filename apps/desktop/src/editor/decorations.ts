/**
 * The three optional things drawn on top of the text itself.
 *
 * All three are viewport-only: decorations are rebuilt for the lines currently
 * on screen and nothing else, which is what keeps them usable in a 200 000
 * line file. A whole-document pass here would be the single easiest way to
 * make this editor feel slow.
 *
 * Two of the three avoid changing layout, which is the fiddly part. An indent
 * guide is an inset box-shadow rather than a border, and a whitespace glyph is
 * an absolutely positioned `::before` sitting at its own static position — both
 * paint over the text grid instead of adding a pixel to it. Anything that adds
 * width here moves every character on the line, and the user notices
 * immediately when they toggle the setting.
 *
 * What this module does not do: decide whether any of it is switched on. That
 * is `settingsExtensions()` in `editor/setup.ts`.
 */

import { getIndentUnit } from '@codemirror/language';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

const SPACE = 32;
const TAB = 9;

const indentGuideMark = Decoration.mark({ class: 'cm-uwuIndentGuide' });
const spaceMark = Decoration.mark({ class: 'cm-uwuSpace' });
const tabMark = Decoration.mark({ class: 'cm-uwuTab' });

/**
 * Walks the leading whitespace of every visible line and marks the character
 * that sits on each indent stop.
 *
 * Blank lines get no guide. Carrying a guide through them needs a widget
 * decoration on an empty line plus a look-ahead to the next non-blank line,
 * and the result flickers while you type into the gap — the honest version is
 * cheaper and does not lie about where the block is.
 */
function buildIndentGuides(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const unit = Math.max(1, getIndentUnit(state));
  const { tabSize } = state;

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      const text = line.text;
      let column = 0;
      for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        if (code !== SPACE && code !== TAB) break;
        if (column > 0 && column % unit === 0) {
          builder.add(line.from + index, line.from + index + 1, indentGuideMark);
        }
        column += code === TAB ? tabSize - (column % tabSize) : 1;
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

/** A hairline on every indent stop, so nested blocks line up visibly. */
export const indentGuides: Extension = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildIndentGuides(view);
      }

      update(update: ViewUpdate) {
        // Tab size and indent unit live in the settings compartment, so a
        // reconfigure is a reason to rebuild even when nothing was typed.
        const indentChanged =
          update.startState.tabSize !== update.state.tabSize ||
          getIndentUnit(update.startState) !== getIndentUnit(update.state);
        if (update.docChanged || update.viewportChanged || indentChanged) {
          this.decorations = buildIndentGuides(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
  EditorView.baseTheme({
    '.cm-uwuIndentGuide': {
      // Inset shadow, not a border: a border would be one pixel of extra width
      // per indent level and would push the whole line sideways.
      boxShadow: 'inset 1px 0 0 0 var(--uwu-code-indent-guide)',
    },
  }),
];

function buildWhitespace(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      const text = line.text;
      for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        if (code === SPACE) builder.add(line.from + index, line.from + index + 1, spaceMark);
        else if (code === TAB) builder.add(line.from + index, line.from + index + 1, tabMark);
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

/**
 * A middot for a space, an arrow for a tab — the Notepad++ habit, for the day
 * a YAML file refuses to parse and nobody can see why.
 */
export const whitespaceMarkers: Extension = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildWhitespace(view);
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildWhitespace(update.view);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  ),
  EditorView.baseTheme({
    // `position: absolute` with no offsets leaves the glyph at its static
    // position — exactly over the character — while taking it out of flow, so
    // the text does not shift when whitespace rendering is switched on.
    '.cm-uwuSpace::before': {
      content: '"·"',
      position: 'absolute',
      pointerEvents: 'none',
      color: 'var(--uwu-code-line-number)',
    },
    '.cm-uwuTab::before': {
      content: '"→"',
      position: 'absolute',
      pointerEvents: 'none',
      color: 'var(--uwu-code-line-number)',
    },
  }),
];

/**
 * A hairline at the given column, drawn as a background gradient on each line.
 *
 * `ch` is the advance width of "0" in the line's own font, which in a
 * monospace face is one character — so the line lands on the right column
 * without measuring anything, and stays there when the font size changes. The
 * 6px is CodeMirror's own left padding on `.cm-line`, without which the margin
 * would sit six pixels early.
 *
 * Painting it per line rather than on `.cm-content` matters: the active-line
 * highlight is a background *colour* on the same element, so the two stack
 * instead of one hiding the other.
 */
export function printMargin(column: number): Extension {
  const known = printMargins.get(column);
  if (known) return known;
  const built = buildPrintMargin(column);
  printMargins.set(column, built);
  return built;
}

/** One rule per column the user has tried, rather than one per reconfigure. */
const printMargins = new Map<number, Extension>();

function buildPrintMargin(column: number): Extension {
  const x = `calc(${column}ch + 6px)`;
  const stroke = 'var(--uwu-code-indent-guide)';
  return EditorView.theme({
    '.cm-line': {
      backgroundImage: `linear-gradient(to right, transparent ${x}, ${stroke} ${x}, ${stroke} calc(${x} + 1px), transparent calc(${x} + 1px))`,
      backgroundRepeat: 'no-repeat',
    },
  });
}
