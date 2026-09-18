/**
 * Record and replay, against a real `EditorView`.
 *
 * The whole point of a macro is that it is replayed *semantically* — the steps
 * say "go to the start of the line", not "edit offset 42" — and the only way to
 * show that is to run one against a real editor with a real undo history and
 * look at the text that comes out. So these tests build one, register it the
 * way a pane does, and drive `lib/macros.ts`'s public API.
 *
 * Two things are faked, both of them the environment rather than the code:
 * `test-support/fake-layout.ts` gives jsdom the rectangles CodeMirror measures,
 * and `lib/toast.ts` is spied on because a run reports itself by raising one
 * and there is no other way to read what it said.
 *
 * Every test starts from a fresh module graph. `lib/macros.ts` keeps its list,
 * its recording and its "is playing" flag in module-level variables, and a test
 * that inherited another one's would pass in the order it was written and
 * nowhere else.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { undo } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import type { Macro, MacroStep } from './macros';

vi.mock('./toast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./toast')>();
  // Only `toast` itself: the store behind it still exists for anything that
  // imports the rest, and a spy that swallowed the timer is one less stray
  // `setTimeout` outliving the test.
  return { ...actual, toast: vi.fn(() => 0) };
});

/** Where `lib/macros.ts` keeps the list. Hard-coded here so a rename is loud. */
const STORE_KEY = 'uwunotes.macros';

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * A module graph that has never seen another test, with `stored` already in
 * storage — which is also how a macro gets into the list without recording one.
 */
async function freshMacros(stored: readonly unknown[] = []) {
  vi.resetModules();
  window.localStorage.clear();
  window.localStorage.setItem(STORE_KEY, JSON.stringify(stored));
  const macros = await import('./macros');
  const { mountEditor, typeInto } = await import('../test-support/editor');
  const { toast } = await import('./toast');
  return { macros, mountEditor, typeInto, toast: vi.mocked(toast) };
}

/** A saved macro under a known id, built fresh so no test can edit another's. */
function macroOf(...steps: MacroStep[]): Macro {
  return { id: 'macro-1', name: 'Test', steps, shortcut: null };
}

function textOf(view: EditorView): string {
  return view.state.doc.toString();
}

function press(view: EditorView, key: string): void {
  view.contentDOM.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
}

/* ── Playing ───────────────────────────────────────────── */

