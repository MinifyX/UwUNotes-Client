/**
 * The plugins that ship with the app.
 *
 * Three of them, chosen to show the three shapes a plugin can have: a pure
 * decoration pass over the viewport (trailing whitespace), a widget inserted
 * into the text (colour swatches), and one that reacts to the selection rather
 * than to the document (the word under the caret). Between them they cover
 * everything `registry.ts` promises, so a fourth plugin is a copy of whichever
 * one is closest.
 *
 * None of them touches the document. A plugin that edits text on the user's
 * behalf would need a place in the undo history and a way to be switched off
 * retroactively, which is a bigger conversation than a checkbox in Settings.
 */

import { RangeSetBuilder, CharCategory, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { N_ } from '../../lib/i18n';
import { registerPlugin } from './registry';

/* ── Trailing whitespace ───────────────────────────────── */

const trailingMark = Decoration.mark({ class: 'cm-uwuTrailing' });

/**
 * The line the caret is on is skipped: while you are typing a sentence, every
 * space you type is trailing whitespace for a moment, and flashing at the user
 * for the keystroke it takes to write the next word is how a helpful feature
 * becomes an irritating one.
 */
function buildTrailing(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { state } = view;
  const caretLines = new Set(
    state.selection.ranges.map((range) => state.doc.lineAt(range.head).number),
  );

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (caretLines.has(line.number)) continue;
      const match = /[ \t]+$/.exec(line.text);
      if (match && match.index >= 0) {
        builder.add(line.from + match.index, line.to, trailingMark);
      }
    }
  }
  return builder.finish();
}

function trailingWhitespace(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = buildTrailing(view);
        }

        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged || update.selectionSet) {
            this.decorations = buildTrailing(update.view);
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
    EditorView.baseTheme({
      '.cm-uwuTrailing': {
        backgroundColor: 'var(--uwu-code-invalid)',
        // Whitespace has no glyph, so the opacity only softens the bar itself.
        opacity: '0.28',
        borderRadius: '2px',
      },
    }),
  ];
}

/* ── Colour swatches ───────────────────────────────────── */

const HEX_LENGTHS = new Set([3, 4, 6, 8]);

class SwatchWidget extends WidgetType {
  constructor(readonly color: string) {
    super();
  }

  override eq(other: SwatchWidget): boolean {
    return other.color.toLowerCase() === this.color.toLowerCase();
  }

  override toDOM(): HTMLElement {
    const dot = document.createElement('span');
    dot.className = 'cm-uwuSwatch';
    dot.style.backgroundColor = this.color;
    // The colour is already written next to it as text; a screen reader
    // announcing "swatch" twice per literal helps nobody.
    dot.setAttribute('aria-hidden', 'true');
    return dot;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

const swatchMatcher = new MatchDecorator({
  regexp: /#[0-9a-fA-F]{3,8}\b/g,
  decorate: (add, from, _to, match) => {
    const literal = match[0];
    if (!HEX_LENGTHS.has(literal.length - 1)) return;
    // Zero-width, on the left of the literal: inserting into the middle of the
    // text would change every column after it and break the indent guides.
    add(from, from, Decoration.widget({ widget: new SwatchWidget(literal), side: -1 }));
  },
});

function colorSwatches(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = swatchMatcher.createDeco(view);
        }

        update(update: ViewUpdate) {
          this.decorations = swatchMatcher.updateDeco(update, this.decorations);
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
    EditorView.baseTheme({
      '.cm-uwuSwatch': {
        display: 'inline-block',
        width: '0.72em',
        height: '0.72em',
        marginRight: '0.28em',
        verticalAlign: 'baseline',
        borderRadius: '2px',
        // A ring, because a white swatch on a light theme is otherwise a hole.
        boxShadow: 'inset 0 0 0 1px var(--uwu-hairline)',
      },
    }),
  ];
}

/* ── The word under the caret ──────────────────────────── */

const wordMark = Decoration.mark({ class: 'cm-uwuWordMatch' });

/** Two characters is the floor: highlighting every `i` in a file is vandalism. */
const MIN_WORD = 2;
const MAX_WORD = 64;

function isWholeWord(view: EditorView, from: number, to: number): boolean {
  const { state } = view;
  const categorize = state.charCategorizer(from);
  const before = from > 0 ? state.sliceDoc(from - 1, from) : '';
  const after = to < state.doc.length ? state.sliceDoc(to, to + 1) : '';
  if (before && categorize(before) === CharCategory.Word) return false;
  if (after && categorize(after) === CharCategory.Word) return false;
  return true;
}

/**
 * Only with an empty selection. A non-empty one is
 * `highlightSelectionMatches`' job, and two extensions painting the same
 * ranges in two slightly different pinks looks like a rendering bug.
 */
function buildWordMatches(view: EditorView): DecorationSet {
  const { state } = view;
  const caret = state.selection.main;
  if (!caret.empty) return Decoration.none;

  const word = state.wordAt(caret.head);
  if (!word) return Decoration.none;
  const text = state.sliceDoc(word.from, word.to);
  if (text.length < MIN_WORD || text.length > MAX_WORD) return Decoration.none;

  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    const chunk = state.sliceDoc(from, to);
    let index = chunk.indexOf(text);
    while (index >= 0) {
      const start = from + index;
      const end = start + text.length;
      // The occurrence the caret is sitting in stays unmarked — the active
      // line already says where you are.
      if (start !== word.from && isWholeWord(view, start, end)) {
        builder.add(start, end, wordMark);
      }
      index = chunk.indexOf(text, index + text.length);
    }
  }
  return builder.finish();
}

function wordUnderCaret(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
          this.decorations = buildWordMatches(view);
        }

        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged || update.selectionSet) {
            this.decorations = buildWordMatches(update.view);
          }
        }
      },
      { decorations: (plugin) => plugin.decorations },
    ),
    EditorView.baseTheme({
      '.cm-uwuWordMatch': {
        // An outline rather than a fill: the word is already legible, and a
        // second filled highlight next to the selection is one too many.
        boxShadow: 'inset 0 0 0 1px var(--uwu-code-match-active)',
        borderRadius: '2px',
      },
    }),
  ];
}

/* ── Registration ──────────────────────────────────────── */

/**
 * Called once from `editor/setup.ts`, before any state is built. Explicit
 * rather than a module side effect, so the order the plugins appear in
 * Settings does not depend on the order Vite happened to evaluate imports in.
 */
export function registerBuiltinPlugins(): void {
  registerPlugin({
    id: 'trailing-whitespace',
    name: N_('Leerzeichen am Zeilenende'),
    description: N_(
      'Markiert Leerzeichen und Tabs am Ende einer Zeile — außer in der Zeile, in der der Cursor gerade steht.',
    ),
    defaultEnabled: true,
    build: trailingWhitespace,
  });

  registerPlugin({
    id: 'color-swatches',
    name: N_('Farbfelder'),
    description: N_('Zeigt neben Farbwerten wie #ff4d8d ein kleines Farbquadrat.'),
    defaultEnabled: true,
    build: colorSwatches,
  });

  registerPlugin({
    id: 'word-under-caret',
    name: N_('Wort unter dem Cursor'),
    description: N_('Umrandet alle weiteren Vorkommen des Wortes, in dem der Cursor steht.'),
    defaultEnabled: false,
    build: wordUnderCaret,
  });
}
