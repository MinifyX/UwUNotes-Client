/**
 * Bookmarks: that they follow their line through edits, survive a reload,
 * and that the Notepad++ commands built on them do what they say — with
 * deleting the bookmarked lines one undo step.
 *
 * Mostly states rather than views, because the mapping is the interesting
 * part and a state is all it needs. The commands that take a view get a real
 * one, since `dispatch` is what they are about.
 */

import { history, undo } from '@codemirror/commands';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bookmarkedText,
  bookmarkLines,
  bookmarks,
  clearBookmarks,
  deleteBookmarkedLines,
  gotoBookmark,
  setBookmarksEffect,
  toggleBookmark,
  toggleBookmarkEffect,
} from './bookmarks';

const TEXT = ['one', 'two', 'three', 'four', 'five'].join('\n');

function stateWith(lines: number[], doc = TEXT): EditorState {
  const state = EditorState.create({ doc, extensions: [bookmarks] });
  return state.update({ effects: setBookmarksEffect.of(lines) }).state;
}

const views: EditorView[] = [];

function viewWith(lines: number[], doc = TEXT): EditorView {
  const view = new EditorView({
    state: EditorState.create({ doc, extensions: [history(), bookmarks] }),
    parent: document.body,
  });
  view.dispatch({ effects: setBookmarksEffect.of(lines) });
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
});

describe('the set', () => {
  it('restores from line numbers, dropping what does not exist and duplicates', () => {
    expect(bookmarkLines(stateWith([4, 2, 2, 0, 99, 1.5]))).toEqual([2, 4]);
  });

  it('toggles on the line of a position, on and off', () => {
    let state = stateWith([]);
    const inLineThree = state.doc.line(3).from + 2;
    state = state.update({ effects: toggleBookmarkEffect.of(inLineThree) }).state;
    expect(bookmarkLines(state)).toEqual([3]);
    state = state.update({ effects: toggleBookmarkEffect.of(state.doc.line(3).to) }).state;
    expect(bookmarkLines(state)).toEqual([]);
  });

  it('is empty for a state without the extension', () => {
    expect(bookmarkLines(EditorState.create({ doc: TEXT }))).toEqual([]);
  });
});

describe('following the text', () => {
  it('moves down when lines are inserted above', () => {
    const state = stateWith([3]);
    const next = state.update({ changes: { from: 0, insert: 'a\nb\n' } }).state;
    expect(bookmarkLines(next)).toEqual([5]);
  });

  it('moves with the line when Enter is pressed at its very start', () => {
    const state = stateWith([3]);
    const next = state.update({ changes: { from: state.doc.line(3).from, insert: '\n' } }).state;
    expect(bookmarkLines(next)).toEqual([4]);
    expect(next.doc.line(4).text).toBe('three');
  });

  it('survives deleting the whole line above it, newline and all', () => {
    const state = stateWith([3]);
    const above = state.doc.line(2);
    const next = state.update({ changes: { from: above.from, to: above.to + 1 } }).state;
    expect(bookmarkLines(next)).toEqual([2]);
    expect(next.doc.line(2).text).toBe('three');
  });

  it('folds two marks that end up on one line', () => {
    const state = stateWith([2, 3]);
    // Joining line 2 and 3 puts both marks on one line.
    const join = state.doc.line(2).to;
    const next = state.update({ changes: { from: join, to: join + 1 } }).state;
    expect(bookmarkLines(next)).toEqual([2]);
  });

  it('keeps line numbers when the whole document is replaced, as a reload does', () => {
    const state = stateWith([2, 5]);
    const next = state.update({
      changes: { from: 0, to: state.doc.length, insert: 'a\nb\nc\nd' },
    }).state;
    expect(bookmarkLines(next)).toEqual([2]);
  });

  it('survives a reconfigure, which is how settings reach a document', () => {
    const settings = new Compartment();
    const state = EditorState.create({ doc: TEXT, extensions: [bookmarks, settings.of([])] });
    const marked = state.update({ effects: setBookmarksEffect.of([2]) }).state;
    const next = marked.update({
      effects: settings.reconfigure(EditorState.tabSize.of(8)),
    }).state;
    expect(bookmarkLines(next)).toEqual([2]);
  });
});

describe('the commands', () => {
  it('walks forward and backward from the caret, wrapping round', () => {
    const view = viewWith([2, 4]);
    const lineOfCaret = () => view.state.doc.lineAt(view.state.selection.main.head).number;

    expect(gotoBookmark(view)).toBe(true);
    expect(lineOfCaret()).toBe(2);
    gotoBookmark(view);
    expect(lineOfCaret()).toBe(4);
    gotoBookmark(view);
    expect(lineOfCaret()).toBe(2);
    gotoBookmark(view, true);
    expect(lineOfCaret()).toBe(4);
  });

  it('has nowhere to go without bookmarks', () => {
    expect(gotoBookmark(viewWith([]))).toBe(false);
  });

  it('toggles at the caret and clears everything', () => {
    const view = viewWith([1]);
    view.dispatch({ selection: { anchor: view.state.doc.line(5).from } });
    toggleBookmark(view);
    expect(bookmarkLines(view.state)).toEqual([1, 5]);
    clearBookmarks(view);
    expect(bookmarkLines(view.state)).toEqual([]);
  });

  it('copies the bookmarked lines in order', () => {
    expect(bookmarkedText(stateWith([4, 1]))).toBe('one\nfour');
  });

  it('deletes the bookmarked lines in one undoable step', () => {
    const view = viewWith([2, 3, 5]);
    expect(deleteBookmarkedLines(view)).toBe(3);
    expect(view.state.doc.toString()).toBe('one\nfour');
    undo(view);
    expect(view.state.doc.toString()).toBe(TEXT);
  });

  it('deletes the last line together with the newline before it', () => {
    const view = viewWith([4, 5]);
    deleteBookmarkedLines(view);
    expect(view.state.doc.toString()).toBe('one\ntwo\nthree');
  });

  it('can delete every line', () => {
    const view = viewWith([1, 2, 3, 4, 5]);
    deleteBookmarkedLines(view);
    expect(view.state.doc.toString()).toBe('');
  });
});