describe('playing a macro', () => {
  it('walks down the file instead of editing where it was recorded', async () => {
    const { macros, mountEditor } = await freshMacros([
      macroOf(
        { kind: 'editor', name: 'cursorLineStart' },
        { kind: 'input', text: '>> ' },
        { kind: 'editor', name: 'cursorLineDown' },
      ),
    ]);
    const { view, dispose } = mountEditor('one\ntwo\nthree\nfour');
    view.dispatch({ selection: { anchor: 0 } });

    await macros.playMacro('macro-1', 3);

    // Three runs, three successive lines. A macro that replayed transactions
    // would have put all three prefixes in front of `one`.
    expect(textOf(view)).toBe('>> one\n>> two\n>> three\nfour');
    dispose();
  });

  it('stops at the end of the file rather than running to the ceiling', async () => {
    const { macros, mountEditor, toast } = await freshMacros([
      macroOf(
        { kind: 'editor', name: 'cursorLineStart' },
        { kind: 'input', text: '- ' },
        { kind: 'editor', name: 'cursorLineDown' },
      ),
    ]);
    const { view, dispose } = mountEditor('one\ntwo\nthree\nfour');
    view.dispatch({ selection: { anchor: 0 } });

    await macros.playUntilEndOfFile('macro-1');

    expect(textOf(view)).toBe('- one\n- two\n- three\n- four');
    expect(toast).not.toHaveBeenCalledWith('info', expect.stringContaining('10000'));
    dispose();
  });

  it('ends the run when a step has nothing it can do', async () => {
    const { macros, mountEditor, toast } = await freshMacros([
      macroOf({ kind: 'editor', name: 'deleteCharForward' }, { kind: 'input', text: '!' }),
    ]);
    const { view, dispose } = mountEditor('one\ntwo');
    // Nothing left to delete forwards, so the first step declines and the `!`
    // of the second step must never reach the document.
    view.dispatch({ selection: { anchor: view.state.doc.length } });

    await macros.playMacro('macro-1', 20);

    expect(textOf(view)).toBe('one\ntwo');
    expect(toast).toHaveBeenCalledWith('error', expect.stringContaining('deleteCharForward'));
    dispose();
  });

  it('keeps what the earlier steps did when a search finds nothing', async () => {
    const { macros, mountEditor, toast } = await freshMacros([
      macroOf(
        { kind: 'input', text: 'X' },
        {
          kind: 'find',
          query: 'nowhere',
          regex: false,
          caseSensitive: false,
          wholeWord: false,
          back: false,
        },
        { kind: 'input', text: 'Y' },
      ),
    ]);
    const { view, dispose } = mountEditor('one\ntwo');
    view.dispatch({ selection: { anchor: 0 } });

    await macros.playMacro('macro-1', 4);

    // The X of the first step stays; the Y after the failed search never ran.
    expect(textOf(view)).toBe('Xone\ntwo');
    expect(toast).toHaveBeenCalledWith('error', expect.stringContaining('nowhere'));
    dispose();
  });

  it('moves the selection to each following match in turn', async () => {
    const { macros, mountEditor } = await freshMacros([
      macroOf(
        {
          kind: 'find',
          query: 'cat',
          regex: false,
          caseSensitive: false,
          wholeWord: false,
          back: false,
        },
        { kind: 'input', text: 'dog' },
      ),
    ]);
    const { view, dispose } = mountEditor('cat\ncat\ncat');
    view.dispatch({ selection: { anchor: 0 } });

    await macros.playUntilEndOfFile('macro-1');

    expect(textOf(view)).toBe('dog\ndog\ndog');
    dispose();
  });

  it('refuses to play with no file open', async () => {
    const { macros, toast } = await freshMacros([macroOf({ kind: 'input', text: 'x' })]);

    await macros.playMacro('macro-1', 1);

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0]?.[0]).toBe('info');
  });

  it('runs no more than its ceiling of repetitions', async () => {
    const { macros, mountEditor, toast } = await freshMacros([
      macroOf({ kind: 'input', text: 'x' }),
    ]);
    const { view, dispose } = mountEditor('.....');
    view.dispatch({ selection: { anchor: 0 } });

    // Typing one character per run never reaches the end of the file — the
    // document grows exactly as fast as the caret does — so only the ceiling
    // can end this, and it has to.
    await macros.playUntilEndOfFile('macro-1');

    expect(textOf(view)).toBe(`${'x'.repeat(10_000)}.....`);
    expect(toast).toHaveBeenCalledWith('info', expect.stringContaining('10000'));
    dispose();
  }, 60_000);
});

/* ── The undo history ──────────────────────────────────── */

describe('undoing a macro', () => {
  it('puts a whole run back in one press', async () => {
    const { macros, mountEditor } = await freshMacros([
      macroOf(
        { kind: 'editor', name: 'cursorLineStart' },
        { kind: 'input', text: '>> ' },
        { kind: 'editor', name: 'cursorLineDown' },
      ),
    ]);
    const { view, dispose } = mountEditor('one\ntwo\nthree\nfour');
    view.dispatch({ selection: { anchor: 0 } });
    const before = textOf(view);

    await macros.playMacro('macro-1', 3);
    expect(textOf(view)).not.toBe(before);

    expect(undo(view)).toBe(true);
    expect(textOf(view)).toBe(before);
    // And nothing of the run is left behind for a second press to find.
    expect(undo(view)).toBe(false);
    dispose();
  });

  it('puts a run that stopped halfway back in one press too', async () => {
    const { macros, mountEditor } = await freshMacros([
      macroOf(
        { kind: 'input', text: 'X' },
        { kind: 'editor', name: 'cursorLineDown' },
        { kind: 'input', text: 'Y' },
      ),
    ]);
    const { view, dispose } = mountEditor('one\ntwo');
    view.dispatch({ selection: { anchor: 0 } });

    await macros.playMacro('macro-1', 6);
    expect(textOf(view)).not.toBe('one\ntwo');

    expect(undo(view)).toBe(true);
    expect(textOf(view)).toBe('one\ntwo');
    dispose();
  });

  it('gives each run an undo step of its own', async () => {
    const { macros, mountEditor } = await freshMacros([macroOf({ kind: 'input', text: 'x' })]);
    const { view, dispose } = mountEditor('.');
    view.dispatch({ selection: { anchor: 0 } });

    await macros.playMacro('macro-1', 2);
    await macros.playMacro('macro-1', 2);
    expect(textOf(view)).toBe('xxxx.');

    undo(view);
    expect(textOf(view)).toBe('xx.');
    undo(view);
    expect(textOf(view)).toBe('.');
    dispose();
  });
});

