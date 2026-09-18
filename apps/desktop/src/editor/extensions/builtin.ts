/**
 * The plugins that ship with the app.
 *
 * Six of them, in two groups of three, chosen so that every shape `registry.ts`
 * allows has one worked example and a seventh plugin is a copy of whichever one
 * is closest.
 *
 * The first three are editor extensions: a pure decoration pass over the
 * viewport (trailing whitespace), a widget inserted into the text (colour
 * swatches), and one that reacts to the selection rather than to the document
 * (the word under the caret). The last three contribute only commands — sorting
 * lines, changing case, Base64 — and no extension at all, so a document that
 * has all three enabled is configured exactly as if it had none.
 *
 * The extensions do not touch the document; the commands do, and the difference
 * is who asked. An extension edits text the user never requested, at a moment
 * the user did not choose, and there is no honest way to undo the feature
 * rather than the edit. A command is invoked by name, writes one entry in the
 * undo history, and Ctrl+Z is right there.
 */

import { CharCategory, EditorSelection, RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { locale, N_, t } from '../../lib/i18n';
import { toast } from '../../lib/toast';
import { activeView } from '../../lib/views';
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

/* ── What the command plugins share ────────────────────── */

/** The whole lines the main selection covers, plus where to put them back. */
type LineBlock = { from: number; to: number; lines: string[] };

/**
 * Null unless the selection covers at least two whole lines.
 *
 * Refusing an empty selection rather than falling back to the whole document is
 * the one decision in here worth arguing about. Ctrl+A is a single keystroke;
 * a palette entry that silently reorders four thousand lines because nothing
 * was selected is a lost scroll position, a diff nobody asked for, and a
 * Ctrl+Z the user has to think of first.
 */
function selectedLines(view: EditorView): LineBlock | null {
  const { state } = view;
  const range = state.selection.main;
  if (range.empty) return null;

  const first = state.doc.lineAt(range.from);
  // A selection dragged down to the very start of a line does not contain that
  // line, however much the highlight below the last character looks like it.
  const lastLine = state.doc.lineAt(range.to);
  const end = lastLine.from === range.to && range.to > first.to ? range.to - 1 : range.to;
  const last = state.doc.lineAt(end);
  if (last.number === first.number) return null;

  const lines: string[] = [];
  for (let number = first.number; number <= last.number; number += 1) {
    lines.push(state.doc.line(number).text);
  }
  return { from: first.from, to: last.to, lines };
}

/** Leaves the rewritten block selected, so the next line command can follow on. */
function replaceLines(view: EditorView, block: LineBlock, lines: string[]): void {
  const insert = lines.join(view.state.lineBreak);
  view.dispatch({
    changes: { from: block.from, to: block.to, insert },
    selection: { anchor: block.from, head: block.from + insert.length },
    scrollIntoView: true,
  });
  view.focus();
}

function withSelectedLines(rewrite: (block: LineBlock) => string[] | null): void {
  const view = activeView();
  if (!view) return;
  const block = selectedLines(view);
  if (!block) {
    toast('info', t('Bitte mindestens zwei ganze Zeilen auswählen.'));
    return;
  }
  const rewritten = rewrite(block);
  if (rewritten) replaceLines(view, block, rewritten);
}

/* ── Line tools ────────────────────────────────────────── */

/**
 * `localeCompare` rather than `<`: by code point, "Zeder" sorts before "Ärger"
 * and every umlaut in a German file ends up in an exile at the bottom of the
 * block. The comparison follows the UI language, because that is the one the
 * person doing the sorting is reading in.
 */
function sortedLines(lines: string[], descending: boolean): string[] {
  const collator = new Intl.Collator(locale(), { numeric: true, sensitivity: 'variant' });
  const sorted = [...lines].sort((left, right) => collator.compare(left, right));
  return descending ? sorted.reverse() : sorted;
}

/** Keeps the first of each set, because the first one is usually where it belongs. */
function withoutDuplicateLines(lines: string[]): string[] {
  const seen = new Set<string>();
  return lines.filter((line) => {
    if (seen.has(line)) return false;
    seen.add(line);
    return true;
  });
}

function sortSelection(descending: boolean): void {
  withSelectedLines((block) => sortedLines(block.lines, descending));
}

function removeDuplicateSelection(): void {
  withSelectedLines((block) => {
    const kept = withoutDuplicateLines(block.lines);
    const removed = block.lines.length - kept.length;
    if (removed === 0) {
      toast('info', t('Keine doppelten Zeilen gefunden.'));
      return null;
    }
    toast('success', t('{count} doppelte Zeilen entfernt.', { count: removed }));
    return kept;
  });
}

/* ── Upper and lower case ──────────────────────────────── */

/**
 * Every non-empty range at once, so it works with multiple cursors.
 *
 * `changeByRange` rather than one flat change because the replacement is not
 * always the same length as what it replaces: "straße" upper-cased is
 * "STRASSE", one character longer, and a hand-mapped selection would end up
 * short by exactly one ß per line.
 */
function convertCase(transform: (text: string) => string): void {
  const view = activeView();
  if (!view) return;
  const { state } = view;
  if (state.selection.ranges.every((range) => range.empty)) {
    toast('info', t('Bitte zuerst Text auswählen.'));
    return;
  }

  view.dispatch(
    state.changeByRange((range) => {
      if (range.empty) return { range };
      const insert = transform(state.sliceDoc(range.from, range.to));
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(range.from, range.from + insert.length),
      };
    }),
  );
  view.focus();
}

