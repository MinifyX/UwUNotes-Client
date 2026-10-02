/**
 * Ticking off tasks in the editor: one transaction, one undo step, and a key
 * that only takes over on lines that actually are tasks.
 */

import { history, undo } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { taskLists, toggleTaskAtSelection, toggleTasksOnLines } from './tasks';

const views: EditorView[] = [];

function viewOf(doc: string, extra = taskLists()): EditorView {
  const view = new EditorView({
    state: EditorState.create({
      doc,
      extensions: [history(), extra, EditorState.allowMultipleSelections.of(true)],
    }),
    parent: document.body,
  });
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

describe('toggling', () => {
  it('flips the task on the caret line and back, undoably', () => {
    const view = viewOf('- [ ] milk\n- [x] bread');
    view.dispatch({ selection: { anchor: 4 } });
    expect(toggleTaskAtSelection(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('- [x] milk\n- [x] bread');
    undo(view);
    expect(view.state.doc.toString()).toBe('- [ ] milk\n- [x] bread');
  });

  it('flips every task a selection touches, in one step', () => {
    const view = viewOf('- [ ] a\nnot a task\n- [x] b\n- [ ] c');
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.line(3).to } });
    toggleTaskAtSelection(view);
    expect(view.state.doc.toString()).toBe('- [x] a\nnot a task\n- [ ] b\n- [ ] c');
    undo(view);
    expect(view.state.doc.toString()).toBe('- [ ] a\nnot a task\n- [x] b\n- [ ] c');
  });

  it('flips once per line even with two carets on it', () => {
    const view = viewOf('- [ ] a');
    view.dispatch({
      selection: EditorSelection.create([EditorSelection.cursor(1), EditorSelection.cursor(7)]),
    });
    toggleTaskAtSelection(view);
    expect(view.state.doc.toString()).toBe('- [x] a');
  });

  it('declines on a line without a task, so the key falls through', () => {
    const view = viewOf('just text');
    expect(toggleTaskAtSelection(view)).toBe(false);
    expect(view.state.doc.toString()).toBe('just text');
  });

  it('leaves the caret where it was', () => {
    const view = viewOf('- [ ] milk');
    view.dispatch({ selection: { anchor: 8 } });
    toggleTaskAtSelection(view);
    expect(view.state.selection.main.head).toBe(8);
  });

  it('does nothing in a read-only document', () => {
    const view = viewOf('- [ ] a', [taskLists(), EditorState.readOnly.of(true)]);
    expect(toggleTasksOnLines(view, [1])).toBe(false);
    expect(view.state.doc.toString()).toBe('- [ ] a');
  });

  it('skips lines that do not exist, as a stale preview click would name', () => {
    const view = viewOf('- [ ] a');
    expect(toggleTasksOnLines(view, [0, 9])).toBe(false);
  });
});
