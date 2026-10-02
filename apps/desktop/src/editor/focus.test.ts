/**
 * Focus dimming's idea of "the paragraph", and when typewriter scrolling
 * steps in.
 *
 * Both are checked on bare `EditorState`s: which lines stay bright is a
 * question about the text, and whether a transaction asks to be centred is a
 * question about the transaction. Neither needs a view, and the opacity is
 * the stylesheet's.
 */

import { EditorState, Text, type TransactionSpec } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../lib/settings';
import { focusBlock, focusExtensions } from './focus';

const doc = Text.of([
  'Erster Absatz,', // 1
  'zweite Zeile.', // 2
  '', // 3
  '   ', // 4
  'function foo() {', // 5
  '  return 1;', // 6
  '}', // 7
]);

describe('the block under the caret', () => {
  it('is the run of non-blank lines around it', () => {
    expect(focusBlock(doc, 1)).toEqual({ from: 1, to: 2 });
    expect(focusBlock(doc, 2)).toEqual({ from: 1, to: 2 });
    expect(focusBlock(doc, 6)).toEqual({ from: 5, to: 7 });
  });

  it('is just the line itself on a blank or whitespace-only line', () => {
    expect(focusBlock(doc, 3)).toEqual({ from: 3, to: 3 });
    expect(focusBlock(doc, 4)).toEqual({ from: 4, to: 4 });
  });

  it('stops looking after a few hundred lines in a file with no blank ones', () => {
    const wall = Text.of(Array.from({ length: 2_000 }, (_, index) => `line ${index}`));
    const block = focusBlock(wall, 1_000);
    expect(block.from).toBe(600);
    expect(block.to).toBe(1_400);
  });
});

/**
 * Whether this transaction picked up an effect on its way through. The specs
 * below carry none of their own, so any effect is the extender's request to
 * centre the caret — CodeMirror exports the factory for that effect, not its
 * type, so it cannot be matched more precisely from outside.
 */
function centres(state: EditorState, spec: TransactionSpec): boolean {
  return state.update(spec).effects.length > 0;
}

describe('typewriter scrolling', () => {
  const on = EditorState.create({
    doc: 'eins\nzwei\ndrei',
    extensions: focusExtensions({ ...DEFAULT_SETTINGS, typewriterScrolling: true }, false),
  });
  const off = EditorState.create({
    doc: 'eins\nzwei\ndrei',
    extensions: focusExtensions(DEFAULT_SETTINGS, false),
  });

  it('centres after typing and after moving the caret by keyboard', () => {
    expect(centres(on, { changes: { from: 0, insert: 'x' }, userEvent: 'input.type' })).toBe(true);
    expect(centres(on, { selection: { anchor: 6 }, userEvent: 'select' })).toBe(true);
  });

  it('leaves a click where it landed, and programmatic changes alone', () => {
    expect(centres(on, { selection: { anchor: 6 }, userEvent: 'select.pointer' })).toBe(false);
    expect(centres(on, { selection: { anchor: 6 } })).toBe(false);
  });

  it('does nothing when it is switched off', () => {
    expect(centres(off, { changes: { from: 0, insert: 'x' }, userEvent: 'input.type' })).toBe(
      false,
    );
  });

  it('is on in zen mode by default, without the everywhere setting', () => {
    const zen = EditorState.create({
      doc: 'eins',
      extensions: focusExtensions(DEFAULT_SETTINGS, true),
    });
    expect(centres(zen, { changes: { from: 0, insert: 'x' }, userEvent: 'input.type' })).toBe(true);
  });
});