/* ── Base64 ────────────────────────────────────────────── */

/**
 * `btoa` speaks Latin-1 and throws on anything above U+00FF, so the text goes
 * through UTF-8 first and `btoa` only ever sees bytes. Without this, encoding a
 * German sentence works right up until someone writes "Grüße".
 */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let latin1 = '';
  for (const byte of bytes) latin1 += String.fromCharCode(byte);
  return btoa(latin1);
}

/** Throws on anything that is not valid Base64 holding valid UTF-8. */
function fromBase64(encoded: string): string {
  // Base64 in the wild arrives wrapped at 76 columns, or pasted across lines.
  const latin1 = atob(encoded.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(latin1, (character) => character.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/**
 * One range only, unlike the case commands: with several cursors, a decode
 * where the third range is not valid Base64 would leave two of them rewritten
 * and one untouched, and there is no honest way to report that in a toast.
 */
function convertMainSelection(convert: (text: string) => string | null): void {
  const view = activeView();
  if (!view) return;
  const range = view.state.selection.main;
  if (range.empty) {
    toast('info', t('Bitte zuerst Text auswählen.'));
    return;
  }

  const insert = convert(view.state.sliceDoc(range.from, range.to));
  if (insert === null) return;
  view.dispatch({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from, head: range.from + insert.length },
    scrollIntoView: true,
  });
  view.focus();
}

function decodeBase64Selection(): void {
  convertMainSelection((text) => {
    try {
      return fromBase64(text);
    } catch {
      // A user who selected the wrong thing gets a sentence, not a stack trace
      // in a console they are not looking at.
      toast('error', t('Die Auswahl ist kein gültiges Base64.'));
      return null;
    }
  });
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

  registerPlugin({
    id: 'line-tools',
    name: N_('Zeilenwerkzeuge'),
    description: N_(
      'Befehle, die die ausgewählten Zeilen sortieren oder doppelte Zeilen daraus entfernen.',
    ),
    defaultEnabled: true,
    commands: [
      {
        id: 'line-tools.sort-ascending',
        title: () => t('Zeilen sortieren (A–Z)'),
        run: () => sortSelection(false),
      },
      {
        id: 'line-tools.sort-descending',
        title: () => t('Zeilen sortieren (Z–A)'),
        run: () => sortSelection(true),
      },
      {
        id: 'line-tools.remove-duplicates',
        title: () => t('Doppelte Zeilen entfernen'),
        run: removeDuplicateSelection,
      },
    ],
  });

  registerPlugin({
    id: 'text-case',
    name: N_('Groß- und Kleinschreibung'),
    description: N_('Befehle, die die Auswahl in Groß- oder in Kleinbuchstaben umschreiben.'),
    defaultEnabled: true,
    commands: [
      {
        id: 'text-case.upper',
        title: () => t('Auswahl in Großbuchstaben'),
        // Locale-aware: without it, a Turkish "i" loses its dot in the wrong
        // direction, and it costs an argument to pass.
        run: () => convertCase((text) => text.toLocaleUpperCase(locale())),
      },
      {
        id: 'text-case.lower',
        title: () => t('Auswahl in Kleinbuchstaben'),
        run: () => convertCase((text) => text.toLocaleLowerCase(locale())),
      },
    ],
  });

  registerPlugin({
    id: 'base64',
    name: N_('Base64'),
    description: N_('Befehle, die die Auswahl als Base64 kodieren oder wieder dekodieren.'),
    // Off by default: useful often enough to ship, rare enough that it does not
    // belong in everyone's palette by itself.
    defaultEnabled: false,
    commands: [
      {
        id: 'base64.encode',
        title: () => t('Auswahl als Base64 kodieren'),
        run: () => convertMainSelection(toBase64),
      },
      {
        id: 'base64.decode',
        title: () => t('Base64-Auswahl dekodieren'),
        run: decodeBase64Selection,
      },
    ],
  });
}
