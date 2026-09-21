/**
 * The keyboard, one layer below the keys.
 *
 * `lib/shortcuts.ts` matches on `event.code` — where the key sits, not what is
 * printed on it — so that Ctrl+S is the same finger on QWERTZ as on QWERTY, and
 * it treats Alt as a disqualifier, because Windows reports AltGr as Ctrl+Alt and
 * AltGr+7 has to stay a `{`. Neither claim can be checked by one person at one
 * keyboard, and driving the real app does not check them either: the automation
 * sends keydowns whose `code` is the empty string, which matches nothing at all.
 * A synthesised event carries whatever `code` it is given, so this is the layer
 * where those two rules can actually be held to.
 *
 * What the commands then do is mocked away. The question here is only which one
 * the dispatch asks for — `file.save` writing a file is `lib/files.ts`'s job and
 * is its own problem.
 *
 * The listener is the module's only state, and `installShortcuts` hangs it on
 * the window, so every test gets a fresh one and takes it back off afterwards.
 * A leaked listener would answer the next test's keys as well, and the test that
 * asserts the teardown works would be the one passing by accident.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCommand } from './commands';
import { macroWithShortcut, playMacro } from './macros';
import type { Macro } from './macros';
import {
  installShortcuts,
  macroShortcutFromEvent,
  macroShortcutTaken,
  macroShortcutText,
  normalizeMacroShortcut,
} from './shortcuts';
import { activateTabAt, cyclePane } from './workspace';

vi.mock('./commands', () => ({ runCommand: vi.fn() }));
vi.mock('./workspace', () => ({ activateTabAt: vi.fn(), cyclePane: vi.fn() }));
// `macroWithShortcut` reading the stored list is `macros.test.ts`'s ground to
// cover; here it is the knob that says whether a macro claims these keys.
vi.mock('./macros', () => ({ macroWithShortcut: vi.fn(), playMacro: vi.fn() }));

const command = vi.mocked(runCommand);
const macroFor = vi.mocked(macroWithShortcut);
const play = vi.mocked(playMacro);
const tabAt = vi.mocked(activateTabAt);
const pane = vi.mocked(cyclePane);

let uninstall: (() => void) | null = null;

beforeEach(() => {
  vi.resetAllMocks();
  uninstall = installShortcuts();
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
});

/**
 * A key press as the browser would report it.
 *
 * `code` and `key` are separate on purpose and neither has a default worth
 * guessing: a test that leaves out the `key` of a letter is saying the dispatch
 * must not look at it.
 */
type Combo = {
  code?: string;
  key?: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
};

function press(combo: Combo): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    code: combo.code ?? '',
    key: combo.key ?? '',
    ctrlKey: combo.ctrl ?? false,
    shiftKey: combo.shift ?? false,
    altKey: combo.alt ?? false,
    metaKey: combo.meta ?? false,
    bubbles: true,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

/** The command a combination asks for, or `null` when it asks for nothing. */
function commandFor(combo: Combo): string | null {
  command.mockClear();
  press(combo);
  return command.mock.calls[0]?.[0] ?? null;
}

/** A macro under a known id, built fresh so no test can edit another's. */
function macroOf(shortcut: string): Macro {
  return { id: 'macro-1', name: 'Test', steps: [{ kind: 'input', text: 'x' }], shortcut };
}

/* ── The listener ──────────────────────────────────────── */