/* ── Recording ─────────────────────────────────────────── */

describe('recording a macro', () => {
  it('captures the command a key stands for, not the key', async () => {
    const { macros, mountEditor } = await freshMacros();
    const { view, dispose } = mountEditor('hello\nworld');
    view.dispatch({ selection: { anchor: 3 } });

    macros.startRecording();
    press(view, 'Home');
    press(view, 'ArrowDown');
    macros.stopRecording();

    const id = macros.saveLastRecording('Walker');
    expect(macros.macroById(id)?.steps).toEqual([
      { kind: 'editor', name: 'cursorLineBoundaryBackward' },
      { kind: 'editor', name: 'cursorLineDown' },
    ]);
    // The keys did what they always do: the recorder is a witness, not an actor.
    expect(view.state.selection.main.head).toBe(6);
    dispose();
  });

  it('captures what was typed, as one step per run of typing', async () => {
    const { macros, mountEditor, typeInto } = await freshMacros();
    const { view, dispose } = mountEditor('one\ntwo');
    view.dispatch({ selection: { anchor: 0 } });

    macros.startRecording();
    await typeInto(view, '#');
    await typeInto(view, ' ');
    press(view, 'End');
    await typeInto(view, '!');
    macros.stopRecording();

    const id = macros.saveLastRecording('Prefix');
    expect(macros.macroById(id)?.steps).toEqual([
      // Three characters, two steps: consecutive typing is merged, so the step
      // count in the dialog means something to a person.
      { kind: 'input', text: '# ' },
      { kind: 'editor', name: 'cursorLineBoundaryForward' },
      { kind: 'input', text: '!' },
    ]);
    expect(textOf(view)).toBe('# one!\ntwo');
    dispose();
  });

  it('does the same thing again one line further down when it is played back', async () => {
    const { macros, mountEditor, typeInto } = await freshMacros();
    const { view, dispose } = mountEditor('one\ntwo\nthree');
    view.dispatch({ selection: { anchor: 0 } });

    macros.startRecording();
    await typeInto(view, '# ');
    press(view, 'ArrowDown');
    press(view, 'Home');
    macros.stopRecording();
    expect(textOf(view)).toBe('# one\ntwo\nthree');

    // The whole feature, end to end: real keys in, a saved macro, and the same
    // edit again where the caret is now.
    await macros.playMacro(macros.saveLastRecording('Heading'), 2);

    expect(textOf(view)).toBe('# one\n# two\n# three');
    dispose();
  });

  it('records nothing of a replay that happens while it is running', async () => {
    const { macros, mountEditor } = await freshMacros([
      macroOf({ kind: 'command', id: 'view.toggleWrap' }),
    ]);
    const { getSettings } = await import('./settings');
    const { dispose } = mountEditor('hello');
    const wrapBefore = getSettings().wrap;

    macros.startRecording();
    await macros.playMacro('macro-1', 1);
    macros.stopRecording();

    // The command did run — an app command a user invokes *is* recorded, so
    // without the guard in `pushStep` this replay would have recorded itself
    // and playing a macro during a recording would double it.
    expect(getSettings().wrap).not.toBe(wrapBefore);
    expect(macros.hasLastRecording()).toBe(false);
    dispose();
  });

  it('refuses to record with no file open', async () => {
    const { macros } = await freshMacros();

    macros.startRecording();

    expect(macros.isRecording()).toBe(false);
  });
});

