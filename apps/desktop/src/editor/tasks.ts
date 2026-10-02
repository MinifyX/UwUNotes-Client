/**
 * Ticking off `- [ ]` without hunting for the space between the brackets.
 *
 * Three ways in, one edit: Ctrl+Enter on the caret's line(s), Ctrl+click on
 * the box itself, and a click on the checkbox in the Markdown preview. Each
 * replaces the one character between the brackets in a single transaction, so
 * Ctrl+Z takes it back and nothing else on the line moves.
 *
 * Ctrl+Enter only claims the key on a task line. Anywhere else it falls
 * through to CodeMirror's own Ctrl+Enter (a new line below), so nobody loses a
 * binding they had. Ctrl+click only claims the click when it lands on the box:
 * everywhere else Ctrl+click still adds a caret, which is what it has done in
 * this editor since the first release.
 *
 * Purely textual — see `lib/markdown/tasks.ts` — so it works in a `.txt` list
 * as well as in Markdown, and on lines the grammar has not parsed yet.
 */

import { Prec, type ChangeSpec, type EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  keymap,
  MatchDecorator,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { findTaskBox, taskToggleChange } from '../lib/markdown/tasks';

/** The changes that flip every task on these 1-based lines; lines without one are skipped. */
export function taskChanges(state: EditorState, lines: Iterable<number>): ChangeSpec[] {
  const changes: ChangeSpec[] = [];
  for (const number of new Set(lines)) {
    if (number < 1 || number > state.doc.lines) continue;
    const line = state.doc.line(number);
    const change = taskToggleChange(line.text, line.from);
    if (change) changes.push(change);
  }
  return changes;
}

/** Flips the tasks on these lines as one undoable edit. `false` when there was none to flip. */
export function toggleTasksOnLines(view: EditorView, lines: Iterable<number>): boolean {
  if (view.state.readOnly) return false;
  const changes = taskChanges(view.state, lines);
  if (changes.length === 0) return false;
  view.dispatch({ changes, userEvent: 'input.toggleTask' });
  return true;
}

/** Every line any selection range touches, so a selection over five tasks flips all five. */
function selectedLines(state: EditorState): number[] {
  const lines: number[] = [];
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let line = first; line <= last; line += 1) lines.push(line);
  }
  return lines;
}

/** The command: flips the task(s) under the caret(s). */
export function toggleTaskAtSelection(view: EditorView): boolean {
  return toggleTasksOnLines(view, selectedLines(view.state));
}

const boxMark = Decoration.mark({ class: 'cm-taskBox' });

const boxMatcher = new MatchDecorator({
  regexp: /^(?:[ \t]*>[ \t]?)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ xX]\](?=[ \t]|$)/g,
  decorate: (add, _from, to) => add(to - 3, to, boxMark),
});

const boxDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = boxMatcher.createDeco(view);
    }

    update(update: ViewUpdate) {
      this.decorations = boxMatcher.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * Ctrl+click on a box. At `Prec.high` so it is asked before CodeMirror turns
 * the same click into a second caret — and declines unless the click is on
 * the three characters of the box.
 */
const clickToToggle = Prec.high(
  EditorView.domEventHandlers({
    mousedown(event, view) {
      if (event.button !== 0 || !(event.ctrlKey || event.metaKey) || event.altKey) return false;
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (position === null) return false;
      const line = view.state.doc.lineAt(position);
      const box = findTaskBox(line.text);
      if (!box) return false;
      const start = line.from + box.start;
      if (position < start || position > start + 3) return false;
      if (!toggleTasksOnLines(view, [line.number])) return false;
      event.preventDefault();
      return true;
    },
  }),
);

/** Built once: a plugin's `build()` runs on every reconfigure and must stay cheap. */
const taskExtension: Extension = [
  Prec.high(keymap.of([{ key: 'Mod-Enter', run: toggleTaskAtSelection }])),
  clickToToggle,
  boxDecorations,
  EditorView.baseTheme({
    '.cm-taskBox': {
      borderRadius: '3px',
      background: 'color-mix(in srgb, var(--uwu-pink) 10%, transparent)',
    },
  }),
];

export function taskLists(): Extension {
  return taskExtension;
}