describe('installing the listener', () => {
  it('runs the command a combination is bound to', () => {
    expect(commandFor({ code: 'KeyN', key: 'n', ctrl: true })).toBe('file.new');
    expect(commandFor({ code: 'KeyS', key: 's', ctrl: true })).toBe('file.save');
    expect(commandFor({ code: 'KeyF', key: 'f', ctrl: true })).toBe('find.find');
    expect(commandFor({ code: 'KeyG', key: 'g', ctrl: true })).toBe('find.gotoLine');
    expect(commandFor({ code: 'Comma', key: ',', ctrl: true })).toBe('app.settings');
  });

  it('tells the shifted half of a pair from the unshifted one', () => {
    expect(commandFor({ code: 'KeyO', key: 'o', ctrl: true })).toBe('file.open');
    expect(commandFor({ code: 'KeyO', key: 'O', ctrl: true, shift: true })).toBe('file.openFolder');
    expect(commandFor({ code: 'KeyW', key: 'w', ctrl: true })).toBe('file.close');
    expect(commandFor({ code: 'KeyW', key: 'W', ctrl: true, shift: true })).toBe('file.closeAll');
    // Ctrl+E alone is nothing; only the shifted one splits.
    expect(commandFor({ code: 'KeyE', key: 'e', ctrl: true })).toBe(null);
    expect(commandFor({ code: 'KeyE', key: 'E', ctrl: true, shift: true })).toBe('view.splitRight');
  });

  it('gives the tab keys and their browser-shaped twins the same commands', () => {
    expect(commandFor({ code: 'Tab', key: 'Tab', ctrl: true })).toBe('tab.next');
    expect(commandFor({ code: 'Tab', key: 'Tab', ctrl: true, shift: true })).toBe('tab.previous');
    expect(commandFor({ code: 'PageDown', key: 'PageDown', ctrl: true })).toBe('tab.next');
    expect(commandFor({ code: 'PageUp', key: 'PageUp', ctrl: true })).toBe('tab.previous');
  });

  it('stops listening when its teardown is called', () => {
    uninstall?.();
    uninstall = null;

    const event = press({ code: 'KeyS', key: 's', ctrl: true });

    expect(command).not.toHaveBeenCalled();
    // And the key is left to whoever else wants it, rather than swallowed by a
    // listener that is no longer there to do anything with it.
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('the default action', () => {
  it('is prevented for a combination the app answers to', () => {
    expect(press({ code: 'KeyS', key: 's', ctrl: true }).defaultPrevented).toBe(true);
    expect(press({ code: 'F6', key: 'F6' }).defaultPrevented).toBe(true);
    expect(press({ code: 'Digit1', key: '1', ctrl: true }).defaultPrevented).toBe(true);
  });

  it('is left alone for everything else', () => {
    // An editor that swallows the keys it has no use for is an editor that
    // breaks typing, so this is the more important half of the pair.
    expect(press({ code: 'KeyJ', key: 'j', ctrl: true }).defaultPrevented).toBe(false);
    expect(press({ code: 'KeyK', key: 'k', ctrl: true, shift: true }).defaultPrevented).toBe(false);
    expect(press({ code: 'KeyA', key: 'a' }).defaultPrevented).toBe(false);
    expect(press({ code: 'Space', key: ' ' }).defaultPrevented).toBe(false);
  });
});

/* ── Alt is never a modifier ───────────────────────────── */

describe('AltGr', () => {
  it('keeps its brace: Ctrl+Alt+7 matches nothing', () => {
    // Windows reports AltGr as Ctrl+Alt, so on a German keyboard this event is
    // what a person typing `{` produces. If it ever reaches a command, the app
    // has taken a brace away from everyone who writes code on a German layout.
    const event = press({ code: 'Digit7', key: '{', ctrl: true, alt: true });

    expect(command).not.toHaveBeenCalled();
    expect(tabAt).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    // Without the Alt the same physical key is the seventh tab, which is what
    // makes the line above a rule rather than an accident of the table.
    press({ code: 'Digit7', key: '7', ctrl: true });
    expect(tabAt).toHaveBeenCalledWith(6);
  });

  it('disqualifies a combination that would otherwise be bound', () => {
    expect(commandFor({ code: 'KeyS', key: 's', ctrl: true, alt: true })).toBe(null);
    expect(commandFor({ code: 'KeyQ', key: '@', ctrl: true, alt: true })).toBe(null);
    expect(commandFor({ code: 'KeyP', key: 'P', ctrl: true, shift: true, alt: true })).toBe(null);
    // Neither does Alt on its own, and neither does the Windows key.
    expect(commandFor({ code: 'KeyS', key: 's', alt: true })).toBe(null);
    expect(commandFor({ code: 'KeyS', key: 's', ctrl: true, meta: true })).toBe(null);
  });

  it('never gets as far as a macro', () => {
    macroFor.mockReturnValue(macroOf('Ctrl+KeyJ'));

    press({ code: 'KeyJ', key: 'j', ctrl: true, alt: true });

    expect(macroFor).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });
});

/* ── Physical keys, not printed ones ───────────────────── */

describe('matching by code', () => {
  it('follows the key where a German layout put it', () => {
    // The key printed Z on QWERTZ is `KeyY`: same place under the hand as the Y
    // of QWERTY, different letter on the cap. The binding goes with the place.
    expect(commandFor({ code: 'KeyY', key: 'z', ctrl: true, shift: true })).toBe('macro.playLast');
    expect(commandFor({ code: 'KeyZ', key: 'y', ctrl: true, shift: true })).toBe(null);
  });

  it('ignores the printed character even when there is none to read', () => {
    // Some input methods report `key` as this, or as nothing at all. The
    // dispatch never looks, so neither case changes anything.
    expect(commandFor({ code: 'KeyS', key: 'Unidentified', ctrl: true })).toBe('file.save');
    expect(commandFor({ code: 'KeyS', ctrl: true })).toBe('file.save');
  });

  it('matches nothing at all when the code is empty', () => {
    // Exactly what UI automation sends, and the reason this file exists rather
    // than a recorded session: an event without a code is not a key press the
    // app can answer, and it must not become a random one either.
    expect(commandFor({ key: 's', ctrl: true })).toBe(null);
    expect(commandFor({ key: 'F6' })).toBe(null);
    expect(pane).not.toHaveBeenCalled();
  });

  it('takes zoom by the character instead, because there the print is the point', () => {
    // Whichever key makes a `+` is the zoom key; on QWERTZ that is `BracketRight`
    // and on QWERTY it is `Equal`, and neither user should have to care.
    expect(commandFor({ code: 'BracketRight', key: '+', ctrl: true })).toBe('view.zoomIn');
    expect(commandFor({ code: 'Equal', key: '=', ctrl: true })).toBe('view.zoomIn');
    expect(commandFor({ code: 'Slash', key: '-', ctrl: true })).toBe('view.zoomOut');
    expect(commandFor({ code: 'Minus', key: '-', ctrl: true })).toBe('view.zoomOut');
    // Reset is a digit and therefore back to the physical key.
    expect(commandFor({ code: 'Digit0', key: '0', ctrl: true })).toBe('view.zoomReset');
    expect(commandFor({ code: 'Numpad0', key: '0', ctrl: true })).toBe('view.zoomReset');
  });
});

/* ── What belongs to CodeMirror ────────────────────────── */

describe('the keys the editor already owns', () => {
  it('leaves clipboard, undo and select-all alone', () => {
    for (const code of ['KeyC', 'KeyV', 'KeyX', 'KeyZ', 'KeyA']) {
      const event = press({ code, key: code.slice(3).toLowerCase(), ctrl: true });

      expect(command).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    }
  });

  it('leaves the arrows alone, plain and with Ctrl', () => {
    for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
      expect(commandFor({ code, key: code })).toBe(null);
      // Ctrl+Arrow is CodeMirror's jump by word; it stays that.
      expect(commandFor({ code, key: code, ctrl: true })).toBe(null);
      expect(pane).not.toHaveBeenCalled();
    }
  });
});

/* ── Panes ─────────────────────────────────────────────── */

describe('F6', () => {
  it('cycles panes forwards, and backwards with Shift', () => {
    press({ code: 'F6', key: 'F6' });
    expect(pane).toHaveBeenCalledWith(false);

    press({ code: 'F6', key: 'F6', shift: true });
    expect(pane).toHaveBeenLastCalledWith(true);
  });

  it('wants no Ctrl, and no Alt', () => {
    press({ code: 'F6', key: 'F6', ctrl: true });
    press({ code: 'F6', key: 'F6', alt: true });

    expect(pane).not.toHaveBeenCalled();
  });
});

describe('Ctrl and a digit', () => {
  it('jumps straight to that tab, counting from zero', () => {
    press({ code: 'Digit1', key: '1', ctrl: true });
    expect(tabAt).toHaveBeenCalledWith(0);

    press({ code: 'Numpad9', key: '9', ctrl: true });
    expect(tabAt).toHaveBeenLastCalledWith(8);
  });

  it('is the ninth tab at most, and never the zeroth', () => {
    press({ code: 'Digit0', key: '0', ctrl: true });
    press({ code: 'Digit1', key: '!', ctrl: true, shift: true });

    expect(tabAt).not.toHaveBeenCalled();
  });
});

/* ── Macros ────────────────────────────────────────────── */

describe('a macro on its own key', () => {
  it('plays when its combination is pressed', () => {
    macroFor.mockImplementation((shortcut) =>
      shortcut === 'Ctrl+Shift+KeyJ' ? macroOf('Ctrl+Shift+KeyJ') : undefined,
    );

    const event = press({ code: 'KeyJ', key: 'J', ctrl: true, shift: true });

    expect(macroFor).toHaveBeenCalledWith('Ctrl+Shift+KeyJ');
    expect(play).toHaveBeenCalledWith('macro-1');
    expect(event.defaultPrevented).toBe(true);
  });

  it('loses to the app on a combination the app has', () => {
    // The lookup happens last for exactly this reason: whatever ends up in the
    // stored list, it cannot take Ctrl+S away from saving.
    macroFor.mockReturnValue(macroOf('Ctrl+KeyS'));

    expect(commandFor({ code: 'KeyS', key: 's', ctrl: true })).toBe('file.save');
    expect(play).not.toHaveBeenCalled();
  });

  it('loses to zoom as well, which is matched by the printed character', () => {
    macroFor.mockReturnValue(macroOf('Ctrl+Minus'));

    expect(commandFor({ code: 'Minus', key: '-', ctrl: true })).toBe('view.zoomOut');
    expect(play).not.toHaveBeenCalled();
    // A macro that can never run is worse than one that was refused, so the
    // dialog has to turn this key down before it is ever saved.
    expect(macroShortcutTaken('Ctrl+Minus')).toBe(true);
  });

  it('is never looked for on a key that could not carry one', () => {
    macroFor.mockReturnValue(macroOf('Ctrl+KeyJ'));

    press({ code: 'KeyJ', key: 'j' });
    press({ code: 'ControlLeft', key: 'Control', ctrl: true });

    expect(macroFor).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });
});

describe('reading a macro key off an event', () => {
  it('writes down Ctrl, the optional Shift, and the physical key', () => {
    const plain = new KeyboardEvent('keydown', { code: 'KeyJ', key: 'j', ctrlKey: true });
    const shifted = new KeyboardEvent('keydown', {
      code: 'KeyJ',
      key: 'J',
      ctrlKey: true,
      shiftKey: true,
    });

    expect(macroShortcutFromEvent(plain)).toBe('Ctrl+KeyJ');
    expect(macroShortcutFromEvent(shifted)).toBe('Ctrl+Shift+KeyJ');
  });

  it('refuses everything that cannot become one', () => {
    const cases: Combo[] = [
      { code: 'KeyJ', key: 'j' }, // no Ctrl: a plain letter is typing
      { code: 'KeyJ', key: 'j', ctrl: true, alt: true }, // AltGr again
      { code: 'KeyJ', key: 'j', ctrl: true, meta: true },
      { code: 'ControlLeft', key: 'Control', ctrl: true }, // a modifier alone
      { code: 'ShiftRight', key: 'Shift', ctrl: true, shift: true },
      { key: 's', ctrl: true }, // the empty code the automation sends
    ];

    for (const combo of cases) {
      const event = new KeyboardEvent('keydown', {
        code: combo.code ?? '',
        key: combo.key ?? '',
        ctrlKey: combo.ctrl ?? false,
        shiftKey: combo.shift ?? false,
        altKey: combo.alt ?? false,
        metaKey: combo.meta ?? false,
      });

      expect(macroShortcutFromEvent(event)).toBe(null);
    }
  });
});

describe('the stored spelling of a macro key', () => {
  it('round-trips its own output', () => {
    for (const text of ['Ctrl+KeyM', 'Ctrl+Shift+KeyM', 'Ctrl+Numpad5', 'Ctrl+F8']) {
      expect(normalizeMacroShortcut(text)).toBe(text);
    }
  });

  it('round-trips what an event produced', () => {
    const event = new KeyboardEvent('keydown', {
      code: 'KeyM',
      key: 'M',
      ctrlKey: true,
      shiftKey: true,
    });
    const written = macroShortcutFromEvent(event);

    expect(written).toBe('Ctrl+Shift+KeyM');
    expect(normalizeMacroShortcut(written ?? '')).toBe(written);
  });

  it('tidies a hand-edited line into the one spelling', () => {
    expect(normalizeMacroShortcut('Shift+Ctrl+KeyM')).toBe('Ctrl+Shift+KeyM');
    expect(normalizeMacroShortcut(' Ctrl + KeyM ')).toBe('Ctrl+KeyM');
    expect(normalizeMacroShortcut('Ctrl++KeyM')).toBe('Ctrl+KeyM');
  });

  it('gives back null for what is not a shortcut at all', () => {
    for (const text of ['', 'KeyM', 'Alt+KeyM', 'Ctrl+Alt+KeyM', 'Ctrl+', 'Strg+M', 'Ctrl+Shift']) {
      expect(normalizeMacroShortcut(text)).toBe(null);
    }
  });

  it('is shown as a key someone could find on a keyboard', () => {
    // `KeyM` is a fine thing to store and a terrible thing to put in a dialog.
    expect(macroShortcutText('Ctrl+Shift+KeyM')).toMatch(/\+M$/);
    expect(macroShortcutText('Ctrl+Digit4')).toMatch(/\+4$/);
    expect(macroShortcutText('Ctrl+Numpad5')).toMatch(/\+Num 5$/);
    // Nonsense is handed back unchanged rather than rendered as half of itself.
    expect(macroShortcutText('nonsense')).toBe('nonsense');
  });
});

describe('the keys a macro may not have', () => {
  it('refuses the ones the app is bound to', () => {
    expect(macroShortcutTaken('Ctrl+KeyS')).toBe(true);
    expect(macroShortcutTaken('Ctrl+Shift+KeyS')).toBe(true);
    expect(macroShortcutTaken('Ctrl+Tab')).toBe(true);
    expect(macroShortcutTaken('Ctrl+Comma')).toBe(true);
    expect(macroShortcutTaken('Ctrl+Shift+KeyY')).toBe(true);
  });

  it('refuses the digits, which are zoom and the tab jumps', () => {
    expect(macroShortcutTaken('Ctrl+Digit0')).toBe(true);
    expect(macroShortcutTaken('Ctrl+Digit1')).toBe(true);
    expect(macroShortcutTaken('Ctrl+Numpad9')).toBe(true);
  });

  it('refuses the zoom keys, which are matched by character and not by code', () => {
    // The trap this function exists to close: `actionFor` reads zoom off
    // `event.key`, so every physical key that prints a `+` or a `-` on a layout
    // the app runs under is spoken for, whatever its code says. A macro allowed
    // onto one of them would be accepted by the dialog and then never run, and
    // the user would have no way of finding out why.
    expect(macroShortcutTaken('Ctrl+Minus')).toBe(true);
    expect(macroShortcutTaken('Ctrl+Equal')).toBe(true);
    expect(macroShortcutTaken('Ctrl+Slash')).toBe(true);
    expect(macroShortcutTaken('Ctrl+BracketRight')).toBe(true);
    expect(macroShortcutTaken('Ctrl+NumpadAdd')).toBe(true);
    expect(macroShortcutTaken('Ctrl+NumpadSubtract')).toBe(true);
  });

  it('allows the ones nothing in the app answers to', () => {
    expect(macroShortcutTaken('Ctrl+KeyJ')).toBe(false);
    expect(macroShortcutTaken('Ctrl+Shift+KeyJ')).toBe(false);
    expect(macroShortcutTaken('Ctrl+F8')).toBe(false);
    expect(macroShortcutTaken('Ctrl+KeyE')).toBe(false);
  });

  it('treats what it cannot read as taken rather than free', () => {
    for (const text of ['', 'KeyJ', 'Alt+KeyJ', 'Ctrl+Shift', 'nonsense at all']) {
      expect(macroShortcutTaken(text)).toBe(true);
    }
  });
});