/* ── Storage ───────────────────────────────────────────── */

describe('the stored list', () => {
  it('gives back the macro that was saved, to the last flag', async () => {
    const { macros, mountEditor } = await freshMacros();
    const { view, dispose } = mountEditor('hello\nworld');
    view.dispatch({ selection: { anchor: 0 } });

    macros.startRecording();
    press(view, 'End');
    macros.recordCommand('file.save');
    macros.recordFind({
      query: 'wor',
      regex: false,
      caseSensitive: true,
      wholeWord: false,
      back: true,
    });
    macros.stopRecording();
    const id = macros.saveLastRecording('Round trip');
    const saved = macros.macroById(id);
    dispose();

    // A second module graph reads the same storage, which is what a restart is.
    vi.resetModules();
    const reloaded = await import('./macros');
    expect(reloaded.savedMacros()).toEqual([saved]);
  });

  it('keeps a rename across a restart', async () => {
    const { macros } = await freshMacros([macroOf({ kind: 'input', text: 'x' })]);

    macros.renameMacro('macro-1', 'Renamed');

    vi.resetModules();
    const reloaded = await import('./macros');
    expect(reloaded.macroById('macro-1')?.name).toBe('Renamed');
  });

  it('drops the broken entries of a hand-edited list and keeps the rest', async () => {
    const { macros } = await freshMacros([
      'not a macro',
      42,
      null,
      { id: '', name: 'no id', steps: [{ kind: 'input', text: 'x' }], shortcut: null },
      { id: 'no-steps', name: 'empty', steps: [], shortcut: null },
      {
        id: 'only-junk',
        name: 'junk',
        steps: [{ kind: 'editor', name: 'notACommand' }, { kind: 'input', text: '' }, 7],
        shortcut: null,
      },
      {
        id: 'good',
        name: 'Good',
        steps: [
          { kind: 'input', text: 'x' },
          { kind: 'editor', name: 'notACommand' },
          { kind: 'editor', name: 'cursorLineDown' },
        ],
        shortcut: 'Ctrl+Shift+KeyM',
      },
    ]);

    expect(macros.savedMacros()).toEqual([
      {
        id: 'good',
        name: 'Good',
        // The unknown command name is dropped here rather than at playback.
        steps: [
          { kind: 'input', text: 'x' },
          { kind: 'editor', name: 'cursorLineDown' },
        ],
        shortcut: 'Ctrl+Shift+KeyM',
      },
    ]);
  });

  it('gives one key to one macro', async () => {
    const { macros } = await freshMacros([
      { id: 'first', name: 'First', steps: [{ kind: 'input', text: 'a' }], shortcut: 'Ctrl+KeyJ' },
      {
        id: 'second',
        name: 'Second',
        steps: [{ kind: 'input', text: 'b' }],
        shortcut: 'Ctrl+KeyJ',
      },
    ]);

    expect(macros.macroWithShortcut('Ctrl+KeyJ')?.id).toBe('first');
    expect(macros.macroById('second')?.shortcut).toBeNull();
  });

  it('is empty rather than broken when the store is not JSON', async () => {
    vi.resetModules();
    window.localStorage.clear();
    window.localStorage.setItem(STORE_KEY, '{"unclosed": ');

    const macros = await import('./macros');

    expect(macros.savedMacros()).toEqual([]);
  });

  it('is empty rather than broken when the store is the wrong shape', async () => {
    vi.resetModules();
    window.localStorage.clear();
    window.localStorage.setItem(STORE_KEY, '{"macros": "all of them"}');

    const macros = await import('./macros');

    expect(macros.savedMacros()).toEqual([]);
  });
});
